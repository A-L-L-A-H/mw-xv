// Settings Dialog component

import { useState, useEffect, useRef } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@moonwitness/ui/components/dialog";
import { Button } from "@moonwitness/ui/components/button";
import { Switch } from "@moonwitness/ui/components/switch";
import { Label } from "@moonwitness/ui/components/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@moonwitness/ui/components/select";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@moonwitness/ui/components/tabs";
import { Input } from "@moonwitness/ui/components/input";
import { toast } from "@moonwitness/ui/components/toast";
import { CloseIcon as XIcon, CheckIcon, MoonIcon, SunIcon, GridIcon as MonitorIcon, GlobeIcon, NotificationIcon as BellIcon, ModelIcon as DatabaseIcon, SettingsIcon as WrenchIcon, InfoIcon, SortIcon as ArrowUpDownIcon, DownloadIcon, UploadIcon, DeleteIcon as Trash2Icon, DocumentIcon as FileTextIcon, WarningIcon as AlertCircleIcon } from "@moonwitness/ui/icons";
import { useTheme } from "../hooks/useTheme";
import { api } from "../api";
import { getLang, setLang, loadDictionary, tr } from "../lib/i18n";

interface SettingsDialogProps {
  open: boolean;
  onClose: () => void;
  currentProject: string | null;
  onProjectUpdate: (patch: { name?: string; color?: string; repos?: string[] }) => void;
  onProjectDelete: () => void;
  onRefresh?: () => void;
}

