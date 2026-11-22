import type { Domain } from './domain.js';

export type FieldType =
  | 'integer'
  | 'string'
  | 'boolean'
  | 'selection'
  | 'many2one'
  | 'one2many'
  | 'many2many'
  | 'password'
  | 'datetime'
  | 'date'
  | 'float'
  | 'text'
  | 'json';

export interface FieldMeta {
  name: string;
  type: FieldType;
  label: string;
  help?: string;
  required: boolean;
  readonly: boolean;
  unique: boolean;
  writeOnly?: boolean;
  default?: string | number | boolean;
  selection?: { value: string; label: string }[];
  relation?: string;
  foreignKey?: string;
  invisible?: Domain | boolean;
  readonlyIf?: Domain;
  requiredIf?: Domain;
}

export interface ListView {
  columns: string[];
  order?: string;
}

export interface FormSection {
  title?: string;
  fields: string[];
}

export interface FormView {
  sections: FormSection[];
  /** Set false on a model to hide the unified activity stream. */
  chatter?: boolean;
  /** Optional notebook labels; default sections render in one responsive notebook. */
  tabs?: string[];
}

export interface KanbanView {
  groupBy: string;
  stageOrder: string[];
}

export interface CalendarView {
  dateField: string;
  titleField?: string;
}

export interface GraphView {
  groupBy: string;
  metric: string;
  type: 'bar' | 'line' | 'pie';
}

export interface PivotView {
  rowGroupBy: string;
  columnGroupBy?: string;
  metric: string;
}

export interface SearchFilter {
  label: string;
  domain: Domain;
}

export interface SearchView {
  fields: string[];
  filters: SearchFilter[];
}

/** What the caller may do on a model; drives which buttons a UI shows. */
export interface ModelPermissions {
  read: boolean;
  create: boolean;
  write: boolean;
  unlink: boolean;
}

export interface ModelInfo {
  model: string;
  table: string;
  menu: {
    label?: string;
    group: string;
    sequence: number;
    developmentOnly: boolean;
  };
}

export interface ModelFields {
  model: string;
  permissions: ModelPermissions;
  fields: FieldMeta[];
}

export interface ResolvedViews {
  model: string;
  title: string;
  permissions: ModelPermissions;
  fields: FieldMeta[];
  list: ListView;
  form: FormView;
  search: SearchView;
  actions?: string[];
  kanban?: KanbanView;
  calendar?: CalendarView;
  graph?: GraphView;
  pivot?: PivotView;
}
