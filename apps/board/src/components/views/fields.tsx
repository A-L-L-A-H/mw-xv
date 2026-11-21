import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import {
  AddIcon,
  CheckIcon,
  ChevronRightIcon,
  CloseIcon,
  ExternalLinkIcon,
  MailIcon,
  PhoneIcon,
} from '@moonwitness/ui/icons';
import { Badge } from '@moonwitness/ui/components/badge';
import { Button } from '@moonwitness/ui/components/button';
import { Checkbox } from '@moonwitness/ui/components/checkbox';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@moonwitness/ui/components/command';
import { DatePicker, type DatePickerValue } from '@moonwitness/ui/components/date-picker';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@moonwitness/ui/components/dialog';
import { Input } from '@moonwitness/ui/components/input';
import { NumberInput } from '@moonwitness/ui/components/number-input';
import { Popover, PopoverContent, PopoverTrigger } from '@moonwitness/ui/components/popover';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@moonwitness/ui/components/select';
import { StatusBar, type StatusBarStep } from '@moonwitness/ui/components/status-bar';
import { Switch } from '@moonwitness/ui/components/switch';
import { TagInput } from '@moonwitness/ui/components/tag-input';
import { Textarea } from '@moonwitness/ui/components/textarea';
import { resolveDomainContext, type Domain, type FieldMeta } from '@moonwitness/client';
import { client } from '@/lib/client';
import { formatDateTime } from '@/lib/date-format';
import { readPreferences } from '@/lib/preferences';
import { scopedQueryKey } from '@/lib/query-scope';
import { cn } from '@/lib/utils';
import { displayName, relationKey, type Row } from './field-utils';
import { One2ManyWidget } from './one2many-widget';
import {
  formatFieldValue,
  registerFieldWidget,
  resolveFieldWidget,
  type ExtendedFieldMeta,
  type FieldCellRendererProps,
  type FieldWidgetRendererProps,
  type RegisteredFieldWidget,
} from './widget-registry';

export type {
  ExtendedFieldMeta,
  FieldCellRendererProps,
  FieldWidgetRendererProps,
  RegisteredFieldWidget,
};

/* ─────────────────────────────── Safe helpers ─────────────────────────────── */

const SAFE_WEB_PROTOCOLS = new Set(['http:', 'https:']);

function sanitizeExternalHref(
  rawValue: unknown,
  kind: 'url' | 'email' | 'phone'
): string | null {
  if (typeof rawValue !== 'string') return null;
  const trimmed = rawValue.trim();
  if (!trimmed) return null;
  if (/^(?:javascript|data|vbscript|file|blob):/iu.test(trimmed)) {
    return null;
  }
  if (kind === 'email') {
    const emailTarget = trimmed.replace(/^mailto:/iu, '').trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(emailTarget)) return null;
    return `mailto:${emailTarget}`;
  }
  if (kind === 'phone') {
    const phoneTarget = trimmed.replace(/^tel:/iu, '').trim();
    if (!/^[+0-9()\-.\s]{3,32}$/u.test(phoneTarget)) return null;
    return `tel:${phoneTarget.replace(/\s+/gu, '')}`;
  }
  try {
    const candidate = /^[a-z][a-z0-9+.-]*:/iu.test(trimmed) ? trimmed : `https://${trimmed}`;
    const parsed = new URL(candidate);
    if (!SAFE_WEB_PROTOCOLS.has(parsed.protocol.toLowerCase())) return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

function parseIsoToDatePickerValue(
  rawValue: unknown,
  includeTime: boolean
): DatePickerValue | null {
  if (typeof rawValue !== 'string' && !(rawValue instanceof Date)) return null;
  const str = rawValue instanceof Date ? rawValue.toISOString() : rawValue.trim();
  if (!str) return null;
  const datePartMatch = /^(\d{4}-\d{2}-\d{2})(?:[T\s](\d{2}:\d{2}))?/u.exec(str);
  if (datePartMatch?.[1]) {
    return {
      date: datePartMatch[1],
      ...(includeTime && datePartMatch[2] ? { time: datePartMatch[2] } : {}),
    };
  }
  const parsed = new Date(str);
  if (!Number.isFinite(parsed.getTime())) return null;
  const iso = parsed.toISOString();
  return {
    date: iso.slice(0, 10),
    ...(includeTime ? { time: iso.slice(11, 16) } : {}),
  };
}

function serializeDatePickerValue(
  pickerValue: DatePickerValue | null,
  includeTime: boolean
): string | null {
  if (!pickerValue?.date) return null;
  if (!includeTime) return pickerValue.date;
  const timePart = pickerValue.time && pickerValue.time.trim() ? pickerValue.time.trim() : '00:00';
  return `${pickerValue.date}T${timePart}:00.000Z`;
}

function resolveCurrencyCode(field: ExtendedFieldMeta, row?: Row): string {
  if (field.currencySymbol) return field.currencySymbol;
  if (field.currencyField && row && typeof row[field.currencyField] === 'string') {
    return String(row[field.currencyField]);
  }
  if (row && typeof row.currency === 'string' && row.currency) return row.currency;
  if (row && typeof row.currency_code === 'string' && row.currency_code) return row.currency_code;
  return 'USD';
}

function formatLocalizedNumber(
  value: unknown,
  options?: Intl.NumberFormatOptions
): string {
  const num = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(num)) return String(value ?? '');
  try {
    const { language } = readPreferences();
    return new Intl.NumberFormat(language, options).format(num);
  } catch {
    return String(num);
  }
}

function resolveRecordLabel(record: Row | null | undefined, relationField?: string): string {
  if (!record) return '';
  if (
    relationField &&
    typeof record[relationField] === 'string' &&
    String(record[relationField]).trim()
  ) {
    return String(record[relationField]);
  }
  return displayName(record);
}

