# Current State — Home Automation Platform

> Living document. Updated after every work session. What exists, where, and how it's wired.
> Last updated: 2026-07-11

## Live URLs

| Surface | URL | Host |
|---|---|---|
| Customer PWA | https://home-automation-platform-gilt.vercel.app | Vercel (`home-automation-platform-pwa`) |
| Admin Portal | https://home-automation-platform-admin.vercel.app | Vercel (`home-automation-platform-admin`) |
| API | https://home-automation-api-yonj.onrender.com | Render (`home-automation-api`, Docker, Free) |
| Database | Neon project `home-automation-platform` (PG 18, aws-us-west-2) | Neon |
| Auth | Firebase project `home-automation-a86aa` | Firebase |

## Repository

`D:\IOT\Home-Automation\home-automation-platform` → github.com/chitrang-iot-projects/home-automation-platform
Branches: `develop` (work) → fast-forward merge → `main` (release).

```
apps/customer-pwa    Next.js 15 + TS + Tailwind 4 (port 3000)
apps/admin-portal    Next.js 15 + TS + Tailwind 4 (port 3001)
backend/HomeAutomation.Api   ASP.NET Core minimal API (.NET 9, port 5000)
database/migrations  SQL migrations (applied manually via Neon SQL editor)
database/docs        schema.md
ai-documents/        vision doc + this file + FUTURE_ROADMAP.md
```

## What Works Today (verified in production)

- **CI/CD**: push develop → CI (build both apps + API + Docker); merge main → Vercel prod deploys + GitHub Action fires Render deploy hook. Secret: `RENDER_DEPLOY_HOOK_URL`.
- **Database**: migration 001 applied — users, homes, home_members, rooms, device_types (seeded), devices, device_telemetry, device_events, automations, schema_migrations.
- **API**: `GET /` hello, `GET /health`, `GET /health/db` (Neon reachability + migration count), `GET /api/me` (Firebase JWT verified → upserts users row → returns profile). CORS for both Vercel apps + localhost.
- **Auth end-to-end**: Firebase Email/Password + Google enabled; Vercel domains authorized; customer PWA has /login (email/password + Google popup, register) and home page showing profile from `/api/me`. Verified live: token → API → Neon row → profile JSON.

## Architecture Decisions (agreed with Chitrang)

- **No firmware .ino download feature** — old project's generator/slot-editor is dropped entirely.
- **Channel model**: generic firmware; relay channel = physical wiring. Claiming/creating a device auto-creates channel rows; users rename + set icons. No slot assignment UI.
- **Live control = MQTT** (EMQX Cloud serverless, Asia region) + **local LAN fast-path** later; Firebase RTDB only for legacy boards until re-flash. Postgres = system of record.
- **Board provisioning**: admin "Board Setup" page pushes config (WiFi + broker creds + device identity) to ESP32 over **Web Serial** (USB); firmware stores in NVS. Replaces .ino generation.
- Old-project parity first; new features tracked in FUTURE_ROADMAP.md, added only when scheduled.

## Firmware (user's side, reference)

Working framework firmware `sketch_july04` (11 modules: EventBus, Logger, Scheduler, NVS prefs, DeviceState, Sync, WiFi, Firebase, Relay, StatusLed WS2812B, Input TTP223). Currently Firebase RTDB stream transport; MQTT module planned. 4 relays active-LOW (GPIO 25/33/32/27), switches GPIO 19/18/17/16, LED GPIO 4. NVS state restore, offline queue, pendingPush echo guard, 5-min heartbeat.

## Session Log

### 2026-07-10 — Phase 1 + infra
- Scaffolded monorepo, both Next.js apps, .NET 9 API; all show "Shree Ganeshay nammh:".
- CI/CD pipelines; Vercel ×2 (framework-preset fix was root cause of 404s); Render service (auto-deploy off, hook-driven); Neon project + schema 001; DATABASE_URL wired; /health/db verified.
- Firebase auth end-to-end (JWT validation in API, login UI in PWA, auto-provisioning). One Render deploy timed out — retried, landed.

### 2026-07-11 — Feature phase started
- Studied old Smart-Switch-Board project (full feature inventory) + vision document + current firmware.
- Locked scope: parity minus firmware-download minus slot-editor; MQTT + local fast-path in-phase; board setup via Web Serial.
- Created this document + FUTURE_ROADMAP.md.

