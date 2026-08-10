using Dapper;
using HomeAutomation.Api.Infrastructure;
using Npgsql;

namespace HomeAutomation.Api.Endpoints;

public static class DeviceEndpoints
{
    public record DeviceInput(string? Name, string? HardwareId, Guid? HomeId, Guid? RoomId, int? RelayCount);
    public record TogglePayload(bool On);
    public record ChannelPatch(
        string? Name, string? Icon, string? ApplianceType,
        bool? IsFavorite, int? SortIndex, bool? BumpUsage);

    public static void Map(IEndpointRouteBuilder app)
    {
        // Unclaimed / self-provisioned devices (admin only).
        app.MapGet("/api/admin/unclaimed-devices", async (HttpContext ctx, NpgsqlDataSource db, CurrentUserService cus) =>
        {
            var user = await cus.ResolveAsync(ctx.User);
            if (user is null) return Results.Unauthorized();
            if (!user.IsAdmin) return Results.Forbid();

            await using var conn = await db.OpenConnectionAsync();

            var devices = (await conn.QueryAsync(
                """
                SELECT id, home_id AS homeid, room_id AS roomid, name, hardware_id AS hardwareid,
                       relay_count AS relaycount, is_online AS isonline, last_seen_at AS lastseenat,
                       firmware_version AS firmwareversion, boot_count AS bootcount,
                       rssi_dbm AS rssidbm, free_heap_bytes AS freeheapbytes, created_at AS createdat
                FROM devices WHERE home_id IS NULL ORDER BY created_at DESC
                """)).AsList();

            var channels = (await conn.QueryAsync(
                """
                SELECT c.id, c.device_id AS deviceid, c.channel_no AS channelno, c.name, c.icon,
                       c.appliance_type AS appliancetype, c.is_favorite AS isfavorite,
                       c.sort_index AS sortindex, c.usage_count AS usagecount, c.last_used_at AS lastusedat
                FROM device_channels c
                JOIN devices d ON d.id = c.device_id
                WHERE d.home_id IS NULL
                ORDER BY c.device_id, c.channel_no
                """)).AsList();

            var byDevice = channels.GroupBy(c => (Guid)c.deviceid).ToDictionary(g => g.Key, g => g.ToList());
            var result = devices.Select(d => new
            {
                d.id, d.homeid, d.roomid, d.name, d.hardwareid, d.relaycount, d.isonline,
                d.lastseenat, d.firmwareversion, d.bootcount, d.rssidbm, d.freeheapbytes, d.createdat,
                channels = byDevice.TryGetValue((Guid)d.id, out var ch) ? ch : []
            });
            return Results.Ok(result);
        }).RequireAuthorization();

        var homeGroup = app.MapGroup("/api/homes/{homeId:guid}/devices").RequireAuthorization();

        // List devices for a home, channels included.
        homeGroup.MapGet("/", async (HttpContext ctx, Guid homeId, NpgsqlDataSource db, CurrentUserService cus) =>
        {
            var user = await cus.ResolveAsync(ctx.User);
            if (user is null) return Results.Unauthorized();

            await using var conn = await db.OpenConnectionAsync();
            if (!await Access.CanAccessHomeAsync(conn, user, homeId)) return Results.Forbid();

            var devices = (await conn.QueryAsync(
                """
                SELECT id, home_id AS homeid, room_id AS roomid, name, hardware_id AS hardwareid,
                       relay_count AS relaycount, is_online AS isonline, last_seen_at AS lastseenat,
                       firmware_version AS firmwareversion, boot_count AS bootcount,
                       rssi_dbm AS rssidbm, free_heap_bytes AS freeheapbytes, created_at AS createdat
                FROM devices WHERE home_id = @homeId ORDER BY created_at
                """, new { homeId })).AsList();

            var channels = (await conn.QueryAsync(
                """
                SELECT c.id, c.device_id AS deviceid, c.channel_no AS channelno, c.name, c.icon,
                       c.appliance_type AS appliancetype, c.is_favorite AS isfavorite,
                       c.sort_index AS sortindex, c.usage_count AS usagecount, c.last_used_at AS lastusedat
                FROM device_channels c
                JOIN devices d ON d.id = c.device_id
                WHERE d.home_id = @homeId
                ORDER BY c.device_id, c.channel_no
                """, new { homeId })).AsList();

            var byDevice = channels.GroupBy(c => (Guid)c.deviceid).ToDictionary(g => g.Key, g => g.ToList());
            var result = devices.Select(d => new
            {
                d.id, d.homeid, d.roomid, d.name, d.hardwareid, d.relaycount, d.isonline,
                d.lastseenat, d.firmwareversion, d.bootcount, d.rssidbm, d.freeheapbytes, d.createdat,
                channels = byDevice.TryGetValue((Guid)d.id, out var ch) ? ch : []
            });

            return Results.Ok(result);
        });

        // Register a new device under a home.
        homeGroup.MapPost("/", async (HttpContext ctx, Guid homeId, DeviceInput input, NpgsqlDataSource db, CurrentUserService cus, EmqxAdminService emqx) =>
        {
            var user = await cus.ResolveAsync(ctx.User);
            if (user is null) return Results.Unauthorized();
            if (!user.IsAdmin) return Results.Forbid();

            await using var conn = await db.OpenConnectionAsync();

            var count = input.RelayCount ?? 4;
            if (count is < 1 or > 16)
                return Results.BadRequest(new { error = "relayCount must be between 1 and 16" });

            var hardwareId = input.HardwareId?.Trim();
            if (string.IsNullOrWhiteSpace(hardwareId))
            {
                hardwareId = "esp32-" + Guid.NewGuid().ToString("N")[..12];
            }

            var existing = await conn.QuerySingleOrDefaultAsync<Guid?>(
                "SELECT id FROM devices WHERE hardware_id = @hardwareId", new { hardwareId });
            if (existing is not null)
                return Results.Conflict(new { error = "hardwareId already registered" });

            await using var tx = await conn.BeginTransactionAsync();

            var deviceId = await conn.QuerySingleAsync<Guid>(
                """
                INSERT INTO devices (home_id, room_id, name, hardware_id, relay_count, claimed)
                VALUES (@homeId, @roomId, @name, @hardwareId, @count, true)
                RETURNING id
                """,
                new
                {
                    homeId,
                    roomId = input.RoomId,
                    name = string.IsNullOrWhiteSpace(input.Name) ? "Smart Switch Board" : input.Name.Trim(),
                    hardwareId,
                    count
                }, tx);

            await conn.ExecuteAsync(
                """
                INSERT INTO device_channels (device_id, channel_no, name)
                SELECT @deviceId, n, 'Switch ' || n
                FROM generate_series(1, @count) AS n
                """, new { deviceId, count }, tx);

            await tx.CommitAsync();

            var cred = await emqx.ProvisionAsync(hardwareId);
            if (cred is not null)
            {
                await conn.ExecuteAsync(
                    "UPDATE devices SET mqtt_username = @u, mqtt_password = @p WHERE id = @id",
                    new { u = cred.Username, p = cred.Password, id = deviceId });
            }

            var device = await conn.QuerySingleAsync(
                """
                SELECT id, home_id AS homeid, room_id AS roomid, name, hardware_id AS hardwareid,
                       relay_count AS relaycount, is_online AS isonline,
                       mqtt_username AS mqttusername, mqtt_password AS mqttpassword, created_at AS createdat
                FROM devices WHERE id = @deviceId
                """, new { deviceId });
            return Results.Ok(device);
        });

        var deviceGroup = app.MapGroup("/api/devices/{deviceId:guid}").RequireAuthorization();

        // Rename / move / resize a board.
        deviceGroup.MapPatch("/", async (HttpContext ctx, Guid deviceId, DeviceInput input, NpgsqlDataSource db, CurrentUserService cus) =>
        {
            var user = await cus.ResolveAsync(ctx.User);
            if (user is null) return Results.Unauthorized();

            await using var conn = await db.OpenConnectionAsync();
            var existing = await conn.QuerySingleOrDefaultAsync<(Guid? HomeId, bool Claimed)>(
                "SELECT home_id AS HomeId, claimed AS Claimed FROM devices WHERE id = @deviceId", new { deviceId });
            if (existing == default) return Results.NotFound();

            if (!user.IsAdmin)
            {
                if (existing.HomeId is null || !await Access.CanAccessHomeAsync(conn, user, existing.HomeId.Value))
                    return Results.Forbid();
            }

            // Structural changes (home move, room move, relay count) are admin-only; rename is member-level.
            if ((input.HomeId is not null || input.RoomId is not null || input.RelayCount is not null) && !user.IsAdmin)
                return Results.Forbid();

            await using var tx = await conn.BeginTransactionAsync();

            var device = await conn.QuerySingleAsync(
                """
                UPDATE devices SET name = COALESCE(@name, name),
                                   home_id = COALESCE(@homeId, home_id),
                                   room_id = COALESCE(@roomId, room_id),
                                   relay_count = COALESCE(@relayCount, relay_count),
                                   claimed = CASE WHEN @homeId IS NOT NULL THEN true ELSE claimed END
                WHERE id = @deviceId
                RETURNING id, home_id AS homeid, room_id AS roomid, name, relay_count AS relaycount, claimed
                """,
                new { deviceId, name = input.Name?.Trim(), homeId = input.HomeId, roomId = input.RoomId, relayCount = input.RelayCount }, tx);

            if (input.RelayCount is int newCount)
            {
                // Grow: add missing channels. Shrink: remove channels above the new count.
                await conn.ExecuteAsync(
                    """
                    INSERT INTO device_channels (device_id, channel_no, name)
                    SELECT @deviceId, n, 'Switch ' || n
                    FROM generate_series(1, @newCount) AS n
                    ON CONFLICT (device_id, channel_no) DO NOTHING
                    """, new { deviceId, newCount }, tx);
                await conn.ExecuteAsync(
                    "DELETE FROM device_channels WHERE device_id = @deviceId AND channel_no > @newCount",
                    new { deviceId, newCount }, tx);
            }

            await tx.CommitAsync();
            return Results.Ok(device);
        });

        // Delete a board (admin only).
        deviceGroup.MapDelete("/", async (HttpContext ctx, Guid deviceId, NpgsqlDataSource db, CurrentUserService cus, EmqxAdminService emqx) =>
        {
            var user = await cus.ResolveAsync(ctx.User);
            if (user is null) return Results.Unauthorized();
            if (!user.IsAdmin) return Results.Forbid();

            await using var conn = await db.OpenConnectionAsync();
            var hardwareId = await conn.ExecuteScalarAsync<string?>(
                "SELECT hardware_id FROM devices WHERE id = @deviceId", new { deviceId });
            if (hardwareId is null) return Results.NotFound();

            await conn.ExecuteAsync("DELETE FROM devices WHERE id = @deviceId", new { deviceId });
            await emqx.DeleteAsync(hardwareId);   // revoke the broker credential
            return Results.NoContent();
        });

        // Fetch a board's MQTT credential (admin only) — for flashing / Board Setup.
        deviceGroup.MapGet("/credentials", async (HttpContext ctx, Guid deviceId, NpgsqlDataSource db, CurrentUserService cus) =>
        {
            var user = await cus.ResolveAsync(ctx.User);
            if (user is null) return Results.Unauthorized();
            if (!user.IsAdmin) return Results.Forbid();

            await using var conn = await db.OpenConnectionAsync();
            var cred = await conn.QuerySingleOrDefaultAsync<(string HardwareId, string? MqttUsername, string? MqttPassword)>(
                """
                SELECT hardware_id AS HardwareId, mqtt_username AS MqttUsername, mqtt_password AS MqttPassword
                FROM devices WHERE id = @deviceId
                """, new { deviceId });
            if (cred == default) return Results.NotFound();
            return Results.Ok(new { hardwareid = cred.HardwareId, mqttusername = cred.MqttUsername, mqttpassword = cred.MqttPassword });
        });

        // Rotate a board's MQTT credential (admin only).
        deviceGroup.MapPost("/credentials/rotate", async (HttpContext ctx, Guid deviceId, NpgsqlDataSource db, CurrentUserService cus, EmqxAdminService emqx) =>
        {
            var user = await cus.ResolveAsync(ctx.User);
            if (user is null) return Results.Unauthorized();
            if (!user.IsAdmin) return Results.Forbid();

            await using var conn = await db.OpenConnectionAsync();
            var hardwareId = await conn.ExecuteScalarAsync<string?>(
                "SELECT hardware_id FROM devices WHERE id = @deviceId", new { deviceId });
            if (hardwareId is null) return Results.NotFound();

            var cred = await emqx.ProvisionAsync(hardwareId);
            if (cred is null)
                return Results.Problem(title: "credential provisioning unavailable", statusCode: StatusCodes.Status503ServiceUnavailable);

            await conn.ExecuteAsync(
                "UPDATE devices SET mqtt_username = @u, mqtt_password = @p WHERE id = @deviceId",
                new { u = cred.Username, p = cred.Password, deviceId });

            return Results.Ok(new { hardwareid = hardwareId, mqttusername = cred.Username, mqttpassword = cred.Password });
        });

        // ---- device state / commands ------------------------------------------

        // Get channel states for a home (used by Customer PWA polling).
        app.MapGet("/api/homes/{homeId:guid}/state", GetHomeStateAsync).RequireAuthorization();
        app.MapGet("/api/homes/{homeId:guid}/relay-states", GetHomeStateAsync).RequireAuthorization();

        app.MapPost("/api/channels/{channelId:guid}/toggle", async (HttpContext ctx, Guid channelId, TogglePayload payload, NpgsqlDataSource db, CurrentUserService cus) =>
        {
            var user = await cus.ResolveAsync(ctx.User);
            if (user is null) return Results.Unauthorized();

            await using var conn = await db.OpenConnectionAsync();
            var target = await conn.QuerySingleOrDefaultAsync<(Guid DeviceId, Guid HomeId, int ChannelNo, string HardwareId)>(
                """
                SELECT d.id AS DeviceId, d.home_id AS HomeId, c.channel_no AS ChannelNo, d.hardware_id AS HardwareId
                FROM device_channels c JOIN devices d ON d.id = c.device_id
                WHERE c.id = @channelId
                """, new { channelId });
            if (target == default) return Results.NotFound();
            if (!await Access.CanAccessHomeAsync(conn, user, target.HomeId)) return Results.Forbid();

            await conn.ExecuteAsync(
                """
                UPDATE devices
                SET state = jsonb_set(state, ARRAY['relay' || @channelNo::text], to_jsonb(@on), true)
                WHERE id = @deviceId
                """, new { deviceId = target.DeviceId, channelNo = target.ChannelNo, on = payload.On });

            await conn.ExecuteAsync(
                """
                INSERT INTO device_events (device_id, user_id, event_type, payload)
                VALUES (@deviceId, @userId, 'command',
                        jsonb_build_object('channel', @channelNo, 'on', @on))
                """, new { deviceId = target.DeviceId, userId = user.Id, channelNo = target.ChannelNo, on = payload.On });

            // Push the command to the board (no-op when MQTT is not configured).
            var mqtt = ctx.RequestServices.GetService<MqttService>();
            if (mqtt is not null && mqtt.IsEnabled)
            {
                await mqtt.PublishRelayCommandAsync(target.HardwareId, target.ChannelNo, payload.On);
            }

            return Results.Ok(new { channelId, on = payload.On });
        }).RequireAuthorization();

        // ---- channels ---------------------------------------------------------

        app.MapPatch("/api/channels/{channelId:guid}", async (HttpContext ctx, Guid channelId, ChannelPatch input, NpgsqlDataSource db, CurrentUserService cus) =>
        {
            var user = await cus.ResolveAsync(ctx.User);
            if (user is null) return Results.Unauthorized();

            await using var conn = await db.OpenConnectionAsync();

            var target = await conn.QuerySingleOrDefaultAsync<(Guid HomeId, Guid DeviceId)>(
                """
                SELECT d.home_id AS HomeId, c.device_id AS DeviceId
                FROM device_channels c JOIN devices d ON d.id = c.device_id
                WHERE c.id = @channelId
                """, new { channelId });
            if (target == default) return Results.NotFound();

            // Appliance type changes require admin; renaming/icons require home membership.
            if (input.ApplianceType is not null && !user.IsAdmin) return Results.Forbid();
            if (!await Access.CanAccessHomeAsync(conn, user, target.HomeId)) return Results.Forbid();

            var channel = await conn.QuerySingleAsync(
                """
                UPDATE device_channels
                SET name           = COALESCE(@name, name),
                    icon           = COALESCE(@icon, icon),
                    appliance_type = COALESCE(@applianceType, appliance_type),
                    is_favorite    = COALESCE(@isFavorite, is_favorite),
                    sort_index     = COALESCE(@sortIndex, sort_index),
                    usage_count    = usage_count + CASE WHEN @bumpUsage THEN 1 ELSE 0 END,
                    last_used_at   = CASE WHEN @bumpUsage THEN now() ELSE last_used_at END
                WHERE id = @channelId
                RETURNING id, device_id AS deviceid, channel_no AS channelno, name, icon,
                          appliance_type AS appliancetype, is_favorite AS isfavorite,
                          sort_index AS sortindex, usage_count AS usagecount, last_used_at AS lastusedat
                """,
                new
                {
                    channelId,
                    name = input.Name?.Trim(),
                    icon = input.Icon,
                    applianceType = input.ApplianceType,
                    isFavorite = input.IsFavorite,
                    sortIndex = input.SortIndex,
                    bumpUsage = input.BumpUsage ?? false
                });
            return Results.Ok(channel);
        }).RequireAuthorization();
    }

    private static async Task<IResult> GetHomeStateAsync(HttpContext ctx, Guid homeId, NpgsqlDataSource db, CurrentUserService cus)
    {
        var user = await cus.ResolveAsync(ctx.User);
        if (user is null) return Results.Unauthorized();

        await using var conn = await db.OpenConnectionAsync();
        if (!await Access.CanAccessHomeAsync(conn, user, homeId)) return Results.Forbid();

        var rows = await conn.QueryAsync<(Guid ChannelId, bool? On)>(
            """
            SELECT c.id AS ChannelId,
                   (d.state ->> ('relay' || c.channel_no::text))::boolean AS On
            FROM device_channels c
            JOIN devices d ON d.id = c.device_id
            WHERE d.home_id = @homeId
            """, new { homeId });

        return Results.Ok(new { states = rows.ToDictionary(r => r.ChannelId, r => r.On ?? false) });
    }
}
