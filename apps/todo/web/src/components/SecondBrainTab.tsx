// Second Brain tab - Document tree (raw/brain/wiki/blueprints/specs), markdown editor, FTS5 search, task linking

import { useState, useEffect, useCallback } from "react";
import { Button } from "@moonwitness/ui/components/button";
import { Input } from "@moonwitness/ui/components/input";
import { Textarea } from "@moonwitness/ui/components/textarea";
import { Badge } from "@moonwitness/ui/components/badge";
import {
  DocumentIcon,
  KnowledgeIcon,
  SearchIcon,
  AddIcon,
  SaveIcon,
  DeleteIcon,
  EditIcon,
  BookOpenIcon,
  ClockIcon,
  ChevronRightIcon,
  CloseIcon,
  RefreshIcon,
} from "@moonwitness/ui/icons";
import { ExternalLinkIcon as LinkIcon, ColumnsIcon, VisibilityIcon } from "@moonwitness/ui/icons";
import {
  getDocuments,
  getDocument,
  upsertDocument,
  updateDocument,
  deleteDocument,
  globalSearch,
  getBoard,
} from "../api";
import type { Document, Task } from "../types";
import { markdown } from "../lib/markdown";
import { ago } from "../lib/time";
import { tr } from "../lib/i18n";

const LAYERS = [
  { id: "raw", label: "Raw", description: "Unprocessed captures & inbox" },
  { id: "brain", label: "Brain", description: "Synthesized notes & thoughts" },
  { id: "wiki", label: "Wiki", description: "Canonical knowledge pages" },
  { id: "blueprints", label: "Blueprints", description: "Architecture & design specs" },
  { id: "specs", label: "Specs", description: "Technical specifications" },
] as const;

type LayerId = (typeof LAYERS)[number]["id"];

export type DocLinkTarget = {
  id?: number;
  ref?: string | { id?: number; slug?: string; path?: string; title?: string };
};

interface SecondBrainTabProps {
  project: string;
  initialDoc?: DocLinkTarget | null;
  onOpenTask?: (taskId: number) => void;
}

