'use client';

import * as React from 'react';
import { cn } from '../lib/cn.js';
import { DatePicker as DatePickerPrimitive } from 'radix-ui';

type DateValue = DatePickerPrimitive.DateValue;
type DateRange = DatePickerPrimitive.DateRange;

export interface DatePickerProps
  extends React.ComponentProps<typeof DatePickerPrimitive.Root> {
  /** Whether to show time selection (datetime mode) */
  includeTime?: boolean;
  /** Error message to display */
  error?: string;
  /** Label for the field */
  label?: string;
  /** Helper text */
  description?: string;
}

function DatePicker({
  className,
  includeTime = false,
  error,
  label,
  description,
  placeholder,
  disabled,
  required,
  name,
  value,
  onValueChange,
  ...props
}: DatePickerProps) {
  const errorId = React.useId();
  const descriptionId = React.useId();

  return (
    <div className={cn('mw-ui-date-picker-field', className)} data-slot='date-picker'>
      {label && (
        <label className='mw-ui-field-label' htmlFor={name}>
          {label}
          {required && <span className='mw-ui-field-required' aria-hidden='true'>*</span>}
        </label>
      )}
      <DatePickerPrimitive.Root
        data-slot='date-picker-root'
        {...props}
        disabled={disabled}
        required={required}
      >
        <DatePickerPrimitive.Field>
          <DatePickerPrimitive.Input
            data-slot='date-picker-input'
            placeholder={placeholder}
            name={name}
            value={value}
            onValueChange={onValueChange}
            disabled={disabled}
            required={required}
            aria-invalid={!!error}
            aria-describedby={cn(error && errorId, description && descriptionId)}
            className={cn(
              'mw-ui-input',
              'mw-ui-date-picker-input',
              disabled && 'mw-ui-date-picker-input--disabled',
              error && 'mw-ui-date-picker-input--invalid'
            )}
          />
        </DatePickerPrimitive.Field>
        <DatePickerPrimitive.Trigger
          data-slot='date-picker-trigger'
          className={cn(
            'mw-ui-date-picker-trigger absolute inset-y-0 right-0 flex items-center justify-center px-3 text-muted-foreground',
            'hover:text-foreground',
            disabled && 'pointer-events-none opacity-50'
          )}
          aria-label={includeTime ? 'Open date and time picker' : 'Open date picker'}
        >
          <svg
            className='mw-ui-date-picker-icon size-5'
            viewBox='0 0 24 24'
            fill='none'
            stroke='currentColor'
            strokeWidth='2'
            strokeLinecap='round'
            strokeLinejoin='round'
            aria-hidden='true'
          >
            <rect x='3' y='4' width='18' height='18' rx='2' ry='2' />
            <line x1='16' y1='2' x2='16' y2='6' />
            <line x1='8' y1='2' x2='8' y2='6' />
            <line x1='3' y1='10' x2='21' y2='10' />
          </svg>
        </DatePickerPrimitive.Trigger>
        <DatePickerPrimitive.Portal>
          <DatePickerPrimitive.Content
            data-slot='date-picker-content'
            className={cn(
              'mw-ui-popover-content z-50 w-auto origin-(--radix-popover-content-transform-origin) rounded-none border-2 border-ink bg-card p-3 text-ink shadow-[4px_4px_0_0_var(--ink)] outline-hidden data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95',
              includeTime && 'mw-ui-date-picker-content--with-time'
            )}
            {...props}
          >
            <DatePickerPrimitive.View>
              <DatePickerPrimitive.Heading>
                <DatePickerPrimitive.PrevButton
                  data-slot='date-picker-prev'
                  className={cn(
                    'mw-ui-date-picker-nav-btn p-1 text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus',
                    'disabled:opacity-50 disabled:pointer-events-none'
                  )}
                  aria-label='Previous month'
                >
                  <svg className='size-4' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='2' strokeLinecap='round' strokeLinejoin='round' aria-hidden='true'>
                    <path d='m15 18-6-6 6-6' />
                  </svg>
                </DatePickerPrimitive.PrevButton>
                <DatePickerPrimitive.Caption
                  data-slot='date-picker-caption'
                  className='mw-ui-date-picker-caption text-center font-medium'
                />
                <DatePickerPrimitive.NextButton
                  data-slot='date-picker-next'
                  className={cn(
                    'mw-ui-date-picker-nav-btn p-1 text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus',
                    'disabled:opacity-50 disabled:pointer-events-none'
                  )}
                  aria-label='Next month'
                >
                  <svg className='size-4' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='2' strokeLinecap='round' strokeLinejoin='round' aria-hidden='true'>
                    <path d='m9 6 6 6-6 6' />
                  </svg>
                </DatePickerPrimitive.NextButton>
              </DatePickerPrimitive.Heading>
              <DatePickerPrimitive.Table
                data-slot='date-picker-table'
                className='mw-ui-date-picker-table'
              >
                <DatePickerPrimitive.HeaderRow
                  data-slot='date-picker-header-row'
                  className='mw-ui-date-picker-header-row'
                >
                  <DatePickerPrimitive.Head
                    data-slot='date-picker-head'
                    className='mw-ui-date-picker-head text-center text-xs text-muted-foreground font-medium'
                    dayOfWeek={0}
                  >
                    Su
                  </DatePickerPrimitive.Head>
                  <DatePickerPrimitive.Head
                    data-slot='date-picker-head'
                    className='mw-ui-date-picker-head text-center text-xs text-muted-foreground font-medium'
                    dayOfWeek={1}
                  >
                    Mo
                  </DatePickerPrimitive.Head>
                  <DatePickerPrimitive.Head
                    data-slot='date-picker-head'
                    className='mw-ui-date-picker-head text-center text-xs text-muted-foreground font-medium'
                    dayOfWeek={2}
                  >
                    Tu
                  </DatePickerPrimitive.Head>
                  <DatePickerPrimitive.Head
                    data-slot='date-picker-head'
                    className='mw-ui-date-picker-head text-center text-xs text-muted-foreground font-medium'
                    dayOfWeek={3}
                  >
                    We
                  </DatePickerPrimitive.Head>
                  <DatePickerPrimitive.Head
                    data-slot='date-picker-head'
                    className='mw-ui-date-picker-head text-center text-xs text-muted-foreground font-medium'
                    dayOfWeek={4}
                  >
                    Th
                  </DatePickerPrimitive.Head>
                  <DatePickerPrimitive.Head
                    data-slot='date-picker-head'
                    className='mw-ui-date-picker-head text-center text-xs text-muted-foreground font-medium'
                    dayOfWeek={5}
                  >
                    Fr
                  </DatePickerPrimitive.Head>
                  <DatePickerPrimitive.Head
                    data-slot='date-picker-head'
                    className='mw-ui-date-picker-head text-center text-xs text-muted-foreground font-medium'
                    dayOfWeek={6}
                  >
                    Sa
                  </DatePickerPrimitive.Head>
                </DatePickerPrimitive.HeaderRow>
                <DatePickerPrimitive.Row
                  data-slot='date-picker-row'
                  className='mw-ui-date-picker-row'
                >
                  <DatePickerPrimitive.Cell
                    data-slot='date-picker-cell'
                    className='mw-ui-date-picker-cell relative flex h-9 w-9 items-center justify-center text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus'
                  >
                    <DatePickerPrimitive.DayButton
                      data-slot='date-picker-day'
                      className={cn(
                        'mw-ui-date-picker-day w-full h-full rounded-none font-medium transition-colors',
                        'data-[selected]:bg-primary data-[selected]:text-primary-foreground',
                        'data-[today]:ring-2 data-[today]:ring-primary',
                        'data-[outside-view]:text-muted-foreground/50',
                        'data-[disabled]:opacity-50 data-[disabled]:pointer-events-none',
                        'hover:not([data-disabled]):bg-accent hover:not([data-disabled]):text-accent-foreground',
                        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus'
                      )}
                    />
                  </DatePickerPrimitive.Cell>
                </DatePickerPrimitive.Row>
              </DatePickerPrimitive.Table>
            </DatePickerPrimitive.View>
            {includeTime && (
              <div data-slot='date-picker-time' className='mw-ui-date-picker-time mt-3 border-t border-border pt-3'>
                <div className='flex items-center gap-2'>
                  <span className='text-xs font-medium text-muted-foreground'>Time</span>
                  <DatePickerPrimitive.TimeField
                    data-slot='date-picker-time-field'
                    className='flex-1'
                  >
                    <DatePickerPrimitive.HourField
                      data-slot='date-picker-hour'
                      className='flex items-center gap-1'
                    >
                      <label htmlFor='hour' className='text-xs text-muted-foreground'>
                        Hour
                      </label>
                      <DatePickerPrimitive.HourInput
                        data-slot='date-picker-hour-input'
                        id='hour'
                        className='mw-ui-input w-16 text-center'
                        placeholder='HH'
                      />
                    </DatePickerPrimitive.HourField>
                    <span className='text-muted-foreground'>:</span>
                    <DatePickerPrimitive.MinuteField
                      data-slot='date-picker-minute'
                      className='flex items-center gap-1'
                    >
                      <label htmlFor='minute' className='text-xs text-muted-foreground'>
                        Min
                      </label>
                      <DatePickerPrimitive.MinuteInput
                        data-slot='date-picker-minute-input'
                        id='minute'
                        className='mw-ui-input w-16 text-center'
                        placeholder='MM'
                      />
                    </DatePickerPrimitive.MinuteField>
                  </DatePickerPrimitive.TimeField>
                </div>
              </div>
            )}
          </DatePickerPrimitive.Content>
        </DatePickerPrimitive.Portal>
      </DatePickerPrimitive.Root>
      {error && (
        <p id={errorId} className='mw-ui-field-error' role='alert' data-slot='date-picker-error'>
          {error}
        </p>
      )}
      {description && !error && (
        <p id={descriptionId} className='mw-ui-field-description' data-slot='date-picker-description'>
          {description}
        </p>
      )}
    </div>
  );
}

export { DatePicker };
