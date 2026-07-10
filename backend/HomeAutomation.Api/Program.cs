using System.Security.Claims;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Npgsql;

var builder = WebApplication.CreateBuilder(args);

// DATABASE_URL is provided as an environment variable (Render → Environment).
// Neon supplies a URI-style string (postgresql://...); Npgsql needs keyword
// format, so normalize before use. When unset (e.g. fresh local checkout),
// the API still boots — /health/db reports "not_configured" instead of crashing.
var databaseUrl = Environment.GetEnvironmentVariable("DATABASE_URL");
if (!string.IsNullOrWhiteSpace(databaseUrl))
{
    builder.Services.AddSingleton(NpgsqlDataSource.Create(NormalizePostgresConnectionString(databaseUrl)));
}

// Firebase Authentication: validate Google-signed ID tokens (JWT bearer).
// No Firebase Admin SDK needed for verification — standard OIDC discovery.
var firebaseProjectId = builder.Configuration["Firebase:ProjectId"]
    ?? throw new InvalidOperationException("Firebase:ProjectId is not configured");

builder.Services
    .AddAuthentication(JwtBearerDefaults.AuthenticationScheme)
    .AddJwtBearer(options =>
    {
        options.Authority = $"https://securetoken.google.com/{firebaseProjectId}";
        options.TokenValidationParameters = new Microsoft.IdentityModel.Tokens.TokenValidationParameters
        {
            ValidateIssuer = true,
            ValidIssuer = $"https://securetoken.google.com/{firebaseProjectId}",
            ValidateAudience = true,
            ValidAudience = firebaseProjectId,
            ValidateLifetime = true
        };
    });

builder.Services.AddAuthorization();

var allowedOrigins = builder.Configuration.GetSection("Cors:AllowedOrigins").Get<string[]>() ?? [];
builder.Services.AddCors(options =>
    options.AddDefaultPolicy(policy =>
        policy.WithOrigins(allowedOrigins)
              .AllowAnyHeader()
              .AllowAnyMethod()));

var app = builder.Build();

app.UseCors();
app.UseAuthentication();
app.UseAuthorization();

app.MapGet("/", () => "Shree Ganeshay nammh:");

app.MapGet("/health", () => Results.Ok(new { status = "ok" }));

app.MapGet("/health/db", async (IServiceProvider services, ILogger<Program> logger) =>
{
    var dataSource = services.GetService<NpgsqlDataSource>();
    if (dataSource is null)
    {
        return Results.Ok(new { status = "not_configured", detail = "DATABASE_URL is not set" });
    }

    try
    {
        await using var command = dataSource.CreateCommand("SELECT count(*) FROM schema_migrations");
        var migrations = await command.ExecuteScalarAsync();
        return Results.Ok(new { status = "ok", database = "reachable", applied_migrations = migrations });
    }
    catch (Exception ex)
    {
        // Log the details server-side only; never return connection info to callers.
        logger.LogError(ex, "Database health check failed");
        return Results.Problem(title: "database unreachable", statusCode: StatusCodes.Status503ServiceUnavailable);
    }
});

// Returns the caller's platform profile, provisioning the row on first call.
// Requires a valid Firebase ID token (Authorization: Bearer <token>).
app.MapGet("/api/me", async (ClaimsPrincipal principal, IServiceProvider services, ILogger<Program> logger) =>
{
    var dataSource = services.GetService<NpgsqlDataSource>();
    if (dataSource is null)
    {
        return Results.Problem(title: "database not configured", statusCode: StatusCodes.Status503ServiceUnavailable);
    }

    // Firebase token: sub = uid (mapped to NameIdentifier), email, name.
    var firebaseUid = principal.FindFirstValue(ClaimTypes.NameIdentifier) ?? principal.FindFirstValue("sub");
    var email = principal.FindFirstValue(ClaimTypes.Email) ?? principal.FindFirstValue("email");
    var displayName = principal.FindFirstValue("name");

    if (string.IsNullOrEmpty(firebaseUid) || string.IsNullOrEmpty(email))
    {
        return Results.BadRequest(new { error = "token is missing uid or email claim" });
    }

    try
    {
        await using var command = dataSource.CreateCommand(
            """
            INSERT INTO users (firebase_uid, email, display_name)
            VALUES ($1, $2, $3)
            ON CONFLICT (firebase_uid) DO UPDATE
                SET email        = EXCLUDED.email,
                    display_name = COALESCE(EXCLUDED.display_name, users.display_name)
            RETURNING id, firebase_uid, email, display_name, role, is_active, created_at
            """);
        command.Parameters.AddWithValue(firebaseUid);
        command.Parameters.AddWithValue(email);
        command.Parameters.AddWithValue((object?)displayName ?? DBNull.Value);

        await using var reader = await command.ExecuteReaderAsync();
        await reader.ReadAsync();

        return Results.Ok(new
        {
            id = reader.GetGuid(0),
            firebase_uid = reader.GetString(1),
            email = reader.GetString(2),
            display_name = reader.IsDBNull(3) ? null : reader.GetString(3),
            role = reader.GetString(4),
            is_active = reader.GetBoolean(5),
            created_at = reader.GetDateTime(6)
        });
    }
    catch (Exception ex)
    {
        logger.LogError(ex, "Failed to load or provision user profile");
        return Results.Problem(title: "profile lookup failed", statusCode: StatusCodes.Status500InternalServerError);
    }
}).RequireAuthorization();

app.Run();

static string NormalizePostgresConnectionString(string raw)
{
    // Already in keyword format ("Host=...;Username=...") — pass through.
    if (!raw.StartsWith("postgres://", StringComparison.OrdinalIgnoreCase) &&
        !raw.StartsWith("postgresql://", StringComparison.OrdinalIgnoreCase))
    {
        return raw;
    }

    var uri = new Uri(raw);
    var userInfo = uri.UserInfo.Split(':', 2);

    var csb = new NpgsqlConnectionStringBuilder
    {
        Host = uri.Host,
        Port = uri.Port > 0 ? uri.Port : 5432,
        Username = Uri.UnescapeDataString(userInfo[0]),
        Password = userInfo.Length > 1 ? Uri.UnescapeDataString(userInfo[1]) : null,
        Database = uri.AbsolutePath.TrimStart('/'),
        SslMode = SslMode.Require   // Neon requires TLS
    };

    return csb.ConnectionString;
}
