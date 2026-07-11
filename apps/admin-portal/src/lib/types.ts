// Shapes returned by the API (field names are lowercase in responses;
// request bodies use camelCase — see the API contract).

export interface Me {
  id: string;
  email: string;
  display_name?: string | null;
  role: string;
}

export interface HomeRef {
  id: string;
  name: string;
}

export interface AdminUser {
  id: string;
  email: string;
  displayname: string | null;
  contact: string | null;
  role: string;
  isactive: boolean;
  registered: boolean;
  homes: HomeRef[];
}

export interface HomeSummary {
  id: string;
  name: string;
  address: string | null;
  timezone: string | null;
  roomcount: number;
}

// Member payload shape is not fully specified — read the user id and label
// defensively from the common field spellings.
export interface HomeMember {
  id?: string;
  userid?: string;
  user_id?: string;
  email?: string | null;
  displayname?: string | null;
  display_name?: string | null;
  role: string;
}

export function memberUserId(m: HomeMember): string {
  return m.userid ?? m.user_id ?? m.id ?? "";
}

export function memberLabel(m: HomeMember): string {
  return m.email ?? m.displayname ?? m.display_name ?? memberUserId(m);
}

export interface Room {
  id: string;
  name: string;
  floor: string | number | null;
  icon: string | null;
}

export interface Channel {
  id: string;
  channelno: number;
  name: string;
  icon: string | null;
  appliancetype: string | null;
  isfavorite: boolean;
  sortindex: number;
  usagecount: number;
}

export interface Device {
  id: string;
  roomid: string | null;
  name: string;
  hardwareid: string;
  relaycount: number;
  isonline: boolean;
  lastseenat: string | null;
  firmwareversion: string | null;
  bootcount: number | null;
  rssidbm: number | null;
  freeheapbytes: number | null;
  channels: Channel[];
}

export const APPLIANCE_ICONS: Record<string, string> = {
  switch: "🔌",
  light: "💡",
  fan: "🌀",
  tv: "📺",
  ac: "❄️",
  heater: "🔥",
  plug: "🔋",
  curtain: "🪟",
  pump: "🚿",
  other: "⚙️",
};

export const APPLIANCE_TYPES = Object.keys(APPLIANCE_ICONS);

export const MEMBER_ROLES = ["owner", "member", "guest"] as const;
export const USER_ROLES = ["customer", "admin", "superadmin"] as const;
