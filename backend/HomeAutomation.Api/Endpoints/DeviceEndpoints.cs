using Dapper;
using HomeAutomation.Api.Infrastructure;
using Npgsql;

namespace HomeAutomation.Api.Endpoints;

public static class DeviceEndpoints
{
    public record DeviceInput(string? Name, string? HardwareId, Guid? RoomId, int? RelayCount);
    public record TogglePayload(bool On);
    public record ChannelPatch(
        string? Name, string? Icon, string? ApplianceType,
        bool? IsFavorite, int? SortIndex, bool? BumpUsage);

    public static void Map(IEndpointRouteBuilder app)
    {
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
                FROM devices WHERE home_id = @homeId ORDER BY name
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

        // Register a board (admin). Auto-creates channel rows 1..relay_count.
        homeGroup.MapPost("/", async (HttpContext ctx, Guid homeId, DeviceInput input, NpgsqlDataSource db, CurrentUserService cus) =>
        {
            var user = await cus.ResolveAsync(ctx.User);
            if (user is null) return Results.Unauthorized();
            if (!user.IsAdmin) return Results.Forbid();
            if (string.IsNullOrWhiteSpace(input.Name)) return Results.BadRequest(new { error = "name is required" });
            if (string.IsNullOrWhiteSpace(input.HardwareId)) return Results.BadRequest(new { error = "hardwareId is required" });

            var relayCount = input.RelayCount ?? 4;
            if (relayCount is < 1 or > 16) return Results.BadRequest(new { error = "relayCount must be 1..16" });

            await using var conn = await db.OpenConnectionAsync();
            await using var tx = await conn.BeginTransactionAsync();
            try
            {
                var device = await conn.QuerySingleAsync(
                    """
                    INSERT INTO devices (home_id, room_id, type_code, name, hardware_id, relay_count)
                    VALUES (@homeId, @roomId, 'controller', @name, @hardwareId, @relayCount)
                    RETURNING id, home_id AS homeid, room_id AS roomid, name, hardware_id AS hardwareid,
                              relay_count AS relaycount, is_online AS isonline, created_at AS createdat
                    """,
                    new { homeId, roomId = input.RoomId, name = input.Name.Trim(), hardwareId = input.HardwareId.Trim(), relayCount },
                    tx);

                for (var n = 1; n <= relayCount; n++)
                {
                    await conn.ExecuteAsync(
                        "INSERT INTO device_channels (device_id, channel_no, name) VALUES (@deviceId, @n, @name)",
                        new { deviceId = (Guid)device.id, n, name = $"Switch {n}" }, tx);
                }

                await tx.CommitAsync();
                return Results.Ok(device);
            }
            catch (PostgresException ex) when (ex.SqlState == PostgresErrorCodes.UniqueViolation)
            {
                await tx.RollbackAsync();
                return Results.Conflict(new { error = "a device with this hardware id already exists" });
            }
        });

        var deviceGroup = app.MapGroup("/api/devices/{deviceId:guid}").RequireAuthorization();

        // Rename / move / resize a board.
        deviceGroup.MapPatch("/", async (HttpContext ctx, Guid deviceId, DeviceInput input, NpgsqlDataSource db, CurrentUserService cus) =>
        {
            var user = await cus.ResolveAsync(ctx.User);
            if (user is null) return Results.Unauthorized();

            await using var conn = await db.OpenConnectionAsync();
            var homeId = await conn.ExecuteScalarAsync<Guid?>(
                "SELECT home_id FROM devices WHERE id = @deviceId", new { deviceId });
            if (homeId is null) return Results.NotFound();
            if (!await Access.CanAccessHomeAsync(conn, user, homeId.Value)) return Results.Forbid();

            // Structural changes (room move, relay count) are admin-only; rename is member-level.
            if ((input.RoomId is not null || input.RelayCount is not null) && !user.IsAdmin)
                return Results.Forbid();

            await using var tx = await conn.BeginTransactionAsync();

            var device = await conn.QuerySingleAsync(
                """
                UPDATE devices SET name = COALESCE(@name, name),
                                   room_id = COALESCE(@roomId, room_id),
                                   relay_count = COALESCE(@relayCount, relay_count)
                WHERE id = @deviceId
                RETURNING id, home_id AS homeid, room_id AS roomid, name, relay_count AS relaycount
                """,
                new { deviceId, name = input.Name?.Trim(), roomId = input.RoomId, relayCount = input.RelayCount }, tx);

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

        deviceGroup.MapDelete("/", async (HttpContext ctx, Guid deviceId, NpgsqlDataSource db, CurrentUserService cus) =>
        {
            var user = await cus.ResolveAsync(ctx.User);
            if (user is null) return Results.Unauthorized();
            if (!user.IsAdmin) return Results.Forbid();

            await using var conn = await db.OpenConnectionAsync();
            var rows = await conn.ExecuteAsync("DELETE FROM devices WHERE id = @deviceId", new { deviceId });
            return rows == 0 ? Results.NotFound() : Results.NoContent();
        });

        // ---- channel state ------------------------------------------------------
        // Postgres holds last-known/desired relay state in devices.state jsonb
        // ({"relay1": true, ...}). Today the dashboard polls; when the MQTT layer
        // lands, the toggle endpoint additionally publishes and devices report
        // actual state back. Contract stays stable for the frontends.

        app.MapGet("/api/homes/{homeId:guid}/state", async (HttpContext ctx, Guid homeId, NpgsqlDataSource db, CurrentUserService cus) =>
        {
            var user = await cus.ResolveAsync(ctx.User);
            if (user is null) return Results.Unauthorized();

            await using var conn = await db.OpenConnectionAsync();
            if (!await Access.CanAccessHomeAsync(conn, user, homeId)) return Results.Forbid();

            var rows = await conn.QueryAsync<(Guid ChannelId, bool? On)>(
                """
                SELECT c.id AS ChannelId,
                       (d.state ->> ('relay' || c.channel_no))::boolean AS "On"
                FROM device_channels c
                JOIN devices d ON d.id = c.device_id
                WHERE d.home_id = @homeId
                """, new { homeId });

            return Results.Ok(new { states = rows.ToDictionary(r => r.ChannelId, r => r.On ?? false) });
        }).RequireAuthorization();

        app.MapPost("/api/channels/{channelId:guid}/toggle", async (HttpContext ctx, Guid channelId, TogglePayload payload, NpgsqlDataSource db, CurrentUserService cus) =>
        {
            var user = await cus.ResolveAsync(ctx.User);
            if (user is null) return Results.Unauthorized();

            await using var conn = await db.OpenConnectionAsync();
            var target = await conn.QuerySingleOrDefaultAsync<(Guid DeviceId, Guid HomeId, int ChannelNo)>(
                """
                SELECT d.id AS DeviceId, d.home_id AS HomeId, c.channel_no AS ChannelNo
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

            // MQTT publish slots in here (task: MQTT layer).
            return Results.Ok(new { channelId, on = payload.On });
        }).RequireAuthorization();

        // ---- channels ---------------------------------------------------------

        app.MapPatch("/api/channels/{channelId:guid}", async (HttpContext ctx, Guid channelId, ChannelPatch input, NpgsqlDataSource db, CurrentUserService cus) =>
        {
            var user = await cus.ResolveAsync(ctx.User);
            if (user is null) return Results.Unauthorized();

            await using var conn = await db.OpenConnectionAsync();
            var homeId = await conn.ExecuteScalarAsync<Guid?>(
                """
                SELECT d.home_id FROM device_channels c JOIN devices d ON d.id = c.device_id
                WHERE c.id = @channelId
                """, new { channelId });
            if (homeId is null) return Results.NotFound();
            if (!await Access.CanAccessHomeAsync(conn, user, homeId.Value)) return Results.Forbid();

            // appliance_type is the only structural field left — admin only (legacy parity).
            if (input.ApplianceType is not null && !user.IsAdmin) return Results.Forbid();

            var channel = await conn.QuerySingleAsync(
                """
                UPDATE device_channels SET
                    name           = COALESCE(@name, name),
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
}
