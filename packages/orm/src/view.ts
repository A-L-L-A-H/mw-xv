import type { BaseModel } from './base.model.js';
import { columnName, type Field, type FieldMap } from './model-definition.js';
import { Registry } from './registry.js';
import type { Domain } from './types.js';

/** Type names a generic UI renders; stable public contract of the metadata API. */
export type FieldType =
  | 'integer'
  | 'float'
  | 'decimal'
  | 'string'
  | 'text'
  | 'boolean'
  | 'selection'
  | 'many2one'
  | 'one2many'
  | 'many2many'
  | 'password'
  | 'date'
  | 'datetime'
  | 'json';

export interface FieldMeta {
  /** Column name used in API payloads (e.g. `partner_id` for a relation). */
  name: string;
  type: FieldType;
  label: string;
  help?: string;
  required: boolean;
  readonly: boolean;
  unique: boolean;
  /** Accepted on write but never returned by the API. */
  writeOnly?: boolean;
  /** True when the field is backed by a declarative `compute` function. */
  computed?: boolean;
  /** True when the model has an `onchange` handler registered for this field. */
  hasOnchange?: boolean;
  default?: string | number | boolean;
  selection?: { value: string; label: string }[];
  /** Target model for `many2one`, `one2many`, and `many2many`. */
  relation?: string;
  /** Foreign key on target model for `one2many`. */
  foreignKey?: string;
  invisible?: Domain | boolean;
  readonlyIf?: Domain;
  requiredIf?: Domain;
}

export interface ListColumnSpec {
  name: string;
  label?: string;
  widget?: string;
  optional?: 'show' | 'hide';
  aggregate?: 'sum' | 'avg';
}

export interface ListDecorationSpec {
  color: 'success' | 'warning' | 'danger' | 'info' | 'muted';
  domain: Domain;
}

export interface ListView {
  columns: (string | ListColumnSpec)[];
  order?: string;
  editable?: 'top' | 'bottom' | false;
  multiEdit?: boolean;
  decorations?: ListDecorationSpec[];
}

export interface FormFieldSpec {
  name: string;
  label?: string;
  widget?: string;
  domain?: Domain;
  context?: Record<string, unknown>;
  readonly?: boolean;
  required?: boolean;
  invisible?: Domain | boolean;
}

export interface FormHeaderButtonSpec {
  label: string;
  action: string;
  variant?: 'primary' | 'secondary' | 'danger';
  visibleIf?: Domain;
}

export interface FormHeaderSpec {
  statusField?: string;
  buttons?: FormHeaderButtonSpec[];
}

export interface SmartButtonSpec {
  label: string;
  icon?: string;
  actionId?: string;
  targetModel?: string;
  domain?: Domain;
  countField?: string;
}

export interface FormTabSpec {
  title: string;
  sections: FormSection[];
}

export interface FormSection {
  title?: string;
  columns?: number;
  fields: (string | FormFieldSpec)[];
}

export interface FormView {
  sections: FormSection[];
  /** Set false on a model to hide the unified activity stream. */
  chatter?: boolean;
  /** Optional notebook labels or structured tab specs. */
  tabs?: (string | FormTabSpec)[];
  header?: FormHeaderSpec;
  smartButtons?: SmartButtonSpec[];
}

export interface SearchFilter {
  label: string;
  domain: Domain;
}

export interface SearchGroupBy {
  label: string;
  field: string;
}

export interface SearchPanelFieldSpec {
  field: string;
  label?: string;
  limit?: number;
}

export interface SearchPanelSpec {
  fields: SearchPanelFieldSpec[];
}

export interface SearchView {
  /** Fields matched with `ilike` by the free-text search box. */
  fields: string[];
  filters: SearchFilter[];
  groupBy?: SearchGroupBy[];
  searchPanel?: SearchPanelSpec;
}

export interface KanbanView {
  groupBy: string;
  stageOrder?: string[];
  cardTitle?: string;
  cardFields?: string[];
  badgeField?: string;
  quickCreate?: boolean;
}

