// Global Search Dialog - FTS5 search across tasks and documents (Second Brain + Kanban)

import { useRef, useEffect, useState, useCallback } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@moonwitness/ui/components/dialog";
import { Input } from "@moonwitness/ui/components/input";
import { Badge } from "@moonwitness/ui/components/badge";
import { Button } from "@moonwitness/ui/components/button";
import { SearchIcon, CloseIcon, BookOpenIcon, DocumentIcon, ChevronRightIcon, KnowledgeIcon, ClockIcon } from "@moonwitness/ui/icons";
import { markdown, plainText } from "../lib/markdown";
import { ago } from "../lib/time";
import type { Task } from "../types";
import { api, globalSearch } from "../api";
import { tr } from "../lib/i18n";

interface GlobalSearchResult {
  tasks: Array<{
    id: number;
    title: string;
    code?: string;
    status: string;
    description?: string;
    tags?: string[];
    human?: boolean;
    url?: string | null;
    project?: string;
    snippet?: string;
  }>;
  documents: Array<{
    id: number;
    title: string;
    layer: string;
    path: string;
    content?: string;
    project?: string;
    snippet?: string;
  }>;
}

interface GlobalSearchDialogProps {
  open: boolean;
  onClose: () => void;
  onSelectTask: (taskId: number) => void;
  onSelectDocument: (docId: number) => void;
  initialQuery?: string;
}

