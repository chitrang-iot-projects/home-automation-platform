# Engineering Maintenance Log

## Current Work & State
- **Date:** 2026-08-10
- **Primary Goal:** Sub-second instant real-time touch switch state synchronization, unclaimed board visibility, and device deletion fix.

### Active Issues & Root Cause Analysis

1. **Sub-Second Touch Switch State Synchronization**
   - **Problem:** Toggling physical touch switches on the ESP32 updated the light instantly, but taking 3–4 seconds to sync on the Customer PWA.
   - **Root Cause:** The PWA used a slow 5-second HTTP polling loop (`POLL_INTERVAL_MS = 5000`).
   - **Fix:**
     - Added an in-memory event bus `OnRelayStateChanged` in `MqttService.cs`.
     - Implemented a Server-Sent Events (SSE) streaming endpoint: `GET /api/homes/{homeId}/state/stream`.
     - Updated `useChannelStates.ts` on the Customer PWA to listen to the SSE stream for **< 50ms instant push updates**, while keeping a fast 1.5s background HTTP poll as a failsafe fallback.

2. **Unclaimed Board Visibility**
   - **Problem:** Self-provisioned ESP32 boards (`home_id IS NULL`) were invisible in the Admin Portal.
   - **Fix:** Implemented `GET /api/admin/unclaimed-devices` and added an **Unclaimed Devices** section with home reassignment controls in `DevicesTab.tsx`.

3. **Device Deletion Failure**
   - **Problem:** Clicking "Delete" in the Admin Portal failed with 404/405 error.
   - **Root Cause:** `deviceGroup.MapDelete("/", ...)` handler was missing from `DeviceEndpoints.cs`.
   - **Fix:** Restored `MapDelete` handler, verified DB record deletion and EMQX MQTT credential revocation. Deleted `esp32-000000000000` and `esp32-3076f5b92894`.

4. **Render Deployment HostBuilder Inotify Crash**
   - **Problem:** `WebApplication.CreateBuilder` crashed on Linux container startup with `System.IO.IOException: The configured user limit (128) on the number of inotify instances has been reached`.
   - **Fix:** Added `Environment.SetEnvironmentVariable("DOTNET_HOSTBUILDER__RELOADCONFIGONCHANGE", "false");` in `Program.cs` and `ENV DOTNET_HOSTBUILDER__RELOADCONFIGONCHANGE=false` in `Dockerfile`.

---

## Git & Branching State

- **`home-automation-platform`:**
  - `develop`: Pushed and up-to-date (`commit ac3f7e0`).
  - `main`: Merged and pushed (`commit ac3f7e0`). Auto-deploying to Vercel and Render.
- **`esp32-iot-framework`:**
  - `phase-one`: Pushed and up-to-date (`commit 87fc393`).
