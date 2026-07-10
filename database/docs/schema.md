# Database Schema

PostgreSQL 18 on Neon. Project: `home-automation-platform` (AWS us-west-2, Oregon).
Database: `neondb`, branch: `production`.

Applied migrations live in [`database/migrations/`](../migrations/) and are
recorded in the `schema_migrations` table. Migrations are currently applied
manually via the Neon SQL Editor; a tool (EF Core migrations or Flyway) will
take over in a later phase.

## Entity Overview

```
users ──< homes ──< rooms
  │         │         │
  │         └──< home_members >── users
  │         │
  │         └──< devices >── device_types (lookup)
  │         │        │
  │         │        ├──< device_telemetry   (time-series readings)
  │         │        └──< device_events      (commands / audit trail)
  │         │
  │         └──< automations
```

## Tables

| Table | Purpose | Key points |
|---|---|---|
| `users` | Platform accounts | `firebase_uid` nullable until auth phase; `role`: customer / admin / superadmin |
| `homes` | Physical property | `owner_id` → users (RESTRICT — owner can't be deleted while home exists) |
| `home_members` | Home access control | Composite PK (home_id, user_id); `role`: owner / member / guest |
| `rooms` | Device grouping inside a home | Unique (home_id, name) |
| `device_types` | Lookup of supported device kinds | Seeded: switch, dimmer, fan, rgb_light, curtain, sensors, energy_meter; `capabilities` jsonb |
| `devices` | Physical unit (ESP32 etc.) | `hardware_id` unique (MAC/chip id); `state`/`config` jsonb; `is_online` + `last_seen_at` |
| `device_telemetry` | Sensor time-series | Plain table now — partition by month when volume demands; index (device_id, recorded_at DESC) |
| `device_events` | Commands, connectivity, errors | `user_id` null = system-generated; append-only audit trail |
| `automations` | User rules (if X then Y) | `definition` jsonb holds triggers/conditions/actions |
| `schema_migrations` | Manual migration ledger | One row per applied migration file |

## Conventions

- Primary keys: `uuid` via `gen_random_uuid()` (entities), `bigint identity` (high-volume append-only tables).
- All timestamps `timestamptz`; `updated_at` maintained by the `set_updated_at()` trigger.
- Deleting a home cascades to rooms, members, devices, automations. Deleting a device cascades to its telemetry/events.
- Flexible/evolving payloads (`state`, `config`, `capabilities`, `definition`, telemetry `payload`) use `jsonb`.
