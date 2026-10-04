/** What the editor is working on; `key` strings are used in the URL hash. */
export type EditTarget = { kind: "invoice"; file?: string } | { kind: "customer"; id?: string } | { kind: "business" };

export const targetKey = (target: EditTarget) =>
  target.kind === "invoice"
    ? `invoice:${target.file ?? ""}`
    : target.kind === "customer"
      ? `customer:${target.id ?? ""}`
      : "business";

export function parseTargetKey(key: string): EditTarget | undefined {
  const [kind, ...rest] = key.split(":");
  const value = rest.join(":") || undefined;
  if (kind === "invoice") return { kind, file: value };
  if (kind === "customer") return { kind, id: value };
  if (kind === "business") return { kind };
  return undefined;
}
