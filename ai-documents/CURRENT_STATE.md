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
- (updates appended below as work lands)
