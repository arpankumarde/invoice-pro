import { createBrowserRouter, Navigate } from "react-router";
import { CustomerPage } from "./routes/CustomerPage.tsx";
import { EditorPage } from "./routes/EditorPage.tsx";
import { InvoicePage } from "./routes/InvoicePage.tsx";
import { Layout } from "./routes/Layout.tsx";
import { editPath } from "./routes/paths.ts";

/** Every URL in the app. Links are built with the helpers in routes/paths.ts. */
export const router = createBrowserRouter([
  {
    path: "/",
    Component: Layout,
    children: [
      // The Invoices tab. "/" lands on the latest invoice.
      { index: true, Component: InvoicePage },
      { path: "invoices/:invoiceId/:receipt?", Component: InvoicePage },

      // The Customers tab. "/customers" lands on the first customer.
      { path: "customers/:customerId?", Component: CustomerPage },

      // The Editor tab. Without an id, the invoice and customer routes start a new record.
      {
        path: "edit",
        children: [
          { index: true, element: <Navigate to={editPath({ kind: "invoice" })} replace /> },
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
