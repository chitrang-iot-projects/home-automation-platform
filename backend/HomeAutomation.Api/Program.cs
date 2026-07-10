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

var app = builder.Build();

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
