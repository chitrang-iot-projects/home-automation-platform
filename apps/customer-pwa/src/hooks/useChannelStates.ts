"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { apiGet } from "@/lib/api";
import { auth } from "@/lib/firebase";
import type { ChannelStatesResponse } from "@/lib/types";

const POLL_INTERVAL_MS = 1500; // Fast 1.5s background poll fallback
const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_URL ?? "https://home-automation-api-yonj.onrender.com";

export interface UseChannelStatesResult {
  /** channelId → on/off. Server truth merged with optimistic overrides. */
  states: Record<string, boolean>;
  /** Optimistically set a channel's state (also used to revert on error). */
  setLocal: (channelId: string, on: boolean) => void;
}

/**
  * Real-time channel state hook:
  * 1. Listens to instant (< 50ms) Server-Sent Events (SSE) from /api/homes/{homeId}/state/stream
  * 2. Runs a 1.5s HTTP background poll as fallback if SSE connection drops
  */
export function useChannelStates(homeId: string | null): UseChannelStatesResult {
  const [states, setStates] = useState<Record<string, boolean>>({});
  const overridesRef = useRef<Record<string, boolean>>({});

  useEffect(() => {
    overridesRef.current = {};
    setStates({});
    if (!homeId) return;

    let cancelled = false;

    // 1. HTTP Poll (Initial fetch & fallback)
    async function poll() {
      if (typeof document !== "undefined" && document.visibilityState !== "visible") {
        return;
      }
      try {
        const res = await apiGet<ChannelStatesResponse>(`/api/homes/${homeId}/state`);
        if (cancelled) return;
        const server = res.states ?? {};
        const overrides = overridesRef.current;
        for (const key of Object.keys(overrides)) {
          if (server[key] === overrides[key]) delete overrides[key];
        }
        setStates({ ...server, ...overrides });
      } catch {
        // Transient poll error — backup timer retries
      }
    }

    void poll();
    const timer = setInterval(() => void poll(), POLL_INTERVAL_MS);

    // 2. Real-time SSE Stream (Instant sub-100ms updates)
    let abortController: AbortController | null = null;

    async function startStream() {
      try {
        const user = auth.currentUser;
        if (!user) return;
        const token = await user.getIdToken();
        if (cancelled) return;

        abortController = new AbortController();
        const res = await fetch(`${API_BASE_URL}/api/homes/${homeId}/state/stream`, {
          headers: { Authorization: `Bearer ${token}` },
          signal: abortController.signal,
        });

        if (!res.ok || !res.body) return;
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        while (!cancelled) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const chunks = buffer.split("\n\n");
          buffer = chunks.pop() ?? "";

          for (const chunk of chunks) {
            const line = chunk.trim();
            if (line.startsWith("data: ")) {
              try {
                const data = JSON.parse(line.slice(6)) as { channelId: string; on: boolean };
                if (data.channelId) {
                  delete overridesRef.current[data.channelId];
                  setStates((prev) => ({ ...prev, [data.channelId]: data.on }));
                }
              } catch {
                // Ignore parse errors
              }
            }
          }
        }
      } catch {
        // Stream closed or disconnected — polling backup will handle updates until reconnected
      }
    }

    void startStream();

    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        void poll();
        void startStream();
      }
    };
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      cancelled = true;
      clearInterval(timer);
      abortController?.abort();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [homeId]);

  const setLocal = useCallback((channelId: string, on: boolean) => {
    overridesRef.current[channelId] = on;
    setStates((prev) => ({ ...prev, [channelId]: on }));
  }, []);

  return { states, setLocal };
}
