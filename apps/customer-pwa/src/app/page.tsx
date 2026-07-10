"use client";

import { onAuthStateChanged, signOut, type User } from "firebase/auth";
import Link from "next/link";
import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import { auth } from "@/lib/firebase";

interface Profile {
  id: string;
  email: string;
  display_name: string | null;
  role: string;
}

export default function Home() {
  const [user, setUser] = useState<User | null>(null);
  const [checked, setChecked] = useState(false);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [profileError, setProfileError] = useState<string | null>(null);

  useEffect(() => {
    return onAuthStateChanged(auth, (u) => {
      setUser(u);
      setChecked(true);
    });
  }, []);

  useEffect(() => {
    if (!user) {
      setProfile(null);
      return;
    }
    apiFetch<Profile>("/api/me")
      .then(setProfile)
      .catch((err) => setProfileError(err.message));
  }, [user]);

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 p-4">
      <h1 className="text-3xl font-semibold">Shree Ganeshay nammh:</h1>

      {!checked ? (
        <p className="text-gray-500">Loading…</p>
      ) : user ? (
        <div className="flex flex-col items-center gap-3 rounded-xl border border-gray-200 p-6">
          <p className="text-lg">
            Welcome, <span className="font-medium">{user.email}</span>
          </p>
          {profile ? (
            <p className="text-sm text-gray-600">
              Platform profile: role <span className="font-mono">{profile.role}</span> · id{" "}
              <span className="font-mono">{profile.id.slice(0, 8)}…</span>
            </p>
          ) : profileError ? (
            <p className="text-sm text-red-600">API error: {profileError}</p>
          ) : (
            <p className="text-sm text-gray-400">Loading profile from API…</p>
          )}
          <button
            onClick={() => signOut(auth)}
            className="rounded-lg border border-gray-300 px-4 py-2 text-sm hover:bg-gray-50"
          >
            Sign out
          </button>
        </div>
      ) : (
        <Link
          href="/login"
          className="rounded-lg bg-blue-600 px-6 py-2 font-medium text-white hover:bg-blue-700"
        >
          Sign in
        </Link>
      )}
    </main>
  );
}
