"use client";

import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import {
  MEMBER_ROLES,
  memberLabel,
  memberUserId,
  type AdminUser,
  type Device,
  type HomeMember,
  type HomeSummary,
  type Room,
} from "@/lib/types";

export default function HousesTab({
  onOpenDevice,
}: {
  onOpenDevice: (deviceId: string) => void;
}) {
  const [homes, setHomes] = useState<HomeSummary[] | null>(null);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Add-house form
  const [newName, setNewName] = useState("");
  const [newAddress, setNewAddress] = useState("");
  const [adding, setAdding] = useState(false);

  const loadHomes = useCallback(async () => {
    try {
      const list = await apiFetch<HomeSummary[]>("/api/homes");
      setHomes(list);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load houses");
      setHomes([]);
    }
  }, []);

  useEffect(() => {
    void loadHomes();
    // Users are needed for the add-member picker.
    apiFetch<AdminUser[]>("/api/users")
      .then(setUsers)
      .catch(() => setUsers([]));
  }, [loadHomes]);

  async function handleAddHouse(event: React.FormEvent) {
    event.preventDefault();
    if (!newName.trim()) return;
    setAdding(true);
    setError(null);
    try {
      await apiFetch("/api/homes", {
        method: "POST",
        body: JSON.stringify({
          name: newName.trim(),
          ...(newAddress.trim() ? { address: newAddress.trim() } : {}),
        }),
      });
      setNewName("");
      setNewAddress("");
      await loadHomes();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add house");
    } finally {
      setAdding(false);
    }
  }

  const selected = homes?.find((h) => h.id === selectedId) ?? null;

  return (
    <div>
      {error && (
        <div className="mb-4 rounded-lg bg-red-50 px-4 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-[320px_1fr]">
        {/* Master: house list + add form */}
        <div className="space-y-4">
          <div className="rounded-xl bg-white p-4 shadow-sm">
            <h2 className="mb-3 text-sm font-semibold text-gray-700">Houses</h2>
            {homes === null ? (
              <p className="text-sm text-gray-500">Loading…</p>
            ) : homes.length === 0 ? (
              <p className="text-sm text-gray-500">No houses yet.</p>
            ) : (
              <ul className="space-y-1">
                {homes.map((home) => (
                  <li key={home.id}>
                    <button
                      onClick={() => setSelectedId(home.id)}
                      className={`w-full rounded-lg px-3 py-2 text-left text-sm ${
                        home.id === selectedId
                          ? "bg-blue-50 font-medium text-blue-700"
                          : "hover:bg-gray-50"
                      }`}
                    >
                      <span className="block">{home.name}</span>
                      <span className="block text-xs text-gray-500">
                        {home.address || "No address"} · {home.roomcount} room
                        {home.roomcount === 1 ? "" : "s"}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <form
            onSubmit={handleAddHouse}
            className="space-y-3 rounded-xl bg-white p-4 shadow-sm"
          >
            <h2 className="text-sm font-semibold text-gray-700">Add house</h2>
            <input
              required
              placeholder="Name"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
            />
            <input
              placeholder="Address (optional)"
              value={newAddress}
              onChange={(e) => setNewAddress(e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
            />
            <button
              type="submit"
              disabled={adding}
              className="w-full rounded-lg bg-blue-600 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {adding ? "Adding…" : "Add house"}
            </button>
          </form>
        </div>

        {/* Detail */}
        {selected ? (
          <HouseDetail
            key={selected.id}
            home={selected}
            users={users}
            onChanged={loadHomes}
            onDeleted={() => {
              setSelectedId(null);
              void loadHomes();
            }}
            onOpenDevice={onOpenDevice}
          />
        ) : (
          <div className="flex min-h-48 items-center justify-center rounded-xl bg-white p-8 text-sm text-gray-500 shadow-sm">
            Select a house to view details.
          </div>
        )}
      </div>
    </div>
  );
}

function HouseDetail({
  home,
  users,
  onChanged,
  onDeleted,
  onOpenDevice,
}: {
  home: HomeSummary;
  users: AdminUser[];
  onChanged: () => Promise<void> | void;
  onDeleted: () => void;
  onOpenDevice: (deviceId: string) => void;
}) {
  const [name, setName] = useState(home.name);
  const [address, setAddress] = useState(home.address ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [members, setMembers] = useState<HomeMember[] | null>(null);
  const [rooms, setRooms] = useState<Room[] | null>(null);
  const [devices, setDevices] = useState<Device[] | null>(null);

  // Add member picker
  const [pickUserId, setPickUserId] = useState("");
  const [pickRole, setPickRole] = useState<string>("member");

  // Add room form
  const [roomName, setRoomName] = useState("");
  const [roomFloor, setRoomFloor] = useState("");

  const loadDetail = useCallback(async () => {
    const results = await Promise.allSettled([
      apiFetch<HomeMember[]>(`/api/homes/${home.id}/members`),
      apiFetch<Room[]>(`/api/homes/${home.id}/rooms`),
      apiFetch<Device[]>(`/api/homes/${home.id}/devices`),
    ]);
    setMembers(results[0].status === "fulfilled" ? results[0].value : []);
    setRooms(results[1].status === "fulfilled" ? results[1].value : []);
    setDevices(results[2].status === "fulfilled" ? results[2].value : []);
    const firstFailure = results.find((r) => r.status === "rejected");
    if (firstFailure && firstFailure.status === "rejected") {
      const reason = firstFailure.reason as unknown;
      setError(
        reason instanceof Error ? reason.message : "Failed to load house details",
      );
    }
  }, [home.id]);

  useEffect(() => {
    void loadDetail();
  }, [loadDetail]);

  async function run(action: () => Promise<unknown>, refresh = true) {
    setError(null);
    try {
      await action();
      if (refresh) await loadDetail();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Operation failed");
    }
  }

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      await apiFetch(`/api/homes/${home.id}`, {
        method: "PATCH",
        body: JSON.stringify({ name: name.trim(), address: address.trim() }),
      });
      await onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!confirm(`Delete house "${home.name}"? This cannot be undone.`)) return;
    setError(null);
    try {
      await apiFetch(`/api/homes/${home.id}`, { method: "DELETE" });
      onDeleted();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete house");
    }
  }

  async function handleAddMember(event: React.FormEvent) {
    event.preventDefault();
    if (!pickUserId) return;
    await run(() =>
      apiFetch(`/api/homes/${home.id}/members/${pickUserId}`, {
        method: "PUT",
        body: JSON.stringify({ role: pickRole }),
      }),
    );
    setPickUserId("");
  }

  async function handleAddRoom(event: React.FormEvent) {
    event.preventDefault();
    if (!roomName.trim()) return;
    await run(() =>
      apiFetch(`/api/homes/${home.id}/rooms`, {
        method: "POST",
        body: JSON.stringify({
          name: roomName.trim(),
          ...(roomFloor.trim() ? { floor: roomFloor.trim() } : {}),
        }),
      }),
    );
    setRoomName("");
    setRoomFloor("");
  }

  const memberIds = new Set((members ?? []).map(memberUserId));
  const addableUsers = users.filter((u) => !memberIds.has(u.id));
  const roomNameById = new Map((rooms ?? []).map((r) => [r.id, r.name]));

  return (
    <div className="space-y-4">
      {error && (
        <div className="rounded-lg bg-red-50 px-4 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      {/* Name / address / delete */}
      <div className="rounded-xl bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex-1">
            <span className="mb-1 block text-xs font-medium text-gray-500">
              Name
            </span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
            />
          </label>
          <label className="flex-[2]">
            <span className="mb-1 block text-xs font-medium text-gray-500">
              Address
            </span>
            <input
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
            />
          </label>
          <button
            onClick={handleSave}
            disabled={saving || !name.trim()}
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {saving ? "Saving…" : "Save"}
          </button>
          <button
            onClick={handleDelete}
            className="rounded-lg border border-red-300 px-4 py-2 text-sm font-medium text-red-600 hover:bg-red-50"
          >
            Delete
          </button>
        </div>
      </div>

      {/* Members */}
      <div className="rounded-xl bg-white p-4 shadow-sm">
        <h3 className="mb-3 text-sm font-semibold text-gray-700">Members</h3>
        {members === null ? (
          <p className="text-sm text-gray-500">Loading…</p>
        ) : members.length === 0 ? (
          <p className="mb-3 text-sm text-gray-500">No members.</p>
        ) : (
          <ul className="mb-3 divide-y divide-gray-100">
            {members.map((member) => {
              const uid = memberUserId(member);
              return (
                <li
                  key={uid || memberLabel(member)}
                  className="flex items-center justify-between py-2 text-sm"
                >
                  <span>
                    {memberLabel(member)}{" "}
                    <span className="ml-1 rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-600">
                      {member.role}
                    </span>
                  </span>
                  <button
                    onClick={() =>
                      run(() =>
                        apiFetch(`/api/homes/${home.id}/members/${uid}`, {
                          method: "DELETE",
                        }),
                      )
                    }
                    title="Remove member"
                    className="rounded px-2 text-gray-400 hover:bg-red-50 hover:text-red-600"
                  >
                    ×
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        <form onSubmit={handleAddMember} className="flex flex-wrap gap-2">
          <select
            value={pickUserId}
            onChange={(e) => setPickUserId(e.target.value)}
            className="min-w-48 flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
          >
            <option value="">Select user…</option>
            {addableUsers.map((u) => (
              <option key={u.id} value={u.id}>
                {u.email}
                {u.displayname ? ` (${u.displayname})` : ""}
              </option>
            ))}
          </select>
          <select
            value={pickRole}
            onChange={(e) => setPickRole(e.target.value)}
            className="rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
          >
            {MEMBER_ROLES.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
          <button
            type="submit"
            disabled={!pickUserId}
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            Add member
          </button>
        </form>
      </div>

      {/* Rooms */}
      <div className="rounded-xl bg-white p-4 shadow-sm">
        <h3 className="mb-3 text-sm font-semibold text-gray-700">Rooms</h3>
        {rooms === null ? (
          <p className="text-sm text-gray-500">Loading…</p>
        ) : rooms.length === 0 ? (
          <p className="mb-3 text-sm text-gray-500">No rooms.</p>
        ) : (
          <ul className="mb-3 divide-y divide-gray-100">
            {rooms.map((room) => (
              <li key={room.id} className="flex items-center gap-2 py-2 text-sm">
                <input
                  defaultValue={room.name}
                  onBlur={(e) => {
                    const value = e.target.value.trim();
                    if (value && value !== room.name) {
                      void run(() =>
                        apiFetch(`/api/homes/${home.id}/rooms/${room.id}`, {
                          method: "PATCH",
                          body: JSON.stringify({ name: value }),
                        }),
                      );
                    }
                  }}
                  className="flex-1 rounded-lg border border-transparent px-2 py-1 hover:border-gray-300 focus:border-blue-500 focus:outline-none"
                />
                <span className="text-xs text-gray-500">
                  {room.floor !== null && room.floor !== ""
                    ? `Floor ${room.floor}`
                    : ""}
                </span>
                <button
                  onClick={() => {
                    if (!confirm(`Delete room "${room.name}"?`)) return;
                    void run(() =>
                      apiFetch(`/api/homes/${home.id}/rooms/${room.id}`, {
                        method: "DELETE",
                      }),
                    );
                  }}
                  title="Delete room"
                  className="rounded px-2 text-gray-400 hover:bg-red-50 hover:text-red-600"
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
        )}
        <form onSubmit={handleAddRoom} className="flex flex-wrap gap-2">
          <input
            required
            placeholder="Room name"
            value={roomName}
            onChange={(e) => setRoomName(e.target.value)}
            className="min-w-40 flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
          />
          <input
            placeholder="Floor (optional)"
            value={roomFloor}
            onChange={(e) => setRoomFloor(e.target.value)}
            className="w-32 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
          />
          <button
            type="submit"
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
          >
            Add room
          </button>
        </form>
      </div>

      {/* Devices in this house */}
      <div className="rounded-xl bg-white p-4 shadow-sm">
        <h3 className="mb-3 text-sm font-semibold text-gray-700">Devices</h3>
        {devices === null ? (
          <p className="text-sm text-gray-500">Loading…</p>
        ) : devices.length === 0 ? (
          <p className="text-sm text-gray-500">No devices in this house.</p>
        ) : (
          <ul className="divide-y divide-gray-100">
            {devices.map((device) => (
              <li
                key={device.id}
                className="flex flex-wrap items-center gap-3 py-2 text-sm"
              >
                <button
                  onClick={() => onOpenDevice(device.id)}
                  className="font-medium text-blue-600 hover:underline"
                >
                  {device.name}
                </button>
                <span className="text-gray-500">
                  {device.roomid
                    ? (roomNameById.get(device.roomid) ?? "Unknown room")
                    : "Unassigned"}
                </span>
                <OnlineBadge online={device.isonline} />
                <span className="ml-auto text-xs text-gray-500">
                  {device.channels.length} channel
                  {device.channels.length === 1 ? "" : "s"}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

export function OnlineBadge({ online }: { online: boolean }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${
        online ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-500"
      }`}
    >
      <span
        className={`h-1.5 w-1.5 rounded-full ${online ? "bg-green-500" : "bg-gray-400"}`}
      />
      {online ? "Online" : "Offline"}
    </span>
  );
}
