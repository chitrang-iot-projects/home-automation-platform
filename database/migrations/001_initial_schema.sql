-- =============================================================================
-- Migration: 001_initial_schema
-- Purpose:  Core schema for the home automation platform.
--           Users, homes, rooms, devices, telemetry, events, automations.
-- Target:   PostgreSQL 18 (Neon)
-- Notes:    firebase_uid stays nullable until the auth phase wires Firebase.
--           Telemetry is a plain table for now; partition when volume demands.
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- updated_at trigger helper
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$;

-- -----------------------------------------------------------------------------
-- users — platform accounts (customers and admins)
-- -----------------------------------------------------------------------------
CREATE TABLE users (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    firebase_uid  text UNIQUE,                          -- linked in auth phase
    email         text NOT NULL UNIQUE,
    display_name  text,
    phone         text,
    role          text NOT NULL DEFAULT 'customer'
                  CHECK (role IN ('customer', 'admin', 'superadmin')),
    is_active     boolean NOT NULL DEFAULT true,
    created_at    timestamptz NOT NULL DEFAULT now(),
    updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER trg_users_updated_at
    BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- -----------------------------------------------------------------------------
-- homes — a physical property owned by a user
-- -----------------------------------------------------------------------------
CREATE TABLE homes (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id    uuid NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
    name        text NOT NULL,
    address     text,
    timezone    text NOT NULL DEFAULT 'UTC',
    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_homes_owner_id ON homes (owner_id);

CREATE TRIGGER trg_homes_updated_at
    BEFORE UPDATE ON homes
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- -----------------------------------------------------------------------------
-- home_members — who can access a home, and with what role
-- -----------------------------------------------------------------------------
CREATE TABLE home_members (
    home_id     uuid NOT NULL REFERENCES homes (id) ON DELETE CASCADE,
    user_id     uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    role        text NOT NULL DEFAULT 'member'
                CHECK (role IN ('owner', 'member', 'guest')),
    invited_at  timestamptz NOT NULL DEFAULT now(),
    joined_at   timestamptz,
    PRIMARY KEY (home_id, user_id)
);

CREATE INDEX idx_home_members_user_id ON home_members (user_id);

-- -----------------------------------------------------------------------------
-- rooms — logical grouping of devices inside a home
-- -----------------------------------------------------------------------------
CREATE TABLE rooms (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    home_id     uuid NOT NULL REFERENCES homes (id) ON DELETE CASCADE,
    name        text NOT NULL,
    icon        text,
    sort_order  integer NOT NULL DEFAULT 0,
    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now(),
    UNIQUE (home_id, name)
);

CREATE TRIGGER trg_rooms_updated_at
    BEFORE UPDATE ON rooms
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- -----------------------------------------------------------------------------
-- device_types — lookup of supported device kinds and their capabilities
-- -----------------------------------------------------------------------------
CREATE TABLE device_types (
    code          text PRIMARY KEY,          -- e.g. 'switch', 'sensor_temperature'
    display_name  text NOT NULL,
    capabilities  jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at    timestamptz NOT NULL DEFAULT now()
);

INSERT INTO device_types (code, display_name, capabilities) VALUES
    ('switch',             'On/Off Switch',      '{"actions": ["on", "off"]}'),
    ('dimmer',             'Dimmer',             '{"actions": ["on", "off", "set_level"], "level_range": [0, 100]}'),
    ('fan',                'Fan',                '{"actions": ["on", "off", "set_speed"], "speed_range": [1, 5]}'),
    ('rgb_light',          'RGB Light',          '{"actions": ["on", "off", "set_color", "set_brightness"]}'),
    ('curtain',            'Curtain/Blind',      '{"actions": ["open", "close", "set_position"]}'),
    ('sensor_temperature', 'Temperature Sensor', '{"metrics": ["temperature_c"]}'),
    ('sensor_humidity',    'Humidity Sensor',    '{"metrics": ["humidity_pct"]}'),
    ('sensor_motion',      'Motion Sensor',      '{"metrics": ["motion"]}'),
    ('energy_meter',       'Energy Meter',       '{"metrics": ["power_w", "energy_kwh"]}');

-- -----------------------------------------------------------------------------
-- devices — a physical unit (e.g. ESP32 relay/sensor) registered to a home
-- -----------------------------------------------------------------------------
CREATE TABLE devices (
    id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    home_id           uuid NOT NULL REFERENCES homes (id) ON DELETE CASCADE,
    room_id           uuid REFERENCES rooms (id) ON DELETE SET NULL,
    type_code         text NOT NULL REFERENCES device_types (code),
    name              text NOT NULL,
    hardware_id       text NOT NULL UNIQUE,   -- MAC / chip id printed on device
    firmware_version  text,
    is_online         boolean NOT NULL DEFAULT false,
    last_seen_at      timestamptz,
    state             jsonb NOT NULL DEFAULT '{}'::jsonb,  -- current reported state
    config            jsonb NOT NULL DEFAULT '{}'::jsonb,  -- per-device settings
    created_at        timestamptz NOT NULL DEFAULT now(),
    updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_devices_home_id ON devices (home_id);
CREATE INDEX idx_devices_room_id ON devices (room_id);
CREATE INDEX idx_devices_type_code ON devices (type_code);

CREATE TRIGGER trg_devices_updated_at
    BEFORE UPDATE ON devices
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- -----------------------------------------------------------------------------
-- device_telemetry — time-series sensor readings
-- Plain table now; convert to native partitions (by month) when volume grows.
-- -----------------------------------------------------------------------------
CREATE TABLE device_telemetry (
    id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    device_id    uuid NOT NULL REFERENCES devices (id) ON DELETE CASCADE,
    metric       text NOT NULL,               -- e.g. 'temperature_c'
    value        double precision,
    payload      jsonb,                       -- raw reading when not scalar
    recorded_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_device_telemetry_device_time
    ON device_telemetry (device_id, recorded_at DESC);

-- -----------------------------------------------------------------------------
-- device_events — commands, state changes, connectivity, errors (audit trail)
-- -----------------------------------------------------------------------------
CREATE TABLE device_events (
    id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    device_id   uuid NOT NULL REFERENCES devices (id) ON DELETE CASCADE,
    user_id     uuid REFERENCES users (id) ON DELETE SET NULL,  -- null = system
    event_type  text NOT NULL
                CHECK (event_type IN ('command', 'state_change', 'online', 'offline', 'error')),
    payload     jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_device_events_device_time
    ON device_events (device_id, created_at DESC);

-- -----------------------------------------------------------------------------
-- automations — user-defined rules ("if motion then light on"), stored as JSON
-- -----------------------------------------------------------------------------
CREATE TABLE automations (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    home_id     uuid NOT NULL REFERENCES homes (id) ON DELETE CASCADE,
    created_by  uuid REFERENCES users (id) ON DELETE SET NULL,
    name        text NOT NULL,
    is_enabled  boolean NOT NULL DEFAULT true,
    definition  jsonb NOT NULL,               -- triggers/conditions/actions
    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_automations_home_id ON automations (home_id);

CREATE TRIGGER trg_automations_updated_at
    BEFORE UPDATE ON automations
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- -----------------------------------------------------------------------------
-- schema_migrations — manual migration ledger until a tool (EF Core/Flyway)
-- takes over
-- -----------------------------------------------------------------------------
CREATE TABLE schema_migrations (
    version     text PRIMARY KEY,
    applied_at  timestamptz NOT NULL DEFAULT now()
);

INSERT INTO schema_migrations (version) VALUES ('001_initial_schema');

COMMIT;
