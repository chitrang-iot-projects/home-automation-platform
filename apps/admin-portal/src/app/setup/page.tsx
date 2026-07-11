"use client";

import { useEffect, useRef, useState } from "react";
import AuthGate from "@/components/AuthGate";
import { apiFetch } from "@/lib/api";
import type { Device, HomeSummary } from "@/lib/types";

// Minimal Web Serial typings — the API is Chromium-only and not part of the
// standard TS lib, so we guard through (navigator as any).serial.
interface SerialPortLike {
  open(options: { baudRate: number }): Promise<void>;
  close(): Promise<void>;
  readable: ReadableStream<Uint8Array> | null;
  writable: WritableStream<Uint8Array> | null;
}

interface DeviceOption {
  id: string;
  name: string;
  hardwareid: string;
  homeName: string;
}

export default function SetupPage() {
  return (
    <AuthGate>
      <SetupInner />
    </AuthGate>
  );
}

function SetupInner() {
  // null = not determined yet (avoids SSR/hydration mismatch)
  const [serialSupported, setSerialSupported] = useState<boolean | null>(null);

  const [devices, setDevices] = useState<DeviceOption[] | null>(null);
  const [selectedDevice, setSelectedDevice] = useState("");
  const [deviceId, setDeviceId] = useState("");

  const [wifiSsid, setWifiSsid] = useState("");
  const [wifiPass, setWifiPass] = useState("");
  const [showPass, setShowPass] = useState(false);

  const [connected, setConnected] = useState(false);
  const [busy, setBusy] = useState(false);
  const [log, setLog] = useState<string[]>([]);
  const portRef = useRef<SerialPortLike | null>(null);

  useEffect(() => {
    setSerialSupported(
      typeof navigator !== "undefined" &&
        "serial" in (navigator as unknown as Record<string, unknown>),
    );
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const homes = await apiFetch<HomeSummary[]>("/api/homes");
        const all: DeviceOption[] = [];
        await Promise.all(
          homes.map(async (home) => {
            const list = await apiFetch<Device[]>(
              `/api/homes/${home.id}/devices`,
            ).catch(() => [] as Device[]);
            for (const d of list) {
              all.push({
                id: d.id,
                name: d.name,
                hardwareid: d.hardwareid,
                homeName: home.name,
              });
            }
          }),
        );
        if (!cancelled) setDevices(all);
      } catch {
        if (!cancelled) setDevices([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Close the port when navigating away.
  useEffect(() => {
    return () => {
      portRef.current?.close().catch(() => {});
    };
  }, []);

  function appendLog(line: string) {
    setLog((prev) => [...prev, line]);
  }

  async function handleConnect() {
    setBusy(true);
    try {
      // Web Serial is Chromium-only and not in the TS DOM lib.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const serial = (navigator as any).serial;
      const port = (await serial.requestPort()) as SerialPortLike;
      await port.open({ baudRate: 115200 });
      portRef.current = port;
      setConnected(true);
      appendLog("[connected] serial port open at 115200 baud");
    } catch (err) {
      appendLog(
        `[error] ${err instanceof Error ? err.message : "Failed to open port"}`,
      );
    } finally {
      setBusy(false);
    }
  }

  async function handleDisconnect() {
    const port = portRef.current;
    portRef.current = null;
    setConnected(false);
    if (port) {
      try {
        await port.close();
        appendLog("[disconnected]");
      } catch {
        // ignore — port may already be gone
      }
    }
  }

  async function handleUpload() {
    const port = portRef.current;
    if (!port || !port.writable || !port.readable) {
      appendLog("[error] not connected");
      return;
    }
    setBusy(true);

    // Credentials go over the local serial link only — never to our API.
    const payload = {
      cmd: "setconfig",
      deviceId,
      wifiSsid,
      wifiPass,
      mqtt: {},
    };
    const line = `${JSON.stringify(payload)}\n`;

    try {
      appendLog(`> ${JSON.stringify({ ...payload, wifiPass: "••••••" })}`);

      const writer = port.writable.getWriter();
      try {
        await writer.write(new TextEncoder().encode(line));
      } finally {
        writer.releaseLock();
      }

      // Read board responses for 5 seconds.
      const reader = port.readable.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      const timer = setTimeout(() => {
        reader.cancel().catch(() => {});
      }, 5000);
      try {
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          let newlineIndex = buffer.indexOf("\n");
          while (newlineIndex >= 0) {
            const received = buffer.slice(0, newlineIndex).replace(/\r$/, "");
            buffer = buffer.slice(newlineIndex + 1);
            if (received.trim()) appendLog(`< ${received}`);
            newlineIndex = buffer.indexOf("\n");
          }
        }
      } finally {
        clearTimeout(timer);
        reader.releaseLock();
      }
      if (buffer.trim()) appendLog(`< ${buffer.trim()}`);
      appendLog("[done] finished listening (5s)");
    } catch (err) {
      appendLog(
        `[error] ${err instanceof Error ? err.message : "Upload failed"}`,
      );
    } finally {
      setBusy(false);
    }
  }

  const inputClass =
    "w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none";

  return (
    <main className="mx-auto max-w-3xl px-4 py-6">
      <h1 className="mb-1 text-xl font-semibold">Board Setup</h1>
      <p className="mb-6 text-sm text-gray-500">
        Configure a switch board over USB serial. Credentials are sent directly
        to the board — nothing is uploaded to the server.
      </p>

      {serialSupported === false && (
        <div className="mb-6 rounded-xl bg-yellow-50 p-4 text-sm text-yellow-800">
          Web Serial is not available in this browser. Board setup requires
          Chrome or Edge on desktop.
        </div>
      )}

      <div className="space-y-4">
        {/* Device */}
        <section className="rounded-xl bg-white p-4 shadow-sm">
          <h2 className="mb-3 text-sm font-semibold text-gray-700">Device</h2>
          <div className="space-y-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-500">
                Registered device
              </label>
              <select
                value={selectedDevice}
                onChange={(e) => {
                  setSelectedDevice(e.target.value);
                  const dev = devices?.find((d) => d.id === e.target.value);
                  if (dev) setDeviceId(dev.hardwareid);
                }}
                className={inputClass}
              >
                <option value="">
                  {devices === null
                    ? "Loading devices…"
                    : devices.length === 0
                      ? "No registered devices"
                      : "Select a device…"}
                </option>
                {devices?.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.homeName} · {d.name} ({d.hardwareid})
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-500">
                Device ID (hardware id)
              </label>
              <input
                value={deviceId}
                onChange={(e) => setDeviceId(e.target.value)}
                placeholder="ESP32-AABBCCDDEEFF"
                className={`${inputClass} font-mono`}
              />
            </div>
          </div>
        </section>

        {/* WiFi */}
        <section className="rounded-xl bg-white p-4 shadow-sm">
          <h2 className="mb-3 text-sm font-semibold text-gray-700">WiFi</h2>
          <div className="space-y-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-500">
                SSID
              </label>
              <input
                value={wifiSsid}
                onChange={(e) => setWifiSsid(e.target.value)}
                className={inputClass}
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-500">
                Password
              </label>
              <div className="flex gap-2">
                <input
                  type={showPass ? "text" : "password"}
                  value={wifiPass}
                  onChange={(e) => setWifiPass(e.target.value)}
                  className={inputClass}
                />
                <button
                  type="button"
                  onClick={() => setShowPass((v) => !v)}
                  className="shrink-0 rounded-lg border border-gray-300 px-3 py-2 text-sm hover:bg-gray-50"
                >
                  {showPass ? "Hide" : "Show"}
                </button>
              </div>
            </div>
          </div>
        </section>

        {/* MQTT — coming soon */}
        <section className="rounded-xl bg-white p-4 opacity-60 shadow-sm">
          <h2 className="mb-3 text-sm font-semibold text-gray-700">
            MQTT — coming soon
          </h2>
          <div className="space-y-3">
            <input disabled placeholder="Broker URL" className={inputClass} />
            <div className="grid grid-cols-2 gap-3">
              <input disabled placeholder="Username" className={inputClass} />
              <input
                disabled
                type="password"
                placeholder="Password"
                className={inputClass}
              />
            </div>
          </div>
        </section>

        {/* Actions */}
        <section className="rounded-xl bg-white p-4 shadow-sm">
          <div className="flex flex-wrap gap-2">
            {!connected ? (
              <button
                onClick={handleConnect}
                disabled={busy || serialSupported !== true}
                className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
              >
                Connect Board
              </button>
            ) : (
              <button
                onClick={handleDisconnect}
                disabled={busy}
                className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium hover:bg-gray-50 disabled:opacity-50"
              >
                Disconnect
              </button>
            )}
            <button
              onClick={handleUpload}
              disabled={busy || !connected || !deviceId || !wifiSsid}
              className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {busy ? "Working…" : "Upload Config"}
            </button>
            <button
              onClick={() => setLog([])}
              disabled={log.length === 0}
              className="ml-auto rounded-lg border border-gray-300 px-3 py-2 text-sm hover:bg-gray-50 disabled:opacity-50"
            >
              Clear log
            </button>
          </div>

          <div className="mt-4 h-56 overflow-y-auto rounded-lg bg-gray-900 p-3 font-mono text-xs text-green-400">
            {log.length === 0 ? (
              <span className="text-gray-500">
                Board output will appear here…
              </span>
            ) : (
              log.map((line, i) => (
                <div key={i} className="whitespace-pre-wrap">
                  {line}
                </div>
              ))
            )}
          </div>
        </section>
      </div>
    </main>
  );
}
