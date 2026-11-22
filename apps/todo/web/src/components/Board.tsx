// Board component - kanban columns with drag-and-drop

import { useRef, useState, useCallback, useEffect } from "react";
import { Button } from "@moonwitness/ui/components/button";
import { SortDescendingIcon as ChevronDownIcon, SortAscendingIcon as ChevronUpIcon, AddIcon as PlusIcon, FilterIcon, ArchiveIcon } from "@moonwitness/ui/icons";
import { Card } from "./Card";
import { statusColor, statusIcon, PROJECT_COLORS, type ProjectColor } from "../lib/colors";
import type { Task, Board } from "../types";
import { useBoard } from "../hooks/useBoard";
import { tr } from "../lib/i18n";

const STATUSES = ["backlog", "todo", "doing", "review", "done"] as const;
type Status = (typeof STATUSES)[number];

interface ColumnProps {
  status: Status;
  tasks: Task[];
  columnRef: React.RefObject<HTMLDivElement | null>;
  isCollapsed: boolean;
  onToggleCollapse: () => void;
  onAddTask: (status: Status) => void;
  selectedIds: number[];
  onSelect: (id: number, multi?: boolean) => void;
  onOpen: (id: number) => void;
  onOpenDoc?: (ref: string | { id?: number; slug?: string; path?: string; title?: string }) => void;
  onRefresh?: () => void;
  onMenu: (x: number, y: number, taskId: number) => void;
  onDragStart: (e: React.DragEvent, task: Task) => void;
  onDragEnd: (e: React.DragEvent) => void;
  onDrop: (e: React.DragEvent, targetTask: Task) => void;
  onDragOver: (e: React.DragEvent) => void;
  onDragLeave: (e: React.DragEvent) => void;
  onMoveTask: (taskId: number, status: string, position: number) => void;
  onDeleteTask: (taskId: number) => void;
}

