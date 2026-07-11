"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { apiFetch } from "@/lib/api";
import { USER_ROLES, type AdminUser } from "@/lib/types";

export default function CustomersTab() {
  const [users, setUsers] = useState<AdminUser[] | null>(null);
  const [search, setSearch] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [editing, setEditing] = useState<AdminUser | null>(null);

  const load = useCallback(async () => {
    try {
      setUsers(await apiFetch<AdminUser[]>("/api/users"));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load users");
      setUsers([]);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = useMemo(() => {
    if (!users) return null;
    const q = search.trim().toLowerCase();
    if (!q) return users;
    return users.filter((u) =>
      [u.email, u.displayname ?? "", u.contact ?? "", u.role]
        .join(" ")
        .toLowerCase()
        .includes(q),
    );
  }, [users, search]);

  async function handleToggleActive(user: AdminUser) {
    setError(null);
    try {
      await apiFetch(`/api/users/${user.id}`, {
        method: "PATCH",
        body: JSON.stringify({ isActive: !user.isactive }),
      });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update user");
    }
  }

  async function handleDelete(user: AdminUser) {
    if (!confirm(`Delete customer ${user.email}? This cannot be undone.`)) return;
    setError(null);
    try {
      await apiFetch(`/api/users/${user.id}`, { method: "DELETE" });
      await load();
    } catch (err) {
      // 409 (owns homes) surfaces the API's own message here.
      setError(err instanceof Error ? err.message : "Failed to delete user");
    }
  }

  return (
    <div>
      {error && (
        <div className="mb-4 rounded-lg bg-red-50 px-4 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <input
          placeholder="Search customers…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="min-w-64 flex-1 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
        />
        <button
          onClick={() => setShowAdd(true)}
          className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
        >
          Add customer
        </button>
      </div>

      <div className="overflow-x-auto rounded-xl bg-white shadow-sm">
        {filtered === null ? (
          <p className="p-6 text-sm text-gray-500">Loading…</p>
        ) : filtered.length === 0 ? (
          <p className="p-6 text-sm text-gray-500">
            {search ? "No customers match your search." : "No customers yet."}
          </p>
        ) : (
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-gray-200 text-xs uppercase tracking-wide text-gray-500">
                <th className="px-4 py-3">Email</th>
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3">Contact</th>
                <th className="px-4 py-3">Role</th>
                <th className="px-4 py-3">Registered</th>
                <th className="px-4 py-3">Active</th>
                <th className="px-4 py-3">Homes</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filtered.map((user) => (
                <tr key={user.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 font-medium">{user.email}</td>
                  <td className="px-4 py-3">{user.displayname ?? "—"}</td>
                  <td className="px-4 py-3">{user.contact ?? "—"}</td>
                  <td className="px-4 py-3">
                    <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs">
                      {user.role}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    {user.registered ? (
                      <span className="text-green-600" title="Registered">
                        ✓
                      </span>
                    ) : (
                      <span className="text-gray-400" title="Not registered yet">
                        ✗
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <button
                      role="switch"
                      aria-checked={user.isactive}
                      onClick={() => handleToggleActive(user)}
                      title={user.isactive ? "Deactivate" : "Activate"}
                      className={`relative h-5 w-9 rounded-full transition-colors ${
                        user.isactive ? "bg-blue-600" : "bg-gray-300"
                      }`}
                    >
                      <span
                        className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all ${
                          user.isactive ? "left-4.5" : "left-0.5"
                        }`}
                      />
                    </button>
                  </td>
                  <td className="px-4 py-3">
                    {user.homes.length === 0 ? (
                      <span className="text-gray-400">—</span>
                    ) : (
                      <span className="flex flex-wrap gap-1">
                        {user.homes.map((h) => (
                          <span
                            key={h.id}
                            className="rounded-full bg-blue-50 px-2 py-0.5 text-xs text-blue-700"
                          >
                            {h.name}
                          </span>
                        ))}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right whitespace-nowrap">
                    <button
                      onClick={() => setEditing(user)}
                      className="mr-2 text-blue-600 hover:underline"
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => handleDelete(user)}
                      className="text-red-600 hover:underline"
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {showAdd && (
        <CustomerModal
          title="Add customer"
          onClose={() => setShowAdd(false)}
          onSubmit={async (form) => {
            await apiFetch("/api/users", {
              method: "POST",
              body: JSON.stringify({
                email: form.email,
                ...(form.displayName ? { displayName: form.displayName } : {}),
                ...(form.contact ? { contact: form.contact } : {}),
                ...(form.role ? { role: form.role } : {}),
              }),
            });
            await load();
          }}
        />
      )}

      {editing && (
        <CustomerModal
          title="Edit customer"
          initial={editing}
          onClose={() => setEditing(null)}
          onSubmit={async (form) => {
            await apiFetch(`/api/users/${editing.id}`, {
              method: "PATCH",
              body: JSON.stringify({
                displayName: form.displayName,
                contact: form.contact,
                role: form.role,
              }),
            });
            await load();
          }}
        />
      )}
    </div>
  );
}

interface CustomerForm {
  email: string;
  displayName: string;
  contact: string;
  role: string;
}

function CustomerModal({
  title,
  initial,
  onClose,
  onSubmit,
}: {
  title: string;
  initial?: AdminUser;
  onClose: () => void;
  onSubmit: (form: CustomerForm) => Promise<void>;
}) {
  const [email, setEmail] = useState(initial?.email ?? "");
  const [displayName, setDisplayName] = useState(initial?.displayname ?? "");
  const [contact, setContact] = useState(initial?.contact ?? "");
  const [role, setRole] = useState(initial?.role ?? "customer");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await onSubmit({
        email: email.trim(),
        displayName: displayName.trim(),
        contact: contact.trim(),
        role,
      });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save");
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-xl bg-white p-6 shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="mb-4 text-lg font-semibold">{title}</h2>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-500">
              Email {initial ? "" : "*"}
            </label>
            <input
              type="email"
              required
              disabled={!!initial}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none disabled:bg-gray-100 disabled:text-gray-500"
            />
            {!initial && (
              <p className="mt-1 text-xs text-gray-500">
                Customer signs up with this email in the customer app; the
                account links automatically.
              </p>
            )}
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-500">
              Name
            </label>
            <input
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-500">
              Contact
            </label>
            <input
              value={contact}
              onChange={(e) => setContact(e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-500">
              Role
            </label>
            <select
              value={role}
              onChange={(e) => setRole(e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
            >
              {USER_ROLES.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </div>

          {error && <p className="text-sm text-red-600">{error}</p>}

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium hover:bg-gray-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={busy}
              className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {busy ? "Saving…" : "Save"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
