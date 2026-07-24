"use client";

import { onAuthStateChanged, type User } from "firebase/auth";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import EditChannelModal from "@/components/EditChannelModal";
import Navbar from "@/components/Navbar";
import SearchFilter, {
  EMPTY_FILTERS,
  hasActiveFilters,
  type FilterState,
} from "@/components/SearchFilter";
import { useChannelStates } from "@/hooks/useChannelStates";
import { useHomeData } from "@/hooks/useHomeData";
import { apiPatch, apiPost } from "@/lib/api";
import { auth } from "@/lib/firebase";
import type { Channel, Device, Home, Room } from "@/lib/types";
import { iconEmoji } from "@/lib/types";

/** One channel plus its surrounding context, ready to render as a card. */
interface Entry {
  channel: Channel;
  device: Device;
  room: Room | null;
  home: Home | null;
}

/** Sorting: any sortindex set → ascending sortindex; otherwise
 *  usagecount desc, then lastusedat desc, then name. */
function sortEntries(entries: Entry[]): Entry[] {
  const sorted = [...entries];
  const anySortIndex = entries.some((e) => e.channel.sortindex != null);
  if (anySortIndex) {
    sorted.sort((a, b) => {
      const ai = a.channel.sortindex ?? Number.MAX_SAFE_INTEGER;
      const bi = b.channel.sortindex ?? Number.MAX_SAFE_INTEGER;
      if (ai !== bi) return ai - bi;
      return a.channel.name.localeCompare(b.channel.name);
    });
  } else {
    sorted.sort((a, b) => {
      if (b.channel.usagecount !== a.channel.usagecount) {
        return b.channel.usagecount - a.channel.usagecount;
      }
      const al = a.channel.lastusedat ? Date.parse(a.channel.lastusedat) : 0;
      const bl = b.channel.lastusedat ? Date.parse(b.channel.lastusedat) : 0;
      if (bl !== al) return bl - al;
      return a.channel.name.localeCompare(b.channel.name);
    });
  }
  return sorted;
}

interface ChannelCardProps {
  entry: Entry;
  on: boolean;
  /** "House › Room" breadcrumb shown in filtered view instead of room name. */
  breadcrumb?: string;
  reorderMode: boolean;
  onToggle: () => void;
  onFavorite: () => void;
  onEdit: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  isFirst: boolean;
  isLast: boolean;
}

function ChannelCard({
  entry,
  on,
  breadcrumb,
  reorderMode,
  onToggle,
  onFavorite,
  onEdit,
  onMoveUp,
  onMoveDown,
  isFirst,
  isLast,
}: ChannelCardProps) {
  const { channel, device, room } = entry;
  const subtitle = breadcrumb ?? room?.name ?? "Unassigned";

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-gray-100 bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <span aria-hidden className="text-2xl">
            {iconEmoji(channel.icon)}
          </span>
          <div className="min-w-0">
            <p className="truncate font-medium text-gray-900">{channel.name}</p>
            <p className="truncate text-xs text-gray-500">{subtitle}</p>
          </div>
        </div>
        <div className="flex shrink-0 items-center">
          <button
            onClick={onFavorite}
            aria-label={channel.isfavorite ? "Remove from favorites" : "Add to favorites"}
            aria-pressed={channel.isfavorite}
            className="flex min-h-11 min-w-11 items-center justify-center rounded-lg text-lg hover:bg-gray-50"
          >
            {channel.isfavorite ? (
              <span className="text-amber-400">★</span>
            ) : (
              <span className="text-gray-300">☆</span>
            )}
          </button>
          <button
            onClick={onEdit}
            aria-label={`Edit ${channel.name}`}
            className="flex min-h-11 min-w-11 items-center justify-center rounded-lg text-lg text-gray-400 hover:bg-gray-50"
          >
            ···
          </button>
        </div>
      </div>

      {!device.isonline && (
        <span className="inline-flex w-fit items-center gap-1 rounded-full bg-red-50 px-2 py-0.5 text-xs font-medium text-red-600">
          ● Offline
        </span>
      )}

      {reorderMode ? (
        <div className="flex gap-2">
          <button
            onClick={onMoveUp}
            disabled={isFirst}
            aria-label={`Move ${channel.name} up`}
            className="min-h-11 flex-1 rounded-lg border border-gray-300 font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-30"
          >
            ↑
          </button>
          <button
            onClick={onMoveDown}
            disabled={isLast}
            aria-label={`Move ${channel.name} down`}
            className="min-h-11 flex-1 rounded-lg border border-gray-300 font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-30"
          >
            ↓
          </button>
        </div>
      ) : (
        <button
          onClick={onToggle}
          aria-pressed={on}
          className={`min-h-11 w-full rounded-lg font-semibold transition-colors ${
            on
              ? "bg-blue-600 text-white hover:bg-blue-700"
              : "bg-gray-200 text-gray-700 hover:bg-gray-300"
          }`}
        >
          {on ? "ON" : "OFF"}
        </button>
      )}
    </div>
  );
}

