/** The local data server (see server/). Set in .env as VITE_API_BASE. */
export const API_BASE = (import.meta.env.VITE_API_BASE || "http://localhost:3001").replace(/\/+$/, "");

/** Where the server keeps the data, for messages shown to the user. */
export const DATA_FOLDER = "server/src/data";

async function request(method: "PUT" | "DELETE", path: string, body?: unknown, query = "") {
  const response = await fetch(`${API_BASE}/api/data/${path}${query}`, {
    method,
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok) {
    const message = ((await response.json().catch(() => null)) as { error?: string } | null)?.error;
    throw new Error(message ?? `The server answered ${response.status}`);
  }
}

/** Writes a JSON file in the data folder, e.g. "customers.json" or "invoices/INV-1.json". */
export const saveFile = (path: string, data: unknown, { createOnly = false } = {}) =>
  request("PUT", path, data, createOnly ? "?create" : "");

export const deleteFile = (path: string) => request("DELETE", path);

export const imageUrl = (name: string) => `${API_BASE}/api/images/${encodeURIComponent(name)}`;
