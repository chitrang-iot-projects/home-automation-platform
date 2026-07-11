-- =============================================================================
-- Migration: 002_channels_and_parity
-- Purpose:  Channel model (generic firmware — relay channel = physical wiring)
--           plus parity fields carried over from the legacy project.
--           Slot-editor/firmware-generation concepts are intentionally absent.
-- Target:   PostgreSQL 18 (Neon)
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- rooms: floor label (legacy parity)
-- -----------------------------------------------------------------------------
ALTER TABLE rooms ADD COLUMN floor text;

-- -----------------------------------------------------------------------------
-- devices: board-level parity + diagnostics fields
-- devices here = physical ESP32 boards. type_code stays (board category).
-- -----------------------------------------------------------------------------
-- (firmware_version already exists from migration 001)
ALTER TABLE devices ADD COLUMN relay_count      integer NOT NULL DEFAULT 4
                        CHECK (relay_count BETWEEN 1 AND 16);
ALTER TABLE devices ADD COLUMN boot_count       integer;
ALTER TABLE devices ADD COLUMN rssi_dbm         integer;
ALTER TABLE devices ADD COLUMN free_heap_bytes  bigint;

-- -----------------------------------------------------------------------------
-- device_channels — one row per relay channel on a board.
-- Identity = (device_id, channel_no); everything else is cosmetic/user-facing.
-- Replaces the legacy "appliances + relay slot assignment" model.
-- -----------------------------------------------------------------------------
CREATE TABLE device_channels (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    device_id     uuid NOT NULL REFERENCES devices (id) ON DELETE CASCADE,
    channel_no    integer NOT NULL CHECK (channel_no BETWEEN 1 AND 16),
    name          text NOT NULL,                 -- "Main Light" (default "Switch N")
    icon          text NOT NULL DEFAULT 'switch',
    appliance_type text NOT NULL DEFAULT 'switch', -- functional category (light/fan/…)
    is_favorite   boolean NOT NULL DEFAULT false,
    sort_index    integer,                       -- manual order; NULL = auto (usage)
    usage_count   integer NOT NULL DEFAULT 0,
    last_used_at  timestamptz,
    created_at    timestamptz NOT NULL DEFAULT now(),
    updated_at    timestamptz NOT NULL DEFAULT now(),
    UNIQUE (device_id, channel_no)
);

CREATE INDEX idx_device_channels_device ON device_channels (device_id);

CREATE TRIGGER trg_device_channels_updated_at
    BEFORE UPDATE ON device_channels
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- -----------------------------------------------------------------------------
-- users: contact number parity (legacy persons.contact)
-- -----------------------------------------------------------------------------
ALTER TABLE users ADD COLUMN contact text;

-- -----------------------------------------------------------------------------
-- ledger
-- -----------------------------------------------------------------------------
INSERT INTO schema_migrations (version) VALUES ('002_channels_and_parity');

COMMIT;
