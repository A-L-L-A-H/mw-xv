// Task Card component - renders a single task in a kanban column

import { useRef, useEffect, useState } from "react";
import { Button } from "@moonwitness/ui/components/button";
import { Popover, PopoverContent, PopoverTrigger } from "@moonwitness/ui/components/popover";
import {
  CheckSquareIcon,
  TagIcon,
  UserIcon,
  ClockIcon,
  WarningIcon,
  ChevronRightIcon,
  MenuIcon,
  ExternalLinkIcon,
  DeleteIcon,
  EditIcon,
  DownloadIcon,
  ArrowRightIcon,
  ArrowLeftIcon,
  BookOpenIcon,
  StoryIcon,
  SecurityIcon,
  ClockIcon as ClockIcon2,
  MessageIcon,
  CloseIcon,
} from "@moonwitness/ui/icons";
import { statusColor, statusIcon, PROJECT_COLORS, type ProjectColor } from "../lib/colors";
import { markdown, plainText } from "../lib/markdown";
import { ago } from "../lib/time";
import type { Task } from "../types";
import { toggleChecklist } from "../api";
import { tr } from "../lib/i18n";

interface CardProps {
  task: Task;
  index: number;
  columnId: string;
  isSelected: boolean;
  onSelect: (id: number, multi?: boolean) => void;
  onOpen: (id: number) => void;
  onOpenDoc?: (ref: string | { id?: number; slug?: string; path?: string; title?: string }) => void;
  onRefresh?: () => void;
  onMenu: (x: number, y: number, taskId: number) => void;
  onDragStart: (e: React.DragEvent, task: Task) => void;
  onDragEnd: (e: React.DragEvent) => void;
  onDrop: (e: React.DragEvent, targetTask: Task) => void;
  onDragOver: (e: React.DragEvent) => void;
  onMoveTask: (taskId: number, status: string, position: number) => void;
  onDeleteTask: (taskId: number) => void;
}

