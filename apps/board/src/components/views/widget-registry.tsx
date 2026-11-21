import type { ReactNode } from 'react';
import type { Domain, FieldMeta } from '@moonwitness/client';
import type { Row } from './field-utils';

export type CanonicalWidgetType =
  | 'string'
  | 'text'
  | 'integer'
  | 'float'
  | 'decimal'
  | 'monetary'
  | 'boolean'
  | 'date'
  | 'datetime'
  | 'selection'
  | 'statusbar'
  | 'json'
  | 'manyToOne'
  | 'many2one'
  | 'oneToMany'
  | 'one2many'
  | 'manyToMany'
  | 'many2many'
  | 'password'
  | 'badge'
  | 'color'
  | 'email'
  | 'url'
  | 'phone';

export interface ExtendedFieldMeta extends Omit<FieldMeta, 'type'> {
  type: FieldMeta['type'] | CanonicalWidgetType | string;
  widget?: string;
  domain?: Domain;
  context?: Record<string, unknown>;
  relationField?: string;
  currencyField?: string;
  currencySymbol?: string;
  hasOnchange?: boolean;
  computed?: boolean;
}

export interface FieldCellRendererProps {
  field: ExtendedFieldMeta;
  row: Row;
  widget?: string;
}

export interface FieldWidgetRendererProps {
  id: string;
  field: ExtendedFieldMeta;
  value: unknown;
  onChange(value: unknown): void;
  related?: Row | null;
  invalid?: boolean;
  contextDomain?: Domain;
  record?: Row;
  widget?: string;
  parentModel?: string;
  parentId?: number;
  isCreate?: boolean;
}

export interface RegisteredFieldWidget {
  /** Unique widget identifier (e.g. `statusbar`, `monetary`, `manyToOne`, `string`). */
  name: string;
  /** Read-only list/table cell renderer. */
  renderCell?: (props: FieldCellRendererProps) => ReactNode;
  /** Editable form control renderer. */
  renderWidget: (props: FieldWidgetRendererProps) => ReactNode;
  /** Deterministic plain-text / CSV export formatter. */
  formatValue?: (value: unknown, field: ExtendedFieldMeta, row?: Row) => string;
  /** Whether the widget supports inline list editing. */
  supportsInlineEdit?: boolean;
}

const TYPE_ALIASES: Readonly<Record<string, string>> = Object.freeze({
  many2one: 'manyToOne',
  manytoone: 'manyToOne',
  manyToOne: 'manyToOne',
  one2many: 'oneToMany',
  onetomany: 'oneToMany',
  oneToMany: 'oneToMany',
  many2many: 'manyToMany',
  manytomany: 'manyToMany',
  manyToMany: 'manyToMany',
  char: 'string',
  varchar: 'string',
  enum: 'selection',
  number: 'float',
});

export function normalizeWidgetKey(rawKey: string | undefined | null): string {
  if (!rawKey) return 'string';
  const trimmed = rawKey.trim();
  if (!trimmed) return 'string';
  return TYPE_ALIASES[trimmed] ?? TYPE_ALIASES[trimmed.toLowerCase()] ?? trimmed;
}

function defaultFormatValue(value: unknown, field: ExtendedFieldMeta, row?: Row): string {
  if (value === null || value === undefined || value === '') return '';
  const normalizedType = normalizeWidgetKey(field.widget ?? String(field.type));
  if (normalizedType === 'password') return '••••••';
  if (normalizedType === 'boolean') return value ? 'true' : 'false';
  if (normalizedType === 'selection' || normalizedType === 'statusbar') {
    const match = field.selection?.find((option) => option.value === value);
    return match ? match.label : String(value);
  }
  if (normalizedType === 'manyToOne') {
    const relKey = field.name.replace(/_id$/, '');
    const related = row?.[relKey] as Row | undefined;
    if (related && typeof related === 'object') {
      const displayField = field.relationField;
      if (displayField && typeof related[displayField] === 'string' && related[displayField]) {
        return String(related[displayField]);
      }
      for (const candidate of ['display_name', 'name', 'login', 'code', 'title', 'email']) {
        if (typeof related[candidate] === 'string' && related[candidate]) {
          return String(related[candidate]);
        }
      }
    }
    return String(value);
  }
  if (normalizedType === 'manyToMany' || normalizedType === 'oneToMany') {
    if (Array.isArray(value)) {
      return value
        .map((entry) => {
          if (entry && typeof entry === 'object') {
            const record = entry as Row;
            return String(
              record.display_name ?? record.name ?? record.code ?? record.id ?? ''
            ).trim();
          }
          return String(entry);
        })
        .filter(Boolean)
        .join(', ');
    }
    return String(value);
  }
  if (normalizedType === 'json') {
    if (typeof value === 'string') return value;
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }
  if (normalizedType === 'monetary') {
    const symbol =
      field.currencySymbol ??
      (field.currencyField && row && typeof row[field.currencyField] === 'string'
        ? String(row[field.currencyField])
        : 'USD');
    const numeric = typeof value === 'number' ? value : Number(value);
    if (Number.isFinite(numeric)) {
      return `${symbol} ${numeric.toFixed(2)}`;
    }
    return String(value);
  }
  return String(value);
}

