import { useSyncExternalStore } from "react";
import { resolveAll } from "../invoice/resolve.ts";
import type { DataSet, InvoiceEntry } from "../invoice/types.ts";
import { API_BASE, imageUrl } from "./api.ts";

export interface Snapshot {
  entries: InvoiceEntry[];
  /** The JSON exactly as stored on the server, for the editor. */
  raw: DataSet;
  /** Image file name in the data folder → URL served by the data server. */
  images: Record<string, string>;
  /** Data files the server couldn't parse. */
  problems: string[];
}

export type DataState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; snapshot: Snapshot };

let state: DataState = { status: "loading" };
let lastBody = "";
const listeners = new Set<() => void>();

function setState(next: DataState) {
  state = next;
  listeners.forEach((notify) => notify());
}

/** Fetches the data folder from the server. Unchanged data keeps the same snapshot, so nothing re-renders. */
export async function refresh() {
  try {
    const response = await fetch(`${API_BASE}/api/data`);
    if (!response.ok) throw new Error(`The server answered ${response.status}`);
    const body = await response.text();
    if (body === lastBody && state.status === "ready") return;
    lastBody = body;
    const data = JSON.parse(body) as DataSet & { problems?: string[] };
    const raw: DataSet = {
      settings: data.settings,
      business: data.business,
      customers: data.customers,
      taxes: data.taxes,
      invoices: data.invoices ?? [],
      images: data.images ?? [],
    };
    setState({
      status: "ready",
      snapshot: {
        entries: resolveAll(raw),
        raw,
        images: Object.fromEntries(raw.images.map((name) => [name, imageUrl(name)])),
        problems: data.problems ?? [],
      },
    });
  } catch (error) {
    // A failed background refresh keeps the data already on screen.
    if (state.status !== "ready") setState({ status: "error", message: (error as Error).message });
  }
}

void refresh();
// Pick up files edited by hand when coming back to the tab.
const onFocus = () => void refresh();
window.addEventListener("focus", onFocus);
import.meta.hot?.dispose(() => window.removeEventListener("focus", onFocus));

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export function useInvoiceData(): DataState {
  return useSyncExternalStore(subscribe, () => state);
}
