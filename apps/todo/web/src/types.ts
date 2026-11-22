// Shared types for the moonwitness-dx board API.

export type Project = {
  id: number;
  slug: string;
  name: string;
  repos: string[];
  color: string;
  created_at: string;
  open: number;
  total: number;
};

export type Task = {
  id: number;
  project: string;
  title: string;
  description: string;
  status: string;
  tags: string[];
  human: boolean;
  url: string | null;
  waiting_on: number[];
  created_at: string;
  updated_at: string;
  comments?: number;

  // TaskOS v2 fields
  code?: string;
  series?: string;
  milestone?: string;
  horizon?: string;
  category?: string;
  priority?: string;
  effort?: string;
  risk?: string;
  owner?: string;
  summary?: string;
  problem?: string;
  proposed_solution?: string;
  acceptance_criteria_json?: string;
  validation_json?: string;
  evidence_json?: string;
  blocked_reason?: string;
  source_ref_json?: string;
  scope_json?: string;
  depends_on?: string;
  blocks_json?: string;
  refs_json?: string;
  task_type?: string;
};

export type TaskLink = {
  id: number;
  project: string;
  title: string;
  status: string;
};

export type Comment = {
  id: number;
  author: string;
  body: string;
  created_at: string;
};

export type Image = {
  id: number;
  file: string;
  comment_id: number | null;
};

export type Board = {
  changes: string;
  done_hidden: number;
  hidden_properties: string[];
  projects: Project[];
  statuses: string[];
  tasks: Task[];
  version: string;
};

export type TaskReply = {
  blocks: TaskLink[];
  comments: Comment[];
  images: Image[];
  task: Task;
  waits_on: TaskLink[];
};

export type Changes = {
  changes: string;
  guests: number | null;
  joined: string | null;
};

export type Net = {
  state: "private" | "sharing" | "joined";
  host?: string;
  addresses?: string[];
  guests?: { name: string | null; address: string }[];
};

export type DiscoveredRepo = {
  path: string;
  repo: string;
  linked_project: string | null;
};

export type DiscoveryScan = {
  roots: string[];
  repos: DiscoveredRepo[];
  scanned: number;
  truncated: boolean;
};

export type Document = {
  id: number;
  project: string;
  layer: string;
  path: string;
  title: string;
  content: string;
  content_md?: string;
  format: string;
  checksum: string;
  size: number;
  created_at: string;
  updated_at: string;
  meta_json?: string;
};