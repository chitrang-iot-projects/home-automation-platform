# Maintenance

This document preserves useful engineering context between AI-agent sessions. It is not a conversation transcript. Summarize investigations, changes, validation, and remaining work; never copy a full AI conversation.

## Current State

Self-provisioning firmware (`July_24072026.ino`) creates unclaimed devices in PostgreSQL with `home_id = NULL`.
The API and Admin Portal now support querying, displaying, and managing unclaimed devices.

## Active / In-Progress Work

None.

## Known Issues

None.

## Pending Work

- Deploy updated API service to Render.
- Deploy updated Admin Portal app to Vercel.

## Recent Work

### 2026-08-10 — Display & Manage Unclaimed Devices in Admin Portal

#### Request
Unclaimed self-provisioned devices (`home_id = NULL`) were not appearing in the Admin Portal. Identify the root cause and implement a fix.

#### Investigation
- Found that `POST /api/provision` creates device rows with `home_id = NULL`.
- `GET /api/homes/{homeId}/devices` only returned devices for a specific `home_id`.
- `DevicesTab.tsx` loaded devices home-by-home, skipping any device where `home_id IS NULL`.

#### Changes
- **`backend/HomeAutomation.Api/Endpoints/DeviceEndpoints.cs`**:
  - Added `GET /api/admin/unclaimed-devices` (Admin-only) returning devices and channels where `home_id IS NULL`.
  - Updated `PATCH /api/devices/{id}` to support assigning/updating `homeId`.
- **`apps/admin-portal/src/components/DevicesTab.tsx`**:
  - Updated `load()` to fetch `/api/admin/unclaimed-devices` alongside home bundles.
  - Added an **"Unclaimed / Self-Provisioned Devices"** section at the top of `DevicesTab`.
  - Allowed assigning any unclaimed device to a home directly via the UI.

#### Validation
- `dotnet build` passed with 0 errors and 0 warnings.
- `next build` (`npm run build` in `apps/admin-portal`) passed with 0 errors and 0 warnings.

#### Remaining Work
- Push/deploy updated API to Render and Admin Portal to Vercel.

#### Notes for Future Agents
- Self-provisioned boards initially have `home_id = NULL` and `claimed = false`.
- The Admin Portal now queries `/api/admin/unclaimed-devices` so these boards are immediately visible as soon as they complete captive portal setup.

## Important Discoveries
- Devices created via `/api/provision` remain unclaimed until a customer claims them via `/api/devices/claim` or an admin assigns a home.

## Handoff Notes
- All code changes are compiled and verified locally. Ready for deployment.