export interface CalendarView {
  dateField?: string;
  dateStart?: string;
  dateStop?: string;
  titleField?: string;
  colorBy?: string;
  mode?: 'month' | 'week' | 'day';
  fields?: string[];
}

export interface GraphView {
  groupBy?: string;
  dimension?: string;
  metric?: string;
  measure?: string;
  aggregation?: 'count' | 'sum' | 'avg';
  type: 'bar' | 'line' | 'pie';
}

export interface PivotView {
  rowGroupBy?: string;
  columnGroupBy?: string;
  rows?: string[];
  columns?: string[];
  metric?: string;
  measures?: string[];
}

export interface ViewSpec {
  title?: string;
  priority?: number;
  list?: Partial<ListView>;
  form?: Partial<FormView>;
  search?: Partial<SearchView>;
  kanban?: KanbanView;
  calendar?: CalendarView;
  graph?: GraphView;
  pivot?: PivotView;
}

export interface ViewDefinition {
  readonly model: string;
  readonly spec: ViewSpec;
  readonly priority?: number;
  readonly addonName?: string;
}

export interface ViewPatchOperation {
  target: 'list' | 'form' | 'search';
  position:
    'before' | 'after' | 'replace' | 'attributes' | 'insertSection' | 'addFilter' | 'addGroupBy';
  anchor?: string;
  fields?: (string | ListColumnSpec | FormFieldSpec)[];
  section?: FormSection;
  filter?: SearchFilter;
  groupBy?: SearchGroupBy;
  attributes?: Record<string, unknown>;
}

export interface ViewExtension {
  readonly model: string;
  readonly priority: number;
  readonly addonName?: string;
  readonly operations: readonly ViewPatchOperation[];
}

