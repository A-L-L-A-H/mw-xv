#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use serde::{Deserialize, Serialize};
use std::env;
use std::io::{BufRead, BufReader, Read, Write};
use std::net::{SocketAddr, TcpStream};
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::{mpsc, Mutex};
use std::thread;
use std::time::{Duration, Instant};
use tauri::{Manager, RunEvent, State, WebviewWindow};

const ALLOWED_WINDOW_LABEL: &str = "main";
const DEFAULT_BOARD_ORIGIN: &str = "http://127.0.0.1:5173";
const DEFAULT_SIDECAR_API_PORT: &str = "4242";
const DEFAULT_SIDECAR_API_URL: &str = "http://127.0.0.1:4242";

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
    api_url: String,
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
    result: serde_json::Value,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SidecarReadiness {
    api_url: String,
    rpc_token: String,
}

#[derive(Debug, Clone)]
struct SidecarRuntime {
    api_url: String,
    rpc_token: String,
}

impl Default for SidecarRuntime {
    fn default() -> Self {
        Self {
            api_url: DEFAULT_SIDECAR_API_URL.to_string(),
            rpc_token: String::new(),
        }
    }
}

struct SidecarProcessState {
    child: Mutex<Option<Child>>,
    runtime: Mutex<SidecarRuntime>,
    node_binary: String,
    entry_script: String,
    api_port: String,
}

fn parse_readiness_line(line: &str) -> Option<SidecarReadiness> {
    let trimmed = line.trim();
    if !trimmed.starts_with('{') {
        return None;
    }
    let parsed: SidecarReadiness = serde_json::from_str(trimmed).ok()?;
    if parsed.api_url.trim().is_empty() || parsed.rpc_token.trim().is_empty() {
        return None;
    }
    Some(parsed)
}

fn parse_loopback_host_port(api_url: &str) -> Result<String, String> {
    let without_scheme = api_url
        .trim()
        .strip_prefix("http://")
        .ok_or_else(|| format!("Sidecar api_url must use http:// loopback: '{api_url}'"))?;
    let host_port = without_scheme
        .split('/')
        .next()
        .unwrap_or("")
        .trim();
    let (host, port_str) = host_port
        .rsplit_once(':')
        .ok_or_else(|| format!("Sidecar api_url missing port: '{api_url}'"))?;
    if host != "127.0.0.1" && host != "localhost" {
        return Err(format!(
            "Sidecar api_url must target loopback (127.0.0.1 or localhost): '{api_url}'"
        ));
    }
    let port: u16 = port_str
        .parse()
        .map_err(|_| format!("Invalid sidecar port in '{api_url}'"))?;
    let resolved_host = if host == "localhost" { "127.0.0.1" } else { host };
    Ok(format!("{resolved_host}:{port}"))
}

fn wait_for_tcp_ready(host_port: &str, timeout: Duration) -> bool {
    let addr: SocketAddr = match host_port.parse() {
        Ok(addr) => addr,
        Err(_) => return false,
    };
    let deadline = Instant::now() + timeout;
    while Instant::now() < deadline {
        if TcpStream::connect_timeout(&addr, Duration::from_millis(150)).is_ok() {
            return true;
        }
        thread::sleep(Duration::from_millis(100));
    }
    false
}

fn build_rpc_http_request(
    host_port: &str,
    rpc_token: &str,
    command: &str,
    payload: &serde_json::Value,
) -> Result<Vec<u8>, String> {
    let body = serde_json::to_vec(&serde_json::json!({
        "command": command,
        "payload": payload,
    }))
    .map_err(|err| format!("Failed to serialize desktop RPC body: {err}"))?;

    let headers = format!(
        "POST /_desktop/rpc HTTP/1.1\r\nHost: {host_port}\r\nContent-Type: application/json\r\nx-mw-desktop-token: {rpc_token}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
        body.len()
    );
    let mut request = Vec::with_capacity(headers.len() + body.len());
    request.extend_from_slice(headers.as_bytes());
    request.extend_from_slice(&body);
    Ok(request)
}

