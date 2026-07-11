using System.Security.Claims;
using Dapper;
using Npgsql;

namespace HomeAutomation.Api.Infrastructure;

/// <summary>Platform user resolved from the Firebase token for this request.</summary>
public sealed record CurrentUser(
    Guid Id,
    string FirebaseUid,
    string Email,
    string? DisplayName,
    string? Contact,
    string Role,
    bool IsActive)
{
    public bool IsAdmin => Role is "admin" or "superadmin";
}

public sealed class CurrentUserService(NpgsqlDataSource db)
{
    /// <summary>
    /// Resolves (and on first sight provisions) the platform user for a verified
    /// Firebase principal. Rows pre-created by an admin (email known, no
    /// firebase_uid yet) are claimed on the user's first authenticated call.
    /// </summary>
    public async Task<CurrentUser?> ResolveAsync(ClaimsPrincipal principal)
    {
        var uid = principal.FindFirstValue(ClaimTypes.NameIdentifier) ?? principal.FindFirstValue("sub");
        var email = principal.FindFirstValue(ClaimTypes.Email) ?? principal.FindFirstValue("email");
        var name = principal.FindFirstValue("name");

        if (string.IsNullOrEmpty(uid) || string.IsNullOrEmpty(email))
        {
            return null;
        }

        await using var conn = await db.OpenConnectionAsync();

        var user = await conn.QuerySingleOrDefaultAsync<CurrentUser>(
            SelectSql + " WHERE firebase_uid = @uid", new { uid });
        if (user is not null)
        {
            return user;
        }

        // Claim an admin-precreated row by email, else provision fresh.
        user = await conn.QuerySingleOrDefaultAsync<CurrentUser>(
            """
            UPDATE users SET firebase_uid = @uid,
                             display_name = COALESCE(display_name, @name)
            WHERE email = @email AND firebase_uid IS NULL
            RETURNING id, firebase_uid AS firebaseuid, email, display_name AS displayname,
                      contact, role, is_active AS isactive
            """, new { uid, email, name });
        if (user is not null)
        {
            return user;
        }

        return await conn.QuerySingleAsync<CurrentUser>(
            """
            INSERT INTO users (firebase_uid, email, display_name)
            VALUES (@uid, @email, @name)
            ON CONFLICT (firebase_uid) DO UPDATE SET email = EXCLUDED.email
            RETURNING id, firebase_uid AS firebaseuid, email, display_name AS displayname,
                      contact, role, is_active AS isactive
            """, new { uid, email, name });
    }

    private const string SelectSql =
        """
        SELECT id, firebase_uid AS firebaseuid, email, display_name AS displayname,
               contact, role, is_active AS isactive
        FROM users
        """;
}

public static class Access
{
    /// <summary>Admin, home owner, or listed member.</summary>
    public static async Task<bool> CanAccessHomeAsync(NpgsqlConnection conn, CurrentUser user, Guid homeId)
    {
        if (user.IsAdmin) return true;
        return await conn.ExecuteScalarAsync<bool>(
            """
            SELECT EXISTS (
                SELECT 1 FROM homes h
                LEFT JOIN home_members m ON m.home_id = h.id AND m.user_id = @userId
                WHERE h.id = @homeId AND (h.owner_id = @userId OR m.user_id IS NOT NULL)
            )
            """, new { homeId, userId = user.Id });
    }
}
