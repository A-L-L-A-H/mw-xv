#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use serde::{Deserialize, Serialize};
use std::env;
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use tauri::{Manager, RunEvent, State, WebviewWindow};

const ALLOWED_WINDOW_LABEL: &str = "main";
const DEFAULT_BOARD_ORIGIN: &str = "http://127.0.0.1:5173";
const DEFAULT_API_BASE_URL: &str = "http://127.0.0.1:3000";

const ALLOWED_ORIGINS: &[&str] = &[
    "http://127.0.0.1:5173",
    "http://localhost:5173",
    "tauri://localhost",
    "http://tauri.localhost",
    "https://tauri.localhost",
    "http://ipc.localhost",
];

const ALLOWED_BRIDGE_COMMANDS: &[&str] = &[
    "getStatus",
    "worktree.listLeases",
    "worktree.diff",
    "worktree.readFile",
    "worktree.release",
    "pty.execute",
    "pty.stop",
    "risk.getAuditLog",
    "sidecar.getState",
    "sidecar.setOfflineMode",
    "sidecar.listEnvelopes",
    "mcp.listServers",
    "mcp.invoke",
];

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct SidecarStatusResponse {
    running: bool,
    pid: Option<u32>,
    node_binary: String,
    entry_script: String,
    protocol_version: &'static str,
    host_surface: &'static str,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ForwardCommandRequest {
    command: String,
    sender_origin: String,
    #[serde(default)]
    payload: serde_json::Value,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ForwardCommandResponse {
    accepted: bool,
    command: String,
    sidecar_pid: Option<u32>,
    payload_echo: serde_json::Value,
}

struct SidecarProcessState {
    child: Mutex<Option<Child>>,
    node_binary: String,
    entry_script: String,
}

impl SidecarProcessState {
    fn new() -> Self {
        let node_binary = env::var("MW_DESKTOP_NODE_BIN").unwrap_or_else(|_| "node".to_string());
        let entry_script = env::var("MW_DESKTOP_SIDECAR_ENTRY").unwrap_or_else(|_| {
            let mut path = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
            path.pop();
            path.push("dist");
            path.push("cli.js");
            path.to_string_lossy().into_owned()
        });

        Self {
            child: Mutex::new(None),
            node_binary,
            entry_script,
        }
    }

    fn spawn_if_needed(&self) -> Result<Option<u32>, String> {
        let mut guard = self
            .child
            .lock()
            .map_err(|_| "Sidecar state mutex poisoned".to_string())?;

        if let Some(existing) = guard.as_mut() {
            match existing.try_wait() {
                Ok(None) => return Ok(Some(existing.id())),
                Ok(Some(_)) | Err(_) => {
                    *guard = None;
                }
            }
        }

        if !PathBuf::from(&self.entry_script).exists() {
            return Ok(None);
        }

        let mut cmd = Command::new(&self.node_binary);
        cmd.arg(&self.entry_script)
            .env_clear()
            .env("PATH", env::var("PATH").unwrap_or_default())
            .env(
                "HOME",
                env::var("HOME")
                    .or_else(|_| env::var("USERPROFILE"))
                    .unwrap_or_default(),
            )
            .env(
                "USERPROFILE",
                env::var("USERPROFILE")
                    .or_else(|_| env::var("HOME"))
                    .unwrap_or_default(),
            )
            .env(
                "MW_DESKTOP_BOARD_ORIGIN",
                env::var("MW_DESKTOP_BOARD_ORIGIN")
                    .unwrap_or_else(|_| DEFAULT_BOARD_ORIGIN.to_string()),
            )
            .env(
                "MW_DESKTOP_API_URL",
                env::var("MW_DESKTOP_API_URL").unwrap_or_else(|_| DEFAULT_API_BASE_URL.to_string()),
            )
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());

        if let Ok(home_override) = env::var("MW_DESKTOP_HOME") {
            cmd.env("MW_DESKTOP_HOME", home_override);
        }
        if let Ok(repo_root) = env::var("MW_DESKTOP_REPO_ROOT") {
            cmd.env("MW_DESKTOP_REPO_ROOT", repo_root);
        }

        let child = cmd
            .spawn()
            .map_err(|err| format!("Failed to spawn Node 24.x @moonwitness/desktop sidecar: {err}"))?;
        let pid = child.id();
        *guard = Some(child);
        Ok(Some(pid))
    }

    fn shutdown(&self) {
        if let Ok(mut guard) = self.child.lock() {
            if let Some(mut child) = guard.take() {
                let _ = child.kill();
                let _ = child.wait();
            }
        }
    }

    fn status(&self) -> SidecarStatusResponse {
        let mut running = false;
        let mut pid = None;
        if let Ok(mut guard) = self.child.lock() {
            if let Some(child) = guard.as_mut() {
                if matches!(child.try_wait(), Ok(None)) {
                    running = true;
                    pid = Some(child.id());
                } else {
                    *guard = None;
                }
            }
        }
        SidecarStatusResponse {
            running,
            pid,
            node_binary: self.node_binary.clone(),
            entry_script: self.entry_script.clone(),
            protocol_version: "1.0",
            host_surface: "apps/board",
        }
    }
}