function createPlaceholderRegistration(name: string): RegisteredFieldWidget {
  return {
    name,
    supportsInlineEdit: name !== 'oneToMany' && name !== 'json',
    formatValue: defaultFormatValue,
    renderWidget: ({ value }) => (value === null || value === undefined ? '' : String(value)),
  };
}

export const DEFAULT_WIDGET_TYPES: readonly string[] = Object.freeze([
  'string',
  'text',
  'integer',
  'float',
  'decimal',
  'monetary',
  'boolean',
  'date',
  'datetime',
  'selection',
  'statusbar',
  'json',
  'manyToOne',
  'oneToMany',
  'manyToMany',
  'password',
  'badge',
  'color',
  'email',
  'url',
  'phone',
]);

export class FieldWidgetRegistry {
  private readonly widgets = new Map<string, RegisteredFieldWidget>();

  constructor(seedDefaults = true) {
    if (seedDefaults) {
      this.resetDefaults();
    }
  }

  resetDefaults(): void {
    this.widgets.clear();
    for (const typeName of DEFAULT_WIDGET_TYPES) {
      const registration = createPlaceholderRegistration(typeName);
      this.widgets.set(typeName, registration);
    }
    // Register snake/legacy aliases pointing to canonical registrations
    this.widgets.set('many2one', this.widgets.get('manyToOne')!);
    this.widgets.set('one2many', this.widgets.get('oneToMany')!);
    this.widgets.set('many2many', this.widgets.get('manyToMany')!);
  }

  register(definition: RegisteredFieldWidget): RegisteredFieldWidget {
    if (!definition || typeof definition.name !== 'string' || !definition.name.trim()) {
      throw new Error('FieldWidgetRegistry.register requires a non-empty widget name');
    }
    if (typeof definition.renderWidget !== 'function') {
      throw new Error(
        `FieldWidgetRegistry.register("${definition.name}") requires a renderWidget function`
      );
    }
    const rawName = definition.name.trim();
    const canonicalName = normalizeWidgetKey(rawName);
    const normalized: RegisteredFieldWidget = {
      supportsInlineEdit: true,
      formatValue: defaultFormatValue,
      ...definition,
      name: canonicalName,
    };
    this.widgets.set(rawName, normalized);
    this.widgets.set(canonicalName, normalized);
    if (canonicalName === 'manyToOne') this.widgets.set('many2one', normalized);
    if (canonicalName === 'oneToMany') this.widgets.set('one2many', normalized);
    if (canonicalName === 'manyToMany') this.widgets.set('many2many', normalized);
    return normalized;
  }

  unregister(name: string): boolean {
    const canonical = normalizeWidgetKey(name);
    const existed = this.widgets.delete(name);
    this.widgets.delete(canonical);
    return existed;
  }

  has(name: string): boolean {
    const canonical = normalizeWidgetKey(name);
    return this.widgets.has(name) || this.widgets.has(canonical);
  }

  get(name: string): RegisteredFieldWidget | undefined {
    return this.widgets.get(name) ?? this.widgets.get(normalizeWidgetKey(name));
  }

  list(): RegisteredFieldWidget[] {
    const seen = new Set<string>();
    const results: RegisteredFieldWidget[] = [];
    for (const widget of this.widgets.values()) {
      if (!seen.has(widget.name)) {
        seen.add(widget.name);
        results.push(widget);
      }
    }
    return results;
  }

  /**
   * Multi-tier widget resolution:
   * 1. Explicit `explicitWidget` parameter (e.g. from list column or form field spec)
   * 2. Explicit `field.widget` metadata attribute
   * 3. Canonical `field.type` mapping (handling `many2one` <-> `manyToOne`, etc.)
   * 4. Fallback to `'string'` widget
   */
  resolve(
    field: Pick<ExtendedFieldMeta, 'type' | 'widget'> & Partial<ExtendedFieldMeta>,
    explicitWidget?: string
  ): RegisteredFieldWidget {
    const candidates = [explicitWidget, field?.widget, field?.type ? String(field.type) : undefined];
    for (const candidate of candidates) {
      if (!candidate) continue;
      const direct = this.widgets.get(candidate);
      if (direct) return direct;
      const normalized = normalizeWidgetKey(candidate);
      const mapped = this.widgets.get(normalized);
      if (mapped) return mapped;
    }
    return this.widgets.get('string') ?? createPlaceholderRegistration('string');
  }
}

export const fieldWidgetRegistry = new FieldWidgetRegistry(true);

export function registerFieldWidget(definition: RegisteredFieldWidget): RegisteredFieldWidget {
  return fieldWidgetRegistry.register(definition);
}

export function resolveFieldWidget(
  field: Pick<ExtendedFieldMeta, 'type' | 'widget'> & Partial<ExtendedFieldMeta>,
  explicitWidget?: string
): RegisteredFieldWidget {
  return fieldWidgetRegistry.resolve(field, explicitWidget);
}

export function formatFieldValue(
  field: ExtendedFieldMeta,
  value: unknown,
  row?: Row,
  explicitWidget?: string
): string {
  const widget = resolveFieldWidget(field, explicitWidget);
  return widget.formatValue
    ? widget.formatValue(value, field, row)
    : defaultFormatValue(value, field, row);
}
