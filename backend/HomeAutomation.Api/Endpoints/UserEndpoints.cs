using Dapper;
using HomeAutomation.Api.Infrastructure;
using Npgsql;

namespace HomeAutomation.Api.Endpoints;

public static class UserEndpoints
{
    public record MePatch(string? DisplayName, string? Contact);
    public record AdminUserInput(string? Email, string? DisplayName, string? Contact, string? Role, bool? IsActive);

    public static void Map(IEndpointRouteBuilder app)
    {
        // ---- self -------------------------------------------------------------

        app.MapGet("/api/me", async (HttpContext ctx, CurrentUserService cus, NpgsqlDataSource db) =>
        {
            var user = await cus.ResolveAsync(ctx.User);
            if (user is null) return Results.BadRequest(new { error = "token is missing uid or email claim" });

            await using var conn = await db.OpenConnectionAsync();
            var homes = await conn.QueryAsync(
                """
                SELECT DISTINCT h.id, h.name, h.address
                FROM homes h LEFT JOIN home_members m ON m.home_id = h.id
                WHERE h.owner_id = @userId OR m.user_id = @userId
                ORDER BY h.name
                """, new { userId = user.Id });

            return Results.Ok(new
            {
                id = user.Id,
                email = user.Email,
                display_name = user.DisplayName,
                contact = user.Contact,
                role = user.Role,
                is_active = user.IsActive,
                homes
            });
        }).RequireAuthorization();

        app.MapPatch("/api/me", async (HttpContext ctx, MePatch input, CurrentUserService cus, NpgsqlDataSource db) =>
        {
            var user = await cus.ResolveAsync(ctx.User);
            if (user is null) return Results.Unauthorized();

            await using var conn = await db.OpenConnectionAsync();
            var updated = await conn.QuerySingleAsync(
                """
                UPDATE users SET display_name = COALESCE(@displayName, display_name),
                                 contact      = COALESCE(@contact, contact)
                WHERE id = @id
                RETURNING id, email, display_name, contact, role, is_active
                """, new { id = user.Id, displayName = input.DisplayName?.Trim(), contact = input.Contact?.Trim() });
            return Results.Ok(updated);
        }).RequireAuthorization();

        // ---- admin user management ---------------------------------------------
        // Admin pre-creates a row (email only, no firebase_uid). When that person
        // registers via Firebase with the same email, their first /api/me call
        // claims the row (see CurrentUserService). No Firebase Admin SDK required.

        var group = app.MapGroup("/api/users").RequireAuthorization();

        group.MapGet("/", async (HttpContext ctx, CurrentUserService cus, NpgsqlDataSource db) =>
        {
            var user = await cus.ResolveAsync(ctx.User);
            if (user is null) return Results.Unauthorized();
            if (!user.IsAdmin) return Results.Forbid();

            await using var conn = await db.OpenConnectionAsync();
            var users = await conn.QueryAsync(
                """
                SELECT u.id, u.email, u.display_name AS displayname, u.contact, u.role,
                       u.is_active AS isactive, u.firebase_uid IS NOT NULL AS registered,
                       u.created_at AS createdat,
                       COALESCE(json_agg(json_build_object('id', h.id, 'name', h.name))
                                FILTER (WHERE h.id IS NOT NULL), '[]') AS homes
                FROM users u
                LEFT JOIN home_members m ON m.user_id = u.id
                LEFT JOIN homes h ON h.id = m.home_id
                GROUP BY u.id
                ORDER BY u.created_at DESC
                """);
            return Results.Ok(users);
        });

        group.MapPost("/", async (HttpContext ctx, AdminUserInput input, CurrentUserService cus, NpgsqlDataSource db) =>
        {
            var user = await cus.ResolveAsync(ctx.User);
            if (user is null) return Results.Unauthorized();
            if (!user.IsAdmin) return Results.Forbid();
            if (string.IsNullOrWhiteSpace(input.Email) || !input.Email.Contains('@'))
                return Results.BadRequest(new { error = "valid email is required" });

            var role = input.Role ?? "customer";
            if (role is not ("customer" or "admin" or "superadmin"))
                return Results.BadRequest(new { error = "role must be customer|admin|superadmin" });

            await using var conn = await db.OpenConnectionAsync();
            try
            {
                var created = await conn.QuerySingleAsync(
                    """
                    INSERT INTO users (email, display_name, contact, role)
                    VALUES (@email, @displayName, @contact, @role)
                    RETURNING id, email, display_name AS displayname, contact, role, is_active AS isactive
                    """,
                    new { email = input.Email.Trim().ToLowerInvariant(), displayName = input.DisplayName?.Trim(), contact = input.Contact?.Trim(), role });
                return Results.Ok(created);
            }
            catch (PostgresException ex) when (ex.SqlState == PostgresErrorCodes.UniqueViolation)
            {
                return Results.Conflict(new { error = "a user with this email already exists" });
            }
        });

        group.MapPatch("/{userId:guid}", async (HttpContext ctx, Guid userId, AdminUserInput input, CurrentUserService cus, NpgsqlDataSource db) =>
        {
            var user = await cus.ResolveAsync(ctx.User);
            if (user is null) return Results.Unauthorized();
            if (!user.IsAdmin) return Results.Forbid();

            if (input.Role is not null and not ("customer" or "admin" or "superadmin"))
                return Results.BadRequest(new { error = "role must be customer|admin|superadmin" });

            await using var conn = await db.OpenConnectionAsync();
            var updated = await conn.QuerySingleOrDefaultAsync(
                """
                UPDATE users SET display_name = COALESCE(@displayName, display_name),
                                 contact      = COALESCE(@contact, contact),
                                 role         = COALESCE(@role, role),
                                 is_active    = COALESCE(@isActive, is_active)
                WHERE id = @userId
                RETURNING id, email, display_name AS displayname, contact, role, is_active AS isactive
                """, new { userId, displayName = input.DisplayName?.Trim(), contact = input.Contact?.Trim(), role = input.Role, isActive = input.IsActive });
            return updated is null ? Results.NotFound() : Results.Ok(updated);
        });

        group.MapDelete("/{userId:guid}", async (HttpContext ctx, Guid userId, CurrentUserService cus, NpgsqlDataSource db) =>
        {
            var user = await cus.ResolveAsync(ctx.User);
            if (user is null) return Results.Unauthorized();
            if (!user.IsAdmin) return Results.Forbid();
            if (userId == user.Id) return Results.BadRequest(new { error = "cannot delete yourself" });

            await using var conn = await db.OpenConnectionAsync();
            // Owned homes block deletion (RESTRICT) — reassign or delete them first.
            try
            {
                var rows = await conn.ExecuteAsync("DELETE FROM users WHERE id = @userId", new { userId });
                return rows == 0 ? Results.NotFound() : Results.NoContent();
            }
            catch (PostgresException ex) when (ex.SqlState == PostgresErrorCodes.ForeignKeyViolation)
            {
                return Results.Conflict(new { error = "user owns one or more homes; delete or reassign them first" });
            }
        });
    }
}
