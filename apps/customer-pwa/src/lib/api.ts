import { auth } from "./firebase";

// Override per environment via NEXT_PUBLIC_API_URL (Vercel env var).
const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_URL ?? "https://home-automation-api-yonj.onrender.com";

export async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const user = auth.currentUser;
  if (!user) {
    throw new Error("Not signed in");
  }

  const token = await user.getIdToken();
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers: {
      ...init?.headers,
      Authorization: `Bearer ${token}`,
    },
  });

  if (!response.ok) {
    throw new Error(`API ${path} failed: ${response.status}`);
  }

  return response.json() as Promise<T>;
}

/** GET helper. */
export function apiGet<T>(path: string): Promise<T> {
  return apiFetch<T>(path);
}

/** PATCH helper with a JSON body. */
export function apiPatch<T>(path: string, body: unknown): Promise<T> {
  return apiFetch<T>(path, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

/** POST helper with a JSON body. */
export function apiPost<T>(path: string, body: unknown): Promise<T> {
  return apiFetch<T>(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}