fn validate_ipc_sender(window_label: &str, sender_origin: &str) -> Result<(), String> {
    if window_label != ALLOWED_WINDOW_LABEL {
        return Err(format!(
            "IPC command rejected from non-main window label '{window_label}'"
        ));
    }
    let normalized = sender_origin.trim().trim_end_matches('/').to_lowercase();
    if !ALLOWED_ORIGINS.iter().any(|allowed| *allowed == normalized) {
        return Err(format!(
            "IPC command rejected from untrusted sender origin '{sender_origin}'"
        ));
    }
    Ok(())
}

fn validate_bridge_command(command: &str) -> Result<(), String> {
    if ALLOWED_BRIDGE_COMMANDS.iter().any(|allowed| *allowed == command) {
        Ok(())
    } else {
        Err(format!(
            "Bridge command '{command}' is not in the desktop allowlist"
        ))
    }
}

#[tauri::command]
fn mw_desktop_sidecar_status(
    window: WebviewWindow,
    state: State<'_, SidecarProcessState>,
) -> Result<SidecarStatusResponse, String> {
    if window.label() != ALLOWED_WINDOW_LABEL {
        return Err(format!(
            "Status rejected from non-main window '{}'",
            window.label()
        ));
    }
    Ok(state.status())
}

#[tauri::command]
fn mw_desktop_forward_command(
    window: WebviewWindow,
    request: ForwardCommandRequest,
    state: State<'_, SidecarProcessState>,
) -> Result<ForwardCommandResponse, String> {
    validate_ipc_sender(window.label(), &request.sender_origin)?;
    validate_bridge_command(&request.command)?;
    let pid = state.spawn_if_needed()?;
    Ok(ForwardCommandResponse {
        accepted: true,
        command: request.command,
        sidecar_pid: pid,
        payload_echo: request.payload,
    })
}

#[tauri::command]
fn mw_desktop_emergency_stop(
    window: WebviewWindow,
    state: State<'_, SidecarProcessState>,
) -> Result<SidecarStatusResponse, String> {
    if window.label() != ALLOWED_WINDOW_LABEL {
        return Err(format!(
            "Emergency stop rejected from non-main window '{}'",
            window.label()
        ));
    }
    state.shutdown();
    Ok(state.status())
}

fn main() {
    let sidecar_state = SidecarProcessState::new();
    let _ = sidecar_state.spawn_if_needed();

    let app = tauri::Builder::default()
        .manage(sidecar_state)
        .invoke_handler(tauri::generate_handler![
            mw_desktop_sidecar_status,
            mw_desktop_forward_command,
            mw_desktop_emergency_stop
        ])
        .build(tauri::generate_context!())
        .expect("error while building MoonWitness Desktop Tauri application");

    app.run(|app_handle, event| {
        if matches!(event, RunEvent::Exit | RunEvent::ExitRequested { .. }) {
            let state = app_handle.state::<SidecarProcessState>();
            state.shutdown();
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_non_main_window_and_remote_origins() {
        assert!(validate_ipc_sender("main", "http://127.0.0.1:5173").is_ok());
        assert!(validate_ipc_sender("main", "tauri://localhost").is_ok());
        assert!(validate_ipc_sender("popup", "http://127.0.0.1:5173").is_err());
        assert!(validate_ipc_sender("main", "https://evil.example").is_err());
    }

    #[test]
    fn enforces_bridge_command_allowlist() {
        assert!(validate_bridge_command("worktree.diff").is_ok());
        assert!(validate_bridge_command("pty.stop").is_ok());
        assert!(validate_bridge_command("shell.execArbitrary").is_err());
    }
}