export interface ResolvedViews {
  model: string;
  title: string;
  displayField?: string;
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

const AUDIT_FIELDS: FieldMeta[] = [
  { name: 'id', type: 'integer', label: 'ID', required: false, readonly: true, unique: true },
  {
    name: 'active',
    type: 'boolean',
    label: 'Active',
    required: false,
    readonly: false,
    unique: false,
    default: true,
  },
  {
    name: 'create_date',
    type: 'datetime',
    label: 'Created On',
    required: false,
    readonly: true,
    unique: false,
  },
  {
    name: 'write_date',
    type: 'datetime',
    label: 'Last Updated On',
    required: false,
    readonly: true,
    unique: false,
  },
];
const AUDIT_NAMES = new Set(AUDIT_FIELDS.map((field) => field.name));
const PRIORITY_LIST_FIELDS = ['name', 'code', 'title', 'login', 'state', 'status', 'company_id'];
const NUMERIC_FIELD_TYPES = new Set<FieldType>(['integer', 'float', 'decimal']);
const KANBAN_GROUP_TYPES = new Set<FieldType>(['selection', 'many2one', 'boolean']);
const CALENDAR_DATE_TYPES = new Set<FieldType>(['date', 'datetime']);

export function humanize(name: string): string {
  const words = name.replace(/_id$/, '').replaceAll(/[_.]+/g, ' ').trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function hasFields(model: typeof BaseModel): model is typeof BaseModel & { fields: FieldMap } {
  return typeof (model as { fields?: unknown }).fields === 'object' && model.fields !== undefined;
}

function fieldEntryName(entry: string | { name: string }): string {
  return typeof entry === 'string' ? entry : entry.name;
}

function describeField(
  key: string,
  field: Field,
  onchangeHandlers?: Readonly<Record<string, unknown>>
): FieldMeta {
  const type: FieldType =
    field.kind === 'belongsTo'
      ? 'many2one'
      : field.kind === 'hasMany'
        ? 'one2many'
        : field.kind === 'manyToMany'
          ? 'many2many'
          : field.kind === 'enum'
            ? 'selection'
            : field.kind;
  const col = columnName(key, field);
  const isComputed = Boolean(field.compute);
  const hasStaticDefault = field.default !== undefined && typeof field.default !== 'function';
  return {
    name: col,
    type,
    label: field.label ?? humanize(key),
    ...(field.help ? { help: field.help } : {}),
    required: Boolean(field.required) && field.default === undefined && !isComputed,
    readonly: Boolean(field.readonly) || (isComputed && !field.store),
    unique: Boolean(field.unique),
    ...(field.kind === 'password' ? { writeOnly: true } : {}),
    ...(isComputed ? { computed: true } : {}),
    ...(onchangeHandlers && (key in onchangeHandlers || col in onchangeHandlers)
      ? { hasOnchange: true }
      : {}),
    ...(hasStaticDefault ? { default: field.default as string | number | boolean } : {}),
    ...(field.values
      ? { selection: field.values.map((value) => ({ value, label: humanize(value) })) }
      : {}),
    ...(() => {
      if (!field.target) return {};
      const target =
        typeof field.target === 'function' && !('tableName' in field.target)
          ? (field.target as () => typeof BaseModel)()
          : (field.target as typeof BaseModel);
      return target?.modelName ? { relation: target.modelName } : {};
    })(),
    ...(field.foreignKey ? { foreignKey: field.foreignKey } : {}),
    ...(field.invisible !== undefined ? { invisible: field.invisible } : {}),
    ...(field.readonlyIf !== undefined ? { readonlyIf: field.readonlyIf } : {}),
    ...(field.requiredIf !== undefined ? { requiredIf: field.requiredIf } : {}),
  };
}

/** Fallback for hand-written models without `fields`: derive from the JSON schema. */
function describeFromSchema(model: typeof BaseModel): FieldMeta[] {
  const properties = (model.jsonSchema?.properties ?? {}) as Record<string, { type?: unknown }>;
  const required = new Set((model.jsonSchema?.required as string[] | undefined) ?? []);
  return Object.entries(properties)
    .filter(([name]) => !AUDIT_NAMES.has(name) && !model.hiddenFields.includes(name))
    .map(([name, schema]) => {
      const raw = Array.isArray(schema.type) ? schema.type.find((t) => t !== 'null') : schema.type;
      const type: FieldType =
        raw === 'integer' || raw === 'boolean' ? raw : raw === 'number' ? 'float' : 'string';
      return {
        name,
        type,
        label: humanize(name),
        required: required.has(name),
        readonly: false,
        unique: false,
      };
    });
}

/** Field metadata for a model: business fields first, then audit fields. */
export function describeFields(model: typeof BaseModel): FieldMeta[] {
  const business = hasFields(model)
    ? Object.entries(model.fields).map(([key, field]) =>
        describeField(key, field, model.onchangeHandlers)
      )
    : describeFromSchema(model);
  return [...business, ...AUDIT_FIELDS.map((field) => ({ ...field }))];
}

/** Multi-view registry: base views + ordered view extensions per model. */
const baseViews = new Map<string, ViewDefinition[]>();
const viewExtensions = new Map<string, ViewExtension[]>();

/** Snapshot view registry for atomic rollback. */
export function snapshotViews(): {
  baseViews: Map<string, ViewDefinition[]>;
  viewExtensions: Map<string, ViewExtension[]>;
} {
  return {
    baseViews: new Map(Array.from(baseViews.entries()).map(([k, v]) => [k, [...v]])),
    viewExtensions: new Map(Array.from(viewExtensions.entries()).map(([k, v]) => [k, [...v]])),
  };
}

/** Restore view registry from a snapshot. */
export function restoreViews(snapshot: {
  baseViews: Map<string, ViewDefinition[]>;
  viewExtensions: Map<string, ViewExtension[]>;
}): void {
  baseViews.clear();
  for (const [k, v] of snapshot.baseViews) baseViews.set(k, [...v]);
  viewExtensions.clear();
  for (const [k, v] of snapshot.viewExtensions) viewExtensions.set(k, [...v]);
  Registry.bumpGeneration();
}

/** Remove all views and extensions for a model (used by uninstallAddon). */
export function unregisterModelViews(modelName: string): void {
  baseViews.delete(modelName);
  viewExtensions.delete(modelName);
  Registry.bumpGeneration();
}

/** Declare list/form/search/kanban/calendar/graph/pivot views for a model. */
export function defineView(
  model: typeof BaseModel & { fields: FieldMap },
  spec: ViewSpec
): ViewDefinition {
  const toColumn = (key: string): string => {
    if (AUDIT_NAMES.has(key)) return key;
    const field = model.fields[key];
    if (!field) {
      // Also allow already-resolved column name (e.g. partner_id)
      const byCol = Object.entries(model.fields).find(([k, f]) => columnName(k, f) === key);
      if (byCol) return key;
      throw new Error(`Unknown field in view for ${model.modelName}: ${key}`);
    }
    return columnName(key, field);
  };

  const resolveListCol = (entry: string | ListColumnSpec): string | ListColumnSpec => {
    const col = toColumn(fieldEntryName(entry));
    const field = Object.entries(model.fields).find(([k, f]) => columnName(k, f) === col)?.[1];
    if (field && field.kind === 'password') {
      throw new Error(`Write-only field cannot be a list column: ${model.modelName}.${col}`);
    }
    if (typeof entry === 'string') return col;
    if (entry.aggregate && field && !['integer', 'float', 'decimal'].includes(field.kind)) {
      throw new Error(
        `Numeric aggregate '${entry.aggregate}' is not allowed on non-numeric field ${model.modelName}.${col}`
      );
    }
    return { ...entry, name: col };
  };

  const resolveFormField = (entry: string | FormFieldSpec): string | FormFieldSpec => {
    const col = toColumn(fieldEntryName(entry));
    return typeof entry === 'string' ? col : { ...entry, name: col };
  };

  const resolved: ViewSpec = {
    ...spec,
    ...(spec.list
      ? {
          list: {
            ...spec.list,
            ...(spec.list.columns ? { columns: spec.list.columns.map(resolveListCol) } : {}),
          },
        }
      : {}),
    ...(spec.form
      ? {
          form: {
            ...spec.form,
            ...(spec.form.sections
              ? {
                  sections: spec.form.sections.map((s) => ({
                    ...s,
                    fields: s.fields.map(resolveFormField),
                  })),
                }
              : {}),
          },
        }
      : {}),
    ...(spec.search
      ? {
          search: {
            ...spec.search,
            ...(spec.search.fields ? { fields: spec.search.fields.map(toColumn) } : {}),
          },
        }
      : {}),
  };
  return Object.freeze({ model: model.modelName, spec: resolved, priority: spec.priority ?? 16 });
}

/** Declare a non-destructive view extension patch for an existing model view. */
export function extendView(
  model: string,
  operations: readonly ViewPatchOperation[],
  options: { priority?: number; addonName?: string } = {}
): ViewExtension {
  return Object.freeze({
    model,
    priority: options.priority ?? 16,
    addonName: options.addonName,
    operations: Object.freeze([...operations]),
  });
}

export function registerView(view: ViewDefinition): void {
  const list = baseViews.get(view.model) ?? [];
  // Replace if same priority & addonName, otherwise append
  const filtered = list.filter(
    (v) => !(v.addonName === view.addonName && (v.priority ?? 16) === (view.priority ?? 16))
  );
  filtered.push(view);
  filtered.sort((a, b) => (a.priority ?? 16) - (b.priority ?? 16));
  baseViews.set(view.model, filtered);
  Registry.bumpGeneration();
}

export function registerViewExtension(extension: ViewExtension): void {
  const list = viewExtensions.get(extension.model) ?? [];
  list.push(extension);
  list.sort((a, b) => a.priority - b.priority);
  viewExtensions.set(extension.model, list);
  Registry.bumpGeneration();
}

function applyListPatch(
  columns: (string | ListColumnSpec)[],
  op: ViewPatchOperation
): (string | ListColumnSpec)[] {
  const next = [...columns];
  const additions = (op.fields ?? []) as (string | ListColumnSpec)[];
  if (op.anchor) {
    const idx = next.findIndex((c) => fieldEntryName(c) === op.anchor);
    if (idx !== -1) {
      if (op.position === 'before') {
        next.splice(idx, 0, ...additions);
      } else if (op.position === 'after') {
        next.splice(idx + 1, 0, ...additions);
      } else if (op.position === 'replace') {
        next.splice(idx, 1, ...additions);
      } else if (op.position === 'attributes' && op.attributes) {
        const cur = next[idx]!;
        const obj: ListColumnSpec =
          typeof cur === 'string' ? { name: cur, ...op.attributes } : { ...cur, ...op.attributes };
        next[idx] = obj;
      }
      return next;
    }
  }
  return [...next, ...additions];
}

function applyFormPatch(sections: FormSection[], op: ViewPatchOperation): FormSection[] {
  const next = sections.map((s) => ({ ...s, fields: [...s.fields] }));
  if (op.position === 'insertSection' && op.section) {
    next.push({ ...op.section, fields: [...op.section.fields] });
    return next;
  }
  const additions = (op.fields ?? []) as (string | FormFieldSpec)[];
  if (op.anchor) {
    for (const section of next) {
      const idx = section.fields.findIndex((f) => fieldEntryName(f) === op.anchor);
      if (idx !== -1) {
        if (op.position === 'before') {
          section.fields.splice(idx, 0, ...additions);
        } else if (op.position === 'after') {
          section.fields.splice(idx + 1, 0, ...additions);
        } else if (op.position === 'replace') {
          section.fields.splice(idx, 1, ...additions);
        } else if (op.position === 'attributes' && op.attributes) {
          const cur = section.fields[idx]!;
          section.fields[idx] =
            typeof cur === 'string'
              ? { name: cur, ...op.attributes }
              : { ...cur, ...op.attributes };
        }
        return next;
      }
    }
  }
  if (next.length === 0) {
    next.push({ fields: additions });
  } else {
    next[next.length - 1]!.fields.push(...additions);
  }
  return next;
}

/** Validate a resolved view against the model's field metadata and hiddenFields. */
export function validateViews(model: typeof BaseModel, resolved: ResolvedViews): void {
  const fieldMap = new Map(resolved.fields.map((f) => [f.name, f]));
  const hidden = new Set(model.hiddenFields);

  const assertFieldExists = (name: string, context: string): FieldMeta => {
    const meta = fieldMap.get(name);
    if (!meta) {
      throw new Error(`Invalid view field '${name}' in ${model.modelName} (${context})`);
    }
    return meta;
  };

  for (const col of resolved.list.columns) {
    const name = fieldEntryName(col);
    const meta = assertFieldExists(name, 'list.columns');
    if (meta.writeOnly) {
      throw new Error(`Write-only field '${name}' not allowed in ${model.modelName} list`);
    }
    if (typeof col !== 'string' && col.aggregate && !NUMERIC_FIELD_TYPES.has(meta.type)) {
      throw new Error(
        `Aggregate '${col.aggregate}' requires numeric field on ${model.modelName}.${name}`
      );
    }
  }

  for (const section of resolved.form.sections) {
    for (const f of section.fields) {
      assertFieldExists(fieldEntryName(f), 'form.sections');
    }
  }

  for (const sf of resolved.search.fields) {
    const meta = assertFieldExists(sf, 'search.fields');
    if (meta.writeOnly || hidden.has(sf)) {
      throw new Error(`Hidden/write-only field '${sf}' not allowed in ${model.modelName} search`);
    }
  }

  if (resolved.search.groupBy) {
    for (const gb of resolved.search.groupBy) {
      const meta = assertFieldExists(gb.field, 'search.groupBy');
      if (meta.writeOnly || hidden.has(gb.field)) {
        throw new Error(`Hidden field '${gb.field}' not allowed in ${model.modelName} groupBy`);
      }
    }
  }

  if (resolved.kanban) {
    const meta = assertFieldExists(resolved.kanban.groupBy, 'kanban.groupBy');
    if (!KANBAN_GROUP_TYPES.has(meta.type)) {
      throw new Error(
        `Kanban groupBy '${resolved.kanban.groupBy}' must be selection, many2one, or boolean on ${model.modelName}`
      );
    }
    if (resolved.kanban.cardFields) {
      for (const cf of resolved.kanban.cardFields) {
        const cmeta = assertFieldExists(cf, 'kanban.cardFields');
        if (cmeta.writeOnly || hidden.has(cf)) {
          throw new Error(`Hidden field '${cf}' not allowed in ${model.modelName} kanban`);
        }
      }
    }
  }

  if (resolved.calendar) {
    const startField = resolved.calendar.dateStart ?? resolved.calendar.dateField;
    if (!startField) {
      throw new Error(`Calendar view on ${model.modelName} requires dateStart or dateField`);
    }
    const startMeta = assertFieldExists(startField, 'calendar.dateStart');
    if (!CALENDAR_DATE_TYPES.has(startMeta.type)) {
      throw new Error(
        `Calendar date field '${startField}' must be date or datetime on ${model.modelName}`
      );
    }
    if (resolved.calendar.dateStop) {
      const stopMeta = assertFieldExists(resolved.calendar.dateStop, 'calendar.dateStop');
      if (!CALENDAR_DATE_TYPES.has(stopMeta.type)) {
        throw new Error(
          `Calendar dateStop '${resolved.calendar.dateStop}' must be date or datetime on ${model.modelName}`
        );
      }
    }
  }

  if (resolved.graph) {
    const dim = resolved.graph.dimension ?? resolved.graph.groupBy;
    if (dim) {
      const meta = assertFieldExists(dim, 'graph.dimension');
      if (meta.writeOnly || hidden.has(dim)) {
        throw new Error(`Hidden field '${dim}' not allowed in ${model.modelName} graph`);
      }
    }
  }

  if (resolved.pivot) {
    const groupFields = [
      ...(resolved.pivot.rows ?? (resolved.pivot.rowGroupBy ? [resolved.pivot.rowGroupBy] : [])),
      ...(resolved.pivot.columns ??
        (resolved.pivot.columnGroupBy ? [resolved.pivot.columnGroupBy] : [])),
    ];
    if (groupFields.length > 3) {
      throw new Error(`Pivot view on ${model.modelName} exceeds maximum of 3 group-by fields`);
    }
    for (const gf of groupFields) {
      const meta = assertFieldExists(gf, 'pivot');
      if (meta.writeOnly || hidden.has(gf)) {
        throw new Error(`Hidden field '${gf}' not allowed in ${model.modelName} pivot`);
      }
    }
  }
}

/** Merge an explicit view (if any) + view extensions with sensible defaults derived from field metadata. */
export function resolveViews(model: typeof BaseModel): ResolvedViews {
  const fields = describeFields(model);
  const registered = baseViews.get(model.modelName) ?? [];
  const spec: ViewSpec = registered.reduce<ViewSpec>(
    (acc, def) => ({
      ...acc,
      ...def.spec,
      list: def.spec.list ? { ...acc.list, ...def.spec.list } : acc.list,
      form: def.spec.form ? { ...acc.form, ...def.spec.form } : acc.form,
      search: def.spec.search ? { ...acc.search, ...def.spec.search } : acc.search,
    }),
    {}
  );

  const business = fields.filter((field) => !AUDIT_NAMES.has(field.name));
  const hiddenSet = new Set(model.hiddenFields);
  const sensitiveSet = new Set(model.sensitiveFields);
  const visible = business.filter(
    (field) => !field.writeOnly && !hiddenSet.has(field.name) && !sensitiveSet.has(field.name)
  );

  // Prioritize key fields in default list view
  const prioritizedVisible = [...visible].sort((a, b) => {
    const aIdx = PRIORITY_LIST_FIELDS.indexOf(a.name);
    const bIdx = PRIORITY_LIST_FIELDS.indexOf(b.name);
    if (aIdx !== -1 && bIdx !== -1) return aIdx - bIdx;
    if (aIdx !== -1) return -1;
    if (bIdx !== -1) return 1;
    return 0;
  });

  const fieldNameSet = new Set(fields.map((f) => f.name));
  let listColumns: (string | ListColumnSpec)[] = spec.list?.columns
    ? spec.list.columns.filter((col) => fieldNameSet.has(fieldEntryName(col)))
    : prioritizedVisible.slice(0, 6).map((field) => field.name);
  let formSections: FormSection[] = spec.form?.sections
    ? spec.form.sections.map((section) => ({
        ...section,
        fields: section.fields.filter((f) => fieldNameSet.has(fieldEntryName(f))),
      }))
    : [{ fields: business.map((field) => field.name) }];
  const defaultSearchFields = Array.from(
    new Set([
      ...(model.displayField && visible.some((f) => f.name === model.displayField)
        ? [model.displayField]
        : []),
      ...visible
        .filter((field) => field.type === 'string' || field.type === 'text')
        .map((f) => f.name),
    ])
  );
  const searchFields: string[] = [
    ...(spec.search?.fields
      ? spec.search.fields.filter((sf) => fieldNameSet.has(sf))
      : defaultSearchFields),
  ];
  const searchFilters: SearchFilter[] = spec.search?.filters
    ? [...spec.search.filters]
    : [
        { label: 'Active', domain: [['active', '=', true]] },
        { label: 'Archived', domain: [['active', '=', false]] },
      ];
  const searchGroupBy: SearchGroupBy[] = [
    ...(spec.search?.groupBy ? spec.search.groupBy.filter((gb) => fieldNameSet.has(gb.field)) : []),
  ];

  // Apply registered view extensions in priority order
  const extensions = viewExtensions.get(model.modelName) ?? [];
  for (const ext of extensions) {
    for (const op of ext.operations) {
      if (op.target === 'list') {
        listColumns = applyListPatch(listColumns, op);
      } else if (op.target === 'form') {
        formSections = applyFormPatch(formSections, op);
      } else if (op.target === 'search') {
        if (op.position === 'addFilter' && op.filter) {
          searchFilters.push(op.filter);
        } else if (op.position === 'addGroupBy' && op.groupBy) {
          searchGroupBy.push(op.groupBy);
        } else if (op.fields) {
          for (const f of op.fields) {
            const name = fieldEntryName(f);
            if (!searchFields.includes(name)) searchFields.push(name);
          }
        }
      }
    }
  }

  return {
    model: model.modelName,
    title: spec.title ?? humanize(model.modelName.split('.').pop() ?? model.modelName),
    ...(model.displayField ? { displayField: model.displayField } : {}),
    fields,
    list: {
      ...spec.list,
      columns: listColumns,
      order: spec.list?.order ?? model.defaultOrder,
    },
    form: {
      ...spec.form,
      sections: formSections,
      ...(spec.form?.chatter === false ? { chatter: false } : {}),
      ...(spec.form?.tabs ? { tabs: spec.form.tabs } : {}),
    },
    search: {
      ...spec.search,
      fields: searchFields,
      filters: searchFilters,
      ...(searchGroupBy.length > 0 ? { groupBy: searchGroupBy } : {}),
    },
    ...(spec.kanban ? { kanban: spec.kanban } : {}),
    ...(spec.calendar ? { calendar: spec.calendar } : {}),
    ...(spec.graph ? { graph: spec.graph } : {}),
    ...(spec.pivot ? { pivot: spec.pivot } : {}),
    actions: [...(model.exposedActions ?? [])],
  };
}
