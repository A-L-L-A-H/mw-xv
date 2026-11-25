import { useId, useState } from 'react';
import { cn } from '../lib/cn.js';

export type NumberInputProps = {
  id?: string;
  name?: string;
  label: string;
  value?: number | null;
  onValueChange?: (value: number | null) => void;
  currency?: string;
  min?: number;
  max?: number;
  step?: number | 'any';
  integer?: boolean;
  required?: boolean;
  disabled?: boolean;
  invalid?: boolean;
  error?: string;
  description?: string;
  className?: string;
};

function formatValue(value: number | null | undefined) {
  return value === null || value === undefined ? '' : String(value);
}

export function parseNumber(rawValue: string, integer: boolean): number | null {
  if (!rawValue) return null;
  const normalized = rawValue.replace(',', '.');
  if (!/^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/u.test(normalized)) return null;
  const parsed = Number(normalized);
  if (!Number.isFinite(parsed)) return null;
  if (integer && !Number.isInteger(parsed)) return null;
  return parsed;
}

export function NumberInput({
  id: providedId,
  name,
  label,
  value,
  onValueChange,
  currency,
  min,
  max,
  step,
  integer = false,
  required = false,
  disabled = false,
  invalid = false,
  error,
  description,
  className,
}: NumberInputProps) {
  const generatedId = useId();
  const id = providedId ?? generatedId;
  const descriptionId = description ? `${id}-description` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [descriptionId, errorId].filter(Boolean).join(' ') || undefined;
  const invalidState = invalid || Boolean(error);
  const [uncontrolledValue, setUncontrolledValue] = useState<number | null>(null);
  const isControlled = value !== undefined;
  const currentValue = isControlled ? value : uncontrolledValue;

  const updateValue = (nextValue: number | null) => {
    if (!isControlled) setUncontrolledValue(nextValue);
    onValueChange?.(nextValue);
  };

  return (
    <div className={cn('mw-ui-field', className)} data-slot="number-input">
      <label className="mw-ui-field-label" htmlFor={id}>
        {label}
        {required ? <span aria-hidden="true"> *</span> : null}
      </label>
      <input
        aria-describedby={describedBy}
        aria-invalid={invalidState ? true : undefined}
        aria-required={required ? true : undefined}
        className="mw-ui-input"
        data-currency={currency}
        data-slot="number-input-field"
        disabled={disabled}
        id={id}
        inputMode={integer ? 'numeric' : 'decimal'}
        max={max}
        min={min}
        name={name}
        onChange={(event) => updateValue(parseNumber(event.target.value, integer))}
        required={required}
        step={step ?? (integer ? 1 : 'any')}
        type="number"
        value={formatValue(currentValue)}
      />
      {description ? (
        <div className="mw-ui-field-description" id={descriptionId}>
          {description}
        </div>
      ) : null}
      {error ? (
        <div className="mw-ui-field-error" id={errorId} role="alert">
          {error}
        </div>
      ) : null}
    </div>
  );
}
