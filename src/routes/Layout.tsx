import { Outlet } from "react-router";
import { API_BASE } from "../app/api.ts";
import { refresh, type Snapshot, useInvoiceData } from "../app/data.ts";
import { sortKey } from "../app/entries.ts";
import { Code, Errors, primaryButton } from "../app/ui.tsx";
import type { InvoiceEntry } from "../invoice/types.ts";
import { Sidebar } from "./Sidebar.tsx";

/** What the layout hands every page, through the outlet context. */
export interface Workspace {
  snapshot: Snapshot;
  /** The invoices, latest first. */
  entries: InvoiceEntry[];
}

/** The root route: waits for the data, then frames the current page with the sidebar. */
export function Layout() {
  const data = useInvoiceData();
  if (data.status !== "ready") {
    return (
      <div className="grid min-h-dvh place-items-center bg-canvas px-6 text-ink">
        {data.status === "loading" ? (
          <p className="text-sm text-muted">Loading invoices…</p>
        ) : (
          <div className="max-w-md text-center">
            <h1 className="text-lg font-semibold">Can't reach the data server</h1>
            <p className="mt-2 text-sm leading-relaxed text-muted">
              The app reads and saves invoices through <Code>{API_BASE}</Code> ({data.message}). Start it from the{" "}
              <Code>server</Code> folder with <Code>pnpm dev</Code>, then try again.
            </p>
            <button type="button" onClick={() => void refresh()} className={`${primaryButton} mt-6`}>
              Try again
            </button>
          </div>
        )}
      </div>
    );
  }

  const { snapshot } = data;
  const entries = [...snapshot.entries].sort((a, b) => sortKey(b).localeCompare(sortKey(a)));

  return (
    <div className="flex min-h-dvh flex-col bg-canvas text-ink md:h-dvh md:flex-row md:overflow-hidden">
      <Sidebar snapshot={snapshot} entries={entries} />
      <main className="min-w-0 flex-1 overflow-y-auto">
        {snapshot.problems.length > 0 && (
          <div className="px-4 pt-4 sm:px-8">
            <Errors title="Some data files couldn't be read" errors={snapshot.problems} />
          </div>
        )}
        <Outlet context={{ snapshot, entries } satisfies Workspace} />
      </main>
    </div>
  );
}
