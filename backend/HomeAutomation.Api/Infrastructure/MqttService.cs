using System.Text;
using System.Text.Json;
using Dapper;
using MQTTnet;
using MQTTnet.Protocol;
using Npgsql;

namespace HomeAutomation.Api.Infrastructure;

/// <summary>
/// Bridge between the EMQX broker and Postgres (see ai-documents/MQTT_CONTRACT.md).
/// Publishes relay commands; mirrors device-reported state and telemetry into the DB.
/// Disabled (no-op) when MQTT_* environment variables are absent.
/// </summary>
public sealed class MqttService : BackgroundService
{
    private readonly NpgsqlDataSource _db;
    private readonly ILogger<MqttService> _logger;
    private readonly string? _host;
    private readonly int _port;
    private readonly string? _username;
    private readonly string? _password;
    private IMqttClient? _client;

    public bool IsEnabled => !string.IsNullOrWhiteSpace(_host);
    public bool IsConnected => _client?.IsConnected ?? false;

    public MqttService(NpgsqlDataSource db, ILogger<MqttService> logger)
    {
        _db = db;
        _logger = logger;
        _host = Environment.GetEnvironmentVariable("MQTT_HOST");
        _port = int.TryParse(Environment.GetEnvironmentVariable("MQTT_PORT"), out var p) ? p : 8883;
        _username = Environment.GetEnvironmentVariable("MQTT_USERNAME");
        _password = Environment.GetEnvironmentVariable("MQTT_PASSWORD");
    }

    /// <summary>Publish a relay command: ha/{hardwareId}/relay/{channelNo}/set = "1"|"0".</summary>
    public async Task PublishRelayCommandAsync(string hardwareId, int channelNo, bool on)
    {
        if (_client is not { IsConnected: true })
        {
            _logger.LogWarning("MQTT not connected; command for {HardwareId} relay {Channel} not published", hardwareId, channelNo);
            return;
        }

        var message = new MqttApplicationMessageBuilder()
            .WithTopic($"ha/{hardwareId}/relay/{channelNo}/set")
            .WithPayload(on ? "1" : "0")
            .WithQualityOfServiceLevel(MqttQualityOfServiceLevel.AtLeastOnce)
            .Build();
        await _client.PublishAsync(message);
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        if (!IsEnabled)
        {
            _logger.LogInformation("MQTT disabled (MQTT_HOST not set)");
            return;
        }

        var factory = new MqttClientFactory();
        _client = factory.CreateMqttClient();

        _client.ApplicationMessageReceivedAsync += HandleMessageAsync;

        var options = new MqttClientOptionsBuilder()
            .WithTcpServer(_host, _port)
            .WithCredentials(_username, _password)
            .WithTlsOptions(o => o.UseTls())
            .WithClientId($"api-server-{Environment.MachineName}")
            .WithCleanSession(false)
            .WithSessionExpiryInterval(3600)
            .Build();

        // Reconnect loop — keep trying for the lifetime of the app.
        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                if (!_client.IsConnected)
                {
                    await _client.ConnectAsync(options, stoppingToken);
                    await _client.SubscribeAsync(new MqttClientSubscribeOptionsBuilder()
                        .WithTopicFilter("ha/+/relay/+", MqttQualityOfServiceLevel.AtLeastOnce)
                        .WithTopicFilter("ha/+/status", MqttQualityOfServiceLevel.AtLeastOnce)
                        .Build(), stoppingToken);
                    _logger.LogInformation("MQTT connected to {Host}:{Port} and subscribed", _host, _port);
                }
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                _logger.LogError(ex, "MQTT connect failed; retrying in 15s");
            }

            await Task.Delay(TimeSpan.FromSeconds(15), stoppingToken);
        }
    }

    private async Task HandleMessageAsync(MqttApplicationMessageReceivedEventArgs args)
    {
        try
        {
            var topic = args.ApplicationMessage.Topic;
            var payload = Encoding.UTF8.GetString(args.ApplicationMessage.Payload);
            var parts = topic.Split('/');
            if (parts.Length < 3 || parts[0] != "ha") return;

            var hardwareId = parts[1];

            // ha/<hw>/relay/<n>  (reported state; ignore the /set command echo)
            if (parts.Length == 4 && parts[2] == "relay" && int.TryParse(parts[3], out var channelNo))
            {
                var on = payload == "1";
                await using var conn = await _db.OpenConnectionAsync();
                await conn.ExecuteAsync(
                    """
                    UPDATE devices
                    SET state = jsonb_set(state, ARRAY['relay' || @channelNo::text], to_jsonb(@on), true),
                        last_seen_at = now(), is_online = true
                    WHERE hardware_id = @hardwareId
                    """, new { hardwareId, channelNo, on });
                return;
            }

            // ha/<hw>/status  (telemetry / LWT)
            if (parts.Length == 3 && parts[2] == "status")
            {
                using var doc = JsonDocument.Parse(payload);
                var root = doc.RootElement;
                var online = root.TryGetProperty("online", out var o) && o.GetBoolean();

                await using var conn = await _db.OpenConnectionAsync();
                await conn.ExecuteAsync(
                    """
                    UPDATE devices SET
                        is_online = @online,
                        last_seen_at = now(),
                        firmware_version = COALESCE(@fw, firmware_version),
                        boot_count = COALESCE(@bootCount, boot_count),
                        rssi_dbm = COALESCE(@rssi, rssi_dbm),
                        free_heap_bytes = COALESCE(@heap, free_heap_bytes)
                    WHERE hardware_id = @hardwareId
                    """,
                    new
                    {
                        hardwareId,
                        online,
                        fw = root.TryGetProperty("fw", out var f) ? f.GetString() : null,
                        bootCount = root.TryGetProperty("boot_count", out var b) ? b.GetInt32() : (int?)null,
                        rssi = root.TryGetProperty("rssi", out var r) ? r.GetInt32() : (int?)null,
                        heap = root.TryGetProperty("heap", out var h) ? h.GetInt64() : (long?)null
                    });
            }
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to process MQTT message on {Topic}", args.ApplicationMessage.Topic);
        }
    }
}
