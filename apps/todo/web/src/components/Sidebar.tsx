// Sidebar component - project navigation, joined boards, project menus

import { useState } from "react";
import { Button } from "@moonwitness/ui/components/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@moonwitness/ui/components/dropdown-menu";
import { AddIcon as PlusIcon, CodeIcon as FolderGit2Icon, EditIcon as PencilIcon, DeleteIcon as Trash2Icon, DocumentIcon as CopyIcon, ExternalLinkIcon, SortDescendingIcon as ChevronDownIcon, SearchIcon, SettingsIcon, UsersIcon, UsersIcon as Share2Icon, CloseIcon as XIcon, ChevronsLeftIcon as ChevronLeftIcon, ChevronRightIcon } from "@moonwitness/ui/icons";
import { projectColor, projectColorName, PROJECT_COLORS, type ProjectColor } from "../lib/colors";
import type { Project } from "../types";
import type { BoardSide } from "../api";
import { useBoard } from "../hooks/useBoard";
import { tr } from "../lib/i18n";

interface SidebarProps {
  projects: Project[];
  joinedProjects: Project[];
  currentProject: string;
  on: BoardSide;
  onProjectSelect: (project: string, on: BoardSide) => void;
  onNewProject: () => void;
  onRenameProject?: (project: Project) => void;
  onChangeProjectColor?: (slug: string, color: string) => void;
  onDeleteProject?: (project: Project) => void;
  onSearch: () => void;
  onSettings: () => void;
  onNetwork: () => void;
}

export function Sidebar({
  projects,
  joinedProjects,
  currentProject,
  on,
  onProjectSelect,
  onNewProject,
  onRenameProject,
  onChangeProjectColor,
  onDeleteProject,
  onSearch,
  onSettings,
  onNetwork,
}: SidebarProps) {
  const [expanded, setExpanded] = useState(true);
  const [hoveredProject, setHoveredProject] = useState<string | null>(null);
  const [showColorPicker, setShowColorPicker] = useState<string | null>(null);

  const localProjects = projects.filter((p) => p.repos.length > 0 || p.open > 0 || p.total > 0);
  const archivedProjects = projects.filter((p) => p.repos.length === 0 && p.open === 0 && p.total === 0);

  const renderProjectItem = (project: Project, isJoined = false) => {
    const isActive = currentProject === project.slug && on === (isJoined ? "shared" : "local");
    const colorName = projectColorName(project.color);
    const colorVar = projectColor(project.color);

    return (
      <div
        key={project.slug}
        className={`project-item ${isActive ? "active" : ""}`}
        onMouseEnter={() => setHoveredProject(project.slug)}
        onMouseLeave={() => setHoveredProject(null)}
        style={{ "--project-color": colorVar } as React.CSSProperties}
      >
        <button
          className="project-link"
          onClick={() => onProjectSelect(project.slug, isJoined ? "shared" : "local")}
          title={project.name}
        >
          <span className="project-color-dot" style={{ backgroundColor: colorVar }} />
          <span className="project-name">{project.name}</span>
          <span className="project-count">{project.open}/{project.total}</span>
        </button>
        {!isJoined && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="project-menu-btn" aria-label="Project menu">
                <ChevronDownIcon className="h-4 w-4" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              <DropdownMenuItem onClick={() => onRenameProject?.(project)}>
                <PencilIcon className="h-4 w-4 mr-2" />
                {tr("Rename")}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setShowColorPicker(showColorPicker === project.slug ? null : project.slug)}>
                <span className="flex items-center gap-2">
                  <span className="color-dot-preview" style={{ backgroundColor: colorVar }} />
                  {tr("Color")}
                </span>
              </DropdownMenuItem>
              <DropdownMenuItem className="text-destructive" onClick={() => onDeleteProject?.(project)}>
                <Trash2Icon className="h-4 w-4 mr-2" />
                {tr("Delete")}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
        {showColorPicker === project.slug && (
          <div className="sidebar-color-picker">
            {PROJECT_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                className={`color-swatch ${project.color === c ? "active" : ""}`}
                style={{ backgroundColor: projectColor(c) }}
                title={c}
                onClick={() => {
                  onChangeProjectColor?.(project.slug, c);
                  setShowColorPicker(null);
                }}
              />
            ))}
          </div>
        )}
      </div>
    );
  };

  return (
    <aside className={`sidebar ${!expanded ? "collapsed" : ""}`} data-side="left">
      <div className="sidebar-header">
        <button className="sidebar-toggle" onClick={() => setExpanded(!expanded)} aria-label={expanded ? tr("Collapse sidebar") : tr("Expand sidebar")}>
          {expanded ? <ChevronLeftIcon className="h-5 w-5" /> : <ChevronRightIcon className="h-5 w-5" />}
        </button>
        {expanded && (
          <div className="sidebar-actions">
            <button className="icon-btn" onClick={onSearch} title={tr("Search")}>
              <SearchIcon className="h-5 w-5" />
            </button>
            <button className="icon-btn" onClick={onSettings} title={tr("Settings")}>
              <SettingsIcon className="h-5 w-5" />
            </button>
            <button className="icon-btn" onClick={onNetwork} title={tr("Network")}>
              <Share2Icon className="h-5 w-5" />
            </button>
          </div>
        )}
      </div>

      {expanded && (
        <>
          <div className="sidebar-section">
            <div className="section-title">{tr("Projects")}</div>
            <div className="project-list">
              {localProjects.map((p) => renderProjectItem(p))}
              {archivedProjects.length > 0 && (
                <details className="archived-projects">
                  <summary>{tr("Archived")} ({archivedProjects.length})</summary>
                  {archivedProjects.map((p) => renderProjectItem(p))}
                </details>
              )}
            </div>
            <button className="new-project-btn" onClick={onNewProject}>
              <PlusIcon className="h-4 w-4 mr-2" />
              {tr("New project")}
            </button>
          </div>

          {joinedProjects.length > 0 && (
            <div className="sidebar-section">
              <div className="section-title">{tr("Joined boards")}</div>
              <div className="project-list">
                {joinedProjects.map((p) => renderProjectItem(p, true))}
              </div>
            </div>
          )}
        </>
      )}

      {/* Color picker popover */}
      {showColorPicker && (
        <div className="color-picker-overlay" onClick={() => setShowColorPicker(null)}>
          <div className="color-picker" onClick={(e) => e.stopPropagation()}>
            <div className="color-swatches">
              {PROJECT_COLORS.map((c) => (
                <button
                  key={c}
                  className={`color-swatch ${projectColorName(projects.find(p => p.slug === showColorPicker)?.color || "gray") === c ? "active" : ""}`}
                  style={{ backgroundColor: `var(--mw-${c})` } as React.CSSProperties}
                  onClick={() => {
                    // Update project color
                    setShowColorPicker(null);
                  }}
                />
              ))}
            </div>
          </div>
        </div>
      )}
    </aside>
  );
}

