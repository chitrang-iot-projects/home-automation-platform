"use client";

import { useState } from "react";
import { apiPatch } from "@/lib/api";
import type { Channel } from "@/lib/types";
import { CHANNEL_ICONS } from "@/lib/types";

interface EditChannelModalProps {
  channel: Channel;
  onClose: () => void;
  /** Called with the updated channel after a successful PATCH. */
  onSaved: (updated: Channel) => void;
}

/** Modal to rename a channel and pick its icon (icon KEY is stored). */
export default function EditChannelModal({ channel, onClose, onSaved }: EditChannelModalProps) {
  const [name, setName] = useState(channel.name);
  const [icon, setIcon] = useState(channel.icon ?? "other");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSave() {
    const trimmed = name.trim();
    if (!trimmed) {
      setError("Name cannot be empty");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const updated = await apiPatch<Channel>(`/api/channels/${channel.id}`, {
        name: trimmed,
        icon,
      });
      onSaved(updated);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={`Edit ${channel.name}`}
    >
      <div
        className="w-full max-w-sm rounded-xl bg-white p-6 shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="mb-4 text-lg font-semibold">Edit channel</h2>

        <label className="mb-1 block text-sm font-medium text-gray-700" htmlFor="channel-name">
          Name
        </label>
        <input
          id="channel-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={60}
          className="mb-4 min-h-11 w-full rounded-lg border border-gray-300 px-3 py-2 focus:border-blue-500 focus:outline-none"
        />

        <p className="mb-2 text-sm font-medium text-gray-700">Icon</p>
        <div className="mb-4 grid grid-cols-5 gap-2">
          {Object.entries(CHANNEL_ICONS).map(([key, emoji]) => (
            <button
              key={key}
              type="button"
              onClick={() => setIcon(key)}
              aria-label={key}
              aria-pressed={icon === key}
              className={`flex min-h-11 min-w-11 items-center justify-center rounded-lg border text-xl ${
                icon === key
                  ? "border-blue-600 bg-blue-50 ring-2 ring-blue-600"
                  : "border-gray-200 hover:bg-gray-50"
              }`}
            >
              {emoji}
            </button>
          ))}
        </div>

        {error && <p className="mb-3 text-sm text-red-600">{error}</p>}

        <div className="flex gap-2">
          <button
            onClick={onClose}
            disabled={saving}
            className="min-h-11 flex-1 rounded-lg border border-gray-300 py-2 font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={() => void handleSave()}
            disabled={saving}
            className="min-h-11 flex-1 rounded-lg bg-blue-600 py-2 font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}
