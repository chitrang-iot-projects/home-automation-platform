"use client";

import { useState } from "react";
import AuthGate from "@/components/AuthGate";
import CustomersTab from "@/components/CustomersTab";
import DevicesTab from "@/components/DevicesTab";
import HousesTab from "@/components/HousesTab";

type Tab = "houses" | "customers" | "devices";

const TABS: { key: Tab; label: string }[] = [
  { key: "houses", label: "Houses" },
  { key: "customers", label: "Customers" },
  { key: "devices", label: "Devices" },
];

export default function Home() {
  return (
    <AuthGate>
      <Dashboard />
    </AuthGate>
  );
}

function Dashboard() {
  const [tab, setTab] = useState<Tab>("houses");
  const [focusDeviceId, setFocusDeviceId] = useState<string | null>(null);

  return (
    <main className="mx-auto max-w-7xl px-4 py-6">
      <div className="mb-6 flex gap-1 rounded-xl bg-white p-1 shadow-sm">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`flex-1 rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
              tab === t.key
                ? "bg-blue-600 text-white"
                : "text-gray-600 hover:bg-gray-100"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "houses" && (
        <HousesTab
          onOpenDevice={(deviceId) => {
            setFocusDeviceId(deviceId);
            setTab("devices");
          }}
        />
      )}
      {tab === "customers" && <CustomersTab />}
      {tab === "devices" && <DevicesTab focusDeviceId={focusDeviceId} />}
    </main>
  );
}