export default function DashboardPage() {
  const [user, setUser] = useState<User | null>(null);
  const [authChecked, setAuthChecked] = useState(false);

  const data = useHomeData(user);
  const { states, setLocal } = useChannelStates(user ? data.activeHomeId : null);

  const [tab, setTab] = useState<string>("all"); // "all" | roomId
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [reorderMode, setReorderMode] = useState(false);
  const [editing, setEditing] = useState<Channel | null>(null);
  const [filters, setFilters] = useState<FilterState>(EMPTY_FILTERS);
  const [addingDevice, setAddingDevice] = useState(false);

  useEffect(() => {
    return onAuthStateChanged(auth, (u) => {
      setUser(u);
      setAuthChecked(true);
    });
  }, []);

  // Reset room tab + reorder mode when switching homes.
  useEffect(() => {
    setTab("all");
    setReorderMode(false);
  }, [data.activeHomeId]);

  // Load rooms/devices for a home picked in the search filter.
  useEffect(() => {
    if (filters.houseId) data.ensureHomeLoaded(filters.houseId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters.houseId]);

  const homes = data.homes ?? [];
  const homesById = useMemo(() => new Map(homes.map((h) => [h.id, h])), [homes]);
  const activeData = data.activeHomeId ? data.homeData[data.activeHomeId] : undefined;

  const roomsSorted = useMemo(() => {
    const rooms = activeData?.rooms ?? [];
    return [...rooms].sort((a, b) => {
      const ao = a.sortorder ?? Number.MAX_SAFE_INTEGER;
      const bo = b.sortorder ?? Number.MAX_SAFE_INTEGER;
      if (ao !== bo) return ao - bo;
      return a.name.localeCompare(b.name);
    });
  }, [activeData?.rooms]);

  /** Entries for the normal (non-filtered) dashboard view. */
  const dashboardEntries = useMemo<Entry[]>(() => {
    if (!activeData || !data.activeHomeId) return [];
    const home = homesById.get(data.activeHomeId) ?? null;
    const roomById = new Map(activeData.rooms.map((r) => [r.id, r]));
    const entries: Entry[] = [];
    for (const device of activeData.devices) {
      if (tab !== "all" && device.roomid !== tab) continue;
      const room = device.roomid ? (roomById.get(device.roomid) ?? null) : null;
      for (const channel of device.channels) {
        if (favoritesOnly && !channel.isfavorite) continue;
        entries.push({ channel, device, room, home });
      }
    }
    return sortEntries(entries);
  }, [activeData, data.activeHomeId, homesById, tab, favoritesOnly]);

  const filtersActive = hasActiveFilters(filters);

  /** Flat filtered entries across loaded homes (AND logic). */
  const filteredEntries = useMemo<Entry[]>(() => {
    if (!filtersActive) return [];
    const homeIds = filters.houseId ? [filters.houseId] : Object.keys(data.homeData);
    const entries: Entry[] = [];
    for (const homeId of homeIds) {
      const homeDatum = data.homeData[homeId];
      if (!homeDatum) continue;
      const home = homesById.get(homeId) ?? null;
      const roomById = new Map(homeDatum.rooms.map((r) => [r.id, r]));
      for (const device of homeDatum.devices) {
        if (filters.roomId && device.roomid !== filters.roomId) continue;
        const room = device.roomid ? (roomById.get(device.roomid) ?? null) : null;
        for (const channel of device.channels) {
          if (filters.applianceType && channel.appliancetype !== filters.applianceType) continue;
          entries.push({ channel, device, room, home });
        }
      }
    }
    return sortEntries(entries);
  }, [filtersActive, filters, data.homeData, homesById]);

  const visibleEntries = filtersActive ? filteredEntries : dashboardEntries;

  async function handleToggle(channel: Channel) {
    const prev = states[channel.id] ?? false;
    const next = !prev;
    setLocal(channel.id, next); // optimistic flip
    // Usage bump is fire-and-forget.
    apiPatch<Channel>(`/api/channels/${channel.id}`, { bumpUsage: true }).catch(() => {});
    try {
      await apiPost<{ channelId: string; on: boolean }>(
        `/api/channels/${channel.id}/toggle`,
        { on: next },
      );
    } catch {
      setLocal(channel.id, prev); // revert on error
    }
  }

  async function handleFavorite(channel: Channel) {
    const next = !channel.isfavorite;
    data.updateChannel(channel.id, { isfavorite: next }); // optimistic
    try {
      await apiPatch<Channel>(`/api/channels/${channel.id}`, { isFavorite: next });
    } catch {
      data.updateChannel(channel.id, { isfavorite: !next }); // revert
    }
  }

  /** Swap a card with its neighbour and persist new sortIndex values
   *  (sequential PATCHes for every channel whose index changed). */
  async function handleMove(index: number, direction: -1 | 1) {
    const target = index + direction;
    if (target < 0 || target >= visibleEntries.length) return;
    const reordered = [...visibleEntries];
    const a = reordered[index];
    const b = reordered[target];
    reordered[index] = b;
    reordered[target] = a;

    const changes: { id: string; sortIndex: number }[] = [];
    reordered.forEach((entry, i) => {
      if (entry.channel.sortindex !== i) changes.push({ id: entry.channel.id, sortIndex: i });
    });
    // Optimistic local update so the card jumps immediately.
    for (const change of changes) {
      data.updateChannel(change.id, { sortindex: change.sortIndex });
    }
    for (const change of changes) {
      try {
        await apiPatch<Channel>(`/api/channels/${change.id}`, { sortIndex: change.sortIndex });
      } catch {
        data.refresh(); // resync with the server on failure
        return;
      }
    }
  }

  // ---------- render ----------

  if (!authChecked) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-gray-50">
        <p className="text-gray-500">Loading…</p>
      </main>
    );
  }

  if (!user) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center gap-6 bg-gray-50 p-4">
        <h1 className="text-3xl font-semibold text-gray-900">Welcome home</h1>
        <p className="text-center text-gray-500">Sign in to control your devices.</p>
        <Link
          href="/login"
          className="min-h-11 rounded-lg bg-blue-600 px-8 py-3 font-medium text-white hover:bg-blue-700"
        >
          Sign in
        </Link>
      </main>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <Navbar email={user.email} />

      <main className="mx-auto max-w-5xl space-y-4 px-4 py-4">
        {data.error ? (
          <div className="rounded-xl border border-red-100 bg-white p-6 text-center">
            <p className="mb-3 text-red-600">Could not load your homes. {data.error}</p>
            <button
              onClick={data.refresh}
              className="min-h-11 rounded-lg bg-blue-600 px-6 py-2 font-medium text-white hover:bg-blue-700"
            >
              Retry
            </button>
          </div>
        ) : data.loading && !data.homes ? (
          <div className="rounded-xl bg-white p-8 text-center text-gray-500">
            Loading your homes…
          </div>
        ) : homes.length === 0 ? (
          <div className="rounded-xl bg-white p-8 text-center">
            <p className="text-gray-600">No devices yet.</p>
            <p className="mt-1 text-sm text-gray-400">
              Power on your board, connect it to WiFi, then add it here.
            </p>
            <button
              onClick={() => setAddingDevice(true)}
              className="mt-4 min-h-11 rounded-lg bg-blue-600 px-6 py-2 font-medium text-white hover:bg-blue-700"
            >
              + Add device
            </button>
          </div>
        ) : (
          <>
            {/* Add-device action */}
            <div className="flex justify-end">
              <button
                onClick={() => setAddingDevice(true)}
                className="min-h-11 rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100"
              >
                + Add device
              </button>
            </div>

            {/* House chips (only when more than one home) */}
            {homes.length > 1 && (
              <div className="flex gap-2 overflow-x-auto pb-1">
                {homes.map((h) => (
                  <button
                    key={h.id}
                    onClick={() => data.selectHome(h.id)}
                    className={`min-h-11 shrink-0 rounded-full px-4 py-2 text-sm font-medium ${
                      h.id === data.activeHomeId
                        ? "bg-blue-600 text-white"
                        : "border border-gray-300 bg-white text-gray-700 hover:bg-gray-100"
                    }`}
                  >
                    {h.name}
                  </button>
                ))}
              </div>
            )}

            <SearchFilter
              homes={homes}
              homeData={data.homeData}
              value={filters}
              onChange={setFilters}
              resultCount={filteredEntries.length}
            />

            {filtersActive ? (
              /* Flat filtered list with House › Room breadcrumbs */
              filteredEntries.length === 0 ? (
                <div className="rounded-xl bg-white p-8 text-center text-gray-500">
                  No channels match these filters.
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                  {filteredEntries.map((entry) => (
                    <ChannelCard
                      key={entry.channel.id}
                      entry={entry}
                      on={states[entry.channel.id] ?? false}
                      breadcrumb={`${entry.home?.name ?? "Home"} › ${entry.room?.name ?? "Unassigned"}`}
                      reorderMode={false}
                      onToggle={() => void handleToggle(entry.channel)}
                      onFavorite={() => void handleFavorite(entry.channel)}
                      onEdit={() => setEditing(entry.channel)}
                      onMoveUp={() => {}}
                      onMoveDown={() => {}}
                      isFirst
                      isLast
                    />
                  ))}
                </div>
              )
            ) : !activeData ? (
              <div className="rounded-xl bg-white p-8 text-center text-gray-500">
                Loading rooms and devices…
              </div>
            ) : (
              <>
                {/* Room tabs */}
                <div className="flex gap-2 overflow-x-auto pb-1">
                  <button
                    onClick={() => setTab("all")}
                    className={`min-h-11 shrink-0 rounded-lg px-4 py-2 text-sm font-medium ${
                      tab === "all"
                        ? "bg-blue-600 text-white"
                        : "border border-gray-300 bg-white text-gray-700 hover:bg-gray-100"
                    }`}
                  >
                    All
                  </button>
                  {roomsSorted.map((room) => (
                    <button
                      key={room.id}
                      onClick={() => setTab(room.id)}
                      className={`min-h-11 shrink-0 rounded-lg px-4 py-2 text-sm font-medium ${
                        tab === room.id
                          ? "bg-blue-600 text-white"
                          : "border border-gray-300 bg-white text-gray-700 hover:bg-gray-100"
                      }`}
                    >
                      {room.name}
                    </button>
                  ))}
                </div>

                {/* View controls */}
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setFavoritesOnly((f) => !f)}
                    aria-pressed={favoritesOnly}
                    className={`min-h-11 rounded-lg px-3 py-2 text-sm font-medium ${
                      favoritesOnly
                        ? "bg-amber-100 text-amber-700"
                        : "border border-gray-300 bg-white text-gray-600 hover:bg-gray-100"
                    }`}
                  >
                    ★ Favorites
                  </button>
                  <button
                    onClick={() => setReorderMode((r) => !r)}
                    aria-pressed={reorderMode}
                    className={`min-h-11 rounded-lg px-3 py-2 text-sm font-medium ${
                      reorderMode
                        ? "bg-blue-100 text-blue-700"
                        : "border border-gray-300 bg-white text-gray-600 hover:bg-gray-100"
                    }`}
                  >
                    {reorderMode ? "Done reordering" : "Reorder"}
                  </button>
                </div>

                {/* Channel cards */}
                {dashboardEntries.length === 0 ? (
                  <div className="rounded-xl bg-white p-8 text-center text-gray-500">
                    {favoritesOnly
                      ? "No favorite channels here yet. Tap ☆ on a card to add one."
                      : "No devices in this view yet."}
                  </div>
                ) : (
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                    {dashboardEntries.map((entry, index) => (
                      <ChannelCard
                        key={entry.channel.id}
                        entry={entry}
                        on={states[entry.channel.id] ?? false}
                        reorderMode={reorderMode}
                        onToggle={() => void handleToggle(entry.channel)}
                        onFavorite={() => void handleFavorite(entry.channel)}
                        onEdit={() => setEditing(entry.channel)}
                        onMoveUp={() => void handleMove(index, -1)}
                        onMoveDown={() => void handleMove(index, 1)}
                        isFirst={index === 0}
                        isLast={index === dashboardEntries.length - 1}
                      />
                    ))}
                  </div>
                )}
              </>
            )}
          </>
        )}

        <footer className="py-6 text-center text-xs text-gray-300">Shree Ganeshay nammh:</footer>
      </main>

      {editing && (
        <EditChannelModal
          channel={editing}
          onClose={() => setEditing(null)}
          onSaved={(updated) => data.updateChannel(updated.id, updated)}
        />
      )}

      {addingDevice && (
        <AddDeviceModal
          onClose={() => setAddingDevice(false)}
          onClaimed={() => {
            setAddingDevice(false);
            data.refresh();
          }}
        />
      )}
    </div>
  );
}

