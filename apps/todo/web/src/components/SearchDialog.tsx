// Search Dialog component - command palette style search

import { useRef, useEffect, useState, useCallback } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@moonwitness/ui/components/dialog";
import { Input } from "@moonwitness/ui/components/input";
import { Button } from "@moonwitness/ui/components/button";
import { SearchIcon, CloseIcon as XIcon, SortDescendingIcon as ChevronDownIcon, SortAscendingIcon as ChevronUpIcon, TagIcon, UserIcon, ClockIcon, RelationIcon as LinkIcon, WarningIcon as AlertCircleIcon, DocumentIcon as FileTextIcon } from "@moonwitness/ui/icons";
import { markdown, plainText } from "../lib/markdown";
import { ago } from "../lib/time";
import type { Task } from "../types";
import { api } from "../api";
import { tr } from "../lib/i18n";

interface SearchDialogProps {
  open: boolean;
  onClose: () => void;
  onSelect: (task: Task) => void;
  initialQuery?: string;
}

const QUALIFIERS = [
  { key: "status", label: "Status", icon: FileTextIcon },
  { key: "tag", label: "Tag", icon: TagIcon },
  { key: "human", label: "Human", icon: UserIcon },
  { key: "waits", label: "Waiting on", icon: AlertCircleIcon },
  { key: "url", label: "URL", icon: LinkIcon },
  { key: "created", label: "Created", icon: ClockIcon },
  { key: "updated", label: "Updated", icon: ClockIcon },
  { key: "description", label: "Description", icon: FileTextIcon },
  { key: "title", label: "Title", icon: FileTextIcon },
] as const;

export function SearchDialog({ open, onClose, onSelect, initialQuery = "" }: SearchDialogProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState(initialQuery);
  const [results, setResults] = useState<Task[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [showQualifiers, setShowQualifiers] = useState(false);
  const [qualifierFilter, setQualifierFilter] = useState<string>("");

  // Focus input on open
  useEffect(() => {
    if (open) {
      setSelectedIndex(0);
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [open]);

  // Handle keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!open) return;
      if (e.key === "Escape") {
        onClose();
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedIndex((i) => Math.min(i + 1, results.length - 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIndex((i) => Math.max(i - 1, 0));
      } else if (e.key === "Enter") {
        e.preventDefault();
        if (results[selectedIndex]) {
          onSelect(results[selectedIndex]);
          onClose();
        }
      } else if (e.key === "Tab" && showQualifiers) {
        e.preventDefault();
        // Cycle through qualifiers
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [open, results, selectedIndex, onClose, onSelect, showQualifiers]);

  // Search on query change
  useEffect(() => {
    if (!open) return;
    const timer = setTimeout(async () => {
      if (!query.trim()) {
        setResults([]);
        return;
      }
      setLoading(true);
      try {
        const res = await api<{ tasks: Task[] }>("GET", `/search?q=${encodeURIComponent(query)}`);
        setResults(res.tasks || []);
      } catch (e) {
        console.error("Search failed:", e);
        setResults([]);
      } finally {
        setLoading(false);
      }
    }, 150);
    return () => clearTimeout(timer);
  }, [query, open]);

  const handleQualifierClick = (qualifier: string) => {
    const newQuery = `${query} ${qualifier}:`.trim();
    setQuery(newQuery);
    setShowQualifiers(false);
    inputRef.current?.focus();
  };

  const renderResult = (task: Task, index: number) => {
    const isSelected = index === selectedIndex;
    return (
      <button
        key={task.id}
        className={`search-result ${isSelected ? "selected" : ""}`}
        onClick={() => { onSelect(task); onClose(); }}
        onMouseEnter={() => setSelectedIndex(index)}
      >
        <div className="result-header">
          <span className="result-title" dangerouslySetInnerHTML={{ __html: markdown(task.title) }} />
          <span className="result-status" style={{ "--status-color": `var(--mw-${task.status})` } as React.CSSProperties}>
            {task.status}
          </span>
        </div>
        {task.description && (
          <div className="result-description" dangerouslySetInnerHTML={{ __html: markdown(task.description).substring(0, 200) }} />
        )}
        <div className="result-meta">
          {task.tags.length > 0 && (
            <span className="result-tags">
              {task.tags.slice(0, 3).map((tag) => (
                <span key={tag} className="result-tag">{tag}</span>
              ))}
            </span>
          )}
          {!task.human && <span className="result-ai">{tr("AI")}</span>}
          {task.url && <span className="result-url"><LinkIcon className="h-3 w-3" /> {new URL(task.url).hostname}</span>}
        </div>
      </button>
    );
  };

  if (!open) return null;

  return (
    <Dialog open={true} onOpenChange={onClose}>
      <DialogContent className="search-dialog max-w-2xl max-h-[80vh]">
        <DialogHeader className="search-header">
          <div className="search-input-wrapper">
            <SearchIcon className="search-icon" />
            <Input
              ref={inputRef}
              type="search"
              placeholder={tr("Search tasks... (try: status:todo tag:bug)")}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") onClose();
              }}
              className="search-input"
            />
            {query && (
              <button className="search-clear" onClick={() => setQuery("")} aria-label={tr("Clear")}>
                <XIcon className="h-4 w-4" />
              </button>
            )}
          </div>
          {showQualifiers && (
            <div className="qualifier-hints">
              {QUALIFIERS.map((q) => (
                <button
                  key={q.key}
                  className="qualifier-hint"
                  onClick={() => handleQualifierClick(q.key)}
                >
                  <q.icon className="h-3 w-3 mr-1" />
                  {q.key}:
                </button>
              ))}
            </div>
          )}
        </DialogHeader>

        <div className="search-results" role="listbox" aria-label={tr("Search results")}>
          {loading && <div className="search-loading">{tr("Searching...")}</div>}
          {!loading && results.length === 0 && query && (
            <div className="search-empty">{tr("No results found")}</div>
          )}
          {!loading && results.length > 0 && (
            <>
              <div className="results-count">{results.length} {tr("results")}</div>
              {results.map(renderResult)}
            </>
          )}
          {!query && !loading && (
            <div className="search-help">
              <h4>{tr("Search tips")}</h4>
              <ul>
                <li><kbd>status:todo</kbd> <span>{tr("Filter by status")}</span></li>
                <li><kbd>tag:bug</kbd> <span>{tr("Filter by tag")}</span></li>
                <li><kbd>human:true</kbd> <span>{tr("Human tasks only")}</span></li>
                <li><kbd>waits:123</kbd> <span>{tr("Tasks waiting on #123")}</span></li>
                <li><kbd>description:api</kbd> <span>{tr("Search in description")}</span></li>
                <li><kbd>title:fix</kbd> <span>{tr("Search in title")}</span></li>
              </ul>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}