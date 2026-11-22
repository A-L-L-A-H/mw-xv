// Main board state hook - manages all board state, polling, and API calls
// Ported from app.js state management

import { useEffect, useRef, useState, useCallback } from "react";
import { api, getBoard, getChanges, getProjects, getTask, getNetwork, type BoardSide, type Board, type Changes, type Net, type TaskReply, type Project } from "../api";
import type { Task } from "../types";

export interface BoardState {
  // Current project
  project: string;
  on: BoardSide;
  joined: string | null;
  
  // Board data
  board: Board | null;
  changes: string;
  
  // Task detail panel
  task: TaskReply | null;
  selected: number[];
  
  // UI state
  menu: { x: number; y: number; taskId: number } | null;
  net: Net | null;
  
  // Search
  searchQuery: string;
  searchResults: Task[];
  
  // Loading states
  loading: boolean;
  loadingTask: boolean;
}

export function useBoard() {
  const [state, setState] = useState<BoardState>({
    project: "",
    on: "local",
    joined: null,
    board: null,
    changes: "",
    task: null,
    selected: [],
    menu: null,
    net: null,
    searchQuery: "",
    searchResults: [],
    loading: true,
    loadingTask: false,
  });

  const pollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const loadBoardGuard = useRef(0);

  // Initialize from URL hash & react to hashchange (back/forward navigation)
  useEffect(() => {
    const syncFromHash = () => {
      const hash = window.location.hash.slice(1);
      if (hash.startsWith("@")) {
        setState((s) => ({ ...s, on: "shared", project: hash.slice(1), joined: hash.slice(1) }));
      } else if (hash) {
        setState((s) => ({ ...s, on: "local", project: hash, joined: null }));
      }
    };
    syncFromHash();
    window.addEventListener("hashchange", syncFromHash);
    loadProjects();
    loadNetwork();
    return () => window.removeEventListener("hashchange", syncFromHash);
  }, []);

  const loadProjects = useCallback(async (board: BoardSide = "local") => {
    try {
      const res = await getProjects(board);
      return res;
    } catch (e) {
      console.error("Failed to load projects:", e);
      return null;
    }
  }, []);

  const loadNetwork = useCallback(async () => {
    try {
      const net = await getNetwork();
      setState((s) => ({ ...s, net }));
      return net;
    } catch (e) {
      console.error("Failed to load network:", e);
      return null;
    }
  }, []);

  const loadBoard = useCallback(async (project: string, allDone = false, q = "") => {
    const guard = ++loadBoardGuard.current;
    setState((s) => ({ ...s, loading: true }));
    try {
      const board = await getBoard(project, allDone, q);
      if (guard !== loadBoardGuard.current) return;
      setState((s) => ({ ...s, board, changes: board.changes, loading: false }));
    } catch (e) {
      if (guard !== loadBoardGuard.current) return;
      setState((s) => ({ ...s, loading: false }));
      console.error("Failed to load board:", e);
    }
  }, []);

  const loadTask = useCallback(async (id: number) => {
    setState((s) => ({ ...s, loadingTask: true }));
    try {
      const task = await getTask(id);
      setState((s) => ({ ...s, task, loadingTask: false }));
    } catch (e) {
      setState((s) => ({ ...s, loadingTask: false }));
      console.error("Failed to load task:", e);
    }
  }, []);

  const poll = useCallback(async () => {
    const { on, joined, changes: currentChanges, project } = state;
    if (!project) return;

    try {
      const localChanges = await getChanges("local");
      if (localChanges.changes !== currentChanges) {
        loadBoard(project, false, state.searchQuery);
      }

      if (on === "shared" && joined) {
        const sharedChanges = await getChanges("shared");
        if (sharedChanges.changes !== currentChanges) {
          loadBoard(project, false, state.searchQuery);
        }
        if (sharedChanges.guests !== null) {
          setState((s) => ({ ...s, net: { ...s.net!, guests: sharedChanges.guests as any } }));
        }
        if (sharedChanges.joined !== joined) {
          setState((s) => ({ ...s, joined: sharedChanges.joined }));
          if (!sharedChanges.joined) {
            window.location.hash = "";
            window.location.reload();
          }
        }
      }
    } catch (e) {
      console.error("Poll error:", e);
    }
  }, [state, loadBoard]);

  // Start polling
  useEffect(() => {
    const runPoll = () => {
      poll();
      pollTimer.current = setTimeout(runPoll, 2000);
    };
    pollTimer.current = setTimeout(runPoll, 2000);
    return () => {
      if (pollTimer.current) clearTimeout(pollTimer.current);
    };
  }, [poll]);

  // React to project/on changes (default to "all" board when no project selected)
  useEffect(() => {
    loadBoard(state.project || "all", false, state.searchQuery);
  }, [state.project, state.on, loadBoard]);

  const setProject = useCallback((project: string, on: BoardSide = "local") => {
    window.location.hash = on === "shared" ? "@" + project : project;
    setState((s) => ({ ...s, project, on, joined: on === "shared" ? project : null }));
  }, []);

  const setSearchQuery = useCallback((q: string) => {
    setState((s) => ({ ...s, searchQuery: q }));
    if (state.project) {
      loadBoard(state.project, false, q);
    }
  }, [state.project, loadBoard]);

  const toggleTaskSelect = useCallback((id: number) => {
    setState((s) => ({
      ...s,
      selected: s.selected.includes(id)
        ? s.selected.filter((x) => x !== id)
        : [...s.selected, id],
    }));
  }, []);

  const clearSelection = useCallback(() => {
    setState((s) => ({ ...s, selected: [] }));
  }, []);

  const openTask = useCallback((id: number) => {
    loadTask(id);
  }, [loadTask]);

  const closeTask = useCallback(() => {
    setState((s) => ({ ...s, task: null }));
  }, []);

  const setMenu = useCallback((menu: { x: number; y: number; taskId: number } | null) => {
    setState((s) => ({ ...s, menu }));
  }, []);

  const refreshCurrentBoard = useCallback(async () => {
    await loadBoard(state.project || "all", false, state.searchQuery);
  }, [state.project, state.searchQuery, loadBoard]);

  const updateTask = useCallback(async (id: number, patch: Partial<Task>) => {
    await api("PATCH", `/tasks/${id}`, patch);
    await refreshCurrentBoard();
    if (state.task?.task.id === id) {
      await loadTask(id);
    }
  }, [refreshCurrentBoard, state.task, loadTask]);

  const createTask = useCallback(async (project: string, title: string, status: string) => {
    await api("POST", "/tasks", { project, title, status });
    await refreshCurrentBoard();
  }, [refreshCurrentBoard]);

  const deleteTask = useCallback(async (id: number) => {
    await api("DELETE", `/tasks/${id}`);
    setState((s) => (s.task?.task.id === id ? { ...s, task: null } : s));
    await refreshCurrentBoard();
  }, [refreshCurrentBoard]);

  const moveTask = useCallback(async (id: number, status: string, position: number) => {
    await api("POST", `/tasks/${id}/move`, { status, position });
    await refreshCurrentBoard();
  }, [refreshCurrentBoard]);

  const bulkAction = useCallback(async (action: string, taskIds: number[], data?: any) => {
    await api("POST", "/tasks/bulk", { action, tasks: taskIds, ...data });
    await refreshCurrentBoard();
  }, [refreshCurrentBoard]);

  return {
    ...state,
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
  };
}