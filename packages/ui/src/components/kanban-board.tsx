import type { ComponentProps, ReactNode } from 'react';
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
};

export function KanbanBoard({ columns, className, onCardAction, ...props }: KanbanBoardProps) {
  return (
    <div className={cn('mw-ui-kanban', className)} data-slot="kanban-board" {...props}>
      {columns.map((column) => (
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
                  className="mw-ui-kanban-card"
                  data-slot="kanban-card"
                  key={card.id}
                  onClick={() => onCardAction?.(card.id, column.id)}
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
