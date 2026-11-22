// Task Panel component - detail view for a task (right sidebar)

import { useRef, useEffect, useState } from "react";
import { Button } from "@moonwitness/ui/components/button";
import { Input } from "@moonwitness/ui/components/input";
import { Textarea } from "@moonwitness/ui/components/textarea";
import { Checkbox } from "@moonwitness/ui/components/checkbox";
import { Label } from "@moonwitness/ui/components/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@moonwitness/ui/components/select";
import { TagInput } from "@moonwitness/ui/components/tag-input";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuSeparator } from "@moonwitness/ui/components/dropdown-menu";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@moonwitness/ui/components/dialog";
import { CloseIcon as XIcon, SortDescendingIcon as ChevronDownIcon, ExternalLinkIcon, DocumentIcon as CopyIcon, DeleteIcon as Trash2Icon, EditIcon as PencilIcon, TagIcon, RelationIcon as LinkIcon, UserIcon, ClockIcon, WarningIcon as AlertCircleIcon, ImageIcon, SendIcon, MenuIcon as MoreHorizontalIcon, CheckSquareIcon, ArchiveIcon, SortAscendingIcon as ArrowUpIcon, SortDescendingIcon as ArrowDownIcon, BookOpenIcon, PlayIcon, CheckCircleIcon } from "@moonwitness/ui/icons";
import { toast } from "@moonwitness/ui/components/toast";
import { statusColor, statusIcon, projectColor, projectColorName } from "../lib/colors";
import { markdown, plainText } from "../lib/markdown";
import { ago } from "../lib/time";
import type { TaskReply, Task, Comment, Image } from "../types";
import { api, claimTask, toggleChecklist, submitReview, type BoardSide } from "../api";
import { tr } from "../lib/i18n";

interface TaskPanelProps {
  task: TaskReply | null;
  onClose: () => void;
  onUpdate: (id: number, patch: Partial<Task>) => void;
  onDelete: (id: number) => void;
  onAddComment: (taskId: number, body: string) => void;
  onDeleteComment: (commentId: number) => void;
  onAddImage: (taskId: number, file: File) => void;
  onDeleteImage: (imageId: number) => void;
  onRefresh?: (taskId: number) => void;
  onOpenDoc?: (ref: string | { id?: number; slug?: string; path?: string; title?: string }) => void;
  currentProject: string;
  currentBoard: BoardSide;
}