fn decode_chunked_body(raw: &[u8]) -> Result<Vec<u8>, String> {
    let mut out = Vec::new();
    let mut pos = 0;
    while pos < raw.len() {
        let line_end = raw[pos..]
            .windows(2)
            .position(|w| w == b"\r\n")
            .ok_or_else(|| "Malformed chunked HTTP response: missing chunk size CRLF".to_string())?;
        let size_str = std::str::from_utf8(&raw[pos..pos + line_end])
            .map_err(|_| "Malformed chunked HTTP response: non-UTF8 chunk size".to_string())?
            .split(';')
            .next()
            .unwrap_or("")
            .trim();
        let chunk_size = usize::from_str_radix(size_str, 16)
            .map_err(|_| format!("Malformed chunked HTTP response: invalid size '{size_str}'"))?;
        pos += line_end + 2;
        if chunk_size == 0 {
            break;
        }
        if pos + chunk_size > raw.len() {
            return Err("Malformed chunked HTTP response: truncated chunk".to_string());
        }
        out.extend_from_slice(&raw[pos..pos + chunk_size]);
        pos += chunk_size;
        if raw.get(pos..pos + 2) == Some(b"\r\n") {
            pos += 2;
        }
    }
    Ok(out)
}

fn parse_rpc_http_response(raw: &[u8]) -> Result<(u16, serde_json::Value), String> {
    let split = raw
        .windows(4)
        .position(|w| w == b"\r\n\r\n")
        .ok_or_else(|| "Malformed HTTP response from sidecar: missing header terminator".to_string())?;
    let header_text = std::str::from_utf8(&raw[..split])
        .map_err(|_| "Malformed HTTP response from sidecar: non-UTF8 headers".to_string())?;
    let mut lines = header_text.lines();
    let status_line = lines
        .next()
        .ok_or_else(|| "Malformed HTTP response from sidecar: empty status line".to_string())?;
    let status_code: u16 = status_line
        .split_whitespace()
        .nth(1)
        .ok_or_else(|| format!("Malformed HTTP status line: '{status_line}'"))?
        .parse()
        .map_err(|_| format!("Invalid HTTP status code in: '{status_line}'"))?;

    let is_chunked = lines.any(|line| {
        if let Some((name, value)) = line.split_once(':') {
            name.trim().eq_ignore_ascii_case("transfer-encoding")
                && value.to_ascii_lowercase().contains("chunked")
        } else {
            false
        }
    });

    let body_slice = &raw[split + 4..];
    let body_bytes = if is_chunked {
        decode_chunked_body(body_slice)?
    } else {
        body_slice.to_vec()
    };

    if body_bytes.is_empty() {
        return Ok((status_code, serde_json::Value::Null));
    }

    let parsed = serde_json::from_slice::<serde_json::Value>(&body_bytes).unwrap_or_else(|_| {
        serde_json::Value::String(String::from_utf8_lossy(&body_bytes).into_owned())
    });
    Ok((status_code, parsed))
}

fn send_loopback_rpc(
    api_url: &str,
    rpc_token: &str,
    command: &str,
    payload: &serde_json::Value,
) -> Result<(u16, serde_json::Value), String> {
    let host_port = parse_loopback_host_port(api_url)?;
    let addr: SocketAddr = host_port
        .parse()
        .map_err(|err| format!("Invalid loopback address '{host_port}': {err}"))?;
    let mut stream = TcpStream::connect_timeout(&addr, Duration::from_secs(3))
        .map_err(|err| format!("Failed to connect to sidecar RPC at {host_port}: {err}"))?;
    let _ = stream.set_read_timeout(Some(Duration::from_secs(15)));
    let _ = stream.set_write_timeout(Some(Duration::from_secs(5)));

    let request = build_rpc_http_request(&host_port, rpc_token, command, payload)?;
    stream
        .write_all(&request)
        .map_err(|err| format!("Failed to write sidecar RPC request: {err}"))?;
    stream
        .flush()
        .map_err(|err| format!("Failed to flush sidecar RPC request: {err}"))?;

    let mut raw_response = Vec::new();
    stream
        .read_to_end(&mut raw_response)
        .map_err(|err| format!("Failed to read sidecar RPC response: {err}"))?;

    parse_rpc_http_response(&raw_response)
}

