using Dapper;
using HomeAutomation.Api.Infrastructure;
using Npgsql;

namespace HomeAutomation.Api.Endpoints;

public static class RoomEndpoints
{
    public record RoomInput(string? Name, string? Floor, string? Icon, int? SortOrder);

    public static void Map(IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/homes/{homeId:guid}/rooms").RequireAuthorization();

        group.MapGet("/", async (HttpContext ctx, Guid homeId, NpgsqlDataSource db, CurrentUserService cus) =>
        {
            var user = await cus.ResolveAsync(ctx.User);
            if (user is null) return Results.Unauthorized();

            await using var conn = await db.OpenConnectionAsync();
            if (!await Access.CanAccessHomeAsync(conn, user, homeId)) return Results.Forbid();

            var rooms = await conn.QueryAsync(
                """
                SELECT id, home_id AS homeid, name, floor, icon, sort_order AS sortorder, created_at AS createdat
                FROM rooms WHERE home_id = @homeId ORDER BY sort_order, name
                """, new { homeId });
            return Results.Ok(rooms);
        });

        // Legacy parity: any house member manages rooms.
        group.MapPost("/", async (HttpContext ctx, Guid homeId, RoomInput input, NpgsqlDataSource db, CurrentUserService cus) =>
        {
            var user = await cus.ResolveAsync(ctx.User);
            if (user is null) return Results.Unauthorized();
            if (string.IsNullOrWhiteSpace(input.Name)) return Results.BadRequest(new { error = "name is required" });

            await using var conn = await db.OpenConnectionAsync();
            if (!await Access.CanAccessHomeAsync(conn, user, homeId)) return Results.Forbid();

            try
            {
                var room = await conn.QuerySingleAsync(
                    """
                    INSERT INTO rooms (home_id, name, floor, icon, sort_order)
                    VALUES (@homeId, @name, @floor, @icon, COALESCE(@sortOrder, 0))
                    RETURNING id, home_id AS homeid, name, floor, icon, sort_order AS sortorder, created_at AS createdat
                    """,
                    new { homeId, name = input.Name.Trim(), floor = input.Floor, icon = input.Icon, sortOrder = input.SortOrder });
                return Results.Ok(room);
            }
            catch (PostgresException ex) when (ex.SqlState == PostgresErrorCodes.UniqueViolation)
            {
                return Results.Conflict(new { error = "a room with this name already exists in this home" });
            }
        });

        group.MapPatch("/{roomId:guid}", async (HttpContext ctx, Guid homeId, Guid roomId, RoomInput input, NpgsqlDataSource db, CurrentUserService cus) =>
        {
            var user = await cus.ResolveAsync(ctx.User);
            if (user is null) return Results.Unauthorized();

            await using var conn = await db.OpenConnectionAsync();
            if (!await Access.CanAccessHomeAsync(conn, user, homeId)) return Results.Forbid();

            try
            {
                var room = await conn.QuerySingleOrDefaultAsync(
                    """
                    UPDATE rooms SET name = COALESCE(@name, name),
                                     floor = COALESCE(@floor, floor),
                                     icon = COALESCE(@icon, icon),
                                     sort_order = COALESCE(@sortOrder, sort_order)
                    WHERE id = @roomId AND home_id = @homeId
                    RETURNING id, home_id AS homeid, name, floor, icon, sort_order AS sortorder, created_at AS createdat
                    """,
                    new { homeId, roomId, name = input.Name?.Trim(), floor = input.Floor, icon = input.Icon, sortOrder = input.SortOrder });
                return room is null ? Results.NotFound() : Results.Ok(room);
            }
            catch (PostgresException ex) when (ex.SqlState == PostgresErrorCodes.UniqueViolation)
            {
                return Results.Conflict(new { error = "a room with this name already exists in this home" });
            }
        });

        group.MapDelete("/{roomId:guid}", async (HttpContext ctx, Guid homeId, Guid roomId, NpgsqlDataSource db, CurrentUserService cus) =>
        {
            var user = await cus.ResolveAsync(ctx.User);
            if (user is null) return Results.Unauthorized();

            await using var conn = await db.OpenConnectionAsync();
            if (!await Access.CanAccessHomeAsync(conn, user, homeId)) return Results.Forbid();

            // Devices in the room survive with room_id = NULL (schema ON DELETE SET NULL).
            var rows = await conn.ExecuteAsync(
                "DELETE FROM rooms WHERE id = @roomId AND home_id = @homeId", new { homeId, roomId });
            return rows == 0 ? Results.NotFound() : Results.NoContent();
        });
    }
}
