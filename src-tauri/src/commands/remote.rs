use chrono::Utc;
use serde::{Deserialize, Serialize};
use std::fs;
use std::net::TcpListener;
use std::path::PathBuf;
use std::process::Command;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct RemoteBridgeStatus {
    pub running: bool,
    pub pid: Option<u32>,
    pub status: String,
    pub port: Option<u16>,
    pub token: Option<String>,
    #[serde(default)]
    pub local_urls: Vec<String>,
    pub started_at: Option<String>,
    pub updated_at: Option<String>,
    pub last_request_at: Option<String>,
    pub last_error: Option<String>,
    pub active_thread_id: Option<String>,
    pub log_path: String,
}

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct RemoteBridgeLogTail {
    pub log_path: String,
    pub lines: Vec<String>,
    pub truncated: bool,
    pub updated_at: String,
}

#[derive(Clone, Debug, Default)]
pub(crate) struct RemoteRelayConfig {
    pub relay_base_url: Option<String>,
    pub relay_host_id: Option<String>,
    pub relay_host_display_name: Option<String>,
    pub relay_state_path: Option<String>,
}

fn agenthub_dir() -> Result<PathBuf, String> {
    let home = dirs::home_dir().ok_or("Cannot determine home directory")?;
    let dir = home.join(".agenthub");
    if !dir.exists() {
        fs::create_dir_all(&dir)
            .map_err(|error| format!("Failed to create .agenthub dir: {}", error))?;
    }
    Ok(dir)
}

fn agenthub_runtime_dir() -> Result<PathBuf, String> {
    let dir = agenthub_dir()?.join("runtime");
    if !dir.exists() {
        fs::create_dir_all(&dir)
            .map_err(|error| format!("Failed to create runtime dir: {}", error))?;
    }
    Ok(dir)
}

fn agenthub_logs_dir() -> Result<PathBuf, String> {
    let dir = agenthub_dir()?.join("logs");
    if !dir.exists() {
        fs::create_dir_all(&dir)
            .map_err(|error| format!("Failed to create logs dir: {}", error))?;
    }
    Ok(dir)
}

fn remote_bridge_pid_path() -> Result<PathBuf, String> {
    Ok(agenthub_runtime_dir()?.join("remote-bridge.pid"))
}

fn remote_bridge_state_path() -> Result<PathBuf, String> {
    Ok(agenthub_runtime_dir()?.join("remote-bridge.json"))
}

fn remote_bridge_log_path() -> Result<PathBuf, String> {
    Ok(agenthub_logs_dir()?.join("remote-bridge.log"))
}

fn remote_bridge_script_path() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("scripts")
        .join("remote-bridge-worker.mjs")
}

fn agenthub_project_root() -> Result<PathBuf, String> {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .map(|path| path.to_path_buf())
        .ok_or("Cannot determine AgentHub project root".to_string())
}

fn with_augmented_path(cmd: &mut Command) {
    if let Some(home) = dirs::home_dir() {
        let npm_bin = home.join(".npm-global/bin");
        let local_bin = home.join(".local/bin");
        let brew_bin = std::path::PathBuf::from("/opt/homebrew/bin");
        let usr_local_bin = std::path::PathBuf::from("/usr/local/bin");
        let current_path = std::env::var("PATH").unwrap_or_default();
        cmd.env(
            "PATH",
            format!(
                "{}:{}:{}:{}:{}",
                npm_bin.to_string_lossy(),
                local_bin.to_string_lossy(),
                brew_bin.to_string_lossy(),
                usr_local_bin.to_string_lossy(),
                current_path
            ),
        );
    }
}

fn shell_quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', "'\"'\"'"))
}

fn read_pid_file(path: &PathBuf) -> Result<Option<u32>, String> {
    if !path.exists() {
        return Ok(None);
    }
    let content =
        fs::read_to_string(path).map_err(|error| format!("Failed to read pid file: {}", error))?;
    Ok(content.trim().parse::<u32>().ok())
}