function Column({
  status,
  tasks,
  columnRef,
  isCollapsed,
  onToggleCollapse,
  onAddTask,
  selectedIds,
  onSelect,
  onOpen,
  onOpenDoc,
  onRefresh,
  onMenu,
  onDragStart,
  onDragEnd,
  onDrop,
  onDragOver,
  onDragLeave,
  onMoveTask,
  onDeleteTask,
}: ColumnProps) {
  const statusColorVar = statusColor(status);
  const statusIconHtml = statusIcon(status);
  const count = tasks.length;

  return (
    <div
      ref={columnRef}
      className={`kanban-column ${isCollapsed ? "collapsed" : ""}`}
      data-status={status}
      style={{ "--status-color": statusColorVar } as React.CSSProperties}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={(e) => {
        e.preventDefault();
        onDrop(e, { id: 0, project: "", title: "", description: "", status, tags: [], human: true, url: null, waiting_on: [], created_at: "", updated_at: "" } as Task);
      }}
    >
      <div className="column-header">
        <div className="column-title-row">
          <div className="column-status" dangerouslySetInnerHTML={{ __html: statusIconHtml }} />
          <h2 className="column-title">{tr(status)}</h2>
          <span className="column-count">{count}</span>
        </div>
        <div className="column-actions">
          <button className="icon-btn" onClick={onToggleCollapse} aria-label={isCollapsed ? tr("Expand") : tr("Collapse")}>
            {isCollapsed ? <ChevronDownIcon className="h-4 w-4" /> : <ChevronUpIcon className="h-4 w-4" />}
          </button>
          <button className="icon-btn" onClick={() => onAddTask(status)} aria-label={tr("Add task to") + " " + tr(status)}>
            <PlusIcon className="h-4 w-4" />
          </button>
        </div>
      </div>

      {!isCollapsed && (
        <div className="column-content" onDragOver={onDragOver}>
          {tasks.map((task, index) => (
            <Card
              key={task.id}
              task={task}
              index={index}
              columnId={status}
              isSelected={selectedIds.includes(task.id)}
              onSelect={onSelect}
              onOpen={onOpen}
              onOpenDoc={onOpenDoc}
              onRefresh={onRefresh}
              onMenu={onMenu}
              onDragStart={onDragStart}
              onDragEnd={onDragEnd}
              onDrop={onDrop}
              onDragOver={onDragOver}
              onMoveTask={onMoveTask}
              onDeleteTask={onDeleteTask}
            />
          ))}
          {tasks.length === 0 && (
            <div className="column-empty">
              <p>{tr("No tasks")}</p>
              <button className="add-first-task" onClick={() => onAddTask(status)}>
                <PlusIcon className="h-4 w-4 mr-1" />
                {tr("Add task")}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

interface BoardProps {
  board: Board | null;
  project: string;
  on: "local" | "shared";
  selectedIds: number[];
  onSelect: (id: number, multi?: boolean) => void;
  onOpen: (id: number) => void;
  onOpenDoc?: (ref: string | { id?: number; slug?: string; path?: string; title?: string }) => void;
  onRefresh?: () => void;
  onMenu: (x: number, y: number, taskId: number) => void;
  onNewTask: (status: string) => void;
  collapsedColumns: Set<string>;
  onToggleCollapse: (status: string) => void;
  searchQuery: string;
  onMoveTask: (taskId: number, status: string, position: number) => void;
  onDeleteTask: (taskId: number) => void;
}

export function Board({
  board,
  project,
  on,
  selectedIds,
  onSelect,
  onOpen,
  onOpenDoc,
  onRefresh,
  onMenu,
  onNewTask,
  collapsedColumns,
  onToggleCollapse,
  searchQuery,
  onMoveTask,
  onDeleteTask,
}: BoardProps) {
  const columnRefs = useRef<Record<Status, React.RefObject<HTMLDivElement | null>>>({
    backlog: { current: null },
    todo: { current: null },
    doing: { current: null },
    review: { current: null },
    done: { current: null },
  });

  const [dragOverColumn, setDragOverColumn] = useState<Status | null>(null);
  const draggedTask = useRef<Task | null>(null);
  const setDraggedTask = (t: Task | null) => { draggedTask.current = t; };

  const tasksByStatus = useCallback(() => {
    if (!board) return {} as Record<Status, Task[]>;
    const result: Record<Status, Task[]> = {
      backlog: [],
      todo: [],
      doing: [],
      review: [],
      done: [],
    };
    for (const task of board.tasks) {
      const status = task.status as Status;
      if (result[status]) {
        result[status].push(task);
      }
    }
    return result;
  }, [board]);

  const handleDragStart = useCallback((e: React.DragEvent, task: Task) => {
    setDraggedTask(task);
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", String(task.id));
    // Add a small delay to allow the drag image to be set
    setTimeout(() => {
      const target = e.currentTarget as HTMLElement;
      target.classList.add("dragging");
    }, 0);
  }, []);

  const handleDragEnd = useCallback((e: React.DragEvent) => {
    const target = e.currentTarget as HTMLElement;
    target.classList.remove("dragging");
    setDraggedTask(null);
    setDragOverColumn(null);
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    // Only clear if leaving the column entirely
    const related = e.relatedTarget as HTMLElement;
    if (!related || !e.currentTarget.contains(related)) {
      setDragOverColumn(null);
    }
  }, []);

  const handleDrop = useCallback(async (e: React.DragEvent, targetTask: Task) => {
    e.preventDefault();
    const taskId = Number(e.dataTransfer.getData("text/plain"));
    if (!taskId || !draggedTask.current) return;

    const columnStatus = (e.currentTarget as HTMLElement).dataset.status as Status;
    if (!columnStatus) return;

    // Calculate position based on drop target
    const tasks = tasksByStatus()[columnStatus] || [];
    let position = tasks.length;
    if (targetTask.id) {
      position = tasks.findIndex((t) => t.id === targetTask.id);
      if (position === -1) position = tasks.length;
    }

    // Call the move API
    try {
      await fetch(`/api/tasks/${taskId}/move`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: columnStatus, position }),
      });
      // Board will refresh via polling
    } catch (err) {
      console.error("Failed to move task:", err);
    }

    setDraggedTask(null);
    setDragOverColumn(null);
  }, [tasksByStatus]);

  const tasks = tasksByStatus();

  return (
    <div className="kanban-board" role="main">
      {STATUSES.map((status) => (
        <Column
          key={status}
          status={status}
          tasks={tasks[status] || []}
          columnRef={columnRefs.current[status]}
          isCollapsed={collapsedColumns.has(status)}
          onToggleCollapse={() => onToggleCollapse(status)}
          onAddTask={onNewTask}
          selectedIds={selectedIds}
          onSelect={onSelect}
          onOpen={onOpen}
          onOpenDoc={onOpenDoc}
          onRefresh={onRefresh}
          onMenu={onMenu}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
          onDrop={handleDrop}
          onDragOver={(e) => {
            handleDragOver(e);
            setDragOverColumn(status);
          }}
          onDragLeave={handleDragLeave}
          onMoveTask={(taskId, _direction, position) => onMoveTask(taskId, status, position)}
          onDeleteTask={(taskId) => {
            onDeleteTask(taskId);
          }}
        />
      ))}
    </div>
  );
}