### 2026-07-11 — Parity build shipped (commits 34089e9…73abfd4, released to main)
- **Migrations 002 + 003 applied to Neon**: `rooms.floor`; `devices` gains relay_count/boot_count/rssi_dbm/free_heap_bytes; new `device_channels` table (channel_no, name, icon, appliance_type, is_favorite, sort_index, usage_count, last_used_at); `users.contact`; seeded `controller` device type.
- **API (deployed + verified live)**: full CRUD — homes (+ member link/unlink w/ roles), rooms, devices (register auto-creates channels; relay-count grow/shrink), channels (member=cosmetic, admin=appliance_type), admin users (pre-provision by email → auto-claim on first sign-in; delete blocked while owning homes). `POST /api/channels/{id}/toggle` persists relay state in `devices.state` jsonb + writes command event (MQTT publish hooks in later). `GET /api/homes/{id}/state` for dashboard polling. Global rate limit 120 req/min/IP. Verified in production: /api/homes 200, customer→/api/users 403.
- **Customer PWA (deployed)**: dashboard with house chips, room tabs, channel cards (optimistic toggle + 5s state polling via swap-ready hook), favorites + filter, reorder mode (sort_index), edit modal with icon picker, cascading search (house/room/type) with chips + breadcrumb results, profile page, navbar. No new deps.
- **Admin Portal (deployed)**: role-gated (admin/superadmin via /api/me); tabs Houses (CRUD, members, rooms, devices list), Customers (table, search, add/edit, active toggle, 409 handling), Devices (register/edit/delete, room reassign, relay-count, diagnostics row, channel editing); **/setup Board Setup page** — Web Serial (Chrome) writes `{"cmd":"setconfig",...}` JSON line to ESP32 over USB at 115200, credentials never touch the API.
- All five frontend routes verified 200 in production.

### 2026-07-11 — MQTT layer live (commits 7adddf8, e93d26f)
- **EMQX Cloud Serverless broker** `home-automation-broker` (project `home-automation-platform`, deployment `lb1d1698`): host `lb1d1698.ala.asia-southeast1.emqxsl.com`, MQTT/TLS 8883, WSS 8084, Asia-Pacific (Singapore, Google Cloud). **Spend limit $0** — free quota only (1M session-minutes, 1 GB traffic/month), suspends instead of billing.
- Broker credentials: `api-server` (Render env) and `device-b805` (for the B805 board). Both passwords in local gitignored `.secrets/mqtt-credentials.txt` — never committed, never in chat.
- **API MQTT bridge deployed + verified connected** (EMQX shows 1 active session): MQTTnet hosted service subscribes `ha/+/relay/+` and `ha/+/status`, mirrors reported relay state + telemetry (online/fw/rssi/heap/boot_count) into Postgres; toggle endpoint publishes `ha/<hw>/relay/<n>/set` QoS1. Render env: MQTT_HOST/PORT/USERNAME/PASSWORD.
- Contract for firmware: [MQTT_CONTRACT.md](MQTT_CONTRACT.md) — topics, retained flags, LWT `{"online":false}`, pendingPush rule, QoS1.

### 2026-07-11 — Firmware MQTT module written
- Repo `chitrang313/esp32-iot-framework`, branch `phase-one`: added `Cloud/MqttManager/` (MqttManager.h/.cpp/README — PubSubClient + WiFiClientSecure TLS 8883, subscribes `ha/<id>/relay/+/set`, publishes retained relay state + status JSON, LWT, offline queue, backoff reconnect) and `sketch_july21/` (july04 adapted: Firebase + SyncManager dropped, MqttManager owns cloud; same B805 hardware). secrets.h.example prefilled with broker host/port/user + device id; real device password stays in platform `.secrets/`.
- `chitrang313@gmail.com` promoted to admin (Neon); B805 house created; Customers-tab json_agg crash fixed.

**Open items (blocked on Chitrang):**
1. Flash firmware: install PubSubClient + ArduinoJson libs; copy `sketch_july21/secrets.h.example` → `secrets.h`; fill WiFi + device MQTT password; flash B805 via Arduino IDE.
2. Register B805 in admin → Devices (Hardware ID = `PdMHOx6Pg6EIo9tmpMvV`, matching SECRET_DEVICE_ID).
3. Board Setup page serial `setconfig` listener (optional convenience — firmware side not written yet).
4. Local LAN fast-path (roadmap).