export function Card({
  task,
  index,
  columnId,
  isSelected,
  onSelect,
  onOpen,
  onOpenDoc,
  onRefresh,
  onMenu,
  onDragStart,
  onDragEnd,
  onDrop,
  onDragOver,
  onMoveTask,
  onDeleteTask,
}: CardProps) {
  const cardRef = useRef<HTMLDivElement>(null);
  const [hovered, setHovered] = useState(false);
  const [showStatusIcon, setShowStatusIcon] = useState(false);
  const [popoverOpen, setPopoverOpen] = useState(false);

  // Marquee selection
  useEffect(() => {
    const handleMouseDown = (e: MouseEvent) => {
      if (e.shiftKey && cardRef.current?.contains(e.target as Node)) {
        onSelect(task.id, true);
      }
    };
    document.addEventListener("mousedown", handleMouseDown);
    return () => document.removeEventListener("mousedown", handleMouseDown);
  }, [task.id, onSelect]);

  const statusColorVar = statusColor(task.status);
  const statusIconHtml = statusIcon(task.status);

  // Helper to get priority color
  const getPriorityColor = (priority?: string) => {
    switch (priority) {
      case "p0": return "var(--mw-red)";
      case "p1": return "var(--mw-orange)";
      case "p2": return "var(--mw-blue)";
      case "p3": return "var(--mw-gray)";
      default: return "var(--mw-gray)";
    }
  };

  // Parse acceptance criteria from JSON
  const getAcceptanceCriteria = () => {
    if (!task.acceptance_criteria_json) return [];
    try {
      const parsed = JSON.parse(task.acceptance_criteria_json);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  };

  // Get priority label
  const getPriorityLabel = (priority?: string) => {
    switch (priority) {
      case "p0": return "P0";
      case "p1": return "P1";
      case "p2": return "P2";
      case "p3": return "P3";
      default: return "";
    }
  };

  return (
    <div
      ref={cardRef}
      className={`task-card ${isSelected ? "selected" : ""} ${task.status === "done" ? "done" : ""} ${hovered ? "hovered" : ""}`}
      draggable
      onDragStart={(e) => onDragStart(e, task)}
      onDragEnd={(e) => onDragEnd(e)}
      onDrop={(e) => onDrop(e, task)}
      onDragOver={onDragOver}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onClick={(e) => {
        if (!e.shiftKey && !e.metaKey && !e.ctrlKey) {
          onOpen(task.id);
        }
      }}
      onContextMenu={(e) => {
        e.preventDefault();
        onMenu(e.clientX, e.clientY, task.id);
      }}
      style={{ "--status-color": statusColorVar } as React.CSSProperties}
      data-task-id={task.id}
    >
      {/* Status indicator */}
      <div className="card-status" dangerouslySetInnerHTML={{ __html: statusIconHtml }} />

      {/* Header row with code, priority, series, horizon badges */}
      <div className="card-header-badges">
        {task.code && (
          <span className="card-badge code-badge" title={tr("Code")}>
            <BookOpenIcon className="h-3 w-3 mr-1" />
            {task.code}
          </span>
        )}
        {task.priority && (
          <span
            className="card-badge priority-badge"
            style={{ "--badge-color": getPriorityColor(task.priority) } as React.CSSProperties}
            title={tr("Priority") + ": " + getPriorityLabel(task.priority)}
          >
            <SecurityIcon className="h-3 w-3 mr-1" />
            {getPriorityLabel(task.priority)}
          </span>
        )}
        {task.series && (
          <span className="card-badge series-badge" title={tr("Series")}>
            <StoryIcon className="h-3 w-3 mr-1" />
            {task.series}
          </span>
        )}
        {task.horizon && (
          <span className="card-badge horizon-badge" title={tr("Horizon") + ": " + task.horizon}>
            <ClockIcon2 className="h-3 w-3 mr-1" />
            {task.horizon}
          </span>
        )}
      </div>

      {/* Title */}
      <h3 className="card-title" onClick={(e) => { e.stopPropagation(); onOpen(task.id); }}>
        {task.title}
      </h3>

      {/* Tags */}
      {(task.tags?.length ?? 0) > 0 && (
        <div className="card-tags">
          {task.tags.slice(0, 4).map((tag) => (
            <span key={tag} className="tag">{tag}</span>
          ))}
          {task.tags.length > 4 && (
            <span className="tag more">+{task.tags.length - 4}</span>
          )}
        </div>
      )}

      {/* Description preview */}
      {task.description && (
        <div className="card-description" dangerouslySetInnerHTML={{ __html: markdown(task.description) }} />
      )}

      {/* URL */}
      {task.url && (
        <a href={task.url} target="_blank" rel="noopener noreferrer" className="card-url" onClick={(e) => e.stopPropagation()}>
          <span>{new URL(task.url).hostname}</span>
          <ExternalLinkIcon className="h-3 w-3 ml-1" />
        </a>
      )}

      {/* Waiting on */}
      {(task.waiting_on?.length ?? 0) > 0 && (
        <div className="card-waits">
          <WarningIcon className="h-3 w-3 mr-1" />
          <span>{tr("Waiting on")} {task.waiting_on.length} {tr("task", task.waiting_on.length)}</span>
        </div>
      )}

      {/* Human/AI badge */}
      {!task.human && (
        <div className="card-ai-badge">
          <span className="ai-label">{tr("AI")}</span>
        </div>
      )}

      {/* Owner badge */}
      {task.owner && (
        <div className="card-owner-badge">
          <UserIcon className="h-3 w-3 mr-1" />
          <span>{task.owner}</span>
        </div>
      )}

      {/* AC Checklist in popover (only shown when criteria exist) */}
      {getAcceptanceCriteria().length > 0 && (
        <Popover open={popoverOpen} onOpenChange={setPopoverOpen}>
          <PopoverTrigger asChild>
            <button className="card-ac-trigger" onClick={(e) => { e.stopPropagation(); setPopoverOpen(!popoverOpen); }} aria-label={tr("Acceptance criteria")}>
              <CheckSquareIcon className="h-4 w-4" />
              <span className="ac-count">{getAcceptanceCriteria().filter((c) => c.done).length}/{getAcceptanceCriteria().length}</span>
            </button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-72 max-h-96 overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="popover-header">
              <h4 className="font-medium">{tr("Acceptance Criteria")}</h4>
              <button className="icon-btn" onClick={(e) => { e.stopPropagation(); setPopoverOpen(false); }} aria-label={tr("Close")}>
                <CloseIcon className="h-4 w-4" />
              </button>
            </div>
            <ul className="ac-list">
              {getAcceptanceCriteria().map((ac, idx) => (
                <li key={ac.id || idx} className="ac-item">
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={Boolean(ac.done)}
                      onChange={async (e) => {
                        e.stopPropagation();
                        if (!ac.id) return;
                        try {
                          await toggleChecklist(task.id, String(ac.id), e.target.checked);
                          onRefresh?.();
                        } catch (err) {
                          console.error("Failed to toggle AC:", err);
                        }
                      }}
                      className="checkbox"
                    />
                    <span className={ac.done ? "line-through text-muted" : ""}>{ac.text}</span>
                    {ac.id && <span className="ac-id text-xs text-muted">#{ac.id}</span>}
                  </label>
                </li>
              ))}
            </ul>
          </PopoverContent>
        </Popover>
      )}

      {/* Document links */}
      {(() => {
        if (!task.refs_json) return null;
        let refs: Array<string | { id?: number; slug?: string; path?: string; title?: string }> = [];
        try {
          const parsed = JSON.parse(task.refs_json);
          refs = Array.isArray(parsed) ? parsed : [];
        } catch {
          refs = [];
        }
        if (refs.length === 0) return null;
        return (
          <div className="card-doc-links" data-testid="card-doc-links">
            {refs.map((ref, idx) => {
              const label =
                typeof ref === "string"
                  ? ref
                  : ref.title || ref.path || ref.slug || (ref.id ? `Doc #${ref.id}` : "Doc");
              return (
                <button
                  key={idx}
                  type="button"
                  className="card-doc-link-btn"
                  data-testid="card-doc-link"
                  onClick={(e) => {
                    e.stopPropagation();
                    onOpenDoc?.(ref);
                  }}
                  title={tr("Open in Second Brain") + `: ${label}`}
                >
                  <BookOpenIcon className="h-3 w-3 mr-1" />
                  <span>{label}</span>
                </button>
              );
            })}
          </div>
        );
      })()}

      {/* Footer with metadata */}
      <div className="card-footer">
        <span className="card-updated" title={task.updated_at}>
          <ClockIcon className="h-3 w-3 mr-1" />
          {ago(task.updated_at)}
        </span>
        {(task.comments ?? 0) > 0 && (
          <span className="card-comments" title={tr("Comments")}>
            <MessageIcon className="h-3 w-3 mr-1" />
            {task.comments}
          </span>
        )}
      </div>

      {/* Menu */}
      <Popover>
        <PopoverTrigger asChild>
          <button className="card-menu-btn" onClick={(e) => { e.stopPropagation(); onMenu(e.clientX, e.clientY, task.id); }}>
            <MenuIcon className="h-4 w-4" />
          </button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-40">
          <button className="popover-item" onClick={() => onOpen(task.id)}>
            <EditIcon className="h-4 w-4 mr-2" />
            {tr("Edit")}
          </button>
          <button className="popover-item" onClick={() => {
            navigator.clipboard.writeText(`${window.location.origin}/#task-${task.id}`).catch(() => {});
          }}>
            <DownloadIcon className="h-4 w-4 mr-2" />
            {tr("Copy link")}
          </button>
          <button className="popover-item" onClick={() => {
            const position = Math.max(index - 1, 0);
            if (position === index) return;
            onMoveTask(task.id, columnId, position);
          }}>
            <ArrowRightIcon className="h-4 w-4 mr-2" />
            {tr("Move up")}
          </button>
          <button className="popover-item" onClick={() => {
            const position = index + 1;
            onMoveTask(task.id, columnId, position);
          }}>
            <ArrowLeftIcon className="h-4 w-4 mr-2" />
            {tr("Move down")}
          </button>
          <hr className="popover-separator" />
          <button className="popover-item destructive" onClick={() => {
            if (window.confirm(tr("Are you sure you want to delete this task?"))) {
              onDeleteTask(task.id);
            }
          }}>
            <DeleteIcon className="h-4 w-4 mr-2" />
            {tr("Delete")}
          </button>
        </PopoverContent>
      </Popover>
    </div>
  );
}