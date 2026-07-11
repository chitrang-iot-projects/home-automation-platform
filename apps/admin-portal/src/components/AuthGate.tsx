"use client";

import { onAuthStateChanged, signOut, type User } from "firebase/auth";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createContext, useContext, useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import { auth } from "@/lib/firebase";
import type { Me } from "@/lib/types";

interface AdminContextValue {
  me: Me;
  user: User;
}

const AdminContext = createContext<AdminContextValue | null>(null);

export function useAdmin(): AdminContextValue {
  const ctx = useContext(AdminContext);
  if (!ctx) throw new Error("useAdmin must be used inside <AuthGate>");
  return ctx;
}

type GateStatus = "loading" | "notadmin" | "error" | "ready";

// Wraps a page: requires a signed-in Firebase user whose /api/me role is
// admin or superadmin. Renders the top navbar when ready.
export default function AuthGate({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [me, setMe] = useState<Me | null>(null);
  const [status, setStatus] = useState<GateStatus>("loading");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    return onAuthStateChanged(auth, (u) => {
      setUser(u);
      if (!u) {
        setMe(null);
        setStatus("loading");
        router.replace("/login");
      }
    });
  }, [router]);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    setStatus("loading");
    setError(null);
    apiFetch<Me>("/api/me")
      .then((profile) => {
        if (cancelled) return;
        setMe(profile);
        setStatus(
          profile.role === "admin" || profile.role === "superadmin"
            ? "ready"
            : "notadmin",
        );
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Failed to load profile");
        setStatus("error");
      });
    return () => {
      cancelled = true;
    };
  }, [user]);

  async function handleSignOut() {
    await signOut(auth);
    router.replace("/login");
  }

  if (!user || status === "loading") {
    return (
      <main className="flex min-h-screen items-center justify-center bg-gray-50">
        <p className="text-sm text-gray-500">Loading…</p>
      </main>
    );
  }

  if (status === "notadmin") {
    return (
      <main className="flex min-h-screen items-center justify-center bg-gray-50 p-4">
        <div className="w-full max-w-sm rounded-xl bg-white p-8 text-center shadow">
          <h1 className="mb-2 text-xl font-semibold">Not an admin account</h1>
          <p className="mb-6 text-sm text-gray-600">
            {user.email} does not have admin access to this portal.
          </p>
          <button
            onClick={handleSignOut}
            className="w-full rounded-lg bg-blue-600 py-2 font-medium text-white hover:bg-blue-700"
          >
            Sign out
          </button>
        </div>
      </main>
    );
  }

  if (status === "error" || !me) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-gray-50 p-4">
        <div className="w-full max-w-sm rounded-xl bg-white p-8 text-center shadow">
          <h1 className="mb-2 text-xl font-semibold">Something went wrong</h1>
          <p className="mb-6 text-sm text-red-600">{error ?? "Unknown error"}</p>
          <div className="space-y-2">
            <button
              onClick={() => window.location.reload()}
              className="w-full rounded-lg bg-blue-600 py-2 font-medium text-white hover:bg-blue-700"
            >
              Retry
            </button>
            <button
              onClick={handleSignOut}
              className="w-full rounded-lg border border-gray-300 py-2 font-medium hover:bg-gray-50"
            >
              Sign out
            </button>
          </div>
        </div>
      </main>
    );
  }

  return (
    <AdminContext.Provider value={{ me, user }}>
      <div className="min-h-screen bg-gray-50">
        <header className="border-b border-gray-200 bg-white">
          <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-3">
            <div className="flex items-center gap-6">
              <Link href="/" className="text-lg font-semibold text-gray-900">
                Home Admin
              </Link>
              <nav className="flex items-center gap-4 text-sm">
                <Link href="/" className="text-gray-600 hover:text-blue-600">
                  Dashboard
                </Link>
                <Link href="/setup" className="text-gray-600 hover:text-blue-600">
                  Board Setup
                </Link>
              </nav>
            </div>
            <div className="flex items-center gap-3">
              <span className="hidden text-sm text-gray-500 sm:inline">
                {me.email}
              </span>
              <button
                onClick={handleSignOut}
                className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-medium hover:bg-gray-50"
              >
                Sign out
              </button>
            </div>
          </div>
        </header>
        {children}
      </div>
    </AdminContext.Provider>
  );
}