fn write_pid_file(path: &PathBuf, pid: u32) -> Result<(), String> {
    fs::write(path, format!("{}\n", pid))
        .map_err(|error| format!("Failed to write pid file: {}", error))
}

fn pid_is_running(pid: u32) -> bool {
    Command::new("kill")
        .arg("-0")
        .arg(pid.to_string())
        .status()
        .map(|status| status.success())
        .unwrap_or(false)
}

fn default_remote_bridge_status() -> Result<RemoteBridgeStatus, String> {
    Ok(RemoteBridgeStatus {
        running: false,
        pid: None,
        status: "stopped".to_string(),
        port: None,
        token: None,
        local_urls: vec![],
        started_at: None,
        updated_at: None,
        last_request_at: None,
        last_error: None,
        active_thread_id: None,
        log_path: remote_bridge_log_path()?.to_string_lossy().to_string(),
    })
}

fn read_remote_bridge_state() -> Result<RemoteBridgeStatus, String> {
    let path = remote_bridge_state_path()?;
    if !path.exists() {
        return default_remote_bridge_status();
    }

    let content = fs::read_to_string(&path)
        .map_err(|error| format!("Failed to read remote bridge state: {}", error))?;
    let mut raw_value = serde_json::from_str::<serde_json::Value>(&content)
        .map_err(|error| format!("Failed to parse remote bridge state: {}", error))?;
    if raw_value
        .get("logPath")
        .map(|value| value.is_null())
        .unwrap_or(false)
    {
        raw_value["logPath"] = serde_json::Value::String(String::new());
    }
    let mut status = serde_json::from_value::<RemoteBridgeStatus>(raw_value)
        .map_err(|error| format!("Failed to parse remote bridge state payload: {}", error))?;
    status.log_path = remote_bridge_log_path()?.to_string_lossy().to_string();
    Ok(status)
}

fn write_remote_bridge_state(status: &RemoteBridgeStatus) -> Result<(), String> {
    let path = remote_bridge_state_path()?;
    let mut next = status.clone();
    next.log_path = remote_bridge_log_path()?.to_string_lossy().to_string();
    let json = serde_json::to_string_pretty(&next)
        .map_err(|error| format!("Failed to serialize remote bridge state: {}", error))?;
    fs::write(path, format!("{}\n", json))
        .map_err(|error| format!("Failed to write remote bridge state: {}", error))
}

fn remove_file_if_exists(path: PathBuf) {
    if path.exists() {
        let _ = fs::remove_file(path);
    }
}

fn generate_bridge_token() -> String {
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    format!("ahb_{}_{:x}", std::process::id(), now)
}

fn choose_remote_bridge_port(preferred: u16) -> u16 {
    for offset in 0..32 {
        let candidate = preferred.saturating_add(offset);
        if TcpListener::bind(("0.0.0.0", candidate)).is_ok() {
            return candidate;
        }
    }
    preferred
}

fn remote_bridge_health_ok(port: u16) -> bool {
    let mut command = Command::new("curl");
    command
        .arg("-s")
        .arg("-m")
        .arg("2")
        .arg(format!("http://127.0.0.1:{}/health", port));
    with_augmented_path(&mut command);

    command
        .output()
        .map(|output| {
            output.status.success()
                && {
                    let stdout = String::from_utf8_lossy(&output.stdout);
                    stdout.contains("\"ok\": true")
                        && stdout.contains("\"service\": \"agenthub-remote-bridge\"")
                }
        })
        .unwrap_or(false)
}

fn find_node_path() -> Option<String> {
    for candidate in ["node", "/opt/homebrew/bin/node", "/usr/local/bin/node"] {
        let mut command = Command::new(candidate);
        command.arg("--version");
        with_augmented_path(&mut command);
        if command
            .status()
            .map(|status| status.success())
            .unwrap_or(false)
        {
            return Some(candidate.to_string());
        }
    }
    None
}

