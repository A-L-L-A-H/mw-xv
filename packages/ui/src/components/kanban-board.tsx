import type { ComponentProps, KeyboardEvent, ReactNode } from 'react';
import { cn } from '../lib/cn.js';

export type KanbanCard = {
  id: string;
  title: string;
  detail?: string;
};

export type KanbanColumn = {
  id: string;
  title: string;
  count?: number;
  emptyState?: ReactNode;
  cards?: readonly KanbanCard[];
};

export type KanbanBoardProps = Omit<ComponentProps<'div'>, 'children'> & {
  columns: readonly KanbanColumn[];
  onCardAction?: (cardId: string, columnId: string) => void;
  onCardMove?: (cardId: string, fromColumnId: string, toColumnId: string) => void;
};

export function KanbanBoard({
  columns,
  className,
  onCardAction,
  onCardMove,
  ...props
}: KanbanBoardProps) {
  const handleCardKeyDown = (
    event: KeyboardEvent<HTMLButtonElement>,
    cardId: string,
    columnIndex: number,
    columnId: string
  ) => {
    if (!onCardMove) return;
    if (event.key === 'ArrowLeft' && columnIndex > 0) {
      event.preventDefault();
      onCardMove(cardId, columnId, columns[columnIndex - 1].id);
    } else if (event.key === 'ArrowRight' && columnIndex < columns.length - 1) {
      event.preventDefault();
      onCardMove(cardId, columnId, columns[columnIndex + 1].id);
    }
  };

  return (
    <div className={cn('mw-ui-kanban', className)} data-slot="kanban-board" {...props}>
      {columns.map((column, columnIndex) => (
        <section aria-label={column.title} className="mw-ui-kanban-column" key={column.id}>
          <header className="mw-ui-kanban-column-header">
            <h3 className="mw-ui-kanban-column-title">{column.title}</h3>
            {column.count !== undefined ? (
              <span className="mw-ui-kanban-column-count">{column.count}</span>
            ) : null}
          </header>
          <div className="mw-ui-kanban-column-body">
            {column.cards?.length ? (
              column.cards.map((card) => (
                <button
                  aria-keyshortcuts={onCardMove ? 'ArrowLeft ArrowRight' : undefined}
                  className="mw-ui-kanban-card"
                  data-slot="kanban-card"
                  key={card.id}
                  onClick={() => onCardAction?.(card.id, column.id)}
                  onKeyDown={(event) => handleCardKeyDown(event, card.id, columnIndex, column.id)}
                  type="button"
                >
                  <span className="mw-ui-kanban-card-title">{card.title}</span>
                  {card.detail ? (
                    <span className="mw-ui-kanban-card-detail">{card.detail}</span>
                  ) : null}
                </button>
              ))
            ) : (
              <div className="mw-ui-kanban-empty">{column.emptyState ?? 'No records'}</div>
            )}
          </div>
        </section>
      ))}
    </div>
  );
}
