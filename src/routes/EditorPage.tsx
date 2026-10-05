import { useNavigate, useOutletContext, useParams } from "react-router";
import { Editor } from "../app/editor/Editor.tsx";
import { type EditTarget, targetKey } from "../app/editor/target.ts";
import type { Workspace } from "./Layout.tsx";
import { editPath, invoiceFile } from "./paths.ts";

/** "/edit/…": the editor for the record the URL names, or a new one when the URL has no id. */
export function EditorPage({ kind }: { kind: EditTarget["kind"] }) {
  const { snapshot } = useOutletContext<Workspace>();
  const { id } = useParams();
  const navigate = useNavigate();
  const target: EditTarget =
    kind === "invoice" ? { kind, file: id ? invoiceFile(id) : undefined } : kind === "customer" ? { kind, id } : { kind };

  return (
    <Editor
      key={targetKey(target)}
      snapshot={snapshot}
      target={target}
      // The record was saved under a new name or deleted, so its old URL shouldn't stay in the history.
      onNavigate={(next) => void navigate(editPath(next), { replace: true })}
    />
  );
}