/** Claim a board that's already online (self-provisioned) into the user's home
 *  by its Hardware ID — the value printed on the board / its QR sticker. */
function AddDeviceModal({
  onClose,
  onClaimed,
}: {
  onClose: () => void;
  onClaimed: () => void;
}) {
  const [hardwareId, setHardwareId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await apiPost("/api/devices/claim", { hardwareId: hardwareId.trim() });
      onClaimed();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Could not add device. Check the ID and that it's online.",
      );
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="w-full max-w-sm rounded-xl bg-white p-6 shadow-lg" onClick={(e) => e.stopPropagation()}>
        <h2 className="mb-1 text-lg font-semibold">Add device</h2>
        <p className="mb-4 text-sm text-gray-500">
          Enter the Hardware ID printed on your board (or its QR sticker). The
          board must be powered on and connected to WiFi.
        </p>
        <form onSubmit={submit} className="space-y-4">
          <input
            autoFocus
            required
            value={hardwareId}
            onChange={(e) => setHardwareId(e.target.value)}
            placeholder="e.g. esp32-a1b2c3d4e5f6"
            className="w-full rounded-lg border border-gray-300 px-3 py-2 font-mono text-sm focus:border-blue-500 focus:outline-none"
          />
          {error && <p className="text-sm text-red-600">{error}</p>}
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="min-h-11 rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium hover:bg-gray-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={busy || !hardwareId.trim()}
              className="min-h-11 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {busy ? "Adding…" : "Add device"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
