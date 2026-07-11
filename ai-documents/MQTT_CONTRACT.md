# MQTT Contract — Platform ↔ ESP32 Firmware

> Broker: EMQX Cloud Serverless `home-automation-broker` (Asia-Pacific, TLS only).
> Ports: MQTT/TLS 8883, WebSocket/TLS 8084. Every client authenticates with
> username/password created in the EMQX console (per-device credentials).

## Identity

`<hw>` below = the board's `hardware_id` as registered in the platform
(devices.hardware_id — e.g. the ESP32 MAC or a printed id). Firmware receives it
via the Board Setup serial config (`setconfig`), never hardcoded.

## Topics

| Topic | Dir (device view) | Payload | Retained | Purpose |
|---|---|---|---|---|
| `ha/<hw>/relay/<n>/set` | subscribe | `1` or `0` | no | Command: turn relay n on/off. n = 1..relay_count |
| `ha/<hw>/relay/<n>` | publish | `1` or `0` | **yes** | Reported relay state. Publish after every change (physical or commanded) |
| `ha/<hw>/status` | publish | JSON (below) | **yes** | Telemetry heartbeat, every 5 min + on boot |
| `ha/<hw>/status` (LWT) | broker | `{"online":false}` | **yes** | Last-will set at connect; broker publishes on ungraceful disconnect |

Status JSON:
```json
{
  "online": true,
  "fw": "1.0.0",
  "rssi": -58,
  "heap": 148000,
  "boot_count": 42,
  "uptime_s": 86400
}
```

## Device behaviour rules (maps to existing framework modules)

1. On connect: publish full state — every `ha/<hw>/relay/<n>` + `ha/<hw>/status {"online":true,...}`.
2. Subscribe `ha/<hw>/relay/+/set`. Retained state topics mean the dashboard
   contract survives device restarts.
3. Physical toggle: switch relay locally FIRST (offline-first), then publish
   state. Keep the `pendingPush` guard: ignore incoming `/set` echoes for a
   relay whose local publish is unconfirmed.
4. QoS 1 everywhere. Clean session false (session keeps subscriptions across
   short drops within broker session expiry).
5. Offline: queue state publishes (existing offline queue), flush on reconnect.
6. LWT registered at CONNECT: topic `ha/<hw>/status`, retained,
   `{"online":false}`.

## Server side (implemented in HomeAutomation.Api)

- Hosted MQTT client (MQTTnet) connects with env vars:
  `MQTT_HOST`, `MQTT_PORT` (8883), `MQTT_USERNAME`, `MQTT_PASSWORD`.
  Absent vars → MQTT disabled, API still runs (dev mode).
- Subscribes `ha/+/relay/+` and `ha/+/status`; mirrors into Postgres:
  relay state → `devices.state` jsonb; status → `is_online`, `firmware_version`,
  `boot_count`, `rssi_dbm`, `free_heap_bytes`, `last_seen_at`; inserts
  `device_telemetry` rows for rssi/heap.
- `POST /api/channels/{id}/toggle` publishes `ha/<hw>/relay/<n>/set` (QoS 1)
  in addition to persisting desired state.
- Browser clients do NOT connect to the broker in v1 — dashboard polls
  `GET /api/homes/{id}/state` (5 s). Direct WSS + per-user minted credentials is
  a roadmap item.

## Credentials

- One `api-server` credential (Render env). Per-device credentials created in
  EMQX console → entered on the admin Board Setup page → sent to the board over
  USB serial only. Never committed, never stored in the platform DB.

## Local LAN fast-path (roadmap)

Firmware later exposes a tiny local WebSocket/HTTP endpoint (mDNS-discoverable);
apps on the same WiFi send `/set` equivalents directly, falling back to MQTT.
