// New Project Dialog component

import { useRef, useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@moonwitness/ui/components/dialog";
import { Input } from "@moonwitness/ui/components/input";
import { Button } from "@moonwitness/ui/components/button";
import { AddIcon as PlusIcon, SparkleIcon, CodeIcon as FolderGit2Icon, CloseIcon as XIcon, CheckIcon } from "@moonwitness/ui/icons";
import { PROJECT_COLORS, projectColor, projectColorName } from "../lib/colors";
import { api } from "../api";
import { tr } from "../lib/i18n";

interface NewProjectDialogProps {
  open: boolean;
  onClose: () => void;
  onCreate: (name: string, color: string, repo?: string) => void;
}

export function NewProjectDialog({ open, onClose, onCreate }: NewProjectDialogProps) {
  const nameRef = useRef<HTMLInputElement>(null);
  const repoRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState("");
  const [repo, setRepo] = useState("");
  const [color, setColor] = useState("blue");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (open) {
      setName("");
      setRepo("");
      setColor("blue");
      setTimeout(() => nameRef.current?.focus(), 0);
    }
  }, [open]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!open) return;
      if (e.key === "Escape") {
        onClose();
      } else if (e.key === "Enter" && name.trim()) {
        e.preventDefault();
        handleCreate();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [open, name, onClose]);

  const handleCreate = async () => {
    if (!name.trim()) return;
    setLoading(true);
    try {
      await api("POST", "/projects", { name: name.trim(), color, repo: repo.trim() || undefined });
      onCreate(name.trim(), color, repo.trim() || undefined);
      onClose();
    } catch (e) {
      console.error("Failed to create project:", e);
    } finally {
      setLoading(false);
    }
  };

  if (!open) return null;

  return (
    <Dialog open={true} onOpenChange={onClose}>
      <DialogContent className="new-project-dialog">
        <DialogHeader>
          <DialogTitle>{tr("New project")}</DialogTitle>
          <DialogDescription>{tr("Create a new kanban board")}</DialogDescription>
        </DialogHeader>

        <div className="dialog-field">
          <label htmlFor="project-name" className="field-label">{tr("Name")}</label>
          <Input
            ref={nameRef}
            id="project-name"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={tr("Project name")}
            className="dialog-input"
            autoFocus
          />
        </div>

        <div className="dialog-field">
          <label className="field-label">{tr("Color")}</label>
          <div className="color-picker" role="radiogroup" aria-label={tr("Project color")}>
            {PROJECT_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                role="radio"
                aria-checked={color === c}
                className={`color-swatch ${color === c ? "active" : ""}`}
                style={{ backgroundColor: `var(--mw-${c})` } as React.CSSProperties}
                onClick={() => setColor(c)}
              />
            ))}
          </div>
        </div>

        <div className="dialog-field">
          <label htmlFor="project-repo" className="field-label">{tr("Repository (optional)")}</label>
          <div className="repo-input-wrapper">
            <FolderGit2Icon className="repo-icon" />
            <Input
              ref={repoRef}
              id="project-repo"
              type="text"
              value={repo}
              onChange={(e) => setRepo(e.target.value)}
              placeholder={tr("github.com/user/repo")}
              className="dialog-input repo-input"
            />
          </div>
          <p className="field-hint">{tr("Link a Git repository to enable sync")}</p>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={loading}>
            {tr("Cancel")}
          </Button>
          <Button onClick={handleCreate} disabled={!name.trim() || loading}>
            {loading ? tr("Creating...") : tr("Create")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}