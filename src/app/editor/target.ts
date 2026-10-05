/** What the editor is working on; `key` strings identify it, e.g. as a React key. */
export type EditTarget =
  | { kind: "invoice"; file?: string }
  | { kind: "customer"; id?: string }
  | { kind: "business" }
  | { kind: "settings" };

export const targetKey = (target: EditTarget) =>
  target.kind === "invoice"
    ? `invoice:${target.file ?? ""}`
    : target.kind === "customer"
      ? `customer:${target.id ?? ""}`
      : target.kind;

export function parseTargetKey(key: string): EditTarget | undefined {
  const [kind, ...rest] = key.split(":");
  const value = rest.join(":") || undefined;
  if (kind === "invoice") return { kind, file: value };
  if (kind === "customer") return { kind, id: value };
  if (kind === "business" || kind === "settings") return { kind };
  return undefined;
}
