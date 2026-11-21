'use client';

import * as React from 'react';
import { cn } from '../lib/cn.js';
import { Button } from './button.js';
import { X } from './icons/x.js';

export interface TagInputProps
  extends Omit<React.ComponentProps<'div'>, 'onChange'> {
  /** Current tags array */
  value?: string[];
  /** Callback when tags change */
  onValueChange?: (tags: string[]) => void;
  /** Maximum number of tags allowed */
  maxTags?: number;
  /** Whether duplicate tags are allowed */
  allowDuplicates?: boolean;
  /** Custom tag validation function */
  validateTag?: (tag: string) => boolean | string;
  /** Placeholder for the input */
  placeholder?: string;
  /** Error message to display */
  error?: string;
  /** Label for the field */
  label?: string;
  /** Helper text */
  description?: string;
  /** Whether the field is disabled */
  disabled?: boolean;
  /** Whether the field is required */
  required?: boolean;
  /** Input name attribute (for hidden input) */
  name?: string;
}

function TagInput({
  className,
  value = [],
  onValueChange,
  maxTags,
  allowDuplicates = false,
  validateTag,
  placeholder = 'Add tag...',
  error,
  label,
  description,
  disabled,
  required,
  name,
  id: providedId,
  ...props
}: TagInputProps) {
  const inputId = providedId || React.useId();
  const errorId = React.useId();
  const descriptionId = React.useId();
  const [inputValue, setInputValue] = React.useState('');
  const [inputFocused, setInputFocused] = React.useState(false);
  const inputRef = React.useRef<HTMLInputElement>(null);

  const tags = value || [];

  const isTagValid = (tag: string): boolean => {
    const trimmed = tag.trim();
    if (!trimmed) return false;
    if (!allowDuplicates && tags.includes(trimmed)) return false;
    if (maxTags !== undefined && tags.length >= maxTags) return false;
    if (validateTag) {
      const result = validateTag(trimmed);
      return result === true;
    }
    return true;
  };

  const addTag = (tag: string) => {
    const trimmed = tag.trim();
    if (!isTagValid(trimmed)) return;
    onValueChange?.([...tags, trimmed]);
    setInputValue('');
  };

  const removeTag = (tagToRemove: string) => {
    onValueChange?.(tags.filter((t) => t !== tagToRemove));
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      if (inputValue.trim()) {
        addTag(inputValue);
      }
    } else if (e.key === 'Backspace' && !inputValue && tags.length > 0) {
      // Remove last tag on backspace when input is empty
      removeTag(tags[tags.length - 1]);
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setInputValue(e.target.value);
  };

  const handlePaste = (e: React.ClipboardEvent<HTMLInputElement>) => {
    e.preventDefault();
    const text = e.clipboardData.getData('text');
    const pastedTags = text
      .split(/[,;\n]/)
      .map((t) => t.trim())
      .filter(Boolean);
    pastedTags.forEach((tag) => {
      if (isTagValid(tag)) {
        addTag(tag);
      }
    });
  };

  const handleFocus = () => setInputFocused(true);
  const handleBlur = () => {
    setInputFocused(false);
    if (inputValue.trim()) {
      addTag(inputValue);
    }
  };

  return (
    <div className={cn('mw-ui-tag-input-field', className)} data-slot='tag-input' {...props}>
      {label && (
        <label className='mw-ui-field-label' htmlFor={inputId}>
          {label}
          {required && <span className='mw-ui-field-required' aria-hidden='true'>*</span>}
        </label>
      )}
      <div
        className={cn(
          'mw-ui-tag-input-wrapper relative flex flex-wrap items-center gap-1.5',
          'mw-ui-input',
          'min-h-[2.5rem]',
          inputFocused && 'mw-ui-tag-input-wrapper--focused',
          error && 'mw-ui-tag-input-wrapper--invalid',
          disabled && 'mw-ui-tag-input-wrapper--disabled'
        )}
        onClick={() => !disabled && inputRef.current?.focus()}
        role='group'
        aria-label={label}
        aria-invalid={!!error}
        aria-describedby={cn(error && errorId, description && descriptionId)}
      >
        {tags.map((tag, index) => (
          <span key={index} className='mw-ui-tag-input-tag inline-flex items-center gap-1.5 px-2 py-0.5 text-sm font-medium bg-muted text-foreground border border-border' data-slot='tag-input-tag'>
            <span>{tag}</span>
            {!disabled && (
              <Button
                type='button'
                variant='ghost'
                size='icon-xs'
                onClick={(e) => {
                  e.stopPropagation();
                  removeTag(tag);
                }}
                aria-label={Remove tag: }
                className='mw-ui-tag-input-tag-remove p-0.5 text-muted-foreground hover:text-destructive'
              >
                <X className='size-3' aria-hidden='true' />
              </Button>
            )}
          </span>
        ))}
        <input
          ref={inputRef}
          id={inputId}
          type='text'
          value={inputValue}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          onFocus={handleFocus}
          onBlur={handleBlur}
          onPaste={handlePaste}
          placeholder={tags.length > 0 && maxTags !== undefined && tags.length >= maxTags ? undefined : placeholder}
          disabled={disabled || (maxTags !== undefined && tags.length >= maxTags)}
          required={required && tags.length === 0}
          aria-invalid={!!error}
          aria-describedby={cn(error && errorId, description && descriptionId)}
          className={cn(
            'mw-ui-tag-input-input flex-1 min-w-[80px] bg-transparent border-0 outline-none text-sm',
            'placeholder:text-muted-foreground',
            disabled && 'pointer-events-none opacity-50'
          )}
          style={{ minWidth: '80px' }}
        />
        {name && (
          <input
            type='hidden'
            name={name}
            value={tags.join(',')}
            readOnly
          />
        )}
      </div>
      {error && (
        <p id={errorId} className='mw-ui-field-error' role='alert' data-slot='tag-input-error'>
          {error}
        </p>
      )}
      {description && !error && (
        <p id={descriptionId} className='mw-ui-field-description' data-slot='tag-input-description'>
          {description}
        </p>
      )}
    </div>
  );
}

export { TagInput };
