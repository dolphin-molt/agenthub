use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use chrono::{Duration as ChronoDuration, Utc};
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::fs;
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct RelayModelSelection {
    pub provider_id: String,
    pub model_id: String,
}

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct RelayMediaConfig {
    #[serde(default)]
    pub voice: Option<RelayModelSelection>,
    #[serde(default)]
    pub video: Option<RelayModelSelection>,
}

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct RelayActiveCallSummary {
    pub call_id: String,
    pub host_id: String,
    pub client_id: String,
    pub session_id: Option<String>,
    pub mode: String,
    pub state: String,
    pub created_at: String,
    pub updated_at: String,
    #[serde(default)]
    pub media_config: Option<RelayMediaConfig>,
}

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct RelayAgentStatus {
    pub running: bool,
    pub pid: Option<u32>,
    pub status: String,
    pub relay_base_url: Option<String>,
    pub host_id: Option<String>,
    pub host_display_name: Option<String>,
    pub session_count: usize,
    pub started_at: Option<String>,
    pub updated_at: Option<String>,
    pub last_sync_at: Option<String>,
    pub connected_at: Option<String>,
    pub last_error: Option<String>,
    #[serde(default)]
    pub media_defaults: Option<RelayMediaConfig>,
    #[serde(default)]
    pub active_call: Option<RelayActiveCallSummary>,
    pub log_path: String,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct RelayPairingInvite {
    pub invite_id: String,
    pub host_id: String,
    pub relay_base_url: String,
    pub code: String,
    pub expires_at: String,
    pub pairing_url: String,
    pub pairing_app_url: String,
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

fn relay_agent_state_path() -> Result<PathBuf, String> {
    Ok(agenthub_runtime_dir()?.join("relay-agent.json"))
}

fn relay_agent_log_path() -> Result<PathBuf, String> {
    Ok(agenthub_logs_dir()?.join("remote-bridge.log"))
}

fn default_host_display_name() -> String {
    sysinfo::System::host_name().unwrap_or_else(|| "This Mac".to_string())
}

fn generate_relay_host_id() -> String {
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    format!("host_{}_{:x}", std::process::id(), now)
}

fn generate_pairing_invite_id() -> String {
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();
    format!("invite_{}_{}", std::process::id(), now)
}

fn generate_pairing_code() -> String {
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    format!("PAIR-{:x}", now).chars().take(13).collect()
}

pub(crate) fn normalize_relay_base_url(input: &str) -> Option<String> {
    let trimmed = input.trim().trim_end_matches('/').trim();
    if trimmed.is_empty() {
        return None;
    }
    Some(trimmed.to_string())
}

pub(crate) fn build_pairing_url(
    relay_base_url: &str,
    host_id: &str,
    invite_id: &str,
    code: &str,
    expires_at: &str,
) -> String {
    let normalized = normalize_relay_base_url(relay_base_url)
        .unwrap_or_else(|| relay_base_url.trim().to_string());
    let landing_base = normalized
        .strip_suffix("/api")
        .unwrap_or(&normalized)
        .trim_end_matches('/');
    let payload = json!({
        "v": 1,
        "relayBaseUrl": normalized,
        "hostId": host_id,
        "inviteId": invite_id,
        "code": code,
        "expiresAt": expires_at
    });
    let encoded = URL_SAFE_NO_PAD.encode(payload.to_string());
    format!("{}/pair#pairing={}", landing_base, encoded)
}

pub(crate) fn build_pairing_app_url(
    relay_base_url: &str,
    host_id: &str,
    invite_id: &str,
    code: &str,
    expires_at: &str,
) -> String {
    let normalized = normalize_relay_base_url(relay_base_url)
        .unwrap_or_else(|| relay_base_url.trim().to_string());
    let payload = json!({
        "v": 1,
        "relayBaseUrl": normalized,
        "hostId": host_id,
        "inviteId": invite_id,
        "code": code,
        "expiresAt": expires_at,
    });
    let encoded = URL_SAFE_NO_PAD.encode(payload.to_string().as_bytes());
    format!("lobster://pair?pairing={}", encoded)
}

pub(crate) fn build_relay_api_url(relay_base_url: &str, path: &str) -> String {
    let normalized = normalize_relay_base_url(relay_base_url)
        .unwrap_or_else(|| relay_base_url.trim().to_string());
    let api_base = if normalized.ends_with("/api") {
        normalized
    } else {
        format!("{}/api", normalized.trim_end_matches('/'))
    };

    format!(
        "{}{}",
        api_base.trim_end_matches('/'),
        if path.starts_with('/') {
            path.to_string()
        } else {
            format!("/{}", path)
        }
    )
}

fn default_relay_agent_status() -> Result<RelayAgentStatus, String> {
    Ok(RelayAgentStatus {
        running: false,
        pid: None,
        status: "stopped".to_string(),
        relay_base_url: None,
        host_id: None,
        host_display_name: Some(default_host_display_name()),
        session_count: 0,
        started_at: None,
        updated_at: None,
        last_sync_at: None,
        connected_at: None,
        last_error: None,
        media_defaults: None,
        active_call: None,
        log_path: relay_agent_log_path()?.to_string_lossy().to_string(),
    })
}

fn read_relay_agent_state() -> Result<RelayAgentStatus, String> {
    let path = relay_agent_state_path()?;
    if !path.exists() {
        return default_relay_agent_status();
    }

    let content = fs::read_to_string(&path)
        .map_err(|error| format!("Failed to read relay agent state: {}", error))?;
    let mut raw_value = serde_json::from_str::<serde_json::Value>(&content)
        .map_err(|error| format!("Failed to parse relay agent state: {}", error))?;
    if raw_value
        .get("logPath")
        .map(|value| value.is_null())
        .unwrap_or(false)
    {
        raw_value["logPath"] = serde_json::Value::String(String::new());
    }

    let mut status = serde_json::from_value::<RelayAgentStatus>(raw_value)
        .map_err(|error| format!("Failed to parse relay agent status payload: {}", error))?;
    status.log_path = relay_agent_log_path()?.to_string_lossy().to_string();
    Ok(status)
}

fn write_relay_agent_state(status: &RelayAgentStatus) -> Result<(), String> {
    let path = relay_agent_state_path()?;
    let mut next = status.clone();
    next.log_path = relay_agent_log_path()?.to_string_lossy().to_string();
    let json = serde_json::to_string_pretty(&next)
        .map_err(|error| format!("Failed to serialize relay agent state: {}", error))?;
    fs::write(path, format!("{}\n", json))
        .map_err(|error| format!("Failed to write relay agent state: {}", error))
}

fn stop_relay_agent_internal() -> Result<RelayAgentStatus, String> {
    let _ = super::remote::stop_remote_bridge();

    let mut status = read_relay_agent_state().or_else(|_| default_relay_agent_status())?;
    status.running = false;
    status.pid = None;
    status.status = "stopped".to_string();
    status.updated_at = Some(Utc::now().to_rfc3339());
    write_relay_agent_state(&status)?;
    Ok(status)
}

fn spawn_relay_agent(
    force_restart: bool,
    relay_base_url: Option<String>,
) -> Result<RelayAgentStatus, String> {
    let existing = read_relay_agent_state().or_else(|_| default_relay_agent_status())?;
    let relay_base_url = relay_base_url
        .and_then(|value| normalize_relay_base_url(&value))
        .or(existing.relay_base_url.clone())
        .ok_or("请先配置 Relay URL。".to_string())?;
    let host_id = existing.host_id.clone().unwrap_or_else(generate_relay_host_id);
    let host_display_name = existing
        .host_display_name
        .clone()
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(default_host_display_name);

    let mut starting = default_relay_agent_status()?;
    starting.status = "starting".to_string();
    starting.running = false;
    starting.relay_base_url = Some(relay_base_url.clone());
    starting.host_id = Some(host_id.clone());
    starting.host_display_name = Some(host_display_name.clone());
    starting.updated_at = Some(Utc::now().to_rfc3339());
    write_relay_agent_state(&starting)?;
    let needs_restart = force_restart
        || existing.relay_base_url.as_deref() != Some(relay_base_url.as_str());
    super::remote::spawn_remote_bridge(
        needs_restart,
        Some(super::remote::RemoteRelayConfig {
            relay_base_url: Some(relay_base_url),
            relay_host_id: Some(host_id),
            relay_host_display_name: Some(host_display_name),
            relay_state_path: Some(relay_agent_state_path()?.to_string_lossy().to_string()),
        }),
    )?;
    get_relay_agent_status()
}

#[tauri::command]
pub fn get_relay_agent_status() -> Result<RelayAgentStatus, String> {
    let mut status = read_relay_agent_state().or_else(|_| default_relay_agent_status())?;
    let gateway_status = super::remote::get_remote_bridge_status().ok();
    let running_pid = gateway_status
        .as_ref()
        .filter(|gateway| gateway.running)
        .and_then(|gateway| gateway.pid);

    status.running = running_pid.is_some() && status.relay_base_url.is_some();
    status.pid = running_pid;
    if status.running {
        if status.status == "starting" || status.status == "stopped" {
            status.status = "running".to_string();
        }
    } else if status.status == "running" || status.status == "starting" {
        status.status = "stopped".to_string();
    }

    status.log_path = gateway_status
        .map(|gateway| gateway.log_path)
        .unwrap_or_else(|| relay_agent_log_path().unwrap_or_default().to_string_lossy().to_string());
    Ok(status)
}

#[tauri::command]
pub fn sync_relay_agent(
    force_restart: Option<bool>,
    relay_base_url: Option<String>,
) -> Result<RelayAgentStatus, String> {
    spawn_relay_agent(force_restart.unwrap_or(false), relay_base_url)
}

#[tauri::command]
pub fn stop_relay_agent() -> Result<RelayAgentStatus, String> {
    stop_relay_agent_internal()
}

async fn register_pairing_invite(
    status: &RelayAgentStatus,
    invite: &RelayPairingInvite,
) -> Result<(), String> {
    let endpoint = build_relay_api_url(&invite.relay_base_url, "/pairing/invites");
    let payload = json!({
        "inviteId": invite.invite_id,
        "hostId": invite.host_id,
        "code": invite.code,
        "createdAt": Utc::now().to_rfc3339(),
        "expiresAt": invite.expires_at,
        "host": {
            "hostId": invite.host_id,
            "displayName": status
                .host_display_name
                .clone()
                .unwrap_or_else(default_host_display_name),
            "status": if status.running { "online" } else { "starting" },
            "lastSeenAt": Utc::now().to_rfc3339(),
            "capabilities": ["chat"]
        }
    });

    let client = reqwest::Client::new();
    let response = client
        .post(endpoint)
        .json(&payload)
        .send()
        .await
        .map_err(|error| format!("Failed to register pairing invite: {}", error))?;

    if response.status().is_success() {
        return Ok(());
    }

    let status_code = response.status();
    let body = response.text().await.unwrap_or_default();
    Err(format!(
        "Failed to register pairing invite: HTTP {} {}",
        status_code,
        body.trim()
    ))
}

#[tauri::command]
pub async fn create_relay_pairing_invite(
    ttl_secs: Option<i64>,
) -> Result<RelayPairingInvite, String> {
    let status = get_relay_agent_status()?;
    let relay_base_url = status
        .relay_base_url
        .clone()
        .ok_or("Relay URL 尚未配置。".to_string())?;
    let host_id = status
        .host_id
        .clone()
        .ok_or("Host ID 尚未初始化。".to_string())?;

    let invite_id = generate_pairing_invite_id();
    let code = generate_pairing_code();
    let expires_at = (Utc::now() + ChronoDuration::seconds(ttl_secs.unwrap_or(300)))
        .to_rfc3339();
    let pairing_url = build_pairing_url(&relay_base_url, &host_id, &invite_id, &code, &expires_at);
    let pairing_app_url =
        build_pairing_app_url(&relay_base_url, &host_id, &invite_id, &code, &expires_at);

    let invite = RelayPairingInvite {
        invite_id,
        host_id,
        relay_base_url,
        code,
        expires_at,
        pairing_url,
        pairing_app_url,
    };

    register_pairing_invite(&status, &invite).await?;

    Ok(invite)
}

#[cfg(test)]
mod tests {
    use super::{
        build_pairing_app_url, build_pairing_url, build_relay_api_url, normalize_relay_base_url,
        RelayAgentStatus,
    };
    use serde_json::json;

    #[test]
    fn normalize_relay_base_url_trims_and_removes_trailing_slash() {
        assert_eq!(
            normalize_relay_base_url(" https://relay.example.workers.dev/api/ "),
            Some("https://relay.example.workers.dev/api".to_string())
        );
        assert_eq!(normalize_relay_base_url("   "), None);
    }

    #[test]
    fn build_pairing_url_uses_pair_route_and_embeds_payload() {
        let url = build_pairing_url(
            "https://relay.example.workers.dev/api",
            "host_123",
            "invite_123",
            "PAIR-123",
            "2026-04-03T12:05:00.000Z",
        );

        assert!(url.starts_with("https://relay.example.workers.dev/pair#pairing="));
        assert!(url.contains("pairing="));
    }

    #[test]
    fn build_pairing_app_url_uses_custom_scheme() {
        let url = build_pairing_app_url(
            "https://relay.example.workers.dev/api",
            "host_123",
            "invite_123",
            "PAIR-123456",
            "2026-04-03T12:05:00.000Z",
        );

        assert!(url.starts_with("lobster://pair?pairing="));
        assert!(url.contains("pairing="));
    }

    #[test]
    fn build_relay_api_url_normalizes_api_suffix() {
        assert_eq!(
            build_relay_api_url("https://relay.example.workers.dev/api", "/pairing/invites"),
            "https://relay.example.workers.dev/api/pairing/invites"
        );
        assert_eq!(
            build_relay_api_url("https://relay.example.workers.dev", "hosts/sync"),
            "https://relay.example.workers.dev/api/hosts/sync"
        );
    }

    #[test]
    fn relay_status_parses_active_call_summary() {
        let status: RelayAgentStatus = serde_json::from_value(json!({
            "running": true,
            "pid": 4242,
            "status": "running",
            "relayBaseUrl": "https://relay.example.workers.dev",
            "hostId": "host_demo",
            "hostDisplayName": "Demo Mac",
            "sessionCount": 3,
            "startedAt": "2026-04-04T10:00:00.000Z",
            "updatedAt": "2026-04-04T10:01:00.000Z",
            "lastSyncAt": "2026-04-04T10:01:00.000Z",
            "connectedAt": "2026-04-04T10:00:05.000Z",
            "mediaDefaults": {
                "voice": {
                    "providerId": "volcengine",
                    "modelId": "doubao-realtime-asr"
                },
                "video": {
                    "providerId": "googleapis",
                    "modelId": "gemini-2.5-flash"
                }
            },
            "logPath": "/tmp/relay.log",
            "activeCall": {
                "callId": "call_123",
                "hostId": "host_demo",
                "clientId": "client_ios",
                "sessionId": "thread_voice",
                "mode": "audio",
                "state": "live",
                "createdAt": "2026-04-04T10:00:30.000Z",
                "updatedAt": "2026-04-04T10:01:00.000Z",
                "mediaConfig": {
                    "voice": {
                        "providerId": "bigmodel",
                        "modelId": "glm-asr-2512"
                    }
                }
            }
        }))
        .expect("relay status should decode active call");

        let media_defaults = status.media_defaults.expect("media defaults should exist");
        assert_eq!(
            media_defaults.voice.as_ref().map(|value| value.provider_id.as_str()),
            Some("volcengine")
        );
        let active_call = status.active_call.expect("active call should exist");
        assert_eq!(active_call.call_id, "call_123");
        assert_eq!(active_call.mode, "audio");
        assert_eq!(active_call.state, "live");
        assert_eq!(active_call.session_id.as_deref(), Some("thread_voice"));
        assert_eq!(
            active_call
                .media_config
                .as_ref()
                .and_then(|media| media.voice.as_ref())
                .map(|value| value.model_id.as_str()),
            Some("glm-asr-2512")
        );
    }
}