/**
 * Evaluate dynamic `field.domain` and `contextDomain` against current form record state
 * so dependent relations filter purely from metadata without model hardcoding.
 */
function buildEffectiveRelationDomain(
  field: ExtendedFieldMeta,
  contextDomain?: Domain,
  record?: Row
): Domain {
  const combined: Domain = [];
  if (Array.isArray(field.domain) && field.domain.length > 0) {
    try {
      const tokenContext: Record<string, unknown> = {
        ...(field.context ?? {}),
        ...(record ?? {}),
      };
      const resolved = resolveDomainContext(field.domain, {
        uid: typeof tokenContext.uid === 'number' ? tokenContext.uid : undefined,
        partnerId:
          typeof tokenContext.partnerId === 'number'
            ? tokenContext.partnerId
            : typeof tokenContext.partner_id === 'number'
              ? tokenContext.partner_id
              : undefined,
        companyId:
          typeof tokenContext.companyId === 'number'
            ? tokenContext.companyId
            : typeof tokenContext.company_id === 'number'
              ? tokenContext.company_id
              : undefined,
      });
      for (const item of resolved) {
        if (Array.isArray(item) && item.length === 3) {
          const [lhs, op, rhs] = item;
          if (typeof rhs === 'string' && rhs.startsWith('record.') && record) {
            const refField = rhs.slice('record.'.length);
            const refVal = record[refField];
            if (refVal !== undefined && refVal !== null && refVal !== '') {
              combined.push([lhs, op, refVal]);
            }
            continue;
          }
          if (typeof rhs === 'string' && rhs.startsWith('$') && record) {
            const refField = rhs.slice(1);
            if (refField in record && record[refField] !== undefined && record[refField] !== null) {
              combined.push([lhs, op, record[refField]]);
              continue;
            }
          }
        }
        combined.push(item);
      }
    } catch {
      combined.push(...field.domain);
    }
  }
  if (Array.isArray(contextDomain) && contextDomain.length > 0) {
    combined.push(...contextDomain);
  }
  return combined;
}

/**
 * Build an `ilike` search domain from target model view metadata (`search.fields` and `displayField`)
 * without any hardcoded model names.
 */
function buildTargetSearchDomain(
  term: string,
  relationField?: string,
  targetSearchFields?: readonly string[],
  targetDisplayField?: string
): Domain {
  const trimmed = term.trim();
  if (!trimmed) return [];
  const candidateFields = Array.from(
    new Set(
      [
        ...(relationField ? [relationField] : []),
        ...(targetDisplayField ? [targetDisplayField] : []),
        ...(targetSearchFields && targetSearchFields.length > 0 ? targetSearchFields : ['name']),
      ].filter(Boolean)
    )
  ).slice(0, 4);

  if (candidateFields.length === 0) {
    return [['name', 'ilike', `%${trimmed}%`]];
  }
  if (candidateFields.length === 1) {
    return [[candidateFields[0]!, 'ilike', `%${trimmed}%`]];
  }
  const domain: Domain = [];
  for (let idx = 0; idx < candidateFields.length - 1; idx++) {
    domain.push('|');
  }
  for (const fieldName of candidateFields) {
    domain.push([fieldName, 'ilike', `%${trimmed}%`]);
  }
  return domain;
}

/* ─────────────────────────── Default Widget Registration ─────────────────────────── */

