// Search query parsing utilities ported from app.js

export const QUALIFIERS = [
  "status",
  "tag",
  "human",
  "waits",
  "url",
  "created",
  "updated",
  "description",
  "title",
] as const;

export type Qualifier = (typeof QUALIFIERS)[number];

export function qualifierIn(q: string, field: Qualifier): boolean {
  const re = new RegExp(`(^|\\s)${field}:`, "i");
  return re.test(q);
}

export function wordsOf(q: string): string[] {
  return q
    .trim()
    .split(/\s+/)
    .filter((w) => w && !QUALIFIERS.some((f) => w.toLowerCase().startsWith(f + ":")));
}

export interface QueryNode {
  type: "and" | "or" | "not" | "field" | "text";
  field?: Qualifier;
  value?: string;
  children?: QueryNode[];
}

export function queryNodes(q: string): QueryNode[] {
  const tokens = q.trim().split(/\s+/);
  const nodes: QueryNode[] = [];
  let current: QueryNode = { type: "and", children: [] };

  for (const token of tokens) {
    if (!token) continue;

    const fieldMatch = token.match(/^(\w+):(.+)$/);
    if (fieldMatch && QUALIFIERS.includes(fieldMatch[1] as Qualifier)) {
      current.children!.push({
        type: "field",
        field: fieldMatch[1] as Qualifier,
        value: fieldMatch[2],
      });
    } else if (token === "AND" || token === "and") {
      nodes.push(current);
      current = { type: "and", children: [] };
    } else if (token === "OR" || token === "or") {
      nodes.push(current);
      current = { type: "or", children: [] };
    } else if (token === "NOT" || token === "not") {
      current.children!.push({ type: "not", children: [] });
    } else {
      current.children!.push({ type: "text", value: token });
    }
  }

  if (current.children!.length > 0) {
    nodes.push(current);
  }

  return nodes.length === 1 ? nodes[0].children! : [{ type: "and", children: nodes.flatMap((n) => n.children!) }];
}