"use client";

import { useMemo } from "react";
import type { Home, HomeData } from "@/lib/types";

export interface FilterState {
  houseId: string;
  roomId: string;
  applianceType: string;
}

export const EMPTY_FILTERS: FilterState = { houseId: "", roomId: "", applianceType: "" };

export function hasActiveFilters(f: FilterState): boolean {
  return Boolean(f.houseId || f.roomId || f.applianceType);
}

interface SearchFilterProps {
  homes: Home[];
  /** Rooms + devices cache keyed by home id (from useHomeData). */
  homeData: Record<string, HomeData>;
  value: FilterState;
  onChange: (next: FilterState) => void;
  /** Live count of channels matching the current filters. */
  resultCount: number;
}

const selectClass =
  "min-h-11 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm " +
  "focus:border-blue-500 focus:outline-none disabled:bg-gray-100 disabled:text-gray-400";

/**
 * Cascading AND filters: House → Room (rooms of the chosen house only)
 * → Appliance type (union of channel appliancetype values).
 */
export default function SearchFilter({
  homes,
  homeData,
  value,
  onChange,
  resultCount,
}: SearchFilterProps) {
  const rooms = value.houseId ? (homeData[value.houseId]?.rooms ?? []) : [];

  const applianceTypes = useMemo(() => {
    const sourceHomeIds = value.houseId ? [value.houseId] : Object.keys(homeData);
    const set = new Set<string>();
    for (const homeId of sourceHomeIds) {
      const data = homeData[homeId];
      if (!data) continue;
      for (const device of data.devices) {
        for (const ch of device.channels) {
          if (ch.appliancetype) set.add(ch.appliancetype);
        }
      }
    }
    return Array.from(set).sort();
  }, [homeData, value.houseId]);

  const active = hasActiveFilters(value);
  const houseName = homes.find((h) => h.id === value.houseId)?.name;
  const roomName = rooms.find((r) => r.id === value.roomId)?.name;

  const chips: { label: string; clear: () => void }[] = [];
  if (value.houseId && houseName) {
    chips.push({
      label: houseName,
      // Clearing the house also clears the dependent room filter.
      clear: () => onChange({ ...value, houseId: "", roomId: "" }),
    });
  }
  if (value.roomId && roomName) {
    chips.push({ label: roomName, clear: () => onChange({ ...value, roomId: "" }) });
  }
  if (value.applianceType) {
    chips.push({
      label: value.applianceType,
      clear: () => onChange({ ...value, applianceType: "" }),
    });
  }

  return (
    <section className="rounded-xl border border-gray-200 bg-white p-4">
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        <select
          aria-label="Filter by house"
          value={value.houseId}
          onChange={(e) => onChange({ ...value, houseId: e.target.value, roomId: "" })}
          className={selectClass}
        >
          <option value="">All houses</option>
          {homes.map((h) => (
            <option key={h.id} value={h.id}>
              {h.name}
            </option>
          ))}
        </select>

        <select
          aria-label="Filter by room"
          value={value.roomId}
          onChange={(e) => onChange({ ...value, roomId: e.target.value })}
          disabled={!value.houseId}
          className={selectClass}
        >
          <option value="">{value.houseId ? "All rooms" : "Pick a house first"}</option>
          {rooms.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name}
            </option>
          ))}
        </select>

        <select
          aria-label="Filter by appliance type"
          value={value.applianceType}
          onChange={(e) => onChange({ ...value, applianceType: e.target.value })}
          className={selectClass}
        >
          <option value="">All appliance types</option>
          {applianceTypes.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
      </div>

      {active && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {chips.map((chip) => (
            <span
              key={chip.label}
              className="inline-flex items-center gap-1 rounded-full bg-blue-50 py-1 pl-3 pr-1 text-sm font-medium text-blue-700"
            >
              {chip.label}
              <button
                onClick={chip.clear}
                aria-label={`Remove ${chip.label} filter`}
                className="flex h-7 w-7 items-center justify-center rounded-full hover:bg-blue-100"
              >
                ×
              </button>
            </span>
          ))}
          <button
            onClick={() => onChange(EMPTY_FILTERS)}
            className="min-h-11 px-2 text-sm font-medium text-gray-500 hover:text-gray-700"
          >
            Clear all
          </button>
          <span className="ml-auto text-sm text-gray-500">
            {resultCount} result{resultCount === 1 ? "" : "s"}
          </span>
        </div>
      )}
    </section>
  );
}
