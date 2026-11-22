import { useId, type KeyboardEvent } from 'react';
import { cn } from '../lib/cn.js';

export type TagInputProps = {
  id?: string;
  name?: string;
  label: string;
  value: readonly string[];
  onValueChange: (value: string[]) => void;
  placeholder?: string;
  maxTags?: number;
  required?: boolean;
  disabled?: boolean;
  invalid?: boolean;
  error?: string;
  description?: string;
  className?: string;
};

function removeTag(tags: readonly string[], index: number) {
  return tags.filter((_, tagIndex) => tagIndex !== index);
}

export function TagInput({
  id: providedId,
  name,
  label,
  value,
  onValueChange,
  placeholder,
  maxTags,
  required = false,
  disabled = false,
  invalid = false,
  error,
  description,
  className,
}: TagInputProps) {
  const generatedId = useId();
  const id = providedId ?? generatedId;
  const descriptionId = description ? `${id}-description` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [descriptionId, errorId].filter(Boolean).join(' ') || undefined;
  const invalidState = invalid || Boolean(error);
  const atLimit = maxTags !== undefined && value.length >= maxTags;

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter' || event.key === ',') {
      event.preventDefault();
      const rawValue = event.currentTarget.value.trim();
      if (!rawValue || atLimit || value.includes(rawValue)) return;
      onValueChange?.([...value, rawValue]);
      event.currentTarget.value = '';
      return;
    }
    if (event.key === 'Backspace' && event.currentTarget.value === '' && value.length > 0) {
      event.preventDefault();
      onValueChange?.(removeTag(value, value.length - 1));
    }
  };

  return (
    <div className={cn('mw-ui-field', className)} data-slot="tag-input">
      <label className="mw-ui-field-label" htmlFor={id}>
        {label}
        {required ? <span aria-hidden="true"> *</span> : null}
      </label>
      <div className="mw-ui-tag-input">
        <ul className="mw-ui-tag-list">
          {value.map((tag, index) => (
            <li className="mw-ui-tag" key={tag}>
              <span>{tag}</span>
              <button
                aria-label={`Remove ${tag}`}
                className="mw-ui-tag-remove"
                disabled={disabled}
                onClick={() => onValueChange?.(removeTag(value, index))}
                type="button"
              >
                ×
              </button>
            </li>
          ))}
        </ul>
        <input
          aria-describedby={describedBy}
          aria-invalid={invalidState ? true : undefined}
          aria-required={required ? true : undefined}
          className="mw-ui-input"
          data-empty={value.length === 0}
          disabled={disabled || atLimit}
          id={id}
          name={name}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          type="text"
        />
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