function registerDefaultWidgets(): void {
  // 1. string
  registerFieldWidget({
    name: 'string',
    renderCell: ({ field, row }) => {
      const value = row[field.name];
      if (value === null || value === undefined || value === '') {
        return <span className="text-ink-faint">—</span>;
      }
      return <span className="truncate">{String(value)}</span>;
    },
    renderWidget: ({ id, field, value, onChange, invalid }) => (
      <Input
        id={id}
        aria-invalid={invalid || undefined}
        disabled={field.readonly}
        value={
          typeof value === 'string'
            ? value
            : value === null || value === undefined
              ? String(field.default ?? '')
              : String(value)
        }
        onChange={(event) => onChange(event.target.value)}
      />
    ),
  });

  // 2. text (multiline Textarea)
  registerFieldWidget({
    name: 'text',
    renderCell: ({ field, row }) => {
      const value = row[field.name];
      if (value === null || value === undefined || value === '') {
        return <span className="text-ink-faint">—</span>;
      }
      return <span className="line-clamp-2 whitespace-pre-wrap text-xs">{String(value)}</span>;
    },
    renderWidget: ({ id, field, value, onChange, invalid }) => (
      <Textarea
        id={id}
        rows={4}
        aria-invalid={invalid || undefined}
        disabled={field.readonly}
        placeholder={field.help}
        value={
          typeof value === 'string'
            ? value
            : value === null || value === undefined
              ? ''
              : String(value)
        }
        onChange={(event) => onChange(event.target.value)}
      />
    ),
  });

  // 3. integer (NumberInput with integer=true)
  registerFieldWidget({
    name: 'integer',
    renderCell: ({ field, row }) => {
      const value = row[field.name];
      if (value === null || value === undefined || value === '') {
        return <span className="text-ink-faint">—</span>;
      }
      return (
        <span className="font-mono tabular-nums">
          {formatLocalizedNumber(value, { maximumFractionDigits: 0 })}
        </span>
      );
    },
    renderWidget: ({ id, field, value, onChange, invalid }) => {
      const numericValue =
        value === null || value === undefined || value === ''
          ? null
          : typeof value === 'number'
            ? value
            : Number(value);
      return (
        <NumberInput
          id={id}
          name={field.name}
          label={field.label}
          integer
          step={1}
          disabled={field.readonly}
          required={field.required}
          invalid={invalid}
          value={Number.isFinite(numericValue) ? numericValue : null}
          onValueChange={(next) => onChange(next === null || Number.isNaN(next) ? null : next)}
          className="[&_.mw-ui-field-label]:sr-only font-mono"
        />
      );
    },
  });

  // 4. float (NumberInput with decimal support)
  registerFieldWidget({
    name: 'float',
    renderCell: ({ field, row }) => {
      const value = row[field.name];
      if (value === null || value === undefined || value === '') {
        return <span className="text-ink-faint">—</span>;
      }
      return (
        <span className="font-mono tabular-nums">
          {formatLocalizedNumber(value, { minimumFractionDigits: 2, maximumFractionDigits: 4 })}
        </span>
      );
    },
    renderWidget: ({ id, field, value, onChange, invalid }) => {
      const numericValue =
        value === null || value === undefined || value === ''
          ? null
          : typeof value === 'number'
            ? value
            : Number(value);
      return (
        <NumberInput
          id={id}
          name={field.name}
          label={field.label}
          step="any"
          disabled={field.readonly}
          required={field.required}
          invalid={invalid}
          value={Number.isFinite(numericValue) ? numericValue : null}
          onValueChange={(next) => onChange(next === null || Number.isNaN(next) ? null : next)}
          className="[&_.mw-ui-field-label]:sr-only font-mono"
        />
      );
    },
  });

  // 5. decimal (NumberInput with 0.01 step)
  registerFieldWidget({
    name: 'decimal',
    renderCell: ({ field, row }) => {
      const value = row[field.name];
      if (value === null || value === undefined || value === '') {
        return <span className="text-ink-faint">—</span>;
      }
      return (
        <span className="font-mono tabular-nums">
          {formatLocalizedNumber(value, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
        </span>
      );
    },
    renderWidget: ({ id, field, value, onChange, invalid }) => {
      const numericValue =
        value === null || value === undefined || value === ''
          ? null
          : typeof value === 'number'
            ? value
            : Number(value);
      return (
        <NumberInput
          id={id}
          name={field.name}
          label={field.label}
          step={0.01}
          disabled={field.readonly}
          required={field.required}
          invalid={invalid}
          value={Number.isFinite(numericValue) ? numericValue : null}
          onValueChange={(next) => onChange(next === null || Number.isNaN(next) ? null : next)}
          className="[&_.mw-ui-field-label]:sr-only font-mono"
        />
      );
    },
  });

  // 6. monetary (NumberInput with currency badge)
  registerFieldWidget({
    name: 'monetary',
    renderCell: ({ field, row }) => {
      const value = row[field.name];
      if (value === null || value === undefined || value === '') {
        return <span className="text-ink-faint">—</span>;
      }
      const currency = resolveCurrencyCode(field, row);
      return (
        <span className="inline-flex items-center gap-1.5 font-mono tabular-nums">
          <Badge variant="default" className="px-1 py-0 text-[10px] font-bold">
            {currency}
          </Badge>
          <span>
            {formatLocalizedNumber(value, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </span>
        </span>
      );
    },
    renderWidget: ({ id, field, value, onChange, invalid, record }) => {
      const currency = resolveCurrencyCode(field, record);
      const numericValue =
        value === null || value === undefined || value === ''
          ? null
          : typeof value === 'number'
            ? value
            : Number(value);
      return (
        <div className="flex items-center gap-2">
          <Badge variant="default" className="shrink-0 border-2 border-ink px-2 py-1 font-mono text-xs font-bold">
            {currency}
          </Badge>
          <NumberInput
            id={id}
            name={field.name}
            label={field.label}
            currency={currency}
            step={0.01}
            disabled={field.readonly}
            required={field.required}
            invalid={invalid}
            value={Number.isFinite(numericValue) ? numericValue : null}
            onValueChange={(next) => onChange(next === null || Number.isNaN(next) ? null : next)}
            className="w-full [&_.mw-ui-field-label]:sr-only font-mono"
          />
        </div>
      );
    },
  });

  // 7. boolean
  registerFieldWidget({
    name: 'boolean',
    renderCell: ({ field, row }) => {
      const value = row[field.name];
      if (value === null || value === undefined || value === '') {
        return <span className="text-ink-faint">—</span>;
      }
      if (field.name === 'active') {
        return value ? (
          <span className="inline-block -rotate-2 border-2 border-ink bg-primary px-2 text-xs font-bold uppercase text-primary-foreground">
            Active
          </span>
        ) : (
          <span className="crosshatch inline-block rotate-1 border-2 border-ink px-2 text-xs font-bold uppercase text-ink-soft">
            Archived
          </span>
        );
      }
      return value ? (
        <CheckIcon className="size-4" strokeWidth={3} />
      ) : (
        <CloseIcon className="size-4 text-ink-faint" />
      );
    },
    renderWidget: ({ id, field, value, onChange, invalid }) => (
      <Switch
        id={id}
        aria-invalid={invalid || undefined}
        disabled={field.readonly}
        checked={Boolean(value)}
        onCheckedChange={(checked) => onChange(checked)}
      />
    ),
  });

  // 8. date (DatePicker with includeTime=false)
  registerFieldWidget({
    name: 'date',
    renderCell: ({ field, row }) => {
      const value = row[field.name];
      if (value === null || value === undefined || value === '') {
        return <span className="text-ink-faint">—</span>;
      }
      return <span className="font-mono text-xs">{formatDateTime(String(value), 'date')}</span>;
    },
    renderWidget: ({ id, field, value, onChange, invalid }) => {
      const pickerValue = parseIsoToDatePickerValue(value, false);
      return (
        <DatePicker
          id={id}
          name={field.name}
          label={field.label}
          includeTime={false}
          disabled={field.readonly}
          required={field.required}
          invalid={invalid}
          value={pickerValue}
          onValueChange={(next) => onChange(serializeDatePickerValue(next, false))}
          className="[&_.mw-ui-field-label]:sr-only"
        />
      );
    },
  });

  // 9. datetime (DatePicker with includeTime=true when editable, formatted when readonly)
  registerFieldWidget({
    name: 'datetime',
    renderCell: ({ field, row }) => {
      const value = row[field.name];
      if (value === null || value === undefined || value === '') {
        return <span className="text-ink-faint">—</span>;
      }
      return <span className="font-mono text-xs">{formatDateTime(String(value))}</span>;
    },
    renderWidget: ({ id, field, value, onChange, invalid }) => {
      if (field.readonly) {
        return (
          <Input
            id={id}
            aria-invalid={invalid || undefined}
            disabled
            readOnly
            value={value ? formatDateTime(String(value)) : ''}
          />
        );
      }
      const pickerValue = parseIsoToDatePickerValue(value, true);
      return (
        <DatePicker
          id={id}
          name={field.name}
          label={field.label}
          includeTime
          disabled={field.readonly}
          required={field.required}
          invalid={invalid}
          value={pickerValue}
          onValueChange={(next) => onChange(serializeDatePickerValue(next, true))}
          className="[&_.mw-ui-field-label]:sr-only"
        />
      );
    },
  });

  // 10. selection
  registerFieldWidget({
    name: 'selection',
    renderCell: ({ field, row }) => {
      const value = row[field.name];
      if (value === null || value === undefined || value === '') {
        return <span className="text-ink-faint">—</span>;
      }
      const label =
        field.selection?.find((option) => option.value === value)?.label ?? String(value);
      return (
        <span className="border-2 border-ink px-1.5 font-mono text-xs uppercase">{label}</span>
      );
    },
    renderWidget: ({ id, field, value, onChange, invalid }) => (
      <Select
        value={value === null || value === undefined ? '' : String(value)}
        onValueChange={onChange}
        disabled={field.readonly}
      >
        <SelectTrigger
          id={id}
          aria-invalid={invalid || undefined}
          disabled={field.readonly}
          className="w-full"
        >
          <SelectValue placeholder="Pick one…" />
        </SelectTrigger>
        <SelectContent>
          {field.selection?.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    ),
  });

  // 11. statusbar (StatusBar + interactive stage transition buttons)
  registerFieldWidget({
    name: 'statusbar',
    renderCell: ({ field, row }) => {
      const value = row[field.name];
      if (value === null || value === undefined || value === '') {
        return <span className="text-ink-faint">—</span>;
      }
      const label =
        field.selection?.find((option) => option.value === value)?.label ?? String(value);
      return (
        <Badge variant="primary" className="border-2 border-ink px-2 py-0.5 font-mono text-xs uppercase">
          {label}
        </Badge>
      );
    },
    renderWidget: ({ id, field, value, onChange }) => {
      const options = field.selection ?? [];
      const currentVal = value === null || value === undefined ? '' : String(value);
      const activeIdx = options.findIndex((opt) => opt.value === currentVal);
      const steps: StatusBarStep[] = options.map((opt, idx) => ({
        id: opt.value,
        label: opt.label,
        state:
          idx === activeIdx
            ? 'active'
            : activeIdx !== -1 && idx < activeIdx
              ? 'done'
              : 'disabled',
      }));
      return (
        <div id={id} className="space-y-2">
          {steps.length > 0 && <StatusBar steps={steps} />}
          {!field.readonly && options.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label={field.label}>
              {options.map((opt) => {
                const isCurrent = opt.value === currentVal;
                return (
                  <Button
                    key={opt.value}
                    type="button"
                    size="xs"
                    variant={isCurrent ? 'default' : 'outline'}
                    disabled={field.readonly}
                    aria-pressed={isCurrent}
                    onClick={() => onChange(opt.value)}
                    className="gap-1 font-mono text-xs uppercase"
                  >
                    {isCurrent && <CheckIcon className="size-3" />}
                    <span>{opt.label}</span>
                  </Button>
                );
              })}
            </div>
          )}
        </div>
      );
    },
  });

  // 12. json (structured JSON editor with syntax validation)
  registerFieldWidget({
    name: 'json',
    supportsInlineEdit: false,
    renderCell: ({ field, row }) => {
      const value = row[field.name];
      if (value === null || value === undefined || value === '') {
        return <span className="text-ink-faint">—</span>;
      }
      const formatted = typeof value === 'string' ? value : JSON.stringify(value);
      return <span className="truncate font-mono text-xs">{formatted}</span>;
    },
    renderWidget: (props) => <JsonFieldWidget {...props} />,
  });

  // 13. manyToOne / many2one
  registerFieldWidget({
    name: 'manyToOne',
    renderCell: ({ field, row }) => {
      const value = row[field.name];
      if (value === null || value === undefined || value === '') {
        return <span className="text-ink-faint">—</span>;
      }
      const related = row[relationKey(field as FieldMeta)] as Row | undefined;
      return related ? (
        <span className="font-medium">{resolveRecordLabel(related, field.relationField)}</span>
      ) : (
        <span className="font-mono text-xs text-ink-faint">#{String(value)}</span>
      );
    },
    renderWidget: ({ id, field, value, onChange, related, invalid, contextDomain, record }) => (
      <Many2oneWidget
        id={id}
        field={field}
        value={(value as number | null) ?? null}
        onChange={onChange}
        related={related}
        disabled={field.readonly}
        aria-invalid={invalid || undefined}
        contextDomain={contextDomain}
        record={record}
      />
    ),
  });

  // 14. oneToMany / one2many
  registerFieldWidget({
    name: 'oneToMany',
    supportsInlineEdit: false,
    renderCell: ({ field, row }) => {
      const value = row[field.name];
      const count = Array.isArray(value) ? value.length : 0;
      return (
        <Badge variant="default" className="font-mono text-xs">
          {count} {count === 1 ? 'record' : 'records'}
        </Badge>
      );
    },
    renderWidget: ({ field, parentModel, parentId, isCreate }) => (
      <One2ManyWidget
        field={field as FieldMeta}
        parentModel={parentModel ?? ''}
        parentId={parentId}
        isCreate={Boolean(isCreate)}
      />
    ),
  });

  // 15. manyToMany / many2many
  registerFieldWidget({
    name: 'manyToMany',
    renderCell: ({ field, row }) => {
      const value = row[field.name];
      if (!Array.isArray(value) || value.length === 0) {
        return <span className="text-ink-faint">—</span>;
      }
      return (
        <div className="flex flex-wrap items-center gap-1">
          {value.slice(0, 3).map((entry, idx) => {
            const label =
              entry && typeof entry === 'object'
                ? resolveRecordLabel(entry as Row, field.relationField)
                : `#${String(entry)}`;
            return (
              <Badge key={idx} variant="default" className="border border-ink px-1.5 py-0 font-mono text-[10px]">
                {label}
              </Badge>
            );
          })}
          {value.length > 3 && (
            <span className="font-mono text-[10px] text-ink-faint">+{value.length - 3}</span>
          )}
        </div>
      );
    },
    renderWidget: ({ id, field, value, onChange, invalid, contextDomain, record }) => (
      <Many2ManyWidget
        id={id}
        field={field}
        value={value}
        onChange={onChange}
        disabled={field.readonly}
        invalid={invalid}
        contextDomain={contextDomain}
        record={record}
      />
    ),
  });

  // 16. password
  registerFieldWidget({
    name: 'password',
    renderCell: () => <span className="font-mono text-ink-faint">••••••</span>,
    renderWidget: ({ id, field, value, onChange, invalid }) => (
      <Input
        id={id}
        type="password"
        autoComplete="new-password"
        aria-invalid={invalid || undefined}
        disabled={field.readonly}
        placeholder={field.help ?? 'Leave empty to keep the current one'}
        value={typeof value === 'string' ? value : ''}
        onChange={(event) => onChange(event.target.value)}
      />
    ),
  });

  // 17. badge
  registerFieldWidget({
    name: 'badge',
    renderCell: ({ field, row }) => {
      const value = row[field.name];
      if (value === null || value === undefined || value === '') {
        return <span className="text-ink-faint">—</span>;
      }
      const label =
        field.selection?.find((option) => option.value === value)?.label ?? String(value);
      return (
        <Badge variant="primary" className="border-2 border-ink px-2 py-0.5 font-mono text-xs uppercase">
          {label}
        </Badge>
      );
    },
    renderWidget: (props) => resolveFieldWidget({ type: 'selection' }).renderWidget(props),
  });

  // 18. color
  registerFieldWidget({
    name: 'color',
    renderCell: ({ field, row }) => {
      const value = row[field.name];
      if (value === null || value === undefined || value === '') {
        return <span className="text-ink-faint">—</span>;
      }
      const colorText = String(value);
      return (
        <span className="inline-flex items-center gap-1.5 font-mono text-xs">
          <span
            aria-hidden="true"
            className="size-3.5 border border-ink"
            style={{ backgroundColor: colorText }}
          />
          <span>{colorText}</span>
        </span>
      );
    },
    renderWidget: ({ id, field, value, onChange, invalid }) => {
      const colorText = typeof value === 'string' ? value : '';
      return (
        <div className="flex items-center gap-2">
          <span
            aria-hidden="true"
            className="size-8 shrink-0 border-2 border-ink"
            style={{ backgroundColor: colorText || 'transparent' }}
          />
          <Input
            id={id}
            aria-invalid={invalid || undefined}
            disabled={field.readonly}
            placeholder="#000000"
            value={colorText}
            onChange={(event) => onChange(event.target.value)}
            className="font-mono"
          />
        </div>
      );
    },
  });

  // 19. email
  registerFieldWidget({
    name: 'email',
    renderCell: ({ field, row }) => {
      const value = row[field.name];
      const safeHref = sanitizeExternalHref(value, 'email');
      if (!safeHref) {
        return value ? (
          <span className="truncate">{String(value)}</span>
        ) : (
          <span className="text-ink-faint">—</span>
        );
      }
      return (
        <a
          href={safeHref}
          onClick={(event) => event.stopPropagation()}
          className="inline-flex items-center gap-1 underline hover:text-primary"
        >
          <MailIcon className="size-3.5 shrink-0" />
          <span className="truncate">{String(value)}</span>
        </a>
      );
    },
    renderWidget: ({ id, field, value, onChange, invalid }) => (
      <Input
        id={id}
        type="email"
        aria-invalid={invalid || undefined}
        disabled={field.readonly}
        placeholder="name@example.com"
        value={typeof value === 'string' ? value : ''}
        onChange={(event) => onChange(event.target.value)}
      />
    ),
  });

  // 20. url
  registerFieldWidget({
    name: 'url',
    renderCell: ({ field, row }) => {
      const value = row[field.name];
      const safeHref = sanitizeExternalHref(value, 'url');
      if (!safeHref) {
        return value ? (
          <span className="truncate">{String(value)}</span>
        ) : (
          <span className="text-ink-faint">—</span>
        );
      }
      return (
        <a
          href={safeHref}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(event) => event.stopPropagation()}
          className="inline-flex items-center gap-1 underline hover:text-primary"
        >
          <span className="truncate">{String(value)}</span>
          <ExternalLinkIcon className="size-3 shrink-0" />
        </a>
      );
    },
    renderWidget: ({ id, field, value, onChange, invalid }) => (
      <Input
        id={id}
        type="url"
        aria-invalid={invalid || undefined}
        disabled={field.readonly}
        placeholder="https://example.com"
        value={typeof value === 'string' ? value : ''}
        onChange={(event) => onChange(event.target.value)}
      />
    ),
  });

  // 21. phone
  registerFieldWidget({
    name: 'phone',
    renderCell: ({ field, row }) => {
      const value = row[field.name];
      const safeHref = sanitizeExternalHref(value, 'phone');
      if (!safeHref) {
        return value ? (
          <span className="truncate">{String(value)}</span>
        ) : (
          <span className="text-ink-faint">—</span>
        );
      }
      return (
        <a
          href={safeHref}
          onClick={(event) => event.stopPropagation()}
          className="inline-flex items-center gap-1 underline hover:text-primary"
        >
          <PhoneIcon className="size-3.5 shrink-0" />
          <span className="truncate">{String(value)}</span>
        </a>
      );
    },
    renderWidget: ({ id, field, value, onChange, invalid }) => (
      <Input
        id={id}
        type="tel"
        aria-invalid={invalid || undefined}
        disabled={field.readonly}
        placeholder="+1 555 0100"
        value={typeof value === 'string' ? value : ''}
        onChange={(event) => onChange(event.target.value)}
      />
    ),
  });
}

registerDefaultWidgets();

/* ─────────────────────────────── JSON Widget ─────────────────────────────── */

function JsonFieldWidget({
  id,
  field,
  value,
  onChange,
  invalid,
}: FieldWidgetRendererProps) {
  const serialized = useMemo(() => {
    if (value === null || value === undefined || value === '') return '';
    if (typeof value === 'string') return value;
    try {
      return JSON.stringify(value, null, 2);
    } catch {
      return String(value);
    }
  }, [value]);

  const [draft, setDraft] = useState(serialized);
  const [parseError, setParseError] = useState<string | null>(null);

  return (
    <div className="space-y-1">
      <Textarea
        id={id}
        rows={4}
        disabled={field.readonly}
        aria-invalid={invalid || Boolean(parseError) || undefined}
        value={draft}
        onChange={(event) => {
          const text = event.target.value;
          setDraft(text);
          if (!text.trim()) {
            setParseError(null);
            onChange(null);
            return;
          }
          try {
            const parsed: unknown = JSON.parse(text);
            setParseError(null);
            onChange(parsed);
          } catch (err) {
            setParseError(err instanceof Error ? err.message : 'Invalid JSON');
          }
        }}
        className="font-mono text-xs"
      />
      {parseError && (
        <p className="font-mono text-[11px] text-destructive" role="alert">
          {parseError}
        </p>
      )}
    </div>
  );
}

/* ─────────────────────────────── Read-only cell ─────────────────────────────── */

export function FieldCell({
  field,
  row,
  widget,
}: {
  field: FieldMeta | ExtendedFieldMeta;
  row: Row;
  widget?: string;
}) {
  const extendedField = field as ExtendedFieldMeta;
  const resolved = resolveFieldWidget(extendedField, widget);
  if (resolved.renderCell) {
    return <>{resolved.renderCell({ field: extendedField, row, widget })}</>;
  }
  const value = row[extendedField.name];
  if (value === null || value === undefined || value === '') {
    return <span className="text-ink-faint">—</span>;
  }
  return <span className="truncate">{formatFieldValue(extendedField, value, row, widget)}</span>;
}

/* ─────────────────────────────── Editable widget ─────────────────────────────── */

export interface WidgetProps {
  field: FieldMeta | ExtendedFieldMeta;
  value: unknown;
  onChange(value: unknown): void;
  /** Loaded relation object for many2one labels. */
  related?: Row | null;
  invalid?: boolean;
  id: string;
  contextDomain?: Domain;
  record?: Row;
  widget?: string;
  parentModel?: string;
  parentId?: number;
  isCreate?: boolean;
}

export function FieldWidget({
  field,
  value,
  onChange,
  related,
  invalid,
  id,
  contextDomain,
  record,
  widget,
  parentModel,
  parentId,
  isCreate,
}: WidgetProps) {
  const extendedField = field as ExtendedFieldMeta;
  const resolved = resolveFieldWidget(extendedField, widget);
  const effectiveValue =
    value !== undefined ? value : extendedField.default !== undefined ? extendedField.default : null;
  return (
    <>
      {resolved.renderWidget({
        id,
        field: extendedField,
        value: effectiveValue,
        onChange,
        related,
        invalid,
        contextDomain,
        record,
        widget,
        parentModel,
        parentId,
        isCreate,
      })}
    </>
  );
}

/** Backward-compatible alias for `FieldWidget`. */
export const FieldInput = FieldWidget;

/* ─────────────────────────── Metadata-Driven Many2oneWidget ─────────────────────────── */

export function Many2oneWidget({
  field,
  value,
  onChange,
  related,
  id,
  disabled,
  contextDomain,
  record,
  ...aria
}: {
  field: ExtendedFieldMeta;
  value: number | null;
  onChange(value: unknown): void;
  related?: Row | null;
  id: string;
  disabled?: boolean;
  'aria-invalid'?: boolean;
  contextDomain?: Domain;
  record?: Row;
}) {
  const [open, setOpen] = useState(false);
  const [term, setTerm] = useState('');
  const [picked, setPicked] = useState<Row | null>(null);
  const target = field.relation ?? '';

  const { data: targetViews } = useQuery({
    queryKey: scopedQueryKey(['views', target]),
    queryFn: () => client.model(target).getViews(),
    enabled: Boolean(open && target),
    staleTime: 5 * 60_000,
  });

  const effectiveDomain = useMemo(
    () => buildEffectiveRelationDomain(field, contextDomain, record),
    [field, contextDomain, record]
  );

  const targetDisplayField = (targetViews as { displayField?: string } | undefined)?.displayField;
  const targetSearchFields = targetViews?.search?.fields;
  const targetDefaultOrder = targetViews?.list?.order;

  const { data, isFetching, error } = useQuery({
    queryKey: scopedQueryKey([
      'm2o',
      target,
      term,
      effectiveDomain,
      field.relationField,
      targetDisplayField,
      targetSearchFields,
    ]),
    queryFn: () => {
      const searchDomain = buildTargetSearchDomain(
        term,
        field.relationField,
        targetSearchFields,
        targetDisplayField
      );
      const baseDomain: Domain = [...effectiveDomain, ...searchDomain];
      return client.model<Row>(target).searchRead({
        domain: baseDomain,
        limit: 30,
        order: targetDefaultOrder,
      });
    },
    enabled: Boolean(open && target),
    staleTime: 30_000,
  });

  const label = value
    ? resolveRecordLabel(picked?.id === value ? picked : related, field.relationField) ||
      `#${value}`
    : '';

  return (
    <div className="flex min-w-0 items-center gap-1.5">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            id={id}
            type="button"
            disabled={disabled || !target}
            aria-invalid={aria['aria-invalid']}
            className={cn(
              'flex h-10 min-w-0 flex-1 items-center gap-2 rounded-none border-2 border-ink bg-paper-raised px-3 text-left text-sm disabled:opacity-50 aria-invalid:border-destructive',
              !value && 'text-ink-faint'
            )}
          >
            <span className="truncate">{label || `Pick a ${field.label.toLowerCase()}…`}</span>
            <ChevronRightIcon className="ml-auto size-4 shrink-0 rotate-90" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
          <Command shouldFilter={false}>
            <CommandInput
              placeholder={`Search ${field.label.toLowerCase()}…`}
              value={term}
              onValueChange={setTerm}
            />
            <CommandList>
              <CommandEmpty>
                {error ? 'You cannot browse this model.' : isFetching ? 'Searching…' : 'No match.'}
              </CommandEmpty>
              <CommandGroup>
                {data?.records.map((candidateRecord) => (
                  <CommandItem
                    key={String(candidateRecord.id)}
                    value={String(candidateRecord.id)}
                    onSelect={() => {
                      setPicked(candidateRecord);
                      onChange(candidateRecord.id);
                      setOpen(false);
                    }}
                  >
                    <CheckIcon
                      className={cn(
                        'size-4',
                        candidateRecord.id === value ? 'opacity-100' : 'opacity-0'
                      )}
                    />
                    {resolveRecordLabel(candidateRecord, field.relationField)}
                    <span className="ml-auto font-mono text-xs text-ink-faint">
                      #{String(candidateRecord.id)}
                    </span>
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>

      {Boolean(value) && !disabled && (
        <Button
          type="button"
          variant="outline"
          size="xs"
          aria-label={`Clear ${field.label}`}
          title={`Clear ${field.label}`}
          onClick={() => {
            setPicked(null);
            onChange(null);
          }}
          className="h-10 shrink-0 px-2.5 hover:text-destructive"
        >
          <CloseIcon className="size-4" />
        </Button>
      )}

      {Boolean(value) && Boolean(target) && (
        <Button
          asChild
          variant="outline"
          size="xs"
          className="h-10 shrink-0 px-2.5"
          title={`Open ${field.label} #${String(value)}`}
        >
          <Link
            href={`/board/m/${target}/${String(value)}`}
            aria-label={`Open ${field.label} #${String(value)}`}
          >
            <ExternalLinkIcon className="size-4" />
          </Link>
        </Button>
      )}
    </div>
  );
}

/* ─────────────────────────── Metadata-Driven Many2ManyWidget ─────────────────────────── */

export function Many2ManyWidget({
  id,
  field,
  value,
  onChange,
  disabled,
  invalid,
  contextDomain,
  record,
}: {
  id: string;
  field: ExtendedFieldMeta;
  value: unknown;
  onChange(value: unknown): void;
  disabled?: boolean;
  invalid?: boolean;
  contextDomain?: Domain;
  record?: Row;
}) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [term, setTerm] = useState('');
  const [knownLabels, setKnownLabels] = useState<Record<number, string>>({});
  const target = field.relation ?? '';

  const selectedIds = useMemo<number[]>(() => {
    if (!Array.isArray(value)) return [];
    const ids: number[] = [];
    for (const item of value) {
      if (typeof item === 'number' && Number.isFinite(item)) {
        ids.push(item);
      } else if (typeof item === 'string' && /^\d+$/u.test(item)) {
        ids.push(Number(item));
      } else if (item && typeof item === 'object' && typeof (item as Row).id === 'number') {
        ids.push((item as Row).id as number);
      }
    }
    return Array.from(new Set(ids));
  }, [value]);

  const inlineLabels = useMemo<Record<number, string>>(() => {
    const map: Record<number, string> = {};
    if (Array.isArray(value)) {
      for (const item of value) {
        if (item && typeof item === 'object' && typeof (item as Row).id === 'number') {
          const rowItem = item as Row;
          map[rowItem.id as number] = resolveRecordLabel(rowItem, field.relationField);
        }
      }
    }
    return map;
  }, [value, field.relationField]);

  const effectiveDomain = useMemo(
    () => buildEffectiveRelationDomain(field, contextDomain, record),
    [field, contextDomain, record]
  );

  const { data: targetViews } = useQuery({
    queryKey: scopedQueryKey(['views', target]),
    queryFn: () => client.model(target).getViews(),
    enabled: Boolean(dialogOpen && target),
    staleTime: 5 * 60_000,
  });

  const targetDisplayField = (targetViews as { displayField?: string } | undefined)?.displayField;
  const targetSearchFields = targetViews?.search?.fields;
  const targetDefaultOrder = targetViews?.list?.order;

  const { data: searchData, isFetching, error } = useQuery({
    queryKey: scopedQueryKey([
      'm2m',
      target,
      term,
      effectiveDomain,
      field.relationField,
      targetDisplayField,
      targetSearchFields,
    ]),
    queryFn: () => {
      const searchDomain = buildTargetSearchDomain(
        term,
        field.relationField,
        targetSearchFields,
        targetDisplayField
      );
      return client.model<Row>(target).searchRead({
        domain: [...effectiveDomain, ...searchDomain],
        limit: 40,
        order: targetDefaultOrder,
      });
    },
    enabled: Boolean(dialogOpen && target),
    staleTime: 30_000,
  });

  const tagEntries = useMemo(
    () =>
      selectedIds.map((recordId) => {
        const label =
          knownLabels[recordId] ?? inlineLabels[recordId] ?? `#${String(recordId)}`;
        return {
          id: recordId,
          tag: `${label} (#${String(recordId)})`,
        };
      }),
    [selectedIds, knownLabels, inlineLabels]
  );

  const handleTagsChange = (nextTags: string[]) => {
    const nextIds: number[] = [];
    for (const tag of nextTags) {
      const match = /\(#(\d+)\)$/u.exec(tag.trim()) ?? /^#?(\d+)$/u.exec(tag.trim());
      if (match?.[1]) {
        const parsed = Number(match[1]);
        if (Number.isFinite(parsed) && !nextIds.includes(parsed)) {
          nextIds.push(parsed);
        }
      }
    }
    onChange(nextIds);
  };

  const toggleId = (candidateRecord: Row) => {
    const recordId = Number(candidateRecord.id);
    if (!Number.isFinite(recordId)) return;
    const label = resolveRecordLabel(candidateRecord, field.relationField);
    if (label) {
      setKnownLabels((prev) => ({ ...prev, [recordId]: label }));
    }
    if (selectedIds.includes(recordId)) {
      onChange(selectedIds.filter((existing) => existing !== recordId));
    } else {
      onChange([...selectedIds, recordId]);
    }
  };

  return (
    <div className="min-w-0 space-y-2">
      <TagInput
        id={id}
        name={field.name}
        label={field.label}
        disabled={disabled}
        required={field.required}
        invalid={invalid}
        placeholder={disabled ? undefined : `Type #ID or use Select ${field.label}…`}
        value={tagEntries.map((entry) => entry.tag)}
        onValueChange={handleTagsChange}
        className="[&_.mw-ui-field-label]:sr-only"
      />

      {!disabled && Boolean(target) && (
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger asChild>
            <Button type="button" variant="outline" size="xs" className="gap-1.5 font-mono text-xs">
              <AddIcon className="size-3.5" />
              <span>Select {field.label}</span>
              {selectedIds.length > 0 && (
                <Badge variant="default" className="ml-1 px-1.5 py-0 text-[10px]">
                  {selectedIds.length}
                </Badge>
              )}
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>Select {field.label}</DialogTitle>
              <DialogDescription>
                Choose one or more related records from {target}.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-3">
              <Input
                placeholder={`Search ${field.label.toLowerCase()}…`}
                value={term}
                onChange={(event) => setTerm(event.target.value)}
              />

              <div className="max-h-60 divide-y divide-ink/10 overflow-y-auto border-2 border-ink bg-card">
                {error ? (
                  <div className="p-4 text-center font-mono text-xs text-destructive">
                    You do not have permission to read {target}.
                  </div>
                ) : isFetching && !searchData?.records.length ? (
                  <div className="p-4 text-center font-mono text-xs text-ink-faint">
                    Searching…
                  </div>
                ) : !searchData?.records.length ? (
                  <div className="p-4 text-center font-mono text-xs text-ink-faint">
                    No matching records.
                  </div>
                ) : (
                  searchData.records.map((candidateRecord) => {
                    const recordId = Number(candidateRecord.id);
                    const checked = selectedIds.includes(recordId);
                    const label = resolveRecordLabel(candidateRecord, field.relationField);
                    return (
                      <div
                        key={String(recordId)}
                        onClick={() => toggleId(candidateRecord)}
                        className="flex cursor-pointer items-center justify-between gap-3 px-3 py-2 text-xs hover:bg-primary/15"
                      >
                        <div className="flex min-w-0 items-center gap-2.5">
                          <Checkbox
                            checked={checked}
                            onChange={() => toggleId(candidateRecord)}
                            onClick={(event) => event.stopPropagation()}
                            aria-label={`Select ${label}`}
                          />
                          <span className="truncate font-medium">{label}</span>
                        </div>
                        <span className="shrink-0 font-mono text-[11px] text-ink-faint">
                          #{String(recordId)}
                        </span>
                      </div>
                    );
                  })
                )}
              </div>
            </div>

            <DialogFooter showCloseButton />
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