fn stop_remote_bridge_internal() -> Result<RemoteBridgeStatus, String> {
    let mut pid = read_pid_file(&remote_bridge_pid_path()?)?;
    if pid.is_none() {
        pid = read_remote_bridge_state()
            .ok()
            .and_then(|status| status.pid)
            .filter(|value| pid_is_running(*value));
    }

    if let Some(pid) = pid {
        let _ = Command::new("kill").arg(pid.to_string()).status();
        std::thread::sleep(Duration::from_millis(400));
        if pid_is_running(pid) {
            let _ = Command::new("kill").arg("-9").arg(pid.to_string()).status();
        }
    }

    remove_file_if_exists(remote_bridge_pid_path()?);

    let mut status = read_remote_bridge_state().or_else(|_| default_remote_bridge_status())?;
    status.running = false;
    status.pid = None;
    status.status = "stopped".to_string();
    status.updated_at = Some(Utc::now().to_rfc3339());
    write_remote_bridge_state(&status)?;
    Ok(status)
}

pub(crate) fn spawn_remote_bridge(
    force_restart: bool,
    relay_config: Option<RemoteRelayConfig>,
) -> Result<RemoteBridgeStatus, String> {
    if force_restart {
        let _ = stop_remote_bridge_internal();
    } else {
        let existing = get_remote_bridge_status()?;
        if existing.running {
            return Ok(existing);
        }
    }

    let state = read_remote_bridge_state().or_else(|_| default_remote_bridge_status())?;
    let token = state
        .token
        .clone()
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(generate_bridge_token);
    let preferred_port = state.port.unwrap_or(18921);
    let port = choose_remote_bridge_port(preferred_port);
    let script_path = remote_bridge_script_path();
    if !script_path.exists() {
        let mut errored = default_remote_bridge_status()?;
        errored.status = "error".to_string();
        errored.last_error = Some(format!(
            "remote bridge 脚本不存在：{}",
            script_path.display()
        ));
        errored.port = Some(port);
        errored.token = Some(token);
        errored.updated_at = Some(Utc::now().to_rfc3339());
        write_remote_bridge_state(&errored)?;
        return Ok(errored);
    }

    let node = match find_node_path() {
        Some(path) => path,
        None => {
            let mut errored = default_remote_bridge_status()?;
            errored.status = "error".to_string();
            errored.last_error = Some("没有找到可用的 node 可执行文件。".to_string());
            errored.port = Some(port);
            errored.token = Some(token);
            errored.updated_at = Some(Utc::now().to_rfc3339());
            write_remote_bridge_state(&errored)?;
            return Ok(errored);
        }
    };

    let log_path = remote_bridge_log_path()?;
    let mut starting = default_remote_bridge_status()?;
    starting.status = "starting".to_string();
    starting.port = Some(port);
    starting.token = Some(token.clone());
    starting.updated_at = Some(Utc::now().to_rfc3339());
    write_remote_bridge_state(&starting)?;

    let shell_command = format!(
        "nohup {} {} >> {} 2>&1 < /dev/null & echo $!",
        shell_quote(&node),
        shell_quote(&script_path.to_string_lossy()),
        shell_quote(&log_path.to_string_lossy())
    );

    let mut command = Command::new("sh");
    command.arg("-lc").arg(shell_command);
    command.env("AGENTHUB_PROJECT_ROOT", agenthub_project_root()?.to_string_lossy().to_string());
    command.env(
        "AGENTHUB_REMOTE_BRIDGE_PORT",
        port.to_string(),
    );
    command.env("AGENTHUB_REMOTE_BRIDGE_TOKEN", token);
    command.env(
        "AGENTHUB_REMOTE_BRIDGE_STATE_PATH",
        remote_bridge_state_path()?.to_string_lossy().to_string(),
    );
    command.env(
        "AGENTHUB_REMOTE_BRIDGE_LOG_PATH",
        log_path.to_string_lossy().to_string(),
    );
    if let Some(relay) = relay_config {
        if let Some(relay_base_url) = relay.relay_base_url {
            command.env("AGENTHUB_RELAY_BASE_URL", relay_base_url);
        }
        if let Some(relay_host_id) = relay.relay_host_id {
            command.env("AGENTHUB_RELAY_HOST_ID", relay_host_id);
        }
        if let Some(relay_host_display_name) = relay.relay_host_display_name {
            command.env("AGENTHUB_RELAY_HOST_DISPLAY_NAME", relay_host_display_name);
        }
        if let Some(relay_state_path) = relay.relay_state_path {
            command.env("AGENTHUB_RELAY_AGENT_STATE_PATH", relay_state_path);
        }
    }
    with_augmented_path(&mut command);

    let output = command
        .output()
        .map_err(|error| format!("Failed to start remote bridge: {}", error))?;
    if !output.status.success() {
        let mut errored = default_remote_bridge_status()?;
        errored.status = "error".to_string();
        errored.port = Some(port);
        errored.last_error = Some(format!(
            "启动 remote bridge 失败：{}",
            String::from_utf8_lossy(&output.stderr)
        ));
        errored.updated_at = Some(Utc::now().to_rfc3339());
        write_remote_bridge_state(&errored)?;
        return Ok(errored);
    }

    let pid = String::from_utf8_lossy(&output.stdout)
        .trim()
        .parse::<u32>()
        .ok();
    if let Some(pid) = pid {
        write_pid_file(&remote_bridge_pid_path()?, pid)?;
    }

    std::thread::sleep(Duration::from_millis(900));
    get_remote_bridge_status()
}

