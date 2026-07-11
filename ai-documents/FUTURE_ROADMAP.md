# Future Roadmap — Suggested Features & Functionality

> Living document. Everything we might build, ordered by suggested priority.
> Items move OUT of here and into CURRENT_STATE.md when implemented.
> Last updated: 2026-07-11

## Near-term (next phases)

1. **Device claiming flow** — device ships with claim code / QR; customer adds device to their account themselves (today: admin registers devices). Enables the vision's "sell → customer claims" journey.
2. **Schedules & timers** — user sets on/off schedules; stored in Postgres, pushed to device over MQTT so the device executes them locally (works during internet outages).
3. **OTA firmware updates** — firmware version registry in admin portal, upload .bin, staged rollout per device/house, device self-updates (vision Phase 9).
4. **Device diagnostics dashboard** — richer than parity: RSSI history charts, heap trends, boot counts, offline incident log (data already flowing via heartbeats).
5. **Web push notifications** — device offline alerts, schedule confirmations, security events (FCM, works with PWA).
6. **Family sharing UX** — invite by email with role picker (owner/member/guest); guest = control only, no renames. Schema already supports.
7. **Local LAN fast-path** — phone on same WiFi talks directly to board (local WebSocket/mDNS), sub-15ms toggles, works with internet down. Firmware adds a small local server module.

## Mid-term

8. **Scenes** — one tap sets many channels ("Movie night"): definition in jsonb, execution via MQTT fan-out.
9. **Energy monitoring** — energy-meter device type exists in schema; needs hardware + telemetry charts.
10. **Usage analytics** — per-appliance usage reports, most-used insights (usage_count/last_used_at already tracked).
11. **Audit trail UI** — admin view over device_events (who toggled what when).
12. **Rate limiting + abuse protection hardening** — per-user quotas, IP throttling at API.
13. **Automated tests in CI** — API integration tests against ephemeral Postgres, frontend component tests, Playwright e2e.
14. **API observability** — structured JSON logs, request tracing, error alerting (e.g. Sentry free tier).
15. **PWA offline shell** — service worker, installable app, cached last-known state with "stale" indicator.

## Long-term (vision Phase 10)

16. Fan controller (speed), curtain controller (position), door lock (high security bar), motion/temperature sensors.
17. **Voice assistants** — Google Home / Alexa integration.
18. **Matter bridge** — expose devices to Matter ecosystems without platform redesign.
19. **Multi-tenant SaaS hardening** — org/installer accounts, per-tenant branding, billing.
20. **Mobile apps** — wrap PWA (Capacitor) or native, if PWA limits bite.

## Deliberately Dropped (from old project)

- Firmware .ino generation + download button + per-config compile — replaced by generic firmware + Web Serial board setup + (future) OTA.
- Relay slot editor / orphan auto-assign — channel = physical wiring; rename-only model.
- Firebase Firestore as structural store — PostgreSQL now.