fn build_bridge_init_script(api_url: &str, rpc_token: &str) -> String {
    let api_url_json = serde_json::to_string(api_url).unwrap_or_else(|_| "\"http://127.0.0.1:4242\"".to_string());
    let rpc_token_json = serde_json::to_string(rpc_token).unwrap_or_else(|_| "\"\"".to_string());
    format!(
        r#"(function() {{
  'use strict';
  const apiUrl = {api_url_json};
  const rpcToken = {rpc_token_json};
  async function invokeRpc(command, payload) {{
    const response = await fetch(apiUrl + '/_desktop/rpc', {{
      method: 'POST',
      headers: {{
        'content-type': 'application/json',
        'x-mw-desktop-token': rpcToken,
      }},
      body: JSON.stringify({{ command, payload: payload === undefined ? {{}} : payload }}),
    }});
    const text = await response.text();
    let parsed = null;
    if (text) {{
      try {{ parsed = JSON.parse(text); }} catch (_) {{ parsed = text; }}
    }}
    if (!response.ok) {{
      const message = (parsed && typeof parsed === 'object' && parsed.error) ? String(parsed.error) : ('Desktop RPC failed: ' + response.status);
      throw new Error(message);
    }}
    return parsed && typeof parsed === 'object' && 'result' in parsed ? parsed.result : parsed;
  }}

  const bridge = Object.freeze({{
    protocolVersion: '1.0',
    hostSurface: 'apps/board',
    getStatus: () => invokeRpc('getStatus', {{}}),
    worktree: Object.freeze({{
      listLeases: () => invokeRpc('worktree.listLeases', {{}}),
      diff: (runId) => invokeRpc('worktree.diff', {{ runId }}),
      readFile: (runId, relativePath) => invokeRpc('worktree.readFile', {{ runId, relativePath }}),
      release: (runId) => invokeRpc('worktree.release', {{ runId }}),
    }}),
    pty: Object.freeze({{
      execute: (req, auth) => invokeRpc('pty.execute', {{ req, auth }}),
      stop: (runId) => invokeRpc('pty.stop', {{ runId }}),
    }}),
    risk: Object.freeze({{
      getAuditLog: (limit) => invokeRpc('risk.getAuditLog', {{ limit }}),
    }}),
    sidecar: Object.freeze({{
      getState: () => invokeRpc('sidecar.getState', {{}}),
      setOfflineMode: (offline) => invokeRpc('sidecar.setOfflineMode', {{ offline }}),
      listEnvelopes: (filters) => invokeRpc('sidecar.listEnvelopes', {{ filters }}),
    }}),
    mcp: Object.freeze({{
      listServers: () => invokeRpc('mcp.listServers', {{}}),
      invoke: (req) => invokeRpc('mcp.invoke', req),
    }}),
  }});

  if (!Object.prototype.hasOwnProperty.call(window, '__MW_DESKTOP_API_URL__')) {{
    Object.defineProperty(window, '__MW_DESKTOP_API_URL__', {{
      value: apiUrl,
      writable: false,
      enumerable: true,
      configurable: false,
    }});
  }}
  if (!Object.prototype.hasOwnProperty.call(window, '__MW_DESKTOP__')) {{
    Object.defineProperty(window, '__MW_DESKTOP__', {{
      value: bridge,
      writable: false,
      enumerable: true,
      configurable: false,
    }});
  }}
}})();"#,
    )
}

fn open_sidecar_stderr_stdio() -> Stdio {
    let base_dir = env::var("MW_DESKTOP_HOME")
        .ok()
        .filter(|val| !val.trim().is_empty())
        .map(PathBuf::from)
        .or_else(|| {
            env::var("USERPROFILE")
                .or_else(|_| env::var("HOME"))
                .ok()
                .filter(|val| !val.trim().is_empty())
                .map(|home| PathBuf::from(home).join(".moonwitness").join("desktop"))
        });

    if let Some(desktop_home) = base_dir {
        let logs_dir = desktop_home.join("logs");
        if std::fs::create_dir_all(&logs_dir).is_ok() {
            let stderr_path = logs_dir.join("sidecar-stderr.log");
            if let Ok(file) = std::fs::OpenOptions::new()
                .create(true)
                .append(true)
                .open(stderr_path)
            {
                return Stdio::from(file);
            }
        }
    }

    Stdio::null()
}

fn resolve_bundled_sidecar_paths(exe_dir: &std::path::Path) -> Option<(String, String)> {
    let sidecar_dir = exe_dir.join("resources").join("sidecar");
    #[cfg(windows)]
    let node_bin = sidecar_dir.join("node.exe");
    #[cfg(not(windows))]
    let node_bin = sidecar_dir.join("node");
    let entry_script = sidecar_dir.join("dist").join("cli.js");

    if node_bin.is_file() && entry_script.is_file() {
        Some((
            node_bin.to_string_lossy().into_owned(),
            entry_script.to_string_lossy().into_owned(),
        ))
    } else {
        None
    }
}

