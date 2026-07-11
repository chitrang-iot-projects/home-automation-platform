// Shared TypeScript types for the customer PWA.
// Field names mirror the API responses exactly (lowercase / snake_case).

export interface HomeSummary {
  id: string;
  name: string;
  address: string | null;
}

export interface Me {
  id: string;
  email: string;
  display_name: string | null;
  contact: string | null;
  role: string;
  is_active: boolean;
  homes: HomeSummary[];
}

export interface Home {
  id: string;
  name: string;
  address: string | null;
  timezone: string | null;
  ownerid: string;
  roomcount: number;
}

export interface Room {
  id: string;
  homeid: string;
  name: string;
  floor: string | number | null;
  icon: string | null;
  sortorder: number | null;
}

export interface Channel {
  id: string;
  deviceid: string;
  channelno: number;
  name: string;
  icon: string | null;
  appliancetype: string | null;
  isfavorite: boolean;
  sortindex: number | null;
  usagecount: number;
  lastusedat: string | null;
}

export interface Device {
  id: string;
  homeid: string;
  roomid: string | null;
  name: string;
  hardwareid: string;
  relaycount: number;
  isonline: boolean;
  lastseenat: string | null;
  firmwareversion: string | null;
  channels: Channel[];
}

export interface ChannelStatesResponse {
  states: Record<string, boolean>;
}

/** Rooms + devices loaded for a single home. */
export interface HomeData {
  rooms: Room[];
  devices: Device[];
}

/** Icon key → emoji map used by channel cards and the icon picker.
 *  The KEY (e.g. "light") is what gets stored in channel.icon. */
export const CHANNEL_ICONS: Record<string, string> = {
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

/** Resolve an icon key to its emoji, falling back to "other". */
export function iconEmoji(key: string | null | undefined): string {
  if (key && CHANNEL_ICONS[key]) return CHANNEL_ICONS[key];
  return CHANNEL_ICONS.other;
}
