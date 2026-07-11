"use client";

import type { User } from "firebase/auth";
import { useCallback, useEffect, useRef, useState } from "react";
import { apiGet } from "@/lib/api";
import type { Channel, Device, Home, HomeData, Room } from "@/lib/types";

export interface UseHomeDataResult {
  /** All homes the user can access. Null until first load completes. */
  homes: Home[] | null;
  /** Currently selected home id (defaults to the first home). */
  activeHomeId: string | null;
  /** Select a home; its rooms/devices are fetched if not cached. */
  selectHome: (homeId: string) => void;
  /** Rooms + devices cache, keyed by home id. */
  homeData: Record<string, HomeData>;
  /** True while the initial homes list / active home data is loading. */
  loading: boolean;
  error: string | null;
  /** Re-fetch homes and the active home's rooms/devices. */
  refresh: () => void;
  /** Fetch rooms/devices for a home if not already cached (for filters). */
  ensureHomeLoaded: (homeId: string) => void;
  /** Optimistic local mutation of a channel (favorite, name, sortindex…). */
  updateChannel: (channelId: string, patch: Partial<Channel>) => void;
}

/**
 * Loads the homes list, then rooms + devices for the active home.
 * Plain fetch via apiFetch — no external data libraries.
 */
export function useHomeData(user: User | null): UseHomeDataResult {
  const [homes, setHomes] = useState<Home[] | null>(null);
  const [activeHomeId, setActiveHomeId] = useState<string | null>(null);
  const [homeData, setHomeData] = useState<Record<string, HomeData>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Refs so callbacks stay stable without re-triggering effects.
  const activeHomeIdRef = useRef<string | null>(null);
  activeHomeIdRef.current = activeHomeId;
  const inflightRef = useRef<Set<string>>(new Set());

  const loadHome = useCallback(async (homeId: string) => {
    if (inflightRef.current.has(homeId)) return;
    inflightRef.current.add(homeId);
    try {
      const [rooms, devices] = await Promise.all([
        apiGet<Room[]>(`/api/homes/${homeId}/rooms`),
        apiGet<Device[]>(`/api/homes/${homeId}/devices`),
      ]);
      setHomeData((prev) => ({ ...prev, [homeId]: { rooms, devices } }));
    } finally {
      inflightRef.current.delete(homeId);
    }
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const list = await apiGet<Home[]>("/api/homes");
      setHomes(list);
      const current = activeHomeIdRef.current;
      const active =
        current && list.some((h) => h.id === current)
          ? current
          : (list[0]?.id ?? null);
      setActiveHomeId(active);
      if (active) await loadHome(active);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load homes");
    } finally {
      setLoading(false);
    }
  }, [loadHome]);

  useEffect(() => {
    if (user) {
      void load();
    } else {
      // Signed out: reset everything.
      setHomes(null);
      setActiveHomeId(null);
      setHomeData({});
      setError(null);
    }
  }, [user, load]);

  const ensureHomeLoaded = useCallback(
    (homeId: string) => {
      setHomeData((prev) => {
        if (!prev[homeId]) void loadHome(homeId).catch(() => {});
        return prev;
      });
    },
    [loadHome],
  );

  const selectHome = useCallback(
    (homeId: string) => {
      setActiveHomeId(homeId);
      ensureHomeLoaded(homeId);
    },
    [ensureHomeLoaded],
  );

  const refresh = useCallback(() => {
    setHomeData({});
    void load();
  }, [load]);

  const updateChannel = useCallback(
    (channelId: string, patch: Partial<Channel>) => {
      setHomeData((prev) => {
        const next: Record<string, HomeData> = {};
        for (const [homeId, data] of Object.entries(prev)) {
          next[homeId] = {
            rooms: data.rooms,
            devices: data.devices.map((device) => ({
              ...device,
              channels: device.channels.map((ch) =>
                ch.id === channelId ? { ...ch, ...patch } : ch,
              ),
            })),
          };
        }
        return next;
      });
    },
    [],
  );

  return {
    homes,
    activeHomeId,
    selectHome,
    homeData,
    loading,
    error,
    refresh,
    ensureHomeLoaded,
    updateChannel,
  };
}
