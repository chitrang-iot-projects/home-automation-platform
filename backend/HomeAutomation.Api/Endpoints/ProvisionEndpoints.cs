using System.Security.Cryptography;
using System.Text;
using Dapper;
using HomeAutomation.Api.Infrastructure;
using Npgsql;

namespace HomeAutomation.Api.Endpoints;

public static class ProvisionEndpoints
{
    public record ProvisionInput(string? HardwareId, string? FirmwareVersion, string? DeviceType, int? RelayCount);
    public record ClaimInput(string? HardwareId, Guid? HomeId, string? HomeName);

    public static void Map(IEndpointRouteBuilder app)
    {
        // ---- device self-provisioning (device-facing, NOT Firebase-authed) ----
        // Gated by a shared provisioning key baked into firmware, sent as
        // X-Provision-Key. Disabled (503) when PROVISION_KEY is not configured.
        app.MapPost("/api/provision", async (HttpContext ctx, ProvisionInput input, NpgsqlDataSource db, EmqxAdminService emqx, ILogger<Program> logger) =>
        {
            var expected = Environment.GetEnvironmentVariable("PROVISION_KEY");
            if (string.IsNullOrWhiteSpace(expected))
                return Results.Problem(title: "provisioning not configured", statusCode: StatusCodes.Status503ServiceUnavailable);

            var provided = ctx.Request.Headers["X-Provision-Key"].ToString();
            if (!FixedTimeEquals(provided, expected))
                return Results.Unauthorized();

            if (string.IsNullOrWhiteSpace(input.HardwareId))
                return Results.BadRequest(new { error = "hardwareId is required" });

            var hardwareId = input.HardwareId.Trim();
            var relayCount = input.RelayCount is >= 1 and <= 16 ? input.RelayCount!.Value : 4;

            await using var conn = await db.OpenConnectionAsync();

            // Upsert the device row (unclaimed until a customer claims it).
            var existing = await conn.QuerySingleOrDefaultAsync<(Guid Id, string? MqttUser, string? MqttPass)>(
                "SELECT id, mqtt_username AS mqttuser, mqtt_password AS mqttpass FROM devices WHERE hardware_id = @hardwareId",
                new { hardwareId });

            Guid deviceId;
            if (existing == default)
            {
                await using var tx = await conn.BeginTransactionAsync();
                var row = await conn.QuerySingleAsync(
                    """
                    INSERT INTO devices (home_id, type_code, name, hardware_id, relay_count,
                                         firmware_version, device_type, provisioned_at, claimed)
                    VALUES (NULL, 'controller', @name, @hardwareId, @relayCount,
                            @fw, @dtype, now(), false)
                    RETURNING id
                    """,
                    new { name = hardwareId, hardwareId, relayCount, fw = input.FirmwareVersion, dtype = input.DeviceType },
                    tx);
                deviceId = (Guid)row.id;
                for (var n = 1; n <= relayCount; n++)
                    await conn.ExecuteAsync(
                        "INSERT INTO device_channels (device_id, channel_no, name) VALUES (@deviceId, @n, @name)",
                        new { deviceId, n, name = $"Switch {n}" }, tx);
                await tx.CommitAsync();
            }
            else
            {
                deviceId = existing.Id;
                await conn.ExecuteAsync(
                    """
                    UPDATE devices SET firmware_version = COALESCE(@fw, firmware_version),
                                       device_type = COALESCE(@dtype, device_type),
                                       provisioned_at = now()
                    WHERE id = @deviceId
                    """, new { deviceId, fw = input.FirmwareVersion, dtype = input.DeviceType });
            }

            // Ensure MQTT credentials (reuse if already issued — idempotent boot).
            string? mqttUser = existing.MqttUser;
            string? mqttPass = existing.MqttPass;
            if (string.IsNullOrEmpty(mqttUser) || string.IsNullOrEmpty(mqttPass))
            {
                var cred = await emqx.ProvisionAsync(hardwareId);
                if (cred is null)
                    return Results.Problem(title: "credential provisioning unavailable", statusCode: StatusCodes.Status503ServiceUnavailable);
                mqttUser = cred.Username;
                mqttPass = cred.Password;
                await conn.ExecuteAsync(
                    "UPDATE devices SET mqtt_username = @u, mqtt_password = @p WHERE id = @deviceId",
                    new { u = mqttUser, p = mqttPass, deviceId });
            }

            logger.LogInformation("Provisioned device {HardwareId}", hardwareId);
            return Results.Ok(new
            {
                deviceId = hardwareId,
                mqttHost = Environment.GetEnvironmentVariable("MQTT_HOST") ?? "",
                mqttPort = 8883,
                mqttUsername = mqttUser,
                mqttPassword = mqttPass
            });
        }).RequireRateLimiting("provision");

        // ---- customer claiming (Firebase-authed) -------------------------------
        app.MapPost("/api/devices/claim", async (HttpContext ctx, ClaimInput input, NpgsqlDataSource db, CurrentUserService cus) =>
        {
            var user = await cus.ResolveAsync(ctx.User);
            if (user is null) return Results.Unauthorized();
            if (string.IsNullOrWhiteSpace(input.HardwareId))
                return Results.BadRequest(new { error = "hardwareId is required" });

            var hardwareId = input.HardwareId.Trim();
            await using var conn = await db.OpenConnectionAsync();

            var device = await conn.QuerySingleOrDefaultAsync<(Guid Id, Guid? HomeId, bool Claimed)>(
                "SELECT id, home_id AS homeid, claimed FROM devices WHERE hardware_id = @hardwareId",
                new { hardwareId });
            if (device == default)
                return Results.NotFound(new { error = "device not found — power it on and connect it to WiFi first" });
            if (device.Claimed && device.HomeId is not null)
                return Results.Conflict(new { error = "device is already claimed" });

            // Resolve target home: explicit, else the caller's only home, else create one.
            Guid homeId;
            if (input.HomeId is Guid hid)
            {
                if (!await Access.CanAccessHomeAsync(conn, user, hid)) return Results.Forbid();
                homeId = hid;
            }
            else
            {
                var owned = (await conn.QueryAsync<Guid>(
                    "SELECT id FROM homes WHERE owner_id = @uid ORDER BY created_at", new { uid = user.Id })).AsList();
                if (owned.Count == 1)
                    homeId = owned[0];
                else if (owned.Count == 0)
                    homeId = await conn.ExecuteScalarAsync<Guid>(
                        "INSERT INTO homes (owner_id, name) VALUES (@uid, @name) RETURNING id",
                        new { uid = user.Id, name = string.IsNullOrWhiteSpace(input.HomeName) ? "My Home" : input.HomeName!.Trim() });
                else
                    return Results.BadRequest(new { error = "multiple homes — specify homeId" });
            }

            var updated = await conn.QuerySingleAsync(
                """
                UPDATE devices SET home_id = @homeId, claimed = true WHERE id = @deviceId
                RETURNING id, home_id AS homeid, name, hardware_id AS hardwareid, relay_count AS relaycount
                """, new { homeId, deviceId = device.Id });
            return Results.Ok(updated);
        }).RequireAuthorization();
    }

    private static bool FixedTimeEquals(string a, string b)
    {
        var ba = Encoding.UTF8.GetBytes(a);
        var bb = Encoding.UTF8.GetBytes(b);
        return ba.Length == bb.Length && CryptographicOperations.FixedTimeEquals(ba, bb);
    }
}
