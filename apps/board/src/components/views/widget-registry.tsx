import type { FieldMeta } from '@moonwitness/client';
import type { Row } from './field-utils';
import {
  formatFieldValue,
  resolveFieldWidget,
  type ExtendedFieldMeta,
} from './field-widget-registry';

/** Read-only cell renderer shared across list views and relational widgets. */
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