#[tauri::command]
pub fn get_remote_bridge_status() -> Result<RemoteBridgeStatus, String> {
    let mut status =
        read_remote_bridge_state().or_else(|_| default_remote_bridge_status())?;
    let pid_path = remote_bridge_pid_path()?;
    let pid_from_file = read_pid_file(&pid_path)?;
    let pid_from_state = status.pid.filter(|pid| pid_is_running(*pid));
    let running_pid = pid_from_file
        .filter(|pid| pid_is_running(*pid))
        .or(pid_from_state);

    let healthy_port = status.port.filter(|port| remote_bridge_health_ok(*port));

    if running_pid.is_none() {
        if let Some(port) = healthy_port {
            status.running = true;
            status.status = "running".to_string();
            status.port = Some(port);
            if status.last_error.as_deref().map(|msg| msg.contains("EADDRINUSE")).unwrap_or(false)
            {
                status.last_error = None;
            }
        } else {
            status.running = false;
        }
    } else {
        status.running = true;
        status.pid = running_pid;
        status.status = "running".to_string();
        if status.last_error.as_deref().map(|msg| msg.contains("EADDRINUSE")).unwrap_or(false) {
            status.last_error = None;
        }
        if let Some(pid) = running_pid {
            let _ = write_pid_file(&pid_path, pid);
        }
    }

    if !status.running && (status.status == "running" || status.status == "starting") {
        status.status = "stopped".to_string();
    }

    status.log_path = remote_bridge_log_path()?.to_string_lossy().to_string();
    Ok(status)
}

#[tauri::command]
pub fn sync_remote_bridge(force_restart: Option<bool>) -> Result<RemoteBridgeStatus, String> {
    spawn_remote_bridge(force_restart.unwrap_or(false), None)
}

#[tauri::command]
pub fn stop_remote_bridge() -> Result<RemoteBridgeStatus, String> {
    stop_remote_bridge_internal()
}

#[tauri::command]
pub fn read_remote_bridge_log(
    tail_lines: Option<usize>,
) -> Result<RemoteBridgeLogTail, String> {
    let log_path = remote_bridge_log_path()?;
    let limit = tail_lines.unwrap_or(80).clamp(10, 400);

    let content = if log_path.exists() {
        fs::read_to_string(&log_path)
            .map_err(|error| format!("Failed to read remote bridge log: {}", error))?
    } else {
        String::new()
    };

    let all_lines: Vec<String> = content.lines().map(|line| line.to_string()).collect();
    let truncated = all_lines.len() > limit;
    let start = all_lines.len().saturating_sub(limit);

    Ok(RemoteBridgeLogTail {
        log_path: log_path.to_string_lossy().to_string(),
        lines: all_lines.into_iter().skip(start).collect(),
        truncated,
        updated_at: Utc::now().to_rfc3339(),
    })
}
