import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
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
  const atLimit = maxTags !== undefined && value.length >= maxTags;
  const limitId = atLimit ? `${id}-limit` : undefined;
  const invalidState = invalid || Boolean(error);
  const [draft, setDraft] = useState('');
  const draftRef = useRef<HTMLInputElement>(null);
  const composingRef = useRef(false);
  const instructionsId = `${id}-instructions`;
  const describedBy = [descriptionId, errorId, limitId, instructionsId].filter(Boolean).join(' ');

  useEffect(() => {
    const draftInput = draftRef.current;
    if (!draftInput) return;
    draftInput.setCustomValidity(
      error ?? (required && value.length === 0 ? 'Add at least one tag.' : '')
    );
  }, [error, required, value.length]);

  const commitDraft = () => {
    const rawValue = draft.trim();
    if (!rawValue || atLimit || value.includes(rawValue)) return;
    onValueChange([...value, rawValue]);
    setDraft('');
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (composingRef.current || event.nativeEvent.isComposing || event.keyCode === 229) return;
    if (event.key === 'Enter' || event.key === ',') {
      event.preventDefault();
      commitDraft();
      return;
    }
    if (event.key === 'Backspace' && draft === '' && value.length > 0) {
      event.preventDefault();
      onValueChange(removeTag(value, value.length - 1));
    }
  };

  return (
    <div className={cn('mw-ui-field', className)} data-slot="tag-input">
      <label className="mw-ui-field-label" htmlFor={id}>
        {label}
        {required ? <span aria-hidden="true"> *</span> : null}
      </label>
      <div className="mw-ui-tag-input">
        {value.map((tag, index) => (
          <input
            key={`${tag}-${index}`}
            disabled={disabled}
            name={name}
            type="hidden"
            value={tag}
          />
        ))}
        <ul className="mw-ui-tag-list">
          {value.map((tag, index) => (
            <li className="mw-ui-tag" key={`${tag}-${index}`}>
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
          aria-disabled={atLimit ? true : undefined}
          className="mw-ui-input"
          data-empty={value.length === 0}
          disabled={disabled}
          id={id}
          onChange={(event) => setDraft(event.target.value)}
          onCompositionEnd={(event) => {
            composingRef.current = false;
            setDraft(event.currentTarget.value);
          }}
          onCompositionStart={() => {
            composingRef.current = true;
          }}
          onKeyDown={handleKeyDown}
          placeholder={atLimit ? 'Maximum tags reached' : placeholder}
          readOnly={atLimit}
          ref={draftRef}
          type="text"
          value={draft}
        />
      </div>
      <span className="mw-ui-visually-hidden" id={instructionsId}>
        Press Enter or comma to add a tag. Text that has not been added as a tag will not be
        submitted.
      </span>
      {atLimit ? (
        <span className="mw-ui-visually-hidden" id={limitId}>
          Maximum {maxTags} tags reached.
        </span>
      ) : null}
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
