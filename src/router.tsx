import { createBrowserRouter, Navigate } from "react-router";
import { CustomerPage } from "./routes/CustomerPage.tsx";
import { EditorPage } from "./routes/EditorPage.tsx";
import { InvoicePage } from "./routes/InvoicePage.tsx";
import { Layout } from "./routes/Layout.tsx";
import { OverviewPage } from "./routes/OverviewPage.tsx";
import { ReceiptPage } from "./routes/ReceiptPage.tsx";
import { editPath } from "./routes/paths.ts";

/** Every URL in the app. Links are built with the helpers in routes/paths.ts. */
export const router = createBrowserRouter([
  {
    path: "/",
    Component: Layout,
    children: [
      // The overview: what is owed, what is late, this month's billing and the latest payments.
      { index: true, Component: OverviewPage },

      // The Invoices tab. Unknown invoice ids land on the latest invoice.
      { path: "invoices/:invoiceId", Component: InvoicePage },
      // A payment's receipt, which may cover several invoices.
      { path: "receipts/:receiptId", Component: ReceiptPage },

      // The Customers tab. "/customers" lands on the first customer.
      { path: "customers/:customerId?", Component: CustomerPage },

      // The editors. Without an id, the invoice and customer routes start a new record. Invoices and
      // customers are opened from their own pages; your details and settings form the Configuration tab.
      {
        path: "edit",
        children: [
          { index: true, element: <Navigate to={editPath({ kind: "business" })} replace /> },
          { path: "invoices/:id?", element: <EditorPage kind="invoice" /> },
          { path: "customers/:id?", element: <EditorPage kind="customer" /> },
          { path: "business", element: <EditorPage kind="business" /> },
          { path: "settings", element: <EditorPage kind="settings" /> },
        ],
      },

      { path: "*", element: <Navigate to="/" replace /> },
    ],
  },
]);
