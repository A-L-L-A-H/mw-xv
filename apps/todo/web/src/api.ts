// The board's API: the same calls the legacy page made, with the same semantics.

import type { Board, Changes, Net, Project, TaskReply, TaskLink, Comment, Image, Document } from "./types";

export type BoardSide = "local" | "shared";

export type { Board, Changes, Net, Project, TaskReply, TaskLink, Comment, Image, Document } from "./types";
export type { Task } from "./types";

export const base = (board: BoardSide = "local") => (board === "shared" ? "/remote" : "");

export async function api<T = unknown>(
  method: string,
  path: string,
  body?: unknown | Blob,
  board: BoardSide = "local"
): Promise<T> {
  const image = body instanceof Blob;
  const res = await fetch(base(board) + "/api" + path, {
    method,
    headers: body ? { "Content-Type": image ? body.type : "application/json" } : {},
    body: image || body == null ? (body as Blob | undefined) : JSON.stringify(body),
  });
  noticeVersion(res.headers.get("x-moonwitness-dx-version"));
  const data = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) throw Object.assign(new Error(data.error || res.statusText), { data });
  return data as T;
}

// An update restarts the board under the page, which then reloads to match it. Not while
// someone types, though: the next reply tries again.
let pageVersion: string | null = null;

function noticeVersion(version: string | null) {
  if (!version) return;
  pageVersion ??= version;
  if (version !== pageVersion && !document.activeElement?.matches("input, textarea, select"))
    location.reload();
}

export const getBoard = (project: string, allDone: boolean, q: string) =>
  api<Board>(
    "GET",
    "/board?project=" +
      encodeURIComponent(project) +
      (allDone ? "&done=all" : "") +
      (q ? "&q=" + encodeURIComponent(q) : "")
  );

export const getChanges = (board: BoardSide) => api<Changes>("GET", "/changes", null, board);

export const getProjects = (board: BoardSide) =>
  api<{ projects: Project[] }>("GET", "/projects", null, board);

export const getTask = (id: number) => api<TaskReply>("GET", `/tasks/${id}`);

export const getNetwork = () => api<Net>("GET", "/network", null, "local");

function normalizeDocument(raw: any): Document {
  const body = raw.body ?? raw.content_md ?? raw.content ?? "";
  const path = raw.slug ?? raw.path ?? "";
  return {
    id: raw.id,
    project: raw.project ?? "",
    layer: raw.layer ?? "brain",
    path,
    title: raw.title ?? path,
    content: body,
    content_md: body,
    format: raw.format ?? "markdown",
    checksum: raw.checksum ?? "",
    size: body.length,
    created_at: raw.created_at ?? "",
    updated_at: raw.updated_at ?? "",
    meta_json: raw.meta_json ?? null,
    linked_tasks: Array.isArray(raw.linked_tasks) ? raw.linked_tasks : [],
  };
}

export const getDocuments = async (layer?: string, project?: string) => {
  const params = new URLSearchParams();
  if (layer && layer !== "all") params.set("layer", layer);
  if (project && project !== "all") params.set("project", project);
  const qs = params.toString();
  const res = await api<any>("GET", `/documents${qs ? "?" + qs : ""}`);
  const arr = Array.isArray(res) ? res : res.documents || [];
  return { documents: arr.map(normalizeDocument) };
};

export const upsertDocument = async (doc: any) => {
  const slug = (doc.slug || doc.path || doc.title || "untitled")
    .toLowerCase()
    .replace(/\.md$/i, "")
    .replace(/[^a-z0-9/_-]+/g, "-")
    .replace(/^-|-$/g, "");
  const payload: Record<string, unknown> = {
    slug,
    layer: doc.layer || "brain",
    title: doc.title,
    body: doc.body ?? doc.content_md ?? doc.content ?? "",
    tags: Array.isArray(doc.tags) ? doc.tags.join(",") : doc.tags || "",
  };
  if (doc.project && doc.project !== "all" && doc.project !== "default") {
    payload.project = doc.project;
  }
  if (doc.status) payload.status = doc.status;
  if (doc.linked_tasks) payload.linked_tasks = doc.linked_tasks;
  const raw = await api<any>("POST", "/documents", payload);
  return { document: normalizeDocument(raw) };
};

export const getDocument = async (id: number) => {
  const raw = await api<any>("GET", `/documents/${id}`);
  return { document: normalizeDocument(raw) };
};

export const updateDocument = async (id: number, patch: any) => {
  const payload: Record<string, unknown> = {};
  if (patch.slug !== undefined || patch.path !== undefined) payload.slug = patch.slug ?? patch.path;
  if (patch.layer !== undefined) payload.layer = patch.layer;
  if (patch.title !== undefined) payload.title = patch.title;
  if (patch.body !== undefined || patch.content_md !== undefined || patch.content !== undefined) {
    payload.body = patch.body ?? patch.content_md ?? patch.content;
  }
  if (patch.tags !== undefined) payload.tags = Array.isArray(patch.tags) ? patch.tags.join(",") : patch.tags;
  if (patch.project && patch.project !== "all" && patch.project !== "default") payload.project = patch.project;
  if (patch.status !== undefined) payload.status = patch.status;
  if (patch.linked_tasks !== undefined) payload.linked_tasks = patch.linked_tasks;
  const raw = await api<any>("PATCH", `/documents/${id}`, payload);
  return { document: normalizeDocument(raw) };
};

export const deleteDocument = (id: number) => api<any>("DELETE", `/documents/${id}`);

export const claimTask = (id: number) => api<any>("POST", `/tasks/${id}/claim`);

export const toggleChecklist = (id: number, ac_id: string, done?: boolean) => api<any>("POST", `/tasks/${id}/checklist`, { ac_id, done });

export const submitReview = (id: number, commit_sha?: string, evidence_path?: string) => api<any>("POST", `/tasks/${id}/review`, { commit_sha, evidence_path });

export const globalSearch = async (query: string, limit?: number) => {
  const raw = await api<any>("GET", `/search/global?q=${encodeURIComponent(query)}&limit=${limit || 20}`);
  if (Array.isArray(raw)) {
    const tasks = raw
      .filter((h: any) => h.entity_type === "task")
      .map((h: any) => ({
        id: h.entity_id,
        title: h.title,
        code: h.code_or_slug,
        status: h.layer_or_status,
        snippet: h.snippet,
        tags: h.tags || [],
      }));
    const documents = raw
      .filter((h: any) => h.entity_type === "document")
      .map((h: any) => ({
        id: h.entity_id,
        title: h.title,
        layer: h.layer_or_status,
        path: h.code_or_slug,
        snippet: h.snippet,
      }));
    return { tasks, documents };
  }
  return { tasks: raw.tasks || [], documents: raw.documents || [] };
};

export function localStorageGet(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function localStorageSet(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // ignore storage errors
  }
}