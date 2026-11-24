import { useId, type ComponentProps } from 'react';

export type TableProps = ComponentProps<'table'> & {
  scrollLabel?: string;
  density?: 'comfortable' | 'compact';
};
export type TableCaptionProps = ComponentProps<'caption'>;
export type TableHeadProps = ComponentProps<'thead'>;
export type TableBodyProps = ComponentProps<'tbody'>;
export type TableRowProps = ComponentProps<'tr'>;
export type TableHeaderProps = ComponentProps<'th'>;
export type TableCellProps = ComponentProps<'td'>;
export type TableFooterProps = ComponentProps<'tfoot'>;
export type TableSummaryCellProps = ComponentProps<'td'> & {
  /** Aggregation type for the summary cell */
  aggregate?: 'sum' | 'avg' | 'count' | 'min' | 'max' | 'custom';
  /** Custom value for 'custom' aggregate */
  customValue?: React.ReactNode;
};

export function Table({ className, scrollLabel, density = 'comfortable', ...props }: TableProps) {
  const instructionsId = useId();
  return (
    <div
      className="mw-ui-table-wrap"
      data-slot="table-wrap"
      role={scrollLabel ? 'region' : undefined}
      aria-label={scrollLabel}
      aria-describedby={scrollLabel ? instructionsId : undefined}
      tabIndex={scrollLabel ? 0 : undefined}
      onKeyDown={
        scrollLabel
          ? (event) => {
              if (event.target !== event.currentTarget) return;

              const { currentTarget, key } = event;
              if (key === 'ArrowLeft' || key === 'ArrowRight') {
                event.preventDefault();
                currentTarget.scrollBy({
                  left:
                    (key === 'ArrowLeft' ? -1 : 1) * Math.max(48, currentTarget.clientWidth * 0.8),
                  behavior: 'auto',
                });
              } else if (key === 'Home' || key === 'End') {
                event.preventDefault();
                currentTarget.scrollTo({
                  left: key === 'Home' ? 0 : currentTarget.scrollWidth,
                  behavior: 'auto',
                });
              }
            }
          : undefined
      }
    >
      {scrollLabel ? (
        <span className="mw-ui-visually-hidden" id={instructionsId}>
          Use Left and Right Arrow to scroll horizontally, or Home and End to jump to the start or
          end.
        </span>
      ) : null}
      <table
        data-density={density}
        className={['mw-ui-table', className].filter(Boolean).join(' ')}
        {...props}
      />
    </div>
  );
}

export function TableCaption({ className, ...props }: TableCaptionProps) {
  return (
    <caption className={['mw-ui-table-caption', className].filter(Boolean).join(' ')} {...props} />
  );
}

export function TableHead({ className, ...props }: TableHeadProps) {
  return <thead className={['mw-ui-table-head', className].filter(Boolean).join(' ')} {...props} />;
}

export function TableBody({ className, ...props }: TableBodyProps) {
  return <tbody className={['mw-ui-table-body', className].filter(Boolean).join(' ')} {...props} />;
}

export function TableRow({ className, ...props }: TableRowProps) {
  return <tr className={['mw-ui-table-row', className].filter(Boolean).join(' ')} {...props} />;
}

export function TableHeader({ className, ...props }: TableHeaderProps) {
  return <th className={['mw-ui-table-header', className].filter(Boolean).join(' ')} {...props} />;
}

export function TableCell({ className, ...props }: TableCellProps) {
  return <td className={['mw-ui-table-cell', className].filter(Boolean).join(' ')} {...props} />;
}

export function TableFooter({ className, ...props }: TableFooterProps) {
  return (
    <tfoot className={['mw-ui-table-footer', className].filter(Boolean).join(' ')} {...props} />
  );
}

export function TableSummaryCell({
  className,
  aggregate,
  customValue,
  ...props
}: TableSummaryCellProps) {
  const cellClassName = ['mw-ui-table-summary-cell', className].filter(Boolean).join(' ');
  if (aggregate === 'custom') {
    return (
      <td className={cellClassName} {...props}>
        {customValue}
      </td>
    );
  }
  return (
    <td className={cellClassName} data-aggregate={aggregate} {...props}>
      {aggregate === 'sum' && <span className="mw-ui-table-aggregate-label">Sum:</span>}
      {aggregate === 'avg' && <span className="mw-ui-table-aggregate-label">Avg:</span>}
      {aggregate === 'count' && <span className="mw-ui-table-aggregate-label">Count:</span>}
      {aggregate === 'min' && <span className="mw-ui-table-aggregate-label">Min:</span>}
      {aggregate === 'max' && <span className="mw-ui-table-aggregate-label">Max:</span>}
      <span className="mw-ui-table-aggregate-value">{props.children}</span>
    </td>
  );
}