export function TaskPanel({
  task,
  onClose,
  onUpdate,
  onDelete,
  onAddComment,
  onDeleteComment,
  onAddImage,
  onDeleteImage,
  onRefresh,
  onOpenDoc,
  currentProject,
  currentBoard,
}: TaskPanelProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const [editingField, setEditingField] = useState<string | null>(null);
  const [editValues, setEditValues] = useState<Record<string, string>>({});
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [newComment, setNewComment] = useState("");
  const [uploadingImage, setUploadingImage] = useState(false);

  // Focus trap and escape handling
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (editingField) {
          setEditingField(null);
        } else {
          onClose();
        }
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [editingField, onClose]);

  // Auto-focus first input when panel opens
  useEffect(() => {
    if (task && editingField) {
      const input = panelRef.current?.querySelector(`[data-edit-field="${editingField}"]`) as HTMLElement;
      input?.focus();
    }
  }, [task, editingField]);

  if (!task) return null;

  const { task: t, comments, images, waits_on, blocks } = task;
  const statusColorVar = statusColor(t.status);
  const statusIconHtml = statusIcon(t.status);
  const projectColorVar = projectColor(t.project); // Note: task doesn't have color, would need project info

  const handleBlur = (field: string) => {
    const value = editValues[field];
    if (value !== undefined) {
      const patch: Partial<Task> = {};
      switch (field) {
        case "title":
          patch.title = value;
          break;
        case "description":
          patch.description = value;
          break;
        case "tags":
          patch.tags = value.split(",").map((s) => s.trim()).filter(Boolean);
          break;
        case "url":
          patch.url = value || null;
          break;
        case "human":
          patch.human = value === "true";
          break;
      }
      if (Object.keys(patch).length > 0) {
        onUpdate(t.id, patch);
      }
    }
    setEditingField(null);
  };

  const startEdit = (field: string, currentValue: string) => {
    setEditingField(field);
    setEditValues((prev) => ({ ...prev, [field]: currentValue }));
  };

  const handleTagChange = (tags: string[]) => {
    onUpdate(t.id, { tags });
  };

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadingImage(true);
    try {
      await onAddImage(t.id, file);
    } finally {
      setUploadingImage(false);
      e.target.value = "";
    }
  };

  return (
    <Dialog open={true} onOpenChange={onClose}>
      <DialogContent className="task-panel max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <div className="panel-header">
            <div className="panel-title-row">
              <div className="panel-status" dangerouslySetInnerHTML={{ __html: statusIconHtml }} style={{ "--status-color": statusColorVar } as React.CSSProperties} />
              <DialogTitle className="panel-title">{t.title}</DialogTitle>
              {!t.human && <span className="ai-badge">{tr("AI")}</span>}
            </div>
            <button className="panel-close" onClick={onClose} aria-label={tr("Close")}>
              <XIcon className="h-5 w-5" />
            </button>
          </div>
        </DialogHeader>

        <div className="panel-body" ref={panelRef}>
          {/* TaskOS v2 Header Metadata + Workflow Actions */}
          <div className="panel-v2-bar">
            <div className="panel-v2-badges">
              {t.code && <span className="card-badge code-badge">{t.code}</span>}
              {t.priority && <span className="card-badge priority-badge">{t.priority.toUpperCase()}</span>}
              {t.series && <span className="card-badge series-badge">{t.series}</span>}
              {t.horizon && <span className="card-badge horizon-badge">{t.horizon}</span>}
              {t.owner && <span className="card-badge">{t.owner}</span>}
              <span className="card-badge">{t.status.toUpperCase()}</span>
            </div>
            <div className="panel-workflow-actions">
              {t.status !== "doing" && t.status !== "done" && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={async () => {
                    try {
                      await claimTask(t.id);
                      toast.success(tr("Task claimed"));
                      onRefresh?.(t.id);
                    } catch (err: any) {
                      toast.error(err?.message || tr("Failed to claim task"));
                    }
                  }}
                >
                  <PlayIcon className="h-3.5 w-3.5 mr-1" />
                  {tr("Claim")}
                </Button>
              )}
              {t.status !== "review" && t.status !== "done" && (
                <Button
                  size="sm"
                  onClick={async () => {
                    try {
                      await submitReview(t.id);
                      toast.success(tr("Submitted for review"));
                      onRefresh?.(t.id);
                    } catch (err: any) {
                      toast.error(err?.message || tr("Cannot submit review"));
                    }
                  }}
                >
                  <CheckCircleIcon className="h-3.5 w-3.5 mr-1" />
                  {tr("Submit review")}
                </Button>
              )}
            </div>
          </div>

          {/* Description */}
          <div className="panel-section">
            <div className="section-header">
              <h3>{tr("Description")}</h3>
              <button
                className="edit-btn"
                onClick={() => startEdit("description", t.description)}
                aria-label={tr("Edit description")}
              >
                <PencilIcon className="h-4 w-4" />
              </button>
            </div>
            {editingField === "description" ? (
              <Textarea
                data-edit-field="description"
                value={editValues.description || ""}
                onChange={(e) => setEditValues((prev) => ({ ...prev, description: e.target.value }))}
                onBlur={() => handleBlur("description")}
                rows={6}
                placeholder={tr("No description yet. Click to add...")}
                className="edit-textarea"
              />
            ) : (
              <div
                className="panel-description"
                dangerouslySetInnerHTML={{ __html: markdown(t.description) }}
                onClick={() => startEdit("description", t.description)}
              />
            )}
          </div>

          {/* Tags */}
          <div className="panel-section">
            <div className="section-header">
              <h3>{tr("Tags")}</h3>
            </div>
            <TagInput
              label={tr("Tags")}
              value={t.tags}
              onValueChange={handleTagChange}
              placeholder={tr("Add tags...")}
              className="panel-tags"
            />
          </div>

          {/* URL */}
          <div className="panel-section">
            <div className="section-header">
              <h3>{tr("URL")}</h3>
              <button
                className="edit-btn"
                onClick={() => startEdit("url", t.url || "")}
                aria-label={tr("Edit URL")}
              >
                <PencilIcon className="h-4 w-4" />
              </button>
            </div>
            {editingField === "url" ? (
              <Input
                data-edit-field="url"
                type="url"
                value={editValues.url || ""}
                onChange={(e) => setEditValues((prev) => ({ ...prev, url: e.target.value }))}
                onBlur={() => handleBlur("url")}
                placeholder={tr("https://example.com")}
                className="edit-input"
              />
            ) : t.url ? (
              <a href={t.url} target="_blank" rel="noopener noreferrer" className="panel-url" onClick={(e) => e.stopPropagation()}>
                <LinkIcon className="h-4 w-4 mr-2" />
                <span>{new URL(t.url).hostname}</span>
                <ExternalLinkIcon className="h-4 w-4 ml-2" />
              </a>
            ) : (
              <button className="add-url-btn" onClick={() => startEdit("url", "")}>
                <LinkIcon className="h-4 w-4 mr-2" />
                {tr("Add URL")}
              </button>
            )}
          </div>

          {/* Acceptance Criteria (v2) */}
          {(() => {
            if (!t.acceptance_criteria_json) return null;
            let acList: Array<{ id?: string; text?: string; done?: boolean }> = [];
            try {
              const parsed = JSON.parse(t.acceptance_criteria_json);
              acList = Array.isArray(parsed) ? parsed : [];
            } catch {
              acList = [];
            }
            if (acList.length === 0) return null;
            return (
              <div className="panel-section">
                <div className="section-header">
                  <h3>{tr("Acceptance Criteria")} ({acList.filter((c) => c.done).length}/{acList.length})</h3>
                </div>
                <ul className="ac-list">
                  {acList.map((ac, idx) => (
                    <li key={ac.id || idx} className="ac-item">
                      <label className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={Boolean(ac.done)}
                          onChange={async (e) => {
                            if (!ac.id) return;
                            try {
                              await toggleChecklist(t.id, String(ac.id), e.target.checked);
                              onRefresh?.(t.id);
                            } catch (err: any) {
                              toast.error(err?.message || tr("Failed to update checklist"));
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
              </div>
            );
          })()}

          {/* Linked Second Brain Documents (v2) */}
          {(() => {
            if (!t.refs_json) return null;
            let refs: Array<string | { id?: number; slug?: string; path?: string; title?: string }> = [];
            try {
              const parsed = JSON.parse(t.refs_json);
              refs = Array.isArray(parsed) ? parsed : [];
            } catch {
              refs = [];
            }
            if (refs.length === 0) return null;
            return (
              <div className="panel-section">
                <div className="section-header">
                  <h3>{tr("Linked Documents")}</h3>
                </div>
                <div className="card-doc-links">
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
                        onClick={() => {
                          onOpenDoc?.(ref);
                          onClose();
                        }}
                      >
                        <BookOpenIcon className="h-3.5 w-3.5 mr-1" />
                        <span>{label}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })()}

          {/* Waiting on / Blocks */}
          {(waits_on.length > 0 || blocks.length > 0) && (
            <div className="panel-section">
              <h3>{tr("Dependencies")}</h3>
              {waits_on.length > 0 && (
                <div className="dependency-group">
                  <h4>{tr("Waiting on")}</h4>
                  <ul className="dependency-list">
                    {waits_on.map((link) => (
                      <li key={link.id} className="dependency-item">
                        <span className="dep-status" dangerouslySetInnerHTML={{ __html: statusIcon(link.status) }} />
                        <span className="dep-title">{link.title}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {blocks.length > 0 && (
                <div className="dependency-group">
                  <h4>{tr("Blocking")}</h4>
                  <ul className="dependency-list">
                    {blocks.map((link) => (
                      <li key={link.id} className="dependency-item">
                        <span className="dep-status" dangerouslySetInnerHTML={{ __html: statusIcon(link.status) }} />
                        <span className="dep-title">{link.title}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}

          {/* Images */}
          <div className="panel-section">
            <div className="section-header">
              <h3>{tr("Images")}</h3>
            </div>
            {images.length > 0 && (
              <div className="image-grid">
                {images.map((img) => (
                  <div key={img.id} className="image-item">
                    <img src={`/api/images/${img.file}`} alt="" loading="lazy" />
                    <button className="image-delete" onClick={() => onDeleteImage(img.id)} aria-label={tr("Delete image")}>
                      <Trash2Icon className="h-4 w-4" />
                    </button>
                  </div>
                ))}
              </div>
            )}
            <label className="image-upload-btn">
              <ImageIcon className="h-4 w-4 mr-2" />
              {tr("Add image")}
              <input type="file" accept="image/*" onChange={handleImageUpload} disabled={uploadingImage} />
            </label>
          </div>

          {/* Comments */}
          <div className="panel-section">
            <div className="section-header">
              <h3>{tr("Comments")} ({comments.length})</h3>
            </div>
            <div className="comments-list">
              {comments.map((comment) => (
                <div key={comment.id} className="comment">
                  <div className="comment-header">
                    <span className="comment-author">{comment.author}</span>
                    <span className="comment-time">{ago(comment.created_at)}</span>
                    <button className="comment-menu" onClick={() => { /* menu */ }}>
                      <MoreHorizontalIcon className="h-4 w-4" />
                    </button>
                  </div>
                  <div className="comment-body" dangerouslySetInnerHTML={{ __html: markdown(comment.body) }} />
                </div>
              ))}
            </div>
            <form className="comment-form" onSubmit={(e) => { e.preventDefault(); if (newComment.trim()) { onAddComment(t.id, newComment); setNewComment(""); } }}>
              <Textarea
                value={newComment}
                onChange={(e) => setNewComment(e.target.value)}
                placeholder={tr("Write a comment...")}
                rows={3}
                className="comment-input"
              />
              <div className="comment-form-footer">
                <Button type="submit" disabled={!newComment.trim() || uploadingImage}>
                  <SendIcon className="h-4 w-4 mr-2" />
                  {tr("Comment")}
                </Button>
              </div>
            </form>
          </div>

          {/* Metadata */}
          <div className="panel-section panel-meta">
            <div className="meta-row">
              <span className="meta-label">{tr("Created")}</span>
              <span className="meta-value">{ago(t.created_at)}</span>
            </div>
            <div className="meta-row">
              <span className="meta-label">{tr("Updated")}</span>
              <span className="meta-value">{ago(t.updated_at)}</span>
            </div>
            <div className="meta-row">
              <span className="meta-label">{tr("Human")}</span>
              <span className="meta-value">{t.human ? tr("Yes") : tr("No")}</span>
            </div>
          </div>
        </div>

        <DialogFooter className="panel-footer">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="sm">
                <MoreHorizontalIcon className="h-4 w-4 mr-2" />
                {tr("More")}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => { /* copy link */ }}>
                <CopyIcon className="h-4 w-4 mr-2" />
                {tr("Copy link")}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => { /* duplicate */ }}>
                <CopyIcon className="h-4 w-4 mr-2" />
                {tr("Duplicate")}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem className="text-destructive" onClick={() => setShowDeleteConfirm(true)}>
                <Trash2Icon className="h-4 w-4 mr-2" />
                {tr("Delete")}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          <div className="footer-spacer" />

          <Button variant="outline" size="sm" onClick={onClose}>
            <XIcon className="h-4 w-4 mr-2" />
            {tr("Close")}
          </Button>
        </DialogFooter>
      </DialogContent>

      {/* Delete confirmation dialog */}
      {showDeleteConfirm && (
        <Dialog open={true} onOpenChange={() => setShowDeleteConfirm(false)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{tr("Delete task")}</DialogTitle>
              <DialogDescription>{tr("Are you sure you want to delete this task? This cannot be undone.")}</DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="ghost" onClick={() => setShowDeleteConfirm(false)}>
                {tr("Cancel")}
              </Button>
              <Button variant="destructive" onClick={() => { onDelete(t.id); onClose(); setShowDeleteConfirm(false); }}>
                {tr("Delete")}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </Dialog>
  );
}