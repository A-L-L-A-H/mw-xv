// Color utilities ported from app.js

export const PROJECT_COLORS = [
  "gray",
  "red",
  "orange",
  "yellow",
  "green",
  "teal",
  "blue",
  "purple",
  "pink",
] as const;

export type ProjectColor = (typeof PROJECT_COLORS)[number];

export const STATUS_COLORS: Record<string, string> = {
  backlog: "gray",
  todo: "red",
  doing: "orange",
  review: "blue",
  done: "green",
};

export function projectColorName(color: string): ProjectColor {
  return PROJECT_COLORS.includes(color as ProjectColor) ? (color as ProjectColor) : "gray";
}

export function projectColor(color: string): string {
  return `var(--mw-${projectColorName(color)})`;
}

export function statusColor(status: string): string {
  const color = STATUS_COLORS[status] ?? "gray";
  return `var(--mw-${color})`;
}

export function statusIcon(status: string): string {
  const colors: Record<string, string> = {
    backlog: "gray",
    todo: "red",
    doing: "orange",
    review: "blue",
    done: "green",
  };
  const c = colors[status] ?? "gray";
  const p = status === "done" ? 100 : status === "review" ? 75 : status === "doing" ? 50 : 0;
  return `<svg width="16" height="16" viewBox="0 0 16 16" style="vertical-align:middle"><circle cx="8" cy="8" r="7" stroke="var(--mw-${c})" stroke-width="2" fill="none" stroke-dasharray="${p * 0.44},${44 - p * 0.44}" transform="rotate(-90 8 8)"/></svg>`;
}