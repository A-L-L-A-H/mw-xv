import { useId, useState } from 'react';
import { cn } from '../lib/cn.js';

export type DatePickerValue = {
  date: string;
  time?: string;
};

export type DatePickerProps = {
  id?: string;
  name?: string;
  label: string;
  value?: DatePickerValue | null;
  onValueChange?: (value: DatePickerValue | null) => void;
  includeTime?: boolean;
  min?: string;
  max?: string;
  required?: boolean;
  disabled?: boolean;
  invalid?: boolean;
  error?: string;
  description?: string;
  className?: string;
};

function associate(value: boolean | undefined) {
  return value ? true : undefined;
}

export function DatePicker({
  id: providedId,
  name,
  label,
  value,
  onValueChange,
  includeTime = false,
  min,
  max,
  required = false,
  disabled = false,
  invalid = false,
  error,
  description,
  className,
}: DatePickerProps) {
  const generatedId = useId();
  const id = providedId ?? generatedId;
  const descriptionId = description ? `${id}-description` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [descriptionId, errorId].filter(Boolean).join(' ') || undefined;
  const invalidState = invalid || Boolean(error);
  const [uncontrolledValue, setUncontrolledValue] = useState<DatePickerValue | null>(null);
  const isControlled = value !== undefined;
  const currentValue = isControlled ? value : uncontrolledValue;

  const updateValue = (nextValue: DatePickerValue | null) => {
    if (!isControlled) setUncontrolledValue(nextValue);
    onValueChange?.(nextValue);
  };

  return (
    <div className={cn('mw-ui-field', className)} data-slot="date-picker">
      <label className="mw-ui-field-label" htmlFor={id}>
        {label}
        {required ? <span aria-hidden="true"> *</span> : null}
      </label>
      <div className="mw-ui-date-picker">
        <input
          aria-describedby={describedBy}
          aria-invalid={associate(invalidState)}
          aria-required={associate(required)}
          className="mw-ui-input"
          data-slot="date-picker-date"
          disabled={disabled}
          id={id}
          max={max}
          min={min}
          name={name ? `${name}-date` : undefined}
          onChange={(event) =>
            updateValue(event.target.value ? { ...currentValue, date: event.target.value } : null)
          }
          required={required}
          type="date"
          value={currentValue?.date ?? ''}
        />
        {includeTime ? (
          <input
            aria-label={`${label} time`}
            aria-describedby={describedBy}
            aria-invalid={associate(invalidState)}
            className="mw-ui-input"
            data-slot="date-picker-time"
            disabled={disabled}
            max={max?.slice(11)}
            min={min?.slice(11)}
            name={name ? `${name}-time` : undefined}
            onChange={(event) =>
              updateValue(
                currentValue?.date
                  ? { ...currentValue, time: event.target.value || undefined }
                  : null
              )
            }
            required={required}
            type="time"
            value={currentValue?.time ?? ''}
          />
        ) : null}
      </div>
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
