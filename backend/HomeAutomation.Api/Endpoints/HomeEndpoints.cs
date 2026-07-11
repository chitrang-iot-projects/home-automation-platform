using Dapper;
using HomeAutomation.Api.Infrastructure;
using Npgsql;

namespace HomeAutomation.Api.Endpoints;

public static class HomeEndpoints
{
    public record HomeInput(string? Name, string? Address, string? Timezone);
    public record MemberInput(string? Role);

    public static void Map(IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/homes").RequireAuthorization();

        // List homes: admin sees all, user sees owned + linked.
        group.MapGet("/", async (HttpContext ctx, NpgsqlDataSource db, CurrentUserService cus) =>
        {
            var user = await cus.ResolveAsync(ctx.User);
            if (user is null) return Results.Unauthorized();

            await using var conn = await db.OpenConnectionAsync();
            var sql = user.IsAdmin
                ? """
                  SELECT h.id, h.name, h.address, h.timezone, h.owner_id AS ownerid, h.created_at AS createdat,
                         (SELECT count(*) FROM rooms r WHERE r.home_id = h.id) AS roomcount
                  FROM homes h ORDER BY h.name
                  """
                : """
                  SELECT DISTINCT h.id, h.name, h.address, h.timezone, h.owner_id AS ownerid, h.created_at AS createdat,
                         (SELECT count(*) FROM rooms r WHERE r.home_id = h.id) AS roomcount
                  FROM homes h
                  LEFT JOIN home_members m ON m.home_id = h.id
                  WHERE h.owner_id = @userId OR m.user_id = @userId
                  ORDER BY h.name
                  """;
            var homes = await conn.QueryAsync(sql, new { userId = user.Id });
            return Results.Ok(homes);
        });

        group.MapPost("/", async (HttpContext ctx, HomeInput input, NpgsqlDataSource db, CurrentUserService cus) =>
        {
            var user = await cus.ResolveAsync(ctx.User);
            if (user is null) return Results.Unauthorized();
            if (!user.IsAdmin) return Results.Forbid();
            if (string.IsNullOrWhiteSpace(input.Name)) return Results.BadRequest(new { error = "name is required" });

            await using var conn = await db.OpenConnectionAsync();
            var home = await conn.QuerySingleAsync(
                """
                INSERT INTO homes (owner_id, name, address, timezone)
                VALUES (@ownerId, @name, @address, COALESCE(@timezone, 'UTC'))
                RETURNING id, name, address, timezone, owner_id AS ownerid, created_at AS createdat
                """,
                new { ownerId = user.Id, name = input.Name.Trim(), address = input.Address, timezone = input.Timezone });
            return Results.Ok(home);
        });

        group.MapGet("/{homeId:guid}", async (HttpContext ctx, Guid homeId, NpgsqlDataSource db, CurrentUserService cus) =>
        {
            var user = await cus.ResolveAsync(ctx.User);
            if (user is null) return Results.Unauthorized();

            await using var conn = await db.OpenConnectionAsync();
            if (!await Access.CanAccessHomeAsync(conn, user, homeId)) return Results.Forbid();

            var home = await conn.QuerySingleOrDefaultAsync(
                "SELECT id, name, address, timezone, owner_id AS ownerid, created_at AS createdat FROM homes WHERE id = @homeId",
                new { homeId });
            return home is null ? Results.NotFound() : Results.Ok(home);
        });

        group.MapPatch("/{homeId:guid}", async (HttpContext ctx, Guid homeId, HomeInput input, NpgsqlDataSource db, CurrentUserService cus) =>
        {
            var user = await cus.ResolveAsync(ctx.User);
            if (user is null) return Results.Unauthorized();

            await using var conn = await db.OpenConnectionAsync();
            if (!await Access.CanAccessHomeAsync(conn, user, homeId)) return Results.Forbid();

            // Members may edit name/address; timezone too (harmless). Parity with legacy rules.
            var home = await conn.QuerySingleOrDefaultAsync(
                """
                UPDATE homes SET name    = COALESCE(@name, name),
                                 address = COALESCE(@address, address),
                                 timezone = COALESCE(@timezone, timezone)
                WHERE id = @homeId
                RETURNING id, name, address, timezone, owner_id AS ownerid, created_at AS createdat
                """,
                new { homeId, name = input.Name?.Trim(), address = input.Address, timezone = input.Timezone });
            return home is null ? Results.NotFound() : Results.Ok(home);
        });

        group.MapDelete("/{homeId:guid}", async (HttpContext ctx, Guid homeId, NpgsqlDataSource db, CurrentUserService cus) =>
        {
            var user = await cus.ResolveAsync(ctx.User);
            if (user is null) return Results.Unauthorized();
            if (!user.IsAdmin) return Results.Forbid();

            await using var conn = await db.OpenConnectionAsync();
            var rows = await conn.ExecuteAsync("DELETE FROM homes WHERE id = @homeId", new { homeId });
            return rows == 0 ? Results.NotFound() : Results.NoContent();
        });

        // ---- members ----------------------------------------------------------

        group.MapGet("/{homeId:guid}/members", async (HttpContext ctx, Guid homeId, NpgsqlDataSource db, CurrentUserService cus) =>
        {
            var user = await cus.ResolveAsync(ctx.User);
            if (user is null) return Results.Unauthorized();

            await using var conn = await db.OpenConnectionAsync();
            if (!await Access.CanAccessHomeAsync(conn, user, homeId)) return Results.Forbid();

            var members = await conn.QueryAsync(
                """
                SELECT u.id, u.email, u.display_name AS displayname, u.contact, m.role,
                       m.invited_at AS invitedat, m.joined_at AS joinedat
                FROM home_members m JOIN users u ON u.id = m.user_id
                WHERE m.home_id = @homeId
                ORDER BY u.display_name NULLS LAST, u.email
                """, new { homeId });
            return Results.Ok(members);
        });

        group.MapPut("/{homeId:guid}/members/{userId:guid}", async (HttpContext ctx, Guid homeId, Guid userId, MemberInput input, NpgsqlDataSource db, CurrentUserService cus) =>
        {
            var user = await cus.ResolveAsync(ctx.User);
            if (user is null) return Results.Unauthorized();
            if (!user.IsAdmin) return Results.Forbid();

            var role = input.Role ?? "member";
            if (role is not ("owner" or "member" or "guest"))
                return Results.BadRequest(new { error = "role must be owner|member|guest" });

            await using var conn = await db.OpenConnectionAsync();
            await conn.ExecuteAsync(
                """
                INSERT INTO home_members (home_id, user_id, role, joined_at)
                VALUES (@homeId, @userId, @role, now())
                ON CONFLICT (home_id, user_id) DO UPDATE SET role = EXCLUDED.role
                """, new { homeId, userId, role });
            return Results.NoContent();
        });

        group.MapDelete("/{homeId:guid}/members/{userId:guid}", async (HttpContext ctx, Guid homeId, Guid userId, NpgsqlDataSource db, CurrentUserService cus) =>
        {
            var user = await cus.ResolveAsync(ctx.User);
            if (user is null) return Results.Unauthorized();
            if (!user.IsAdmin) return Results.Forbid();

            await using var conn = await db.OpenConnectionAsync();
            var rows = await conn.ExecuteAsync(
                "DELETE FROM home_members WHERE home_id = @homeId AND user_id = @userId",
                new { homeId, userId });
            return rows == 0 ? Results.NotFound() : Results.NoContent();
        });
    }
}