export function GlobalSearchDialog({
  open,
  onClose,
  onSelectTask,
  onSelectDocument,
  initialQuery = "",
}: GlobalSearchDialogProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState(initialQuery);
  const [results, setResults] = useState<GlobalSearchResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [selectedSection, setSelectedSection] = useState<"tasks" | "documents">("tasks");
  const [selectedIndex, setSelectedIndex] = useState(0);

  // Focus input on open
  useEffect(() => {
    if (open) {
      setSelectedIndex(0);
      setSelectedSection("tasks");
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [open]);

  // Handle keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!open) return;
      if (e.key === "Escape") {
        onClose();
      } else if (e.key === "Tab") {
        e.preventDefault();
        setSelectedSection((s) => (s === "tasks" ? "documents" : "tasks"));
        setSelectedIndex(0);
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        const currentResults = selectedSection === "tasks" ? results?.tasks || [] : results?.documents || [];
        setSelectedIndex((i) => Math.min(i + 1, currentResults.length - 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIndex((i) => Math.max(i - 1, 0));
      } else if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
        e.preventDefault();
        setSelectedSection((s) => (s === "tasks" ? "documents" : "tasks"));
        setSelectedIndex(0);
      } else if (e.key === "Enter") {
        e.preventDefault();
        const currentResults = selectedSection === "tasks" ? results?.tasks || [] : results?.documents || [];
        const selected = currentResults[selectedIndex];
        if (selected) {
          if (selectedSection === "tasks") {
            onSelectTask(selected.id);
          } else {
            onSelectDocument(selected.id);
          }
          onClose();
        }
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [open, results, selectedSection, selectedIndex, onClose, onSelectTask, onSelectDocument]);

  // Search on query change (debounced)
  useEffect(() => {
    if (!open) return;
    const timer = setTimeout(async () => {
      if (!query.trim()) {
        setResults(null);
        return;
      }
      setLoading(true);
      try {
        const res = await globalSearch(query.trim(), 50);
        setResults({
          tasks: res.tasks || [],
          documents: res.documents || [],
        });
      } catch (e) {
        console.error("Global search failed:", e);
        setResults({ tasks: [], documents: [] });
      } finally {
        setLoading(false);
      }
    }, 150);
    return () => clearTimeout(timer);
  }, [query, open]);

  const renderTaskResult = (task: GlobalSearchResult["tasks"][0], index: number) => {
    const isSelected = selectedSection === "tasks" && index === selectedIndex;
    return (
      <button
        key={task.id}
        className={`search-result ${isSelected ? "selected" : ""}`}
        onClick={() => { onSelectTask(task.id); onClose(); }}
        onMouseEnter={() => { setSelectedSection("tasks"); setSelectedIndex(index); }}
      >
        <div className="result-header">
          <BookOpenIcon className="h-3.5 w-3.5 shrink-0" />
          <span className="result-title">
            {task.code && <span className="result-code">[{task.code}]</span>}
            <span dangerouslySetInnerHTML={{ __html: markdown(task.title) }} />
          </span>
          <Badge variant="default" className="result-status">{task.status}</Badge>
        </div>
        {(task.snippet || task.description) && (
          <div className="result-snippet" dangerouslySetInnerHTML={{ __html: markdown(task.snippet || task.description || "").substring(0, 200) }} />
        )}
        <div className="result-meta">
          {task.tags?.slice(0, 3).map((tag) => (
            <span key={tag} className="result-tag">{tag}</span>
          ))}
          {!task.human && <span className="result-ai">{tr("AI")}</span>}
          {task.project && <span className="result-project">{tr("Project")}: {task.project}</span>}
        </div>
      </button>
    );
  };

  const renderDocResult = (doc: GlobalSearchResult["documents"][0], index: number) => {
    const isSelected = selectedSection === "documents" && index === selectedIndex;
    return (
      <button
        key={doc.id}
        className={`search-result ${isSelected ? "selected" : ""}`}
        onClick={() => { onSelectDocument(doc.id); onClose(); }}
        onMouseEnter={() => { setSelectedSection("documents"); setSelectedIndex(index); }}
      >
        <div className="result-header">
          <DocumentIcon className="h-3.5 w-3.5 shrink-0" />
          <span className="result-title" dangerouslySetInnerHTML={{ __html: markdown(doc.title) }} />
          <Badge variant="primary" className="result-layer">{doc.layer}</Badge>
        </div>
        <div className="result-doc-path">{doc.path}</div>
        {(doc.snippet || doc.content) && (
          <div className="result-snippet" dangerouslySetInnerHTML={{ __html: markdown(doc.snippet || doc.content || "").substring(0, 200) }} />
        )}
        <div className="result-meta">
          <span className="result-project">{tr("Project")}: {doc.project || "default"}</span>
        </div>
      </button>
    );
  };

  if (!open) return null;

  return (
    <Dialog open={true} onOpenChange={onClose}>
      <DialogContent className="global-search-dialog max-w-3xl max-h-[85vh]">
        <DialogHeader className="global-search-header">
          <div className="global-search-input-wrapper">
            <div className="global-search-icon-group">
              <KnowledgeIcon className="h-5 w-5 text-muted" />
              <SearchIcon className="h-5 w-5" />
            </div>
            <Input
              ref={inputRef}
              type="search"
              placeholder={tr("Search everywhere... (tasks + Second Brain via FTS5)")}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") onClose();
              }}
              className="global-search-input"
            />
            {query && (
              <button className="search-clear" onClick={() => setQuery("")} aria-label={tr("Clear")}>
                <CloseIcon className="h-4 w-4" />
              </button>
            )}
          </div>
        </DialogHeader>

        <div className="global-search-tabs" role="tablist">
          <button
            role="tab"
            aria-selected={selectedSection === "tasks"}
            className={`global-search-tab ${selectedSection === "tasks" ? "active" : ""}`}
            onClick={() => { setSelectedSection("tasks"); setSelectedIndex(0); }}
          >
            {tr("Tasks")} <span className="tab-count">{results?.tasks.length || 0}</span>
          </button>
          <button
            role="tab"
            aria-selected={selectedSection === "documents"}
            className={`global-search-tab ${selectedSection === "documents" ? "active" : ""}`}
            onClick={() => { setSelectedSection("documents"); setSelectedIndex(0); }}
          >
            {tr("Documents")} <span className="tab-count">{results?.documents.length || 0}</span>
          </button>
        </div>

        <div className="global-search-results" role="tabpanel">
          {loading && <div className="search-loading">{tr("Searching...")}</div>}
          {!loading && results && results.tasks.length === 0 && results.documents.length === 0 && query && (
            <div className="search-empty">{tr("No results found")}</div>
          )}
          {!loading && results && results.tasks.length > 0 && selectedSection === "tasks" && (
            <div className="results-section">
              <div className="results-count">{results.tasks.length} {tr("tasks found")}</div>
              {results.tasks.map(renderTaskResult)}
            </div>
          )}
          {!loading && results && results.documents.length > 0 && selectedSection === "documents" && (
            <div className="results-section">
              <div className="results-count">{results.documents.length} {tr("documents found")}</div>
              {results.documents.map(renderDocResult)}
            </div>
          )}
          {!query && !loading && (
            <div className="search-help">
              <h4>{tr("Search tips")}</h4>
              <ul>
                <li><kbd>status:todo</kbd> <span>{tr("Filter by status")}</span></li>
                <li><kbd>tag:bug</kbd> <span>{tr("Filter by tag")}</span></li>
                <li><kbd>human:true</kbd> <span>{tr("Human tasks only")}</span></li>
                <li><kbd>layer:wiki</kbd> <span>{tr("Filter by document layer")}</span></li>
                <li><kbd>project:myproj</kbd> <span>{tr("Filter by project")}</span></li>
                <li><kbd>api design</kbd> <span>{tr("Full-text search across tasks and docs")}</span></li>
              </ul>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}