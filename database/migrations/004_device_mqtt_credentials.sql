-- =============================================================================
-- Migration: 004_device_mqtt_credentials
-- Purpose:  Per-device MQTT credentials. Each physical board gets a unique
--           broker username/password (provisioned in EMQX via its REST API),
--           so a leaked/lost board is revoked in isolation.
-- Note:     mqtt_password is stored so the admin can retrieve it to flash the
--           board (Board Setup / secrets.h). It is a per-device, revocable,
--           topic-scoped credential — blast radius is one board. A future
--           hardening step can move to JWT auth and drop stored passwords.
-- =============================================================================

BEGIN;

ALTER TABLE devices ADD COLUMN mqtt_username text UNIQUE;
ALTER TABLE devices ADD COLUMN mqtt_password text;

INSERT INTO schema_migrations (version) VALUES ('004_device_mqtt_credentials');

COMMIT;
