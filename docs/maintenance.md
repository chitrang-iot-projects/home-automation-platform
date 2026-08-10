# Engineering Maintenance Log

## Current Work & State
- **Date:** 2026-08-10
- **Primary Goal:** Unclaimed board visibility, device deletion fix, and Customer PWA real-time state sync.

### Active Issues & Root Cause Analysis

1. **Unclaimed Board Visibility**
   - **Problem:** Self-provisioned ESP32 boards (`home_id IS NULL`) were invisible in the Admin Portal.
   - **Fix:** Implemented `GET /api/admin/unclaimed-devices` and added an **Unclaimed Devices** section with home reassignment controls in `DevicesTab.tsx`.

2. **Device Deletion Failure**
   - **Problem:** Clicking "Delete" in the Admin Portal failed with 404/405 error.
   - **Root Cause:** `deviceGroup.MapDelete("/", ...)` handler was missing from `DeviceEndpoints.cs`.
   - **Fix:** Restored `MapDelete` handler, verified DB record deletion and EMQX MQTT credential revocation. Deleted `esp32-000000000000` and `esp32-3076f5b92894`.

3. **Customer PWA Touch Switch State Sync Issue**
   - **Problem:** Pressing physical touch switches toggled lights, but the virtual switches on Customer PWA (`https://home-automation-platform-gilt.vercel.app/`) did not update state.
   - **Root Cause:** Route name mismatch between frontend state hook (`useChannelStates.ts`) and ASP.NET Core API (`DeviceEndpoints.cs`). The hook polled `GET /api/homes/{homeId}/state`, but the backend only registered `/api/homes/{homeId}/relay-states`, returning 404 on every poll.
   - **Fix:** Mapped both `/api/homes/{homeId}/state` and `/api/homes/{homeId}/relay-states` to `GetHomeStateAsync` in `DeviceEndpoints.cs`.

4. **Render Deployment HostBuilder Inotify Crash**
   - **Problem:** `WebApplication.CreateBuilder` crashed on Linux container startup with `System.IO.IOException: The configured user limit (128) on the number of inotify instances has been reached`.
   - **Fix:** Added `Environment.SetEnvironmentVariable("DOTNET_HOSTBUILDER__RELOADCONFIGONCHANGE", "false");` in `Program.cs` and `ENV DOTNET_HOSTBUILDER__RELOADCONFIGONCHANGE=false` in `Dockerfile`.

---

## Git & Branching State

- **`home-automation-platform`:**
  - `develop`: Pushed and up-to-date (`commit 45768c6`).
  - `main`: Merged and pushed (`commit 45768c6`). Auto-deploying to Vercel and Render.
- **`esp32-iot-framework`:**
  - `phase-one`: Pushed and up-to-date (`commit 87fc393`). Clean B805 plug-and-play firmware architecture.
