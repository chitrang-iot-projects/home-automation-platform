using System.Threading.RateLimiting;
using HomeAutomation.Api.Endpoints;
using HomeAutomation.Api.Infrastructure;
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
    builder.Services.AddScoped<CurrentUserService>();

    // MQTT bridge (no-op when MQTT_* env vars absent) — see ai-documents/MQTT_CONTRACT.md.
    builder.Services.AddSingleton<MqttService>();
    builder.Services.AddHostedService(sp => sp.GetRequiredService<MqttService>());

    // Per-device MQTT credential provisioning via EMQX REST API (no-op when
    // EMQX_API_* env vars absent).
    builder.Services.AddHttpClient();
    builder.Services.AddScoped<EmqxAdminService>();
}

// Firebase Authentication: validate Google-signed ID tokens (JWT bearer).
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

// Basic abuse protection: 120 requests/min per client IP.
builder.Services.AddRateLimiter(options =>
{
    options.RejectionStatusCode = StatusCodes.Status429TooManyRequests;
    options.GlobalLimiter = PartitionedRateLimiter.Create<HttpContext, string>(ctx =>
        RateLimitPartition.GetFixedWindowLimiter(
            ctx.Connection.RemoteIpAddress?.ToString() ?? "unknown",
            _ => new FixedWindowRateLimiterOptions
            {
                Window = TimeSpan.FromMinutes(1),
                PermitLimit = 120,
                QueueLimit = 0
            }));

    // Stricter limit for the unauthenticated device provisioning endpoint.
    options.AddPolicy("provision", ctx =>
        RateLimitPartition.GetFixedWindowLimiter(
            ctx.Connection.RemoteIpAddress?.ToString() ?? "unknown",
            _ => new FixedWindowRateLimiterOptions
            {
                Window = TimeSpan.FromMinutes(1),
                PermitLimit = 20,
                QueueLimit = 0
            }));
});

var app = builder.Build();

app.UseCors();
app.UseRateLimiter();
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

if (!string.IsNullOrWhiteSpace(databaseUrl))
{
    UserEndpoints.Map(app);
    HomeEndpoints.Map(app);
    RoomEndpoints.Map(app);
    DeviceEndpoints.Map(app);
    ProvisionEndpoints.Map(app);
}

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
