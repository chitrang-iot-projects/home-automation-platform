import { auth } from "./firebase";

// Override per environment via NEXT_PUBLIC_API_URL (Vercel env var).
const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_URL ?? "https://home-automation-api-yonj.onrender.com";

export class ApiError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

export async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const user = auth.currentUser;
  if (!user) {
    throw new Error("Not signed in");
  }

  const token = await user.getIdToken();
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...init?.headers,
      Authorization: `Bearer ${token}`,
    },
  });

  const text = await response.text();

  if (!response.ok) {
    // Surface the API's own error message when it provides one (e.g. 409 on
    // deleting a user that still owns homes).
    let message = `API ${path} failed: ${response.status}`;
    try {
      const body = JSON.parse(text) as Record<string, unknown>;
      if (typeof body.error === "string" && body.error) message = body.error;
      else if (typeof body.message === "string" && body.message) message = body.message;
    } catch {
      // keep the default message
    }
    throw new ApiError(response.status, message);
  }

  // DELETE and some PATCH endpoints return an empty body.
  return (text ? JSON.parse(text) : undefined) as T;
}
