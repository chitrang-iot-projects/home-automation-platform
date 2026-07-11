"use client";

import { signOut } from "firebase/auth";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { auth } from "@/lib/firebase";

const LINKS = [
  { href: "/", label: "Dashboard" },
  { href: "/profile", label: "Profile" },
] as const;

interface NavbarProps {
  email: string | null;
}

/** Sticky top bar shown on the dashboard and profile pages (not login). */
export default function Navbar({ email }: NavbarProps) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  function linkClass(href: string) {
    const active = pathname === href;
    return `rounded-lg px-3 py-2 text-sm font-medium min-h-11 inline-flex items-center ${
      active ? "bg-blue-50 text-blue-700" : "text-gray-600 hover:bg-gray-100"
    }`;
  }

  return (
    <header className="sticky top-0 z-40 border-b border-gray-200 bg-white/95 backdrop-blur">
      <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-2">
        <div className="flex items-center gap-3">
          <Link href="/" className="flex min-h-11 items-center text-lg font-semibold text-gray-900">
            <span aria-hidden className="mr-2">🏠</span>Home
          </Link>
          {/* Desktop links */}
          <nav className="hidden items-center gap-1 sm:flex">
            {LINKS.map((l) => (
              <Link key={l.href} href={l.href} className={linkClass(l.href)}>
                {l.label}
              </Link>
            ))}
          </nav>
        </div>

        <div className="hidden items-center gap-3 sm:flex">
          {email && <span className="max-w-48 truncate text-sm text-gray-500">{email}</span>}
          <button
            onClick={() => void signOut(auth)}
            className="min-h-11 rounded-lg border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            Sign out
          </button>
        </div>

        {/* Mobile: dropdown toggle */}
        <button
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          aria-label="Menu"
          className="min-h-11 min-w-11 rounded-lg border border-gray-300 px-3 text-lg sm:hidden"
        >
          {open ? "✕" : "☰"}
        </button>
      </div>

      {open && (
        <div className="border-t border-gray-100 bg-white px-4 pb-3 pt-2 sm:hidden">
          <nav className="flex flex-col gap-1">
            {LINKS.map((l) => (
              <Link
                key={l.href}
                href={l.href}
                onClick={() => setOpen(false)}
                className={linkClass(l.href)}
              >
                {l.label}
              </Link>
            ))}
          </nav>
          <div className="mt-2 flex items-center justify-between border-t border-gray-100 pt-3">
            <span className="max-w-52 truncate text-sm text-gray-500">{email}</span>
            <button
              onClick={() => void signOut(auth)}
              className="min-h-11 rounded-lg border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
            >
              Sign out
            </button>
          </div>
        </div>
      )}
    </header>
  );
}
