// Ask Dialog component - generic confirmation/input dialog

import { useRef, useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@moonwitness/ui/components/dialog";
import { Input } from "@moonwitness/ui/components/input";
import { Textarea } from "@moonwitness/ui/components/textarea";
import { Button } from "@moonwitness/ui/components/button";
import { CloseIcon as XIcon, CheckIcon, WarningIcon as AlertCircleIcon } from "@moonwitness/ui/icons";
import { tr } from "../lib/i18n";

export type AskType = "confirm" | "input" | "textarea" | "select";

interface AskDialogProps {
  open: boolean;
  onClose: () => void;
  onConfirm: (value: string) => void;
  type: AskType;
  title: string;
  description?: string;
  placeholder?: string;
  defaultValue?: string;
  options?: { value: string; label: string }[];
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
}

export function AskDialog({
  open,
  onClose,
  onConfirm,
  type,
  title,
  description,
  placeholder,
  defaultValue = "",
  options = [],
  confirmLabel,
  cancelLabel,
  destructive = false,
}: AskDialogProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const selectRef = useRef<HTMLSelectElement>(null);
  const [value, setValue] = useState(defaultValue);

  useEffect(() => {
    if (open) {
      setValue(defaultValue);
      setTimeout(() => {
        inputRef.current?.focus();
        textareaRef.current?.focus();
        selectRef.current?.focus();
      }, 0);
    }
  }, [open, defaultValue]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!open) return;
      if (e.key === "Escape") {
        onClose();
      } else if (e.key === "Enter" && (type === "input" || type === "select")) {
        e.preventDefault();
        onConfirm(value);
        onClose();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [open, type, value, onConfirm, onClose]);

  if (!open) return null;

  return (
    <Dialog open={true} onOpenChange={onClose}>
      <DialogContent className="ask-dialog">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>

        <div className="ask-input">
          {type === "confirm" && (
            <div className="confirm-message">
              <AlertCircleIcon className="h-6 w-6 text-muted" />
              <p>{description || title}</p>
            </div>
          )}
          {type === "input" && (
            <Input
              ref={inputRef}
              type="text"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder={placeholder}
              className="ask-input-field"
              autoFocus
            />
          )}
          {type === "textarea" && (
            <Textarea
              ref={textareaRef}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder={placeholder}
              rows={4}
              className="ask-input-field"
              autoFocus
            />
          )}
          {type === "select" && (
            <select
              ref={selectRef}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              className="ask-input-field"
              autoFocus
            >
              {options.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            {cancelLabel || tr("Cancel")}
          </Button>
          <Button
            variant={destructive ? "destructive" : "default"}
            onClick={() => { onConfirm(value); onClose(); }}
            disabled={type !== "confirm" && !value.trim()}
          >
            {confirmLabel || tr("Confirm")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}