// Main App component - ties together all board components

import { useState, useEffect, useCallback } from "react";
import { ToastHost } from "@moonwitness/ui/components/toast";
import { ColumnsIcon, KnowledgeIcon } from "@moonwitness/ui/icons";
import { Sidebar } from "./components/Sidebar";
import { Header } from "./components/Header";
import { Board } from "./components/Board";
import { TaskPanel } from "./components/TaskPanel";
import { SearchDialog } from "./components/SearchDialog";
import { GlobalSearchDialog } from "./components/GlobalSearchDialog";
import { AskDialog } from "./components/AskDialog";
import { NewProjectDialog } from "./components/NewProjectDialog";
import { SettingsDialog } from "./components/SettingsDialog";
import { NetworkPopover } from "./components/NetworkPopover";
import { BulkBar } from "./components/BulkBar";
import { SecondBrainTab, type DocLinkTarget } from "./components/SecondBrainTab";
import { useBoard } from "./hooks/useBoard";
import { useTheme } from "./hooks/useTheme";
import { getProjects, getNetwork, api, type BoardSide, type Project, type Task, type TaskReply, type Net, type Board as BoardData } from "./api";
import { initLang, loadDictionary, tr } from "./lib/i18n";

export default function App() {
  const { themePreference, dark, setTheme } = useTheme();
  const [projects, setProjects] = useState<Project[]>([]);
  const [joinedProjects, setJoinedProjects] = useState<Project[]>([]);
  const [net, setNet] = useState<Net | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [globalSearchOpen, setGlobalSearchOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [newProjectOpen, setNewProjectOpen] = useState(false);
  const [askDialog, setAskDialog] = useState<{
    open: boolean;
    type: "confirm" | "input" | "textarea" | "select";
    title: string;
    description?: string;
    placeholder?: string;
    defaultValue?: string;
    destructive?: boolean;
    onConfirm: (value: string) => void;
  } | null>(null);

  const {
    project,
    on,
    joined,
    board,
    changes,
    task,
    selected,
    menu,
    searchQuery,
    loading,
    loadingTask,
    setProject,
    setSearchQuery,
    toggleTaskSelect,
    clearSelection,
    openTask,
    closeTask,
    setMenu,
    updateTask,
    createTask,
    deleteTask,
    moveTask,
    bulkAction,
    loadBoard,
    loadTask,
    loadNetwork,
    loadProjects,
  } = useBoard();

  // Initialize language
  useEffect(() => {
    initLang();
    loadDictionary();
  }, []);

  // Load projects on mount and when board side changes
  useEffect(() => {
    loadProjects("local").then((res) => {
      if (res) {
        setProjects(res.projects);
        if (!project && res.projects.length > 0) {
          setProject(res.projects[0].slug, "local");
        }
      }
    });
    loadProjects("shared").then((res) => {
      if (res) setJoinedProjects(res.projects);
    });
    loadNetwork().then((n) => setNet(n));
  }, [on]);

  // Handle project selection from sidebar
  const handleProjectSelect = useCallback((slug: string, side: BoardSide) => {
    setProject(slug, side);
    clearSelection();
  }, [setProject, clearSelection]);

  // Handle new task creation
  const handleNewTask = useCallback((status: string = "todo") => {
    const targetProject = project || projects[0]?.slug;
    if (!targetProject) {
      setNewProjectOpen(true);
      return;
    }
    setAskDialog({
      open: true,
      type: "input",
      title: tr("New task"),
      description: tr("Add to {0} ({1})", targetProject, status),
      placeholder: tr("Task title..."),
      onConfirm: (title) => {
        if (title.trim()) {
          createTask(targetProject, title.trim(), status);
        }
      },
    });
  }, [project, projects, createTask]);

  // Handle filter toggles
  const [humanOnly, setHumanOnly] = useState(false);
  const [showDone, setShowDone] = useState(false);

  // Main view switch: board | brain
  const [mainView, setMainView] = useState<"board" | "brain">("board");
  const [linkedDoc, setLinkedDoc] = useState<DocLinkTarget | null>(null);

  const handleOpenDoc = useCallback((ref: string | { id?: number; slug?: string; path?: string; title?: string }) => {
    setLinkedDoc({ ref });
    setMainView("brain");
  }, []);

  const handleFilterToggle = useCallback(() => {
    setHumanOnly((v) => !v);
  }, []);

  const handleViewToggle = useCallback(() => {
    // Toggle between board/list view
  }, []);

  const handleNetworkClick = useCallback(() => {
    // Network popover handles itself
  }, []);

  // Handle bulk actions
  const handleBulkTag = useCallback((tags: string[]) => {
    bulkAction("tag", selected, { tags });
    clearSelection();
  }, [selected, bulkAction, clearSelection]);

  const handleBulkAssign = useCallback((human: boolean) => {
    bulkAction("assign", selected, { human });
    clearSelection();
  }, [selected, bulkAction, clearSelection]);

  const handleBulkMove = useCallback((status: string) => {
    bulkAction("move", selected, { status });
    clearSelection();
  }, [selected, bulkAction, clearSelection]);

  const handleBulkCopy = useCallback(() => {
    bulkAction("copy", selected);
    clearSelection();
  }, [selected, bulkAction, clearSelection]);

  const handleBulkDelete = useCallback(() => {
    setAskDialog({
      open: true,
      type: "confirm",
      title: tr("Delete tasks"),
      description: tr("Are you sure you want to delete {0} tasks?", selected.length),
      onConfirm: () => {
        bulkAction("delete", selected);
        clearSelection();
      },
    });
  }, [selected, bulkAction, clearSelection]);

  // Handle project creation
  const handleCreateProject = useCallback(async (name: string) => {
    const res = await loadProjects("local");
    if (res) {
      setProjects(res.projects);
      const created = res.projects.find((p) => p.name === name) || res.projects[res.projects.length - 1];
      if (created) setProject(created.slug, "local");
    }
  }, [loadProjects, setProject]);

  // Handle project update
  const handleProjectUpdate = useCallback(async (patch: { name?: string; color?: string; repos?: string[] }) => {
    if (!project) return;
    await api("PATCH", `/projects/${project}`, patch);
    const res = await loadProjects("local");
    if (res) setProjects(res.projects);
  }, [project, loadProjects]);

  // Handle project delete
  const handleProjectDelete = useCallback(async () => {
    if (!project) return;
    await api("DELETE", `/projects/${project}`);
    const res = await loadProjects("local");
    if (res) {
      setProjects(res.projects);
      setProject(res.projects[0]?.slug ?? "", "local");
    } else {
      setProject("");
    }
  }, [project, setProject, loadProjects]);

  const handleRenameProject = useCallback((target: Project) => {
    setAskDialog({
      open: true,
      type: "input",
      title: tr("Rename project"),
      defaultValue: target.name,
      placeholder: tr("Project name..."),
      onConfirm: async (newName) => {
        if (!newName.trim()) return;
        await api("PATCH", `/projects/${target.slug}`, { name: newName.trim() });
        const res = await loadProjects("local");
        if (res) setProjects(res.projects);
      },
    });
  }, [loadProjects]);

  const handleChangeProjectColor = useCallback(async (slug: string, color: string) => {
    await api("PATCH", `/projects/${slug}`, { color });
    const res = await loadProjects("local");
    if (res) setProjects(res.projects);
  }, [loadProjects]);

  const handleDeleteProjectBySlug = useCallback((target: Project) => {
    setAskDialog({
      open: true,
      type: "confirm",
      title: tr("Delete project"),
      description: tr("Delete project \"{0}\" and all its tasks?", target.name),
      destructive: true,
      onConfirm: async () => {
        await api("DELETE", `/projects/${target.slug}`);
        const res = await loadProjects("local");
        if (res) {
          setProjects(res.projects);
          if (project === target.slug) {
            setProject(res.projects[0]?.slug ?? "", "local");
          }
        }
      },
    });
  }, [loadProjects, project, setProject]);

  // Handle network refresh
  const handleNetworkRefresh = useCallback(async () => {
    const n = await getNetwork();
    setNet(n);
  }, []);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't trigger shortcuts when typing in inputs
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement) {
        return;
      }

      if (e.key === "/" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setSearchOpen(true);
      } else if (e.key === "Escape") {
        setSearchOpen(false);
        setSettingsOpen(false);
        setNewProjectOpen(false);
        closeTask();
        clearSelection();
      } else if (e.key === "n" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setNewProjectOpen(true);
      } else if (e.key === "," && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setSettingsOpen(true);
      } else if (e.key === "ArrowLeft" && e.altKey) {
        // Previous project
      } else if (e.key === "ArrowRight" && e.altKey) {
        // Next project
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [closeTask, clearSelection]);

  // Find current project object
  const currentProject = projects.find((p) => p.slug === project) || joinedProjects.find((p) => p.slug === project) || null;

  return (
    <>
      <ToastHost />
      <div className="app">
        {/* Sidebar */}
        <Sidebar
          projects={projects}
          joinedProjects={joinedProjects}
          currentProject={project}
          on={on}
          onProjectSelect={handleProjectSelect}
          onNewProject={() => setNewProjectOpen(true)}
          onRenameProject={handleRenameProject}
          onChangeProjectColor={handleChangeProjectColor}
          onDeleteProject={handleDeleteProjectBySlug}
          onSearch={() => setSearchOpen(true)}
          onSettings={() => setSettingsOpen(true)}
          onNetwork={handleNetworkClick}
        />

        {/* Main content */}
        <main className="main-content">
          {/* Header */}
          <Header
            project={currentProject}
            on={on}
            searchQuery={searchQuery}
            onSearchChange={setSearchQuery}
            onNewTask={() => handleNewTask()}
            onFilterToggle={handleFilterToggle}
            onViewToggle={handleViewToggle}
            onNetworkClick={handleNetworkClick}
            onGlobalSearchClick={() => setGlobalSearchOpen(true)}
            networkSlot={<NetworkPopover net={net} onRefresh={handleNetworkRefresh} />}
            humanOnly={humanOnly}
            onHumanOnlyChange={setHumanOnly}
            showDone={showDone}
            onShowDoneChange={setShowDone}
          />

          {/* Bulk action bar */}
          {selected.length > 0 && (
            <BulkBar
              count={selected.length}
              onClose={clearSelection}
              onTag={handleBulkTag}
              onAssign={handleBulkAssign}
              onMove={handleBulkMove}
              onCopy={handleBulkCopy}
              onDelete={handleBulkDelete}
            />
          )}

          {/* View switcher: Board | Second Brain */}
          <nav className="main-view-switcher" role="tablist" aria-label={tr("Main view")}>
            <button
              role="tab"
              aria-selected={mainView === "board"}
              className={`main-view-tab ${mainView === "board" ? "active" : ""}`}
              onClick={() => setMainView("board")}
              data-testid="view-board-tab"
            >
              <ColumnsIcon className="h-4 w-4 mr-1.5" />
              {tr("Board")}
            </button>
            <button
              role="tab"
              aria-selected={mainView === "brain"}
              className={`main-view-tab ${mainView === "brain" ? "active" : ""}`}
              onClick={() => setMainView("brain")}
              data-testid="view-brain-tab"
            >
              <KnowledgeIcon className="h-4 w-4 mr-1.5" />
              {tr("Second Brain")}
            </button>
          </nav>

          {/* Board / Second Brain */}
          <div className="board-container">
            {mainView === "brain" ? (
              <SecondBrainTab
                project={project}
                initialDoc={linkedDoc}
                onOpenTask={(id) => {
                  openTask(id);
                  setMainView("board");
                }}
              />
            ) : board ? (
              <Board
                board={
                  humanOnly
                    ? { ...board, tasks: board.tasks.filter((t) => t.human) }
                    : board
                }
                project={project}
                on={on}
                selectedIds={selected}
                onSelect={toggleTaskSelect}
                onOpen={openTask}
                onOpenDoc={handleOpenDoc}
                onRefresh={() => loadBoard(project || "all", showDone, searchQuery)}
                onMenu={(x, y, taskId) => setMenu({ x, y, taskId })}
                onNewTask={handleNewTask}
                collapsedColumns={new Set()}
                onToggleCollapse={() => {}}
                searchQuery={searchQuery}
              />
            ) : loading ? (
              <div className="board-loading">{tr("Loading board...")}</div>
            ) : (
              <div className="board-empty">
                <p>{tr("No project selected")}</p>
                <button onClick={() => setNewProjectOpen(true)}>{tr("Create project")}</button>
              </div>
            )}          </div>
        </main>

        {/* Task detail panel */}
        <TaskPanel
          task={task}
          onClose={closeTask}
          onUpdate={updateTask}
          onDelete={deleteTask}
          onRefresh={async (taskId) => {
            await loadTask(taskId);
            await loadBoard(project || "all", showDone, searchQuery);
          }}
          onOpenDoc={handleOpenDoc}
          onAddComment={async (taskId, body) => {
            await api("POST", `/tasks/${taskId}/comments`, { body });
            loadTask(taskId);
          }}
          onDeleteComment={async (commentId) => {
            await api("DELETE", `/comments/${commentId}`);
            if (task) loadTask(task.task.id);
          }}
          onAddImage={async (taskId, file) => {
            const formData = new FormData();
            formData.append("file", file);
            await api("POST", `/tasks/${taskId}/images`, formData);
            if (task) loadTask(task.task.id);
          }}
          onDeleteImage={async (imageId) => {
            await api("DELETE", `/images/${imageId}`);
            if (task) loadTask(task.task.id);
          }}
          currentProject={project}
          currentBoard={on}
        />

        {/* Dialogs */}
        <SearchDialog
          open={searchOpen}
          onClose={() => setSearchOpen(false)}
          onSelect={(task) => {
            openTask(task.id);
            setSearchOpen(false);
          }}
        />

        <GlobalSearchDialog
          open={globalSearchOpen}
          onClose={() => setGlobalSearchOpen(false)}
          onSelectTask={(taskId) => {
            openTask(taskId);
            setMainView("board");
          }}
          onSelectDocument={(docId) => {
            setLinkedDoc({ id: docId });
            setMainView("brain");
            setGlobalSearchOpen(false);
          }}
        />

        <SettingsDialog
          open={settingsOpen}
          onClose={() => setSettingsOpen(false)}
          currentProject={project}
          onProjectUpdate={handleProjectUpdate}
          onProjectDelete={handleProjectDelete}
        />

        <NewProjectDialog
          open={newProjectOpen}
          onClose={() => setNewProjectOpen(false)}
          onCreate={handleCreateProject}
        />

        {askDialog && (
          <AskDialog
            open={askDialog.open}
            onClose={() => setAskDialog(null)}
            onConfirm={askDialog.onConfirm}
            type={askDialog.type}
            title={askDialog.title}
            description={askDialog.description}
            placeholder={askDialog.placeholder}
            defaultValue={askDialog.defaultValue}
            destructive={askDialog.destructive}
          />
        )}
      </div>
    </>
  );
}
