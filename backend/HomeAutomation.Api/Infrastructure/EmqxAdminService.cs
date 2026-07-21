using System.Net.Http.Headers;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

namespace HomeAutomation.Api.Infrastructure;

/// <summary>
/// Provisions per-device MQTT credentials in EMQX Cloud via its REST API
/// (built-in database authentication + authorization). Each physical board
/// gets a unique username/password scoped to its own ha/&lt;hardwareId&gt;/# topics.
///
/// Configured from env: EMQX_API_ENDPOINT, EMQX_API_APP_ID, EMQX_API_APP_SECRET.
/// When any is absent the service is disabled (IsEnabled == false) and device
/// registration proceeds without provisioning — useful for local dev.
/// </summary>
public sealed class EmqxAdminService
{
    private readonly HttpClient _http;
    private readonly ILogger<EmqxAdminService> _logger;
    private readonly string? _endpoint;

    public bool IsEnabled => !string.IsNullOrWhiteSpace(_endpoint);

    public EmqxAdminService(IHttpClientFactory httpFactory, ILogger<EmqxAdminService> logger)
    {
        _logger = logger;
        _endpoint = Environment.GetEnvironmentVariable("EMQX_API_ENDPOINT")?.TrimEnd('/');
        var appId = Environment.GetEnvironmentVariable("EMQX_API_APP_ID");
        var appSecret = Environment.GetEnvironmentVariable("EMQX_API_APP_SECRET");

        _http = httpFactory.CreateClient("emqx");
        _http.Timeout = TimeSpan.FromSeconds(20);
        if (!string.IsNullOrWhiteSpace(appId) && !string.IsNullOrWhiteSpace(appSecret))
        {
            var basic = Convert.ToBase64String(Encoding.UTF8.GetBytes($"{appId}:{appSecret}"));
            _http.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Basic", basic);
        }
    }

    public sealed record Credential(string Username, string Password);

    /// <summary>
    /// Create (or reset) the credential for a board and scope it to its topics.
    /// Idempotent: deletes any existing user/rule first, then recreates with a
    /// fresh password. Returns null when the service is disabled.
    /// </summary>
    public async Task<Credential?> ProvisionAsync(string hardwareId)
    {
        if (!IsEnabled) return null;

        var username = $"dev-{hardwareId}";
        var password = GeneratePassword();

        // Reset first so re-registration rotates the password cleanly.
        await DeleteAsync(hardwareId);

        // 1) Create the auth user.
        var userBody = JsonSerializer.Serialize(new { user_id = username, password, is_superuser = false });
        using (var resp = await _http.PostAsync(
            $"{_endpoint}/authentication/password_based:built_in_database/users",
            new StringContent(userBody, Encoding.UTF8, "application/json")))
        {
            if (!resp.IsSuccessStatusCode)
            {
                _logger.LogError("EMQX create user failed for {Hw}: {Status}", hardwareId, resp.StatusCode);
                return null;
            }
        }

        // 2) Authorization rule: allow only this board's own topics.
        var aclBody = JsonSerializer.Serialize(new[]
        {
            new
            {
                username,
                rules = new[]
                {
                    new { topic = $"ha/{hardwareId}/#", action = "all", permission = "allow" }
                }
            }
        });
        using (var resp = await _http.PostAsync(
            $"{_endpoint}/authorization/sources/built_in_database/rules/users",
            new StringContent(aclBody, Encoding.UTF8, "application/json")))
        {
            if (!resp.IsSuccessStatusCode)
                _logger.LogWarning("EMQX ACL rule failed for {Hw}: {Status}", hardwareId, resp.StatusCode);
        }

        return new Credential(username, password);
    }

    /// <summary>Remove a board's credential and ACL rule (on device delete / rotate).</summary>
    public async Task DeleteAsync(string hardwareId)
    {
        if (!IsEnabled) return;
        var username = $"dev-{hardwareId}";
        try
        {
            using var r1 = await _http.DeleteAsync(
                $"{_endpoint}/authorization/sources/built_in_database/rules/users/{Uri.EscapeDataString(username)}");
            using var r2 = await _http.DeleteAsync(
                $"{_endpoint}/authentication/password_based:built_in_database/users/{Uri.EscapeDataString(username)}");
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "EMQX delete credential failed for {Hw}", hardwareId);
        }
    }

    // URL-safe, ~26 chars of entropy. No padding chars that trip up config files.
    private static string GeneratePassword()
    {
        Span<byte> bytes = stackalloc byte[20];
        RandomNumberGenerator.Fill(bytes);
        return Convert.ToBase64String(bytes).Replace("+", "").Replace("/", "").Replace("=", "");
    }
}
