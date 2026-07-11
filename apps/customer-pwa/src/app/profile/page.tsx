"use client";

import { onAuthStateChanged, signOut, type User } from "firebase/auth";
import Link from "next/link";
import { useEffect, useState } from "react";
import Navbar from "@/components/Navbar";
import { apiGet, apiPatch } from "@/lib/api";
import { auth } from "@/lib/firebase";
import type { Me } from "@/lib/types";

export default function ProfilePage() {
  const [user, setUser] = useState<User | null>(null);
  const [authChecked, setAuthChecked] = useState(false);

  const [me, setMe] = useState<Me | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const [displayName, setDisplayName] = useState("");
  const [contact, setContact] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    return onAuthStateChanged(auth, (u) => {
      setUser(u);
      setAuthChecked(true);
    });
  }, []);

  async function loadProfile() {
    setLoading(true);
    setError(null);
    try {
      const profile = await apiGet<Me>("/api/me");
      setMe(profile);
      setDisplayName(profile.display_name ?? "");
      setContact(profile.contact ?? "");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load profile");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!user) {
      setMe(null);
      return;
    }
    void loadProfile();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  async function handleSave(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setSaveError(null);
    setSaved(false);
    try {
      await apiPatch<Me>("/api/me", {
        displayName: displayName.trim() || null,
        contact: contact.trim() || null,
      });
      setMe((prev) =>
        prev
          ? { ...prev, display_name: displayName.trim() || null, contact: contact.trim() || null }
          : prev,
      );
      setSaved(true);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  if (!authChecked) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-gray-50">
        <p className="text-gray-500">Loading…</p>
      </main>
    );
  }

  if (!user) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center gap-6 bg-gray-50 p-4">
        <p className="text-gray-500">Sign in to view your profile.</p>
        <Link
          href="/login"
          className="min-h-11 rounded-lg bg-blue-600 px-8 py-3 font-medium text-white hover:bg-blue-700"
        >
          Sign in
        </Link>
      </main>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <Navbar email={user.email} />

      <main className="mx-auto max-w-xl space-y-4 px-4 py-4">
        <h1 className="text-2xl font-semibold text-gray-900">Profile</h1>

        {error ? (
          <div className="rounded-xl border border-red-100 bg-white p-6 text-center">
            <p className="mb-3 text-red-600">Could not load your profile. {error}</p>
            <button
              onClick={() => void loadProfile()}
              className="min-h-11 rounded-lg bg-blue-600 px-6 py-2 font-medium text-white hover:bg-blue-700"
            >
              Retry
            </button>
          </div>
        ) : loading || !me ? (
          <div className="rounded-xl bg-white p-8 text-center text-gray-500">Loading profile…</div>
        ) : (
          <>
            <section className="rounded-xl border border-gray-100 bg-white p-6 shadow-sm">
              <div className="mb-4 flex items-center justify-between">
                <div>
                  <p className="font-medium text-gray-900">{me.email}</p>
                  <p className="text-sm text-gray-500">
                    Role: <span className="font-mono">{me.role}</span>
                    {!me.is_active && <span className="ml-2 text-red-500">(inactive)</span>}
                  </p>
                </div>
              </div>

              <form onSubmit={(e) => void handleSave(e)} className="space-y-4">
                <div>
                  <label
                    htmlFor="display-name"
                    className="mb-1 block text-sm font-medium text-gray-700"
                  >
                    Display name
                  </label>
                  <input
                    id="display-name"
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                    maxLength={80}
                    placeholder="Your name"
                    className="min-h-11 w-full rounded-lg border border-gray-300 px-3 py-2 focus:border-blue-500 focus:outline-none"
                  />
                </div>
                <div>
                  <label htmlFor="contact" className="mb-1 block text-sm font-medium text-gray-700">
                    Contact
                  </label>
                  <input
                    id="contact"
                    value={contact}
                    onChange={(e) => setContact(e.target.value)}
                    maxLength={40}
                    placeholder="Phone or other contact"
                    className="min-h-11 w-full rounded-lg border border-gray-300 px-3 py-2 focus:border-blue-500 focus:outline-none"
                  />
                </div>

                {saveError && <p className="text-sm text-red-600">{saveError}</p>}
                {saved && <p className="text-sm text-green-600">Profile saved.</p>}

                <button
                  type="submit"
                  disabled={saving}
                  className="min-h-11 w-full rounded-lg bg-blue-600 py-2 font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                >
                  {saving ? "Saving…" : "Save changes"}
                </button>
              </form>
            </section>

            <section className="rounded-xl border border-gray-100 bg-white p-6 shadow-sm">
              <h2 className="mb-3 font-medium text-gray-900">Linked homes</h2>
              {me.homes.length === 0 ? (
                <p className="text-sm text-gray-500">No homes linked yet.</p>
              ) : (
                <ul className="space-y-2">
                  {me.homes.map((home) => (
                    <li
                      key={home.id}
                      className="flex items-center gap-3 rounded-lg border border-gray-100 p-3"
                    >
                      <span aria-hidden className="text-xl">
                        🏠
                      </span>
                      <div className="min-w-0">
                        <p className="truncate font-medium text-gray-900">{home.name}</p>
                        {home.address && (
                          <p className="truncate text-sm text-gray-500">{home.address}</p>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <button
              onClick={() => void signOut(auth)}
              className="min-h-11 w-full rounded-xl border border-gray-300 bg-white py-3 font-medium text-gray-700 hover:bg-gray-50"
            >
              Sign out
            </button>
          </>
        )}
      </main>
    </div>
  );
}
