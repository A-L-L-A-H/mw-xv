// Header component - project title, repo links, filters, view toggles, network button, new task

import { useState } from "react";
import { Button } from "@moonwitness/ui/components/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuSeparator } from "@moonwitness/ui/components/dropdown-menu";
import { Input } from "@moonwitness/ui/components/input";
import { Checkbox } from "@moonwitness/ui/components/checkbox";
import { Label } from "@moonwitness/ui/components/label";
import { Switch } from "@moonwitness/ui/components/switch";
import { AddIcon as PlusIcon, FilterIcon, ColumnsIcon, MenuIcon as ListIcon, SaveIcon, ExternalLinkIcon, WorkflowIcon, WorkflowIcon as GitBranchIcon, SortDescendingIcon as ChevronDownIcon, ChevronRightIcon, CloseIcon, TagIcon, RelationIcon as LinkIcon, UserIcon, ClockIcon, SearchIcon, UsersIcon } from "@moonwitness/ui/icons";
import { projectColor, projectColorName } from "../lib/colors";
import type { Project, Task } from "../types";
import { useBoard } from "../hooks/useBoard";
import { tr } from "../lib/i18n";

interface HeaderProps {
  project: Project | null;
  on: "local" | "shared";
  searchQuery: string;
  onSearchChange: (q: string) => void;
  onNewTask: () => void;
  onFilterToggle: () => void;
  onViewToggle: () => void;
  onNetworkClick: () => void;
  onGlobalSearchClick: () => void;
  networkSlot?: React.ReactNode;
  humanOnly: boolean;
  onHumanOnlyChange: (v: boolean) => void;
  showDone: boolean;
  onShowDoneChange: (v: boolean) => void;
}

export function Header({
  project,
  on,
  searchQuery,
  onSearchChange,
  onNewTask,
  onFilterToggle,
  onViewToggle,
  onNetworkClick,
  onGlobalSearchClick,
  networkSlot,
  humanOnly,
  onHumanOnlyChange,
  showDone,
  onShowDoneChange,
}: HeaderProps) {
  const [filterOpen, setFilterOpen] = useState(false);

  if (!project) {
    return (
      <header className="board-header">
        <div className="header-left">
          <div className="project-title-row">
            <span className="project-color-bar" style={{ background: "var(--mw-primary)" }} />
            <h1 className="board-title">{tr("All projects")}</h1>
          </div>
        </div>
        <div className="header-center">
          <div className="search-box" role="search">
            <SearchIcon className="search-icon" />
            <Input
              type="search"
              placeholder={tr("Filter tasks...")}
              value={searchQuery}
              onChange={(e) => onSearchChange(e.target.value)}
              className="search-input"
            />
          </div>
          <Button
            variant="outline"
            size="sm"
            className="global-search-btn"
            onClick={onGlobalSearchClick}
            title={tr("Global search (FTS5)")}
            aria-label={tr("Global search (FTS5)")}
            data-testid="global-search-btn"
          >
            <SearchIcon className="h-4 w-4" />
            <span>{tr("Search")}</span>
          </Button>
        </div>
        <div className="header-right">
          {networkSlot || (
            <Button variant="outline" size="icon" onClick={onNetworkClick}>
              <UsersIcon className="h-5 w-5" />
            </Button>
          )}
        </div>
      </header>
    );
  }

  const colorName = projectColorName(project.color);
  const colorVar = projectColor(project.color);

  return (
    <header className="board-header" style={{ "--project-color": colorVar } as React.CSSProperties}>
      <div className="header-left">
        <div className="project-title-row">
          <span className="project-color-bar" />
          <h1 className="board-title">{project.name}</h1>
          {on === "shared" && (
            <span className="shared-badge">{tr("Shared")}</span>
          )}
        </div>
        {project.repos.length > 0 && (
          <div className="repo-links">
            {project.repos.map((repo, i) => (
              <a
                key={i}
                href={repo}
                target="_blank"
                rel="noopener noreferrer"
                className="repo-link"
                title={repo}
              >
                <GitBranchIcon className="h-3 w-3 mr-1" />
                <span>{repo.split("/").slice(-2).join("/")}</span>
                <ExternalLinkIcon className="h-3 w-3 ml-1" />
              </a>
            ))}
          </div>
        )}
      </div>

      <div className="header-center">
        <div className="search-box" role="search">
          <SearchIcon className="search-icon" />
          <Input
            type="search"
            placeholder={tr("Search tasks...")}
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            className="search-input"
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                (e.target as HTMLInputElement).blur();
                onSearchChange("");
              }
            }}
          />
          {searchQuery && (
            <button className="search-clear" onClick={() => onSearchChange("")} aria-label={tr("Clear search")}>
              <CloseIcon className="h-4 w-4" />
            </button>
          )}
        </div>
        <Button
          variant="outline"
          size="sm"
          className="global-search-btn"
          onClick={onGlobalSearchClick}
          title={tr("Global search (FTS5)")}
          aria-label={tr("Global search (FTS5)")}
          data-testid="global-search-btn"
        >
          <SearchIcon className="h-4 w-4" />
          <span>{tr("Global")}</span>
        </Button>
      </div>

      <div className="header-right">
        <DropdownMenu open={filterOpen} onOpenChange={setFilterOpen}>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm" className="filter-btn">
              <FilterIcon className="h-4 w-4 mr-1" />
              <span>{tr("Filters")}</span>
              <ChevronDownIcon className="h-4 w-4 ml-1" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-64">
            <div className="p-2">
              <div className="flex items-center gap-2 mb-2">
                <Checkbox
                  id="filter-human"
                  checked={humanOnly}
                  onChange={(e) => onHumanOnlyChange(e.target.checked)}
                />
                <Label htmlFor="filter-human" className="cursor-pointer text-sm">
                  {tr("Human only")}
                </Label>
              </div>
              <div className="flex items-center gap-2">
                <Checkbox
                  id="filter-done"
                  checked={showDone}
                  onChange={(e) => onShowDoneChange(e.target.checked)}
                />
                <Label htmlFor="filter-done" className="cursor-pointer text-sm">
                  {tr("Show done")}
                </Label>
              </div>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => { onHumanOnlyChange(false); onShowDoneChange(false); setFilterOpen(false); }}>
                {tr("Clear filters")}
              </DropdownMenuItem>
            </div>
          </DropdownMenuContent>
        </DropdownMenu>

        {networkSlot || (
          <Button variant="outline" size="icon" onClick={onNetworkClick} title={tr("Network")}>
            <UsersIcon className="h-5 w-5" />
          </Button>
        )}

        <Button onClick={onNewTask} className="new-task-btn" size="sm">
          <PlusIcon className="h-4 w-4 mr-1" />
          {tr("New task")}
        </Button>
      </div>
    </header>
  );
}