impl SidecarProcessState {
    fn new() -> Self {
        let bundled = env::current_exe()
            .ok()
            .and_then(|exe| exe.parent().map(resolve_bundled_sidecar_paths))
            .flatten();

        let (default_node, default_entry) = match bundled {
            Some((node_bin, entry_script)) => (node_bin, entry_script),
            None => {
                let mut path = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
                path.pop();
                path.push("dist");
                path.push("cli.js");
                ("node".to_string(), path.to_string_lossy().into_owned())
            }
        };

        let node_binary = env::var("MW_DESKTOP_NODE_BIN").unwrap_or(default_node);
        let entry_script = env::var("MW_DESKTOP_SIDECAR_ENTRY").unwrap_or(default_entry);
        let api_port =
            env::var("MW_DESKTOP_API_PORT").unwrap_or_else(|_| DEFAULT_SIDECAR_API_PORT.to_string());

        Self {
            child: Mutex::new(None),
            runtime: Mutex::new(SidecarRuntime {
                api_url: format!("http://127.0.0.1:{api_port}"),
                rpc_token: String::new(),
            }),
            node_binary,
            entry_script,
            api_port,
        }
    }

    fn runtime_snapshot(&self) -> SidecarRuntime {
        self.runtime
            .lock()
            .map(|guard| guard.clone())
            .unwrap_or_default()
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
            .arg("--offline")
            .arg("--api-port")
            .arg(&self.api_port)
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
                env::var("MW_DESKTOP_API_URL")
                    .unwrap_or_else(|_| format!("http://127.0.0.1:{}", self.api_port)),
            )
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(open_sidecar_stderr_stdio());

        for key in [
            "SystemRoot",
            "SYSTEMROOT",
            "WINDIR",
            "SYSTEMDRIVE",
            "TEMP",
            "TMP",
            "COMSPEC",
            "APPDATA",
            "LOCALAPPDATA",
        ] {
            if let Ok(val) = env::var(key) {
                cmd.env(key, val);
            }
        }

