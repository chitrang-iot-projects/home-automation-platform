-- =============================================================================
-- Migration: 003_controller_device_type
-- Purpose:  Seed the 'controller' device type — devices rows represent physical
--           ESP32 boards; per-channel function lives in device_channels.
-- =============================================================================

BEGIN;

INSERT INTO device_types (code, display_name, capabilities)
VALUES ('controller', 'ESP32 Switch Controller',
        '{"channels_max": 16, "actions": ["relay_on", "relay_off"]}')
ON CONFLICT (code) DO NOTHING;

INSERT INTO schema_migrations (version) VALUES ('003_controller_device_type');

COMMIT;