export function SecondBrainTab({ project, initialDoc, onOpenTask }: SecondBrainTabProps) {
  const [documents, setDocuments] = useState<Document[]>([]);
  const [selectedDoc, setSelectedDoc] = useState<Document | null>(null);
  const [activeLayer, setActiveLayer] = useState<LayerId | "all">("all");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState(false);
  const [creating, setCreating] = useState(false);

  // Board tasks for resolving linked task codes to IDs
  const [boardTasks, setBoardTasks] = useState<Task[]>([]);
  const [tasksLoaded, setTasksLoaded] = useState(false);

  const loadBoardTasks = useCallback(async () => {
    if (tasksLoaded) return;
    try {
      const res = await getBoard(project, false, "");
      setBoardTasks(res.tasks || []);
    } catch (err) {
      console.error("Failed to load board tasks:", err);
    } finally {
      setTasksLoaded(true);
    }
  }, [project, tasksLoaded]);

  const taskByCode = useCallback((code: string): Task | undefined => {
    return boardTasks.find((t) => t.code === code || `TASK-${t.id}` === code || String(t.id) === code);
  }, [boardTasks]);

  // Editor state
  const [editTitle, setEditTitle] = useState("");
  const [editContent, setEditContent] = useState("");
  const [editPath, setEditPath] = useState("");
  const [editLayer, setEditLayer] = useState<LayerId>("brain");

  // Editor mode: "edit" | "preview" | "split"
  const [editorMode, setEditorMode] = useState<"edit" | "preview" | "split">("edit");

  // Search state
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<{
    tasks: Array<{ id: number; title: string; code?: string; status: string; snippet?: string }>;
    documents: Array<{ id: number; title: string; layer: string; path: string; snippet?: string }>;
  } | null>(null);
  const [searching, setSearching] = useState(false);

  // Expanded layers in tree
  const [expandedLayers, setExpandedLayers] = useState<Set<string>>(
    new Set(["raw", "brain", "wiki", "blueprints", "specs"])
  );

  const loadDocuments = useCallback(async () => {
    setLoading(true);
    try {
      const layerFilter = activeLayer === "all" ? undefined : activeLayer;
      const res = await getDocuments(layerFilter, project || undefined);
      setDocuments(res.documents || []);
    } catch (err) {
      console.error("Failed to load documents:", err);
    } finally {
      setLoading(false);
    }
  }, [activeLayer, project]);

  useEffect(() => {
    loadDocuments();
    loadBoardTasks();
  }, [loadDocuments, loadBoardTasks]);

  const handleSelectDoc = useCallback(async (doc: Document) => {
    try {
      const full = await getDocument(doc.id);
      const docData = full.document || full;
      setSelectedDoc(docData);
      setEditTitle(docData.title || "");
      setEditContent(docData.content_md || docData.content || "");
      setEditPath(docData.path || "");
      setEditLayer((docData.layer as LayerId) || "brain");
      setEditing(false);
      setCreating(false);
    } catch {
      setSelectedDoc(doc);
      setEditTitle(doc.title || "");
      setEditContent(doc.content_md || doc.content || "");
      setEditPath(doc.path || "");
      setEditLayer((doc.layer as LayerId) || "brain");
      setEditing(false);
      setCreating(false);
    }
  }, []);

  useEffect(() => {
    if (!initialDoc) return;
    const rawRef = initialDoc.ref;
    const targetId = initialDoc.id ?? (typeof rawRef === "object" ? rawRef?.id : undefined);
    if (targetId) {
      getDocument(targetId)
        .then((res) => {
          const docData = res.document || res;
          if (docData?.id) handleSelectDoc(docData);
        })
        .catch(() => {});
      return;
    }
    const needle =
      typeof rawRef === "string"
        ? rawRef
        : rawRef?.slug || rawRef?.path || rawRef?.title || "";
    if (!needle) return;
    const norm = (s: string) => s.replace(/\.md$/i, "").replace(/^\//, "").toLowerCase();
    const targetNorm = norm(needle);
    const matchIn = (list: Document[]) =>
      list.find(
        (d) =>
          norm(d.path) === targetNorm ||
          norm(d.title) === targetNorm ||
          norm(d.path).endsWith("/" + targetNorm) ||
          norm(d.path).includes(targetNorm)
      );
    const found = matchIn(documents);
    if (found) {
      handleSelectDoc(found);
      return;
    }
    getDocuments(undefined, undefined)
      .then((res) => {
        const anyMatch = matchIn(res.documents || []);
        if (anyMatch) handleSelectDoc(anyMatch);
      })
      .catch(() => {});
  }, [initialDoc, documents, handleSelectDoc]);

  const handleSave = async () => {
    if (!editTitle.trim()) return;
    setSaving(true);
    try {
      if (creating) {
        const path =
          editPath.trim() ||
          `${editLayer}/${editTitle
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, "-")
            .replace(/^-|-$/g, "")}.md`;
        const res = await upsertDocument({
          project: project || "default",
          layer: editLayer,
          path,
          title: editTitle.trim(),
          content_md: editContent,
          format: "markdown",
        });
        const created = res.document || res;
        setCreating(false);
        setEditing(false);
        await loadDocuments();
        if (created?.id) {
          setSelectedDoc(created);
        }
      } else if (selectedDoc) {
        await updateDocument(selectedDoc.id, {
          title: editTitle.trim(),
          content_md: editContent,
          layer: editLayer,
        });
        setEditing(false);
        await loadDocuments();
        setSelectedDoc((prev) =>
          prev
            ? {
                ...prev,
                title: editTitle.trim(),
                content: editContent,
                content_md: editContent,
                layer: editLayer,
              }
            : null
        );
      }
    } catch (err) {
      console.error("Failed to save document:", err);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: number) => {
    try {
      await deleteDocument(id);
      if (selectedDoc?.id === id) {
        setSelectedDoc(null);
        setEditing(false);
      }
      await loadDocuments();
    } catch (err) {
      console.error("Failed to delete document:", err);
    }
  };

  const handleStartCreate = (layer: LayerId = "brain") => {
    setCreating(true);
    setEditing(true);
    setSelectedDoc(null);
    setEditLayer(layer);
    setEditTitle("");
    setEditPath("");
    setEditContent("");
  };

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!searchQuery.trim()) {
      setSearchResults(null);
      return;
    }
    setSearching(true);
    try {
      const res = await globalSearch(searchQuery.trim(), 30);
      setSearchResults({
        tasks: res.tasks || [],
        documents: res.documents || [],
      });
    } catch (err) {
      console.error("Global search failed:", err);
    } finally {
      setSearching(false);
    }
  };

  const toggleLayer = (layerId: string) => {
    setExpandedLayers((prev) => {
      const next = new Set(prev);
      if (next.has(layerId)) next.delete(layerId);
      else next.add(layerId);
      return next;
    });
  };

  // Group documents by layer
  const docsByLayer = LAYERS.reduce<Record<string, Document[]>>((acc, l) => {
    acc[l.id] = documents.filter((d) => d.layer === l.id);
    return acc;
  }, {});

  return (
    <div className="second-brain-container" data-testid="second-brain-tab">
      {/* Left sidebar: layer filter + document tree */}
      <aside className="brain-sidebar">
        <div className="brain-sidebar-header">
          <div className="brain-title">
            <KnowledgeIcon className="h-4 w-4" />
            <span>{tr("Second Brain")}</span>
          </div>
          <div className="brain-actions">
            <Button
              variant="ghost"
              size="sm"
              onClick={loadDocuments}
              title={tr("Refresh")}
              aria-label={tr("Refresh")}
            >
              <RefreshIcon className="h-4 w-4" />
            </Button>
            <Button
              size="sm"
              onClick={() => handleStartCreate(activeLayer === "all" ? "brain" : activeLayer)}
              data-testid="new-doc-btn"
            >
              <AddIcon className="h-4 w-4 mr-1" />
              {tr("New")}
            </Button>
          </div>
        </div>

        {/* FTS5 Global Search Bar */}
        <form className="brain-search" onSubmit={handleSearch}>
          <div className="brain-search-input-wrap">
            <SearchIcon className="h-4 w-4 brain-search-icon" />
            <Input
              type="search"
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                if (!e.target.value.trim()) setSearchResults(null);
              }}
              placeholder={tr("Search brain & tasks (FTS5)...")}
              data-testid="brain-search-input"
            />
            {searchQuery && (
              <button
                type="button"
                className="brain-search-clear"
                onClick={() => {
                  setSearchQuery("");
                  setSearchResults(null);
                }}
                aria-label={tr("Clear search")}
              >
                <CloseIcon className="h-3 w-3" />
              </button>
            )}
          </div>
        </form>

        {/* Layer pills */}
        <div className="brain-layer-pills">
          <button
            className={`layer-pill ${activeLayer === "all" ? "active" : ""}`}
            onClick={() => setActiveLayer("all")}
          >
            {tr("All")} ({documents.length})
          </button>
          {LAYERS.map((l) => (
            <button
              key={l.id}
              className={`layer-pill ${activeLayer === l.id ? "active" : ""}`}
              onClick={() => setActiveLayer(l.id)}
              title={l.description}
            >
              {l.label} ({docsByLayer[l.id]?.length || 0})
            </button>
          ))}
        </div>

        {/* Search results overlay OR Document tree */}
        {searchResults ? (
          <div className="brain-search-results" data-testid="brain-search-results">
            <div className="search-section-header">
              <span>
                {tr("Documents")} ({searchResults.documents.length})
              </span>
            </div>
            {searchResults.documents.length === 0 ? (
              <p className="brain-empty-hint">{tr("No matching documents")}</p>
            ) : (
              <ul className="brain-doc-list">
                {searchResults.documents.map((d) => (
                  <li key={`doc-${d.id}`}>
                    <button
                      className="brain-doc-item"
                      onClick={() =>
                        handleSelectDoc({
                          id: d.id,
                          project: project || "",
                          layer: d.layer,
                          path: d.path,
                          title: d.title,
                          content: "",
                          format: "markdown",
                          checksum: "",
                          size: 0,
                          created_at: "",
                          updated_at: "",
                        })
                      }
                    >
                      <DocumentIcon className="h-3.5 w-3.5 shrink-0" />
                      <div className="brain-doc-item-body">
                        <span className="brain-doc-title">{d.title}</span>
                        <Badge variant="default">{d.layer}</Badge>
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            )}

            <div className="search-section-header">
              <span>
                {tr("Tasks")} ({searchResults.tasks.length})
              </span>
            </div>
            {searchResults.tasks.length === 0 ? (
              <p className="brain-empty-hint">{tr("No matching tasks")}</p>
            ) : (
              <ul className="brain-doc-list">
                {searchResults.tasks.map((t) => (
                  <li key={`task-${t.id}`}>
                    <button
                      className="brain-doc-item"
                      onClick={() => onOpenTask?.(t.id)}
                    >
                      <BookOpenIcon className="h-3.5 w-3.5 shrink-0" />
                      <div className="brain-doc-item-body">
                        <span className="brain-doc-title">
                          {t.code ? `[${t.code}] ` : ""}
                          {t.title}
                        </span>
                        <Badge variant="default">{t.status}</Badge>
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ) : (
          <div className="brain-tree" data-testid="brain-doc-tree">
            {loading ? (
              <div className="brain-loading">{tr("Loading documents...")}</div>
            ) : (
              LAYERS.filter((l) => activeLayer === "all" || activeLayer === l.id).map((layer) => {
                const layerDocs = docsByLayer[layer.id] || [];
                const isExpanded = expandedLayers.has(layer.id);
                return (
                  <div key={layer.id} className="brain-tree-group">
                    <button
                      className="brain-tree-layer-header"
                      onClick={() => toggleLayer(layer.id)}
                    >
                      <ChevronRightIcon
                        className={`h-3.5 w-3.5 transition-transform ${isExpanded ? "rotate-90" : ""}`}
                      />
                      <span className="layer-name">{layer.label}</span>
                      <span className="layer-count">{layerDocs.length}</span>
                    </button>
                    {isExpanded && (
                      <ul className="brain-doc-list">
                        {layerDocs.length === 0 ? (
                          <li className="brain-empty-layer">{tr("Empty")}</li>
                        ) : (
                          layerDocs.map((doc) => (
                            <li key={doc.id}>
                              <button
                                className={`brain-doc-item ${selectedDoc?.id === doc.id ? "active" : ""}`}
                                onClick={() => handleSelectDoc(doc)}
                              >
                                <DocumentIcon className="h-3.5 w-3.5 shrink-0" />
                                <span className="brain-doc-title">{doc.title || doc.path}</span>
                              </button>
                            </li>
                          ))
                        )}
                      </ul>
                    )}
                  </div>
                );
              })
            )}
          </div>
        )}
      </aside>

      {/* Main pane: document viewer / editor */}
      <section className="brain-editor-pane">
        {creating || editing ? (
          <div className={`brain-editor ${editorMode !== "edit" ? "brain-editor-split" : ""}`} data-testid="brain-doc-editor">
            <div className="brain-editor-toolbar">
              <div className="brain-editor-meta-inputs">
                <select
                  value={editLayer}
                  onChange={(e) => setEditLayer(e.target.value as LayerId)}
                  className="brain-layer-select"
                  aria-label={tr("Layer")}
                >
                  {LAYERS.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.label}
                    </option>
                  ))}
                </select>
                <Input
                  value={editTitle}
                  onChange={(e) => setEditTitle(e.target.value)}
                  placeholder={tr("Document title...")}
                  data-testid="brain-doc-title-input"
                />
                {creating && (
                  <Input
                    value={editPath}
                    onChange={(e) => setEditPath(e.target.value)}
                    placeholder={tr("Path (optional, e.g. wiki/architecture.md)")}
                    data-testid="brain-doc-path-input"
                  />
                )}
              </div>
              <div className="brain-editor-actions">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setEditorMode((m) => (m === "edit" ? "preview" : "edit"))}
                  title={editorMode === "edit" ? tr("Preview") : tr("Edit")}
                >
                  {editorMode === "edit" ? (
                    <VisibilityIcon className="h-4 w-4 mr-1" />
                  ) : (
                    <EditIcon className="h-4 w-4 mr-1" />
                  )}
                  {editorMode === "edit" ? tr("Preview") : tr("Edit")}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setEditorMode("split")}
                  title={tr("Split view")}
                >
                  <ColumnsIcon className="h-4 w-4 mr-1" />
                  {tr("Split")}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setEditorMode("edit")}
                  title={tr("Edit only")}
                  disabled={editorMode === "edit"}
                >
                  <BookOpenIcon className="h-4 w-4 mr-1" />
                  {tr("Edit")}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setEditing(false);
                    setCreating(false);
                  }}
                >
                  {tr("Cancel")}
                </Button>
                <Button
                  size="sm"
                  onClick={handleSave}
                  disabled={saving || !editTitle.trim()}
                  data-testid="brain-doc-save-btn"
                >
                  <SaveIcon className="h-4 w-4 mr-1" />
                  {saving ? tr("Saving...") : tr("Save")}
                </Button>
              </div>
            </div>
            {editorMode === "edit" || editorMode === "split" ? (
              <Textarea
                value={editContent}
                onChange={(e) => setEditContent(e.target.value)}
                placeholder={tr("Write markdown content...")}
                rows={22}
                className={`brain-markdown-textarea ${editorMode === "split" ? "brain-split-editor" : ""}`}
                data-testid="brain-doc-content-input"
              />
            ) : null}
            {(editorMode === "preview" || editorMode === "split") && (
              <div
                className={`brain-split-preview ${editorMode === "split" ? "brain-split-preview" : "brain-full-preview"}`}
                dangerouslySetInnerHTML={{
                  __html: markdown(editContent),
                }}
              />
            )}
          </div>
        ) : selectedDoc ? (
          <article className="brain-viewer" data-testid="brain-doc-viewer">
            <header className="brain-viewer-header">
              <div>
                <div className="brain-viewer-badges">
                  <Badge variant="primary">{selectedDoc.layer}</Badge>
                  <span className="brain-viewer-path">{selectedDoc.path}</span>
                </div>
                <h2 className="brain-viewer-title">{selectedDoc.title}</h2>
                {selectedDoc.updated_at && (
                  <span className="brain-viewer-updated">
                    <ClockIcon className="h-3.5 w-3.5 inline mr-1" />
                    {ago(selectedDoc.updated_at)}
                  </span>
                )}
              </div>
              <div className="brain-viewer-actions">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setEditing(true)}
                  data-testid="brain-doc-edit-btn"
                >
                  <EditIcon className="h-4 w-4 mr-1" />
                  {tr("Edit")}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => handleDelete(selectedDoc.id)}
                  data-testid="brain-doc-delete-btn"
                >
                  <DeleteIcon className="h-4 w-4" />
                </Button>
              </div>
            </header>
            <div
              className="brain-viewer-content"
              dangerouslySetInnerHTML={{
                __html: markdown(selectedDoc.content_md || selectedDoc.content || ""),
              }}
            />
            {selectedDoc.linked_tasks && selectedDoc.linked_tasks.length > 0 && (
              <div className="brain-backlinks">
                <div className="brain-backlinks-header">
                  <LinkIcon className="h-3.5 w-3.5 shrink-0" />
                  <span className="brain-backlinks-title">{tr("Linked tasks")}</span>
                </div>
                <ul className="brain-backlinks-list">
                  {selectedDoc.linked_tasks.map((code) => {
                    const task = taskByCode(code);
                    return (
                      <li key={code} className="brain-backlinks-item">
                        <button
                          className="brain-backlinks-link"
                          onClick={() => {
                            const id = task?.id ?? Number(code.replace(/\D/g, "") || 0);
                            if (id) onOpenTask?.(id);
                          }}
                          title={tr("Open task")}
                        >
                          <BookOpenIcon className="h-3 w-3 shrink-0 mr-1" />
                          <span>{code}</span>
                          {task?.title && <span className="brain-backlinks-title-badge">{task.title}</span>}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}
          </article>
        ) : (
          <div className="brain-empty-state">
            <KnowledgeIcon className="h-10 w-10 opacity-40" />
            <h3>{tr("Second Brain Knowledge Base")}</h3>
            <p>
              {tr(
                "Select a document from the tree, search across tasks and docs with FTS5, or create a new note."
              )}
            </p>
            <Button onClick={() => handleStartCreate("brain")}>
              <AddIcon className="h-4 w-4 mr-1" />
              {tr("Create Document")}
            </Button>
          </div>
        )}
      </section>
    </div>
  );
}