export function SettingsDialog({
  open,
  onClose,
  currentProject,
  onProjectUpdate,
  onProjectDelete,
  onRefresh,
}: SettingsDialogProps) {
  const { themePreference, dark, setTheme } = useTheme();
  const [lang, setLangState] = useState(getLang());
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [checkingUpdate, setCheckingUpdate] = useState(false);
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const [installingUpdate, setInstallingUpdate] = useState(false);
  const [syncUrl, setSyncUrl] = useState("");
  const [syncBranch, setSyncBranch] = useState("");
  const [syncInterval, setSyncInterval] = useState(300);
  const [autoSync, setAutoSync] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [importing, setImporting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      // Load sync settings
      // TODO: fetch from API
    }
  }, [open]);

  const checkUpdate = async () => {
    setCheckingUpdate(true);
    try {
      const res = await api<{ version: string; current: string }>("GET", "/update");
      setUpdateAvailable(res.version !== res.current);
    } catch (e) {
      console.error("Update check failed:", e);
    } finally {
      setCheckingUpdate(false);
    }
  };

  const installUpdate = async () => {
    setInstallingUpdate(true);
    try {
      await api("POST", "/update");
      // Version reload handled by noticeVersion
    } catch (e) {
      console.error("Update install failed:", e);
    } finally {
      setInstallingUpdate(false);
    }
  };

  const handleLangChange = async (newLang: "en" | "zh-cn") => {
    setLangState(newLang);
    setLang(newLang);
    await loadDictionary();
  };

  const handleExport = async () => {
    setExporting(true);
    try {
      const project = currentProject ?? "all";
      const res = await fetch(`/api/export?project=${encodeURIComponent(project)}`, {
        method: "GET",
      });
      if (!res.ok) throw new Error(res.statusText);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `moonwitness-dx-${project}-export.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (e) {
      console.error("Export failed:", e);
      toast.error(tr("Failed to export data"));
    } finally {
      setExporting(false);
    }
  };

  const handleImport = async (file: File) => {
    setImporting(true);
    try {
      const text = await file.text();
      const payload = JSON.parse(text);
      await api("POST", "/import", { payload });
      await onRefresh?.();
    } catch (e) {
      console.error("Import failed:", e);
      toast.error(tr("Failed to import data"));
    } finally {
      setImporting(false);
    }
  };

  if (!open) return null;

  return (
    <Dialog open={true} onOpenChange={onClose}>
      <DialogContent className="settings-dialog max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{tr("Settings")}</DialogTitle>
        </DialogHeader>

        <Tabs defaultValue="general" className="settings-tabs">
          <TabsList>
            <TabsTrigger value="general">{tr("General")}</TabsTrigger>
            <TabsTrigger value="board">{tr("Board")}</TabsTrigger>
            <TabsTrigger value="sync">{tr("Sync")}</TabsTrigger>
            <TabsTrigger value="about">{tr("About")}</TabsTrigger>
          </TabsList>

          {/* General Tab */}
          <TabsContent value="general" className="settings-tab">
            <div className="setting-group">
              <h3>{tr("Appearance")}</h3>
              <div className="setting-item">
                <div className="setting-label">
                  <span>{tr("Theme")}</span>
                  <p className="setting-hint">{tr("Choose light, dark, or system preference")}</p>
                </div>
                <Select value={themePreference} onValueChange={setTheme}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="light">
                      <SunIcon className="h-4 w-4 mr-2" />
                      {tr("Light")}
                    </SelectItem>
                    <SelectItem value="dark">
                      <MoonIcon className="h-4 w-4 mr-2" />
                      {tr("Dark")}
                    </SelectItem>
                    <SelectItem value="system">
                      <MonitorIcon className="h-4 w-4 mr-2" />
                      {tr("System")}
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="setting-item">
                <div className="setting-label">
                  <span>{tr("Language")}</span>
                </div>
                <Select value={lang} onValueChange={handleLangChange}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="en">
                      <GlobeIcon className="h-4 w-4 mr-2" />
                      English
                    </SelectItem>
                    <SelectItem value="zh-cn">
                      <GlobeIcon className="h-4 w-4 mr-2" />
                      中文
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            {currentProject && (
              <div className="setting-group">
                <h3>{tr("Project")}</h3>
                <div className="setting-item">
                  <Button variant="outline" onClick={() => { /* edit project */ }}>
                    <WrenchIcon className="h-4 w-4 mr-2" />
                    {tr("Edit project")}
                  </Button>
                </div>
                <div className="setting-item">
                  <Button variant="destructive" onClick={() => setShowDeleteConfirm(true)}>
                    <Trash2Icon className="h-4 w-4 mr-2" />
                    {tr("Delete project")}
                  </Button>
                </div>
              </div>
            )}
          </TabsContent>

          {/* Board Tab */}
          <TabsContent value="board" className="settings-tab">
            <div className="setting-group">
              <h3>{tr("Display")}</h3>
              <div className="setting-item">
                <div className="setting-label">
                  <span>{tr("Compact mode")}</span>
                  <p className="setting-hint">{tr("Reduce spacing between cards")}</p>
                </div>
                <Switch
                  id="compact-mode"
                  checked={false}
                  onCheckedChange={() => {}}
                />
              </div>
              <div className="setting-item">
                <div className="setting-label">
                  <span>{tr("Show task numbers")}</span>
                </div>
                <Switch
                  id="show-numbers"
                  checked={true}
                  onCheckedChange={() => {}}
                />
              </div>
              <div className="setting-item">
                <div className="setting-label">
                  <span>{tr("Auto-hide empty columns")}</span>
                </div>
                <Switch
                  id="auto-hide-empty"
                  checked={false}
                  onCheckedChange={() => {}}
                />
              </div>
            </div>

            <div className="setting-group">
              <h3>{tr("Behavior")}</h3>
              <div className="setting-item">
                <div className="setting-label">
                  <span>{tr("Confirm on delete")}</span>
                </div>
                <Switch
                  id="confirm-delete"
                  checked={true}
                  onCheckedChange={() => {}}
                />
              </div>
              <div className="setting-item">
                <div className="setting-label">
                  <span>{tr("Enter to create task")}</span>
                  <p className="setting-hint">{tr("Press Enter in empty column to add task")}</p>
                </div>
                <Switch
                  id="enter-create"
                  checked={true}
                  onCheckedChange={() => {}}
                />
              </div>
            </div>
          </TabsContent>

          {/* Sync Tab */}
          <TabsContent value="sync" className="settings-tab">
            <div className="setting-group">
              <h3>{tr("Git Sync")}</h3>
              <div className="setting-item">
                <div className="setting-label">
                  <span>{tr("Repository URL")}</span>
                </div>
                <Input
                  type="text"
                  value={syncUrl}
                  onChange={(e) => setSyncUrl(e.target.value)}
                  placeholder="https://github.com/user/repo.git"
                  className="setting-input"
                />
              </div>
              <div className="setting-item">
                <div className="setting-label">
                  <span>{tr("Branch")}</span>
                </div>
                <Input
                  type="text"
                  value={syncBranch}
                  onChange={(e) => setSyncBranch(e.target.value)}
                  placeholder="main"
                  className="setting-input"
                />
              </div>
              <div className="setting-item">
                <div className="setting-label">
                  <span>{tr("Auto-sync interval (seconds)")}</span>
                </div>
                <Input
                  type="number"
                  value={syncInterval}
                  onChange={(e) => setSyncInterval(Number(e.target.value))}
                  min={60}
                  max={3600}
                  className="setting-input"
                />
              </div>
              <div className="setting-item">
                <div className="setting-label">
                  <span>{tr("Auto-sync")}</span>
                </div>
                <Switch
                  id="auto-sync"
                  checked={autoSync}
                  onCheckedChange={setAutoSync}
                />
              </div>
              <div className="setting-actions">
                <Button variant="outline" onClick={() => { /* sync now */ }}>
                  <ArrowUpDownIcon className="h-4 w-4 mr-2" />
                  {tr("Sync now")}
                </Button>
                <Button variant="outline" onClick={() => { /* pull */ }}>
                  <DownloadIcon className="h-4 w-4 mr-2" />
                  {tr("Pull")}
                </Button>
                <Button variant="outline" onClick={() => { /* push */ }}>
                  <UploadIcon className="h-4 w-4 mr-2" />
                  {tr("Push")}
                </Button>
              </div>
            </div>
          </TabsContent>

          {/* About Tab */}
          <TabsContent value="about" className="settings-tab">
            <div className="setting-group">
              <h3>{tr("Version")}</h3>
              <div className="setting-item">
                <div className="setting-label">
                  <span>{tr("Current version")}</span>
                  <p className="setting-hint">0.4.2</p>
                </div>
              </div>
              <div className="setting-item">
                <Button
                  variant="outline"
                  onClick={checkUpdate}
                  disabled={checkingUpdate || installingUpdate}
                >
                  {checkingUpdate ? tr("Checking...") : updateAvailable ? tr("Update available") : tr("Check for updates")}
                </Button>
                {updateAvailable && !installingUpdate && (
                  <Button variant="destructive" onClick={installUpdate}>
                    {tr("Install update")}
                  </Button>
                )}
                {installingUpdate && <span>{tr("Installing...")}</span>}
              </div>
            </div>

            <div className="setting-group">
              <h3>{tr("Data")}</h3>
              <div className="setting-actions">
                <Button variant="outline" onClick={handleExport} disabled={exporting}>
                  <DownloadIcon className="h-4 w-4 mr-2" />
                  {exporting ? tr("Exporting...") : tr("Export data")}
                </Button>
                <div style={{ position: "relative", display: "inline-block" }}>
                  <Button variant="outline" onClick={() => fileInputRef.current?.click()} disabled={importing}>
                    <UploadIcon className="h-4 w-4 mr-2" />
                    {importing ? tr("Importing...") : tr("Import data")}
                  </Button>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".json"
                    style={{ display: "none" }}
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) handleImport(file);
                    }}
                  />
                </div>
              </div>
            </div>

            <div className="setting-group">
              <h3>{tr("Links")}</h3>
              <div className="links-list">
                <a href="https://github.com/A-L-L-A-H/mw-xv" target="_blank" rel="noopener" className="link-item">
                  <GlobeIcon className="h-4 w-4 mr-2" />
                  {tr("GitHub repository")}
                </a>
                <a href="https://github.com/A-L-L-A-H/mw-xv/issues" target="_blank" rel="noopener" className="link-item">
                  <AlertCircleIcon className="h-4 w-4 mr-2" />
                  {tr("Report issue")}
                </a>
                <a href="/changelog.md" target="_blank" rel="noopener" className="link-item">
                  <FileTextIcon className="h-4 w-4 mr-2" />
                  {tr("Changelog")}
                </a>
              </div>
            </div>
          </TabsContent>
        </Tabs>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            {tr("Close")}
          </Button>
        </DialogFooter>
      </DialogContent>

      {/* Delete confirmation */}
      {showDeleteConfirm && (
        <Dialog open={true} onOpenChange={() => setShowDeleteConfirm(false)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{tr("Delete project")}</DialogTitle>
              <DialogDescription>{tr("This will permanently delete the project and all its tasks. This cannot be undone.")}</DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="ghost" onClick={() => setShowDeleteConfirm(false)}>
                {tr("Cancel")}
              </Button>
              <Button variant="destructive" onClick={() => { onProjectDelete(); onClose(); setShowDeleteConfirm(false); }}>
                {tr("Delete")}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </Dialog>
  );
}