        if let Ok(home_override) = env::var("MW_DESKTOP_HOME") {
            cmd.env("MW_DESKTOP_HOME", home_override);
        }
        if let Ok(repo_root) = env::var("MW_DESKTOP_REPO_ROOT") {
            cmd.env("MW_DESKTOP_REPO_ROOT", repo_root);
        }

        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW
        }

        let mut child = cmd
            .spawn()
            .map_err(|err| format!("Failed to spawn Node 24.x @moonwitness/desktop sidecar: {err}"))?;
        let pid = child.id();

        if let Some(stdout) = child.stdout.take() {
            let (tx, rx) = mpsc::channel::<SidecarReadiness>();
            thread::spawn(move || {
                let reader = BufReader::new(stdout);
                let mut sent = false;
                for line in reader.lines().map_while(Result::ok) {
                    if !sent {
                        if let Some(readiness) = parse_readiness_line(&line) {
                            let _ = tx.send(readiness);
                            sent = true;
                        }
                    }
                }
            });

            if let Ok(readiness) = rx.recv_timeout(Duration::from_secs(10)) {
                if let Ok(host_port) = parse_loopback_host_port(&readiness.api_url) {
                    let _ = wait_for_tcp_ready(&host_port, Duration::from_secs(5));
                }
                if let Ok(mut rt) = self.runtime.lock() {
                    rt.api_url = readiness.api_url;
                    rt.rpc_token = readiness.rpc_token;
                }
            } else {
                let fallback_host_port = format!("127.0.0.1:{}", self.api_port);
                let _ = wait_for_tcp_ready(&fallback_host_port, Duration::from_secs(5));
            }
        }

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
        let runtime = self.runtime_snapshot();
        SidecarStatusResponse {
            running,
            pid,
            node_binary: self.node_binary.clone(),
            entry_script: self.entry_script.clone(),
            api_url: runtime.api_url,
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
    let runtime = state.runtime_snapshot();
    let (status_code, result) = send_loopback_rpc(
        &runtime.api_url,
        &runtime.rpc_token,
        &request.command,
        &request.payload,
    )?;
    if status_code >= 400 {
        return Err(format!(
            "Sidecar RPC '{}' failed with HTTP {}: {}",
            request.command, status_code, result
        ));
    }
    Ok(ForwardCommandResponse {
        accepted: true,
        command: request.command,
        sidecar_pid: pid,
        result,
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
    let runtime = sidecar_state.runtime_snapshot();
    let init_script = build_bridge_init_script(&runtime.api_url, &runtime.rpc_token);

    let bridge_plugin = tauri::plugin::Builder::<tauri::Wry>::new("mw-desktop-bridge")
        .js_init_script(init_script)
        .build();

    let app = tauri::Builder::default()
        .plugin(bridge_plugin)
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

    #[test]
    fn parses_sidecar_readiness_json_lines() {
        let valid = r#"{"event":"ready","apiUrl":"http://127.0.0.1:4242","rpcToken":"tok-abc-123"}"#;
        let parsed = parse_readiness_line(valid).expect("valid readiness JSON");
        assert_eq!(parsed.api_url, "http://127.0.0.1:4242");
        assert_eq!(parsed.rpc_token, "tok-abc-123");

        assert!(parse_readiness_line("non-json log line").is_none());
        assert!(parse_readiness_line(r#"{"apiUrl":"","rpcToken":"x"}"#).is_none());
        assert!(parse_readiness_line(r#"{"apiUrl":"http://127.0.0.1:4242"}"#).is_none());
    }

    #[test]
    fn validates_loopback_host_port_extraction() {
        assert_eq!(
            parse_loopback_host_port("http://127.0.0.1:4242").unwrap(),
            "127.0.0.1:4242"
        );
        assert_eq!(
            parse_loopback_host_port("http://localhost:4242/api").unwrap(),
            "127.0.0.1:4242"
        );
        assert!(parse_loopback_host_port("https://127.0.0.1:4242").is_err());
        assert!(parse_loopback_host_port("http://evil.example:4242").is_err());
    }

    #[test]
    fn frames_and_parses_http_rpc_requests_and_responses() {
        let req_bytes = build_rpc_http_request(
            "127.0.0.1:4242",
            "secret-tok",
            "getStatus",
            &serde_json::json!({"verbose": true}),
        )
        .unwrap();
        let req_text = String::from_utf8(req_bytes).unwrap();
        assert!(req_text.starts_with("POST /_desktop/rpc HTTP/1.1\r\n"));
        assert!(req_text.contains("x-mw-desktop-token: secret-tok\r\n"));
        assert!(req_text.contains(r#""command":"getStatus""#));

        let plain_resp = b"HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: 27\r\n\r\n{\"ok\":true,\"result\":{\"v\":1}}";
        let (status, body) = parse_rpc_http_response(plain_resp).unwrap();
        assert_eq!(status, 200);
        assert_eq!(body["ok"], serde_json::json!(true));
        assert_eq!(body["result"]["v"], serde_json::json!(1));

        let chunked_resp = b"HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\nb\r\n{\"ok\":true}\r\n0\r\n\r\n";
        let (c_status, c_body) = parse_rpc_http_response(chunked_resp).unwrap();
        assert_eq!(c_status, 200);
        assert_eq!(c_body["ok"], serde_json::json!(true));

        let err_resp = b"HTTP/1.1 401 Unauthorized\r\nContent-Length: 24\r\n\r\n{\"error\":\"unauthorized\"}";
        let (e_status, e_body) = parse_rpc_http_response(err_resp).unwrap();
        assert_eq!(e_status, 401);
        assert_eq!(e_body["error"], serde_json::json!("unauthorized"));
    }

    #[test]
    fn builds_frozen_bridge_init_script_without_leaking_token_on_window() {
        let script = build_bridge_init_script("http://127.0.0.1:4242", "ephemeral-secret");
        assert!(script.contains("__MW_DESKTOP_API_URL__"));
        assert!(script.contains("__MW_DESKTOP__"));
        assert!(script.contains("Object.freeze("));
        assert!(!script.contains("window.rpcToken"));
        assert!(!script.contains("window.__MW_DESKTOP_RPC_TOKEN__"));
    }

    #[test]
    fn resolves_bundled_sidecar_when_present_and_returns_none_otherwise() {
        let temp_root = env::temp_dir().join(format!(
            "mw-desktop-sidecar-test-{}",
            std::process::id()
        ));
        let _ = std::fs::remove_dir_all(&temp_root);
        assert!(resolve_bundled_sidecar_paths(&temp_root).is_none());

        let sidecar_dist = temp_root.join("resources").join("sidecar").join("dist");
        std::fs::create_dir_all(&sidecar_dist).unwrap();
        #[cfg(windows)]
        let node_name = "node.exe";
        #[cfg(not(windows))]
        let node_name = "node";
        let node_path = temp_root.join("resources").join("sidecar").join(node_name);
        let entry_path = sidecar_dist.join("cli.js");
        std::fs::write(&node_path, b"").unwrap();
        std::fs::write(&entry_path, b"").unwrap();

        let resolved = resolve_bundled_sidecar_paths(&temp_root)
            .expect("bundled sidecar should resolve when node and cli.js exist");
        assert_eq!(resolved.0, node_path.to_string_lossy());
        assert_eq!(resolved.1, entry_path.to_string_lossy());

        let _ = std::fs::remove_dir_all(&temp_root);
    }
}
