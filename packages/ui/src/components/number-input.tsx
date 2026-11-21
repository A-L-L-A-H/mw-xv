'use client';

import * as React from 'react';
import { cn } from '../lib/cn.js';

export interface NumberInputProps
  extends Omit<React.ComponentProps<'input'>, 'type' | 'onChange'> {
  /** Current value as a number */
  value?: number | null;
  /** Callback when value changes */
  onValueChange?: (value: number | null) => void;
  /** Minimum value */
  min?: number;
  /** Maximum value */
  max?: number;
  /** Step increment */
  step?: number;
  /** Number of decimal places */
  precision?: number;
  /** Currency code for formatting (e.g., 'IDR', 'USD') */
  currency?: string;
  /** Locale for formatting */
  locale?: string;
  /** Error message to display */
  error?: string;
  /** Label for the field */
  label?: string;
  /** Helper text */
  description?: string;
  /** Placeholder text */
  placeholder?: string;
  /** Whether the field is disabled */
  disabled?: boolean;
  /** Whether the field is required */
  required?: boolean;
  /** Input name attribute */
  name?: string;
}

function NumberInput({
  className,
  value,
  onValueChange,
  min,
  max,
  step = 1,
  precision,
  currency,
  locale = 'id-ID',
  error,
  label,
  description,
  placeholder,
  disabled,
  required,
  name,
  id: providedId,
  onBlur,
  onFocus,
  ...props
}: NumberInputProps) {
  const inputId = providedId || React.useId();
  const errorId = React.useId();
  const descriptionId = React.useId();
  const [localValue, setLocalValue] = React.useState<string>(
    value !== undefined && value !== null ? formatNumber(value, precision, currency, locale) : ''
  );
  const [isFocused, setIsFocused] = React.useState(false);

  // Format number for display
  function formatNumber(num: number, precision?: number, currency?: string, locale = 'id-ID'): string {
    if (currency) {
      return new Intl.NumberFormat(locale, {
        style: 'currency',
        currency,
        minimumFractionDigits: precision ?? 0,
        maximumFractionDigits: precision ?? 2,
      }).format(num);
    }
    return new Intl.NumberFormat(locale, {
      minimumFractionDigits: precision ?? 0,
      maximumFractionDigits: precision ?? 2,
    }).format(num);
  }

  // Parse input string to number
  function parseNumber(str: string): number | null {
    if (!str || str.trim() === '') return null;
    const cleaned = str.replace(/[^\d.,-]/g, '').replace(',', '.');
    const num = parseFloat(cleaned);
    return isNaN(num) ? null : num;
  }

  // Sync local value with controlled value
  React.useEffect(() => {
    if (!isFocused && value !== undefined) {
      setLocalValue(value !== null ? formatNumber(value, precision, currency, locale) : '');
    }
  }, [value, isFocused, precision, currency, locale]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const rawValue = e.target.value;
    setLocalValue(rawValue);

    const parsed = parseNumber(rawValue);
    if (parsed !== null) {
      // Apply min/max bounds
      let bounded = parsed;
      if (min !== undefined) bounded = Math.max(min, bounded);
      if (max !== undefined) bounded = Math.min(max, bounded);
      // Apply step snapping
      if (step > 0) {
        bounded = Math.round(bounded / step) * step;
      }
      onValueChange?.(bounded);
    } else {
      onValueChange?.(null);
    }
  };

  const handleBlur = (e: React.FocusEvent<HTMLInputElement>) => {
    setIsFocused(false);
    // Re-format on blur if valid
    const parsed = parseNumber(localValue);
    if (parsed !== null && onValueChange) {
      let bounded = parsed;
      if (min !== undefined) bounded = Math.max(min, bounded);
      if (max !== undefined) bounded = Math.min(max, bounded);
      if (step > 0) {
        bounded = Math.round(bounded / step) * step;
      }
      setLocalValue(formatNumber(bounded, precision, currency, locale));
    }
    onBlur?.(e);
  };

  const handleFocus = (e: React.FocusEvent<HTMLInputElement>) => {
    setIsFocused(true);
    // Show raw number on focus for editing
    if (value !== undefined && value !== null) {
      const raw = currency
        ? value.toFixed(precision ?? 2)
        : value.toString();
      setLocalValue(raw);
    }
    onFocus?.(e);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault();
      const current = parseNumber(localValue) ?? (value ?? 0);
      const delta = e.key === 'ArrowUp' ? step : -step;
      let newValue = current + delta;
      if (min !== undefined) newValue = Math.max(min, newValue);
      if (max !== undefined) newValue = Math.min(max, newValue);
      const formatted = formatNumber(newValue, precision, currency, locale);
      setLocalValue(formatted);
      onValueChange?.(newValue);
    }
  };

  return (
    <div className={cn('mw-ui-number-input-field', className)} data-slot='number-input'>
      {label && (
        <label className='mw-ui-field-label' htmlFor={inputId}>
          {label}
          {required && <span className='mw-ui-field-required' aria-hidden='true'>*</span>}
        </label>
      )}
      <div className='mw-ui-number-input-wrapper relative'>
        {currency && (
          <span className='mw-ui-number-input-prefix absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none' aria-hidden='true'>
            {new Intl.NumberFormat(locale, { style: 'currency', currency, minimumFractionDigits: 0 }).format(0).replace(/[0-9.,]+/, '').trim()}
          </span>
        )}
        <input
          id={inputId}
          name={name}
          type='text'
          value={localValue}
          onChange={handleChange}
          onBlur={handleBlur}
          onFocus={handleFocus}
          onKeyDown={handleKeyDown}
          disabled={disabled}
          required={required}
          placeholder={placeholder}
          aria-invalid={!!error}
          aria-describedby={cn(error && errorId, description && descriptionId)}
          className={cn(
            'mw-ui-input mw-ui-number-input',
            currency && 'pl-8',
            disabled && 'mw-ui-number-input--disabled',
            error && 'mw-ui-number-input--invalid'
          )}
          {...props}
        />
        {!disabled && step > 0 && (
          <div className='mw-ui-number-input-stepper absolute right-2 top-1/2 -translate-y-1/2 flex flex-col' aria-hidden='true'>
            <button
              type='button'
              tabIndex={-1}
              onMouseDown={(e) => {
                e.preventDefault();
                const current = parseNumber(localValue) ?? (value ?? 0);
                let newValue = current + step;
                if (max !== undefined) newValue = Math.min(max, newValue);
                const formatted = formatNumber(newValue, precision, currency, locale);
                setLocalValue(formatted);
                onValueChange?.(newValue);
              }}
              className='mw-ui-number-input-step-btn p-1 text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus disabled:opacity-50'
              aria-label='Increment'
            >
              <svg className='size-3' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='2.5' strokeLinecap='round' strokeLinejoin='round' aria-hidden='true'>
                <path d='M12 5v14M19 12H5' />
              </svg>
            </button>
            <button
              type='button'
              tabIndex={-1}
              onMouseDown={(e) => {
                e.preventDefault();
                const current = parseNumber(localValue) ?? (value ?? 0);
                let newValue = current - step;
                if (min !== undefined) newValue = Math.max(min, newValue);
                const formatted = formatNumber(newValue, precision, currency, locale);
                setLocalValue(formatted);
                onValueChange?.(newValue);
              }}
              className='mw-ui-number-input-step-btn p-1 text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus disabled:opacity-50'
              aria-label='Decrement'
            >
              <svg className='size-3' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='2.5' strokeLinecap='round' strokeLinejoin='round' aria-hidden='true'>
                <path d='M5 12h14' />
              </svg>
            </button>
          </div>
        )}
      </div>
      {error && (
        <p id={errorId} className='mw-ui-field-error' role='alert' data-slot='number-input-error'>
          {error}
        </p>
      )}
      {description && !error && (
        <p id={descriptionId} className='mw-ui-field-description' data-slot='number-input-description'>
          {description}
        </p>
      )}
    </div>
  );
}

export { NumberInput };
