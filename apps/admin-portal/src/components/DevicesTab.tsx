"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { apiFetch } from "@/lib/api";
import {
  APPLIANCE_ICONS,
  APPLIANCE_TYPES,
  type Channel,
  type Device,
  type HomeSummary,
  type Room,
} from "@/lib/types";
import { OnlineBadge } from "./HousesTab";

interface HomeBundle {
  home: HomeSummary;
  rooms: Room[];
  devices: Device[];
}

const RELAY_COUNTS = Array.from({ length: 16 }, (_, i) => i + 1);

export default function DevicesTab({
  focusDeviceId,
}: {
  focusDeviceId: string | null;
}) {
  const [bundles, setBundles] = useState<HomeBundle[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showRegister, setShowRegister] = useState(false);
  const focusedOnce = useRef(false);

  const load = useCallback(async () => {
    try {
      const homes = await apiFetch<HomeSummary[]>("/api/homes");
      const loaded = await Promise.all(
        homes.map(async (home) => {
          const [rooms, devices] = await Promise.all([
            apiFetch<Room[]>(`/api/homes/${home.id}/rooms`).catch(
              () => [] as Room[],
            ),
            apiFetch<Device[]>(`/api/homes/${home.id}/devices`).catch(
              () => [] as Device[],
            ),
          ]);
          return { home, rooms, devices };
        }),
      );
      setBundles(loaded);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load devices");
      setBundles([]);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Scroll to a device opened from the Houses tab (once, after first load).
  useEffect(() => {
    if (!focusDeviceId || !bundles || focusedOnce.current) return;
    focusedOnce.current = true;
    const el = document.getElementById(`device-${focusDeviceId}`);
    el?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [focusDeviceId, bundles]);

  const totalDevices = bundles?.reduce((n, b) => n + b.devices.length, 0) ?? 0;

  return (
    <div>
      {error && (
        <div className="mb-4 rounded-lg bg-red-50 px-4 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="mb-4 flex items-center justify-between">
        <p className="text-sm text-gray-500">
          {bundles === null ? "Loading…" : `${totalDevices} device${totalDevices === 1 ? "" : "s"} across ${bundles.length} home${bundles.length === 1 ? "" : "s"}`}
        </p>
        <button
          onClick={() => setShowRegister(true)}
          className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
        >
          Register device
        </button>
      </div>

      {bundles !== null && totalDevices === 0 && (
        <div className="rounded-xl bg-white p-8 text-center text-sm text-gray-500 shadow-sm">
          No devices registered yet.
        </div>
      )}

      <div className="space-y-4">
        {bundles?.map((bundle) =>
          bundle.devices.map((device) => (
            <DeviceCard
              key={device.id}
              device={device}
              home={bundle.home}
              rooms={bundle.rooms}
              highlighted={device.id === focusDeviceId}
              onError={setError}
              onChanged={load}
            />
          )),
        )}
      </div>

      {showRegister && bundles && (
        <RegisterDeviceModal
          bundles={bundles}
          onClose={() => setShowRegister(false)}
          onRegistered={load}
        />
      )}
    </div>
  );
}

function DeviceCard({
  device,
  home,
  rooms,
  highlighted,
  onError,
  onChanged,
}: {
  device: Device;
  home: HomeSummary;
  rooms: Room[];
  highlighted: boolean;
  onError: (message: string | null) => void;
  onChanged: () => Promise<void> | void;
}) {
  const roomName = device.roomid
    ? (rooms.find((r) => r.id === device.roomid)?.name ?? "Unknown room")
    : null;

  async function run(action: () => Promise<unknown>) {
    onError(null);
    try {
      await action();
      await onChanged();
    } catch (err) {
      onError(err instanceof Error ? err.message : "Operation failed");
    }
  }

  function patchDevice(body: Record<string, unknown>) {
    return run(() =>
      apiFetch(`/api/devices/${device.id}`, {
        method: "PATCH",
        body: JSON.stringify(body),
      }),
    );
  }

  async function handleRelayCountChange(next: number) {
    if (
      next < device.relaycount &&
      !confirm(
        `Shrinking relay count from ${device.relaycount} to ${next} removes the higher channels. Continue?`,
      )
    ) {
      return;
    }
    await patchDevice({ relayCount: next });
  }

  async function handleDelete() {
    if (!confirm(`Delete device "${device.name}" (${device.hardwareid})?`)) return;
    await run(() => apiFetch(`/api/devices/${device.id}`, { method: "DELETE" }));
  }

  const freeHeapMb =
    device.freeheapbytes !== null
      ? (device.freeheapbytes / (1024 * 1024)).toFixed(2)
      : null;

  return (
    <div
      id={`device-${device.id}`}
      className={`rounded-xl bg-white p-4 shadow-sm ${
        highlighted ? "ring-2 ring-blue-400" : ""
      }`}
    >
      {/* Header row */}
      <div className="flex flex-wrap items-center gap-3">
        <input
          defaultValue={device.name}
          onBlur={(e) => {
            const value = e.target.value.trim();
            if (value && value !== device.name) {
              void patchDevice({ name: value });
            }
          }}
          className="min-w-40 rounded-lg border border-transparent px-2 py-1 text-base font-semibold hover:border-gray-300 focus:border-blue-500 focus:outline-none"
        />
        <code className="rounded bg-gray-100 px-2 py-0.5 font-mono text-xs text-gray-700">
          {device.hardwareid}
        </code>
        <OnlineBadge online={device.isonline} />
        <span className="text-sm text-gray-500">
          {home.name}
          {roomName ? ` · ${roomName}` : ""}
        </span>
        <div className="ml-auto flex items-center gap-2">
          <label className="text-xs text-gray-500">
            Room{" "}
            <select
              value={device.roomid ?? ""}
              onChange={(e) =>
                void patchDevice({ roomId: e.target.value || null })
              }
              className="rounded-lg border border-gray-300 px-2 py-1 text-sm focus:border-blue-500 focus:outline-none"
            >
              <option value="">Unassigned</option>
              {rooms.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs text-gray-500">
            Relays{" "}
            <select
              value={device.relaycount}
              onChange={(e) => void handleRelayCountChange(Number(e.target.value))}
              className="rounded-lg border border-gray-300 px-2 py-1 text-sm focus:border-blue-500 focus:outline-none"
            >
              {RELAY_COUNTS.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>
          <button
            onClick={handleDelete}
            className="rounded-lg border border-red-300 px-3 py-1 text-sm font-medium text-red-600 hover:bg-red-50"
          >
            Delete
          </button>
        </div>
      </div>

      {/* Diagnostics */}
      <div className="mt-3 flex flex-wrap gap-x-6 gap-y-1 rounded-lg bg-gray-50 px-3 py-2 text-xs text-gray-600">
        <span>
          Firmware: <strong>{device.firmwareversion ?? "—"}</strong>
        </span>
        <span>
          Boots: <strong>{device.bootcount ?? "—"}</strong>
        </span>
        <span>
          RSSI: <strong>{device.rssidbm !== null ? `${device.rssidbm} dBm` : "—"}</strong>
        </span>
        <span>
          Free heap: <strong>{freeHeapMb !== null ? `${freeHeapMb} MB` : "—"}</strong>
        </span>
        <span>
          Last seen:{" "}
          <strong>
            {device.lastseenat ? new Date(device.lastseenat).toLocaleString() : "never"}
          </strong>
        </span>
      </div>

      {/* Channels */}
      <div className="mt-3">
        <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
          Channels
        </h4>
        {device.channels.length === 0 ? (
          <p className="text-sm text-gray-500">No channels.</p>
        ) : (
          <ul className="divide-y divide-gray-100">
            {[...device.channels]
              .sort((a, b) => a.channelno - b.channelno)
              .map((channel) => (
                <ChannelRow
                  key={channel.id}
                  channel={channel}
                  onPatch={(body) =>
                    run(() =>
                      apiFetch(`/api/channels/${channel.id}`, {
                        method: "PATCH",
                        body: JSON.stringify(body),
                      }),
                    )
                  }
                />
              ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function ChannelRow({
  channel,
  onPatch,
}: {
  channel: Channel;
  onPatch: (body: Record<string, unknown>) => Promise<void>;
}) {
  return (
    <li className="flex flex-wrap items-center gap-2 py-1.5 text-sm">
      <span className="w-8 text-xs text-gray-400">#{channel.channelno}</span>
      <span className="w-6 text-center">
        {(channel.icon && APPLIANCE_ICONS[channel.icon]) ??
          (channel.appliancetype && APPLIANCE_ICONS[channel.appliancetype]) ??
          "⚙️"}
      </span>
      <input
        defaultValue={channel.name}
        onBlur={(e) => {
          const value = e.target.value.trim();
          if (value && value !== channel.name) {
            void onPatch({ name: value });
          }
        }}
        className="min-w-32 flex-1 rounded-lg border border-transparent px-2 py-1 hover:border-gray-300 focus:border-blue-500 focus:outline-none"
      />
      <label className="text-xs text-gray-500">
        Icon{" "}
        <select
          value={channel.icon ?? ""}
          onChange={(e) => void onPatch({ icon: e.target.value || null })}
          className="rounded-lg border border-gray-300 px-2 py-1 text-sm focus:border-blue-500 focus:outline-none"
        >
          <option value="">—</option>
          {APPLIANCE_TYPES.map((key) => (
            <option key={key} value={key}>
              {APPLIANCE_ICONS[key]} {key}
            </option>
          ))}
        </select>
      </label>
      <label className="text-xs text-gray-500">
        Type{" "}
        <select
          value={channel.appliancetype ?? ""}
          onChange={(e) => void onPatch({ applianceType: e.target.value || null })}
          className="rounded-lg border border-gray-300 px-2 py-1 text-sm focus:border-blue-500 focus:outline-none"
        >
          <option value="">—</option>
          {APPLIANCE_TYPES.map((key) => (
            <option key={key} value={key}>
              {key}
            </option>
          ))}
        </select>
      </label>
    </li>
  );
}

function RegisterDeviceModal({
  bundles,
  onClose,
  onRegistered,
}: {
  bundles: HomeBundle[];
  onClose: () => void;
  onRegistered: () => Promise<void> | void;
}) {
  const [homeId, setHomeId] = useState(bundles[0]?.home.id ?? "");
  const [roomId, setRoomId] = useState("");
  const [name, setName] = useState("");
  const [hardwareId, setHardwareId] = useState("");
  const [relayCount, setRelayCount] = useState(4);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const rooms = bundles.find((b) => b.home.id === homeId)?.rooms ?? [];

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!homeId) {
      setError("Select a home");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await apiFetch(`/api/homes/${homeId}/devices`, {
        method: "POST",
        body: JSON.stringify({
          name: name.trim(),
          hardwareId: hardwareId.trim(),
          ...(roomId ? { roomId } : {}),
          relayCount,
        }),
      });
      await onRegistered();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to register device");
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
        <h2 className="mb-4 text-lg font-semibold">Register device</h2>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-500">
              Home *
            </label>
            <select
              required
              value={homeId}
              onChange={(e) => {
                setHomeId(e.target.value);
                setRoomId("");
              }}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
            >
              <option value="">Select home…</option>
              {bundles.map((b) => (
                <option key={b.home.id} value={b.home.id}>
                  {b.home.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-500">
              Room
            </label>
            <select
              value={roomId}
              onChange={(e) => setRoomId(e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
            >
              <option value="">Unassigned</option>
              {rooms.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-500">
              Name *
            </label>
            <input
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-500">
              Hardware ID *
            </label>
            <input
              required
              value={hardwareId}
              onChange={(e) => setHardwareId(e.target.value)}
              placeholder="e.g. ESP32-AABBCCDDEEFF"
              className="w-full rounded-lg border border-gray-300 px-3 py-2 font-mono text-sm focus:border-blue-500 focus:outline-none"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-500">
              Relay count
            </label>
            <select
              value={relayCount}
              onChange={(e) => setRelayCount(Number(e.target.value))}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
            >
              {RELAY_COUNTS.map((n) => (
                <option key={n} value={n}>
                  {n}
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
              {busy ? "Registering…" : "Register"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
