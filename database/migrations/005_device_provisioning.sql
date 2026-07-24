-- =============================================================================
-- Migration: 005_device_provisioning
-- Purpose:  Support self-provisioning + customer claiming.
--           A board self-registers over WiFi (POST /api/provision) BEFORE any
--           customer owns it, so home_id must be nullable. The customer later
--           claims it in the app (POST /api/devices/claim), which sets home_id.
-- =============================================================================

BEGIN;

-- Unclaimed boards exist with no home until a customer claims them.
ALTER TABLE devices ALTER COLUMN home_id DROP NOT NULL;

ALTER TABLE devices ADD COLUMN claimed        boolean NOT NULL DEFAULT false;
ALTER TABLE devices ADD COLUMN provisioned_at timestamptz;
ALTER TABLE devices ADD COLUMN device_type    text;   -- reported by firmware at provision

-- Devices already registered by an admin (home assigned) count as claimed.
UPDATE devices SET claimed = true WHERE home_id IS NOT NULL;

INSERT INTO schema_migrations (version) VALUES ('005_device_provisioning');

COMMIT;
