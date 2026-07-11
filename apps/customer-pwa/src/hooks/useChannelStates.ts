"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { apiGet } from "@/lib/api";
import type { ChannelStatesResponse } from "@/lib/types";

const POLL_INTERVAL_MS = 5000;

export interface UseChannelStatesResult {
  /** channelId → on/off. Server truth merged with optimistic overrides. */
  states: Record<string, boolean>;
  /** Optimistically set a channel's state (also used to revert on error). */
  setLocal: (channelId: string, on: boolean) => void;
}

/**
 * Polls GET /api/homes/{homeId}/state every 5s while the tab is visible.
 *
 * All polling is deliberately isolated in this hook so it can be swapped
 * for an MQTT push subscription later without touching the dashboard UI.
 *
 * Optimistic overrides (from toggles) win over polled data until the
 * server reports the same value, at which point the override is dropped.
 */
export function useChannelStates(homeId: string | null): UseChannelStatesResult {
  const [states, setStates] = useState<Record<string, boolean>>({});
  const overridesRef = useRef<Record<string, boolean>>({});

  useEffect(() => {
    // New home (or signed out): clear everything.
    overridesRef.current = {};
    setStates({});
    if (!homeId) return;

    let cancelled = false;

    async function poll() {
      if (typeof document !== "undefined" && document.visibilityState !== "visible") {
        return;
      }
      try {
        const res = await apiGet<ChannelStatesResponse>(`/api/homes/${homeId}/state`);
        if (cancelled) return;
        const server = res.states ?? {};
        // Drop overrides the server has caught up with.
        const overrides = overridesRef.current;
        for (const key of Object.keys(overrides)) {
          if (server[key] === overrides[key]) delete overrides[key];
        }
        setStates({ ...server, ...overrides });
      } catch {
        // Transient poll failure — keep last known state; next tick retries.
      }
    }

    void poll();
    const timer = setInterval(() => void poll(), POLL_INTERVAL_MS);
    const onVisibility = () => {
      if (document.visibilityState === "visible") void poll();
    };
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      cancelled = true;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [homeId]);

  const setLocal = useCallback((channelId: string, on: boolean) => {
    overridesRef.current[channelId] = on;
    setStates((prev) => ({ ...prev, [channelId]: on }));
  }, []);

  return { states, setLocal };
}
