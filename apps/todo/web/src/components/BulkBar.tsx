// Bulk Action Bar component - appears when multiple tasks are selected

import { Button } from "@moonwitness/ui/components/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuSeparator } from "@moonwitness/ui/components/dropdown-menu";
import { CloseIcon as XIcon, TagIcon, UserIcon, ArchiveIcon, DeleteIcon as Trash2Icon, ArrowRightIcon, ArrowRightIcon as MoveIcon, ArrowLeftIcon, DocumentIcon as CopyIcon, ColumnsIcon, ModelIcon } from "@moonwitness/ui/icons";
import { statusColor } from "../lib/colors";
import { tr } from "../lib/i18n";

interface BulkBarProps {
  count: number;
  onClose: () => void;
  onTag: (tags: string[]) => void;
  onAssign: (human: boolean) => void;
  onMove: (status: string) => void;
  onCopy: () => void;
  onDelete: () => void;
}

export function BulkBar({
  count,
  onClose,
  onTag,
  onAssign,
  onMove,
  onCopy,
  onDelete,
}: BulkBarProps) {
  return (
    <div className="bulk-bar" role="toolbar" aria-label={tr("Bulk actions")}>
      <div className="bulk-info">
        <span>{count} {tr("tasks selected")}</span>
        <button className="bulk-close" onClick={onClose} aria-label={tr("Clear selection")}>
          <XIcon className="h-4 w-4" />
        </button>
      </div>

      <div className="bulk-actions">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm">
              <TagIcon className="h-4 w-4 mr-2" />
              {tr("Add tags")}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => onTag(["bug"])}>bug</DropdownMenuItem>
            <DropdownMenuItem onClick={() => onTag(["feature"])}>feature</DropdownMenuItem>
            <DropdownMenuItem onClick={() => onTag(["docs"])}>docs</DropdownMenuItem>
            <DropdownMenuItem onClick={() => onTag(["refactor"])}>refactor</DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => { /* custom tag input */ }}>
              {tr("Custom tags...")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm">
              <UserIcon className="h-4 w-4 mr-2" />
              {tr("Assign")}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => onAssign(true)}>
              <UserIcon className="h-4 w-4 mr-2" />
              {tr("Human")}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => onAssign(false)}>
                          <ModelIcon className="h-4 w-4 mr-2" />
              {tr("AI")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm">
              <MoveIcon className="h-4 w-4 mr-2" />
              {tr("Move to")}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => onMove("backlog")}>
              <span className="flex items-center gap-2">
                <span className="w-3 h-3 rounded border" style={{ backgroundColor: "var(--mw-gray)" }} />
                {tr("Backlog")}
              </span>
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => onMove("todo")}>
              <span className="flex items-center gap-2">
                <span className="w-3 h-3 rounded border" style={{ backgroundColor: "var(--mw-red)" }} />
                {tr("Todo")}
              </span>
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => onMove("doing")}>
              <span className="flex items-center gap-2">
                <span className="w-3 h-3 rounded border" style={{ backgroundColor: "var(--mw-orange)" }} />
                {tr("Doing")}
              </span>
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => onMove("review")}>
              <span className="flex items-center gap-2">
                <span className="w-3 h-3 rounded border" style={{ backgroundColor: "var(--mw-blue)" }} />
                {tr("Review")}
              </span>
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => onMove("done")}>
              <span className="flex items-center gap-2">
                <span className="w-3 h-3 rounded border" style={{ backgroundColor: "var(--mw-green)" }} />
                {tr("Done")}
              </span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        <Button variant="outline" size="sm" onClick={onCopy}>
          <CopyIcon className="h-4 w-4 mr-2" />
          {tr("Copy")}
        </Button>

        <Button variant="destructive" size="sm" onClick={onDelete}>
          <Trash2Icon className="h-4 w-4 mr-2" />
          {tr("Delete")}
        </Button>
      </div>
    </div>
  );
}

