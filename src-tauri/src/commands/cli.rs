use base64::Engine;
use serde::{Deserialize, Serialize};
use std::io::{BufRead, BufReader, Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use tauri::Emitter;
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};

#[derive(Serialize)]
pub struct CliResult {
    pub stdout: String,
    pub stderr: String,
    pub success: bool,
    pub json: Option<serde_json::Value>,
}

fn escape_for_applescript(command: &str) -> String {
    command
        .replace('\\', "\\\\")
        .replace('"', "\\\"")
}

#[derive(Deserialize)]
struct CustomRuntimeProfileConfig {
    runtime_family: String,
}

#[derive(Deserialize)]
struct CustomAgentConfig {
    id: String,
    runtime_profile: CustomRuntimeProfileConfig,
}

#[derive(Deserialize, Clone)]
struct ProviderEndpointConfig {
    #[serde(rename = "baseUrl")]
    base_url: String,
    #[serde(rename = "apiType")]
    api_type: Option<String>,
}

#[derive(Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
struct ProviderAudioConfig {
    transcription_model: Option<String>,
    #[allow(dead_code)]
    realtime_asr_model: Option<String>,
}

#[derive(Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
struct ProviderVisionConfig {
    reasoning_model: Option<String>,
}

#[derive(Deserialize, Clone)]
struct ProviderConfig {
    id: String,
    name: Option<String>,
    #[serde(rename = "apiKey")]
    api_key: Option<String>,
    endpoints: Option<Vec<ProviderEndpointConfig>>,
    #[serde(rename = "baseUrl")]
    base_url: Option<String>,
    #[serde(rename = "apiType")]
    api_type: Option<String>,
    audio: Option<ProviderAudioConfig>,
    vision: Option<ProviderVisionConfig>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
struct ResolvedTranscriptionTarget {
    provider_id: String,
    provider_name: String,
    api_key: String,
    endpoint: String,
    model: String,
}

#[derive(Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
struct HubMediaVoiceConfig {
    asr_provider_id: Option<String>,
    asr_model_id: Option<String>,
}

#[derive(Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
struct HubMediaVideoConfig {
    reasoning_provider_id: Option<String>,
    reasoning_model_id: Option<String>,
}

#[derive(Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
struct HubMediaConfig {
    voice: Option<HubMediaVoiceConfig>,
    #[allow(dead_code)]
    video: Option<HubMediaVideoConfig>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AudioTranscriptionPayload {
    pub audio_base64: String,
    pub mime_type: String,
    pub provider_id: Option<String>,
    pub model_id: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AudioTranscriptionResult {
    pub text: String,
    pub provider_id: String,
    pub provider_name: String,
    pub model: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveAudioClipPayload {
    pub audio_base64: String,
    pub mime_type: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SavedAudioClipResult {
    pub file_path: String,
    pub mime_type: String,
    pub byte_length: usize,
}

fn with_augmented_path(cmd: &mut Command) {
    if let Some(home) = dirs::home_dir() {
        let npm_bin = home.join(".npm-global/bin");
        let brew_bin = std::path::PathBuf::from("/opt/homebrew/bin");
        let current_path = std::env::var("PATH").unwrap_or_default();
        cmd.env(
            "PATH",
            format!(
                "{}:{}:{}",
                npm_bin.to_string_lossy(),
                brew_bin.to_string_lossy(),
                current_path
            ),
        );
    }
}

fn get_hub_providers() -> Result<Vec<ProviderConfig>, String> {
    let hub = super::config::read_hub_config()?;
    let providers = hub
        .get("providers")
        .and_then(|value| value.as_array())
        .cloned()
        .unwrap_or_default();

    serde_json::from_value(serde_json::Value::Array(providers))
        .map_err(|error| format!("Failed to parse provider config: {}", error))
}

fn get_hub_media_config() -> Result<Option<HubMediaConfig>, String> {
    let hub = super::config::read_hub_config()?;
    let Some(media) = hub.get("media").cloned() else {
        return Ok(None);
    };

    serde_json::from_value(media)
        .map(Some)
        .map_err(|error| format!("Failed to parse media config: {}", error))
}

fn agenthub_dir() -> Result<PathBuf, String> {
    let home = dirs::home_dir().ok_or("Cannot determine home directory")?;
    let dir = home.join(".agenthub");
    if !dir.exists() {
        std::fs::create_dir_all(&dir)
            .map_err(|error| format!("Failed to create .agenthub dir: {}", error))?;
    }
    Ok(dir)
}

fn agenthub_runtime_dir() -> Result<PathBuf, String> {
    let dir = agenthub_dir()?.join("runtime");
    if !dir.exists() {
        std::fs::create_dir_all(&dir)
            .map_err(|error| format!("Failed to create runtime dir: {}", error))?;
    }
    Ok(dir)
}

fn agenthub_audio_clips_dir() -> Result<PathBuf, String> {
    let dir = agenthub_runtime_dir()?.join("audio-clips");
    if !dir.exists() {
        std::fs::create_dir_all(&dir)
            .map_err(|error| format!("Failed to create audio clips dir: {}", error))?;
    }
    Ok(dir)
}

fn default_clip_transcription_model() -> &'static str {
    "glm-asr-2512"
}

fn configured_transcription_model(provider: &ProviderConfig) -> Option<String> {
    provider
        .audio
        .as_ref()
        .and_then(|audio| audio.transcription_model.clone())
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

fn resolve_transcription_target_from_hub_config(
    providers: &[ProviderConfig],
    media_config: Option<&HubMediaConfig>,
    provider_id: Option<&str>,
    model_id: Option<&str>,
) -> Result<ResolvedTranscriptionTarget, String> {
    let requested_id = provider_id
        .or_else(|| media_config.and_then(|media| media.voice.as_ref()?.asr_provider_id.as_deref()))
        .unwrap_or("bigmodel");
    let provider = providers
        .iter()
        .find(|provider| provider.id == requested_id)
        .cloned()
        .ok_or_else(|| format!("Provider '{}' not found", requested_id))?;

    let api_key = provider
        .api_key
        .clone()
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| format!("Provider '{}' has no API key configured", provider.id))?;
    let base_url = resolve_openai_endpoint(&provider)
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| {
            format!(
                "Provider '{}' has no OpenAI-compatible endpoint configured",
                provider.id
            )
        })?;
    let model = model_id
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .or_else(|| {
            media_config
                .and_then(|media| media.voice.as_ref()?.asr_model_id.clone())
                .map(|value| value.trim().to_string())
                .filter(|value| !value.is_empty())
        })
        .or_else(|| configured_transcription_model(&provider))
        .unwrap_or_else(|| default_clip_transcription_model().to_string());

    Ok(ResolvedTranscriptionTarget {
        provider_id: provider.id.clone(),
        provider_name: provider
            .name
            .clone()
            .unwrap_or_else(|| "语音转写".to_string()),
        api_key,
        endpoint: transcription_endpoint(&base_url),
        model,
    })
}

fn resolve_transcription_target(
    provider_id: Option<&str>,
    model_id: Option<&str>,
) -> Result<ResolvedTranscriptionTarget, String> {
    let providers = get_hub_providers()?;
    let media_config = get_hub_media_config()?;
    resolve_transcription_target_from_hub_config(&providers, media_config.as_ref(), provider_id, model_id)
}

fn resolve_openai_endpoint(provider: &ProviderConfig) -> Option<String> {
    if let Some(endpoints) = &provider.endpoints {
        let preferred = endpoints
            .iter()
            .find(|endpoint| endpoint.api_type.as_deref() == Some("openai"))
            .or_else(|| endpoints.first());
        if let Some(endpoint) = preferred {
            return Some(endpoint.base_url.clone());
        }
    }

    provider.base_url.clone()
}

fn transcription_endpoint(base_url: &str) -> String {
    let base = base_url.trim_end_matches('/');
    if base.ends_with("/v1") || base.ends_with("/v3") || base.ends_with("/v4") {
        format!("{}/audio/transcriptions", base)
    } else {
        format!("{}/v1/audio/transcriptions", base)
    }
}

fn extension_from_mime_type(mime_type: &str) -> &'static str {
    match mime_type {
        "audio/mp4" | "audio/x-m4a" | "audio/aac" => "m4a",
        "audio/mpeg" | "audio/mp3" => "mp3",
        "audio/wav" | "audio/x-wav" | "audio/wave" => "wav",
        "audio/ogg" | "audio/ogg;codecs=opus" => "ogg",
        "audio/webm" | "audio/webm;codecs=opus" => "webm",
        _ => "bin",
    }
}

fn output_content_type(path: &Path) -> &'static str {
    match path.extension().and_then(|value| value.to_str()).unwrap_or_default() {
        "wav" => "audio/wav",
        _ => "audio/mpeg",
    }
}

fn decode_audio_payload(audio_base64: &str) -> Result<Vec<u8>, String> {
    base64::engine::general_purpose::STANDARD
        .decode(audio_base64.as_bytes())
        .map_err(|error| format!("Failed to decode recorded audio: {}", error))
}

fn write_payload_to_temp_audio(
    audio_base64: &str,
    mime_type: &str,
) -> Result<(tempfile::TempDir, PathBuf), String> {
    let audio_bytes = decode_audio_payload(audio_base64)?;
    let temp_dir = tempfile::tempdir().map_err(|error| format!("Failed to create temp dir: {}", error))?;
    let input_extension = extension_from_mime_type(mime_type);
    let input_path = temp_dir.path().join(format!("speech-input.{}", input_extension));
    std::fs::write(&input_path, audio_bytes)
        .map_err(|error| format!("Failed to write audio clip: {}", error))?;
    Ok((temp_dir, input_path))
}

fn persist_prepared_audio_file(prepared_path: &Path) -> Result<PathBuf, String> {
    let clips_dir = agenthub_audio_clips_dir()?;
    let extension = prepared_path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or("mp3");
    let suffix = format!(".{}", extension);
    let temp_clip = tempfile::Builder::new()
        .prefix("clip-")
        .suffix(&suffix)
        .tempfile_in(&clips_dir)
        .map_err(|error| format!("Failed to create persisted audio clip file: {}", error))?;

    std::fs::copy(prepared_path, temp_clip.path())
        .map_err(|error| format!("Failed to persist audio clip: {}", error))?;

    let (_file, path) = temp_clip
        .keep()
        .map_err(|error| format!("Failed to finalize audio clip: {}", error.error))?;

    Ok(path)
}

fn ensure_supported_audio_file(input_path: &Path) -> Result<PathBuf, String> {
    let extension = input_path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase();

    if extension == "mp3" || extension == "wav" {
        return Ok(input_path.to_path_buf());
    }

    let output_path = input_path.with_extension("mp3");
    let mut command = Command::new("ffmpeg");
    with_augmented_path(&mut command);
    let output = command
        .args([
            "-y",
            "-i",
            input_path.to_string_lossy().as_ref(),
            "-vn",
            "-acodec",
            "libmp3lame",
            "-ar",
            "16000",
            "-ac",
            "1",
            output_path.to_string_lossy().as_ref(),
        ])
        .output()
        .map_err(|error| format!("Failed to run ffmpeg: {}", error))?;

    if !output.status.success() {
        return Err(format!(
            "ffmpeg transcode failed: {}",
            String::from_utf8_lossy(&output.stderr)
        ));
    }

    Ok(output_path)
}


/// GitHub OAuth: open browser, listen for callback, exchange code for token
#[tauri::command]
pub async fn github_oauth_login(client_id: String, client_secret: String) -> Result<serde_json::Value, String> {
    use std::io::{Read, Write};
    use std::net::TcpListener;

    let listener = TcpListener::bind("127.0.0.1:19198")
        .map_err(|e| format!("Failed to bind: {}", e))?;

    let auth_url = format!(
        "https://github.com/login/oauth/authorize?client_id={}&redirect_uri=http://localhost:19198/callback&scope=read:user,user:email",
        client_id
    );

    #[cfg(target_os = "macos")]
    Command::new("open").arg(&auth_url).spawn().ok();
    #[cfg(target_os = "linux")]
    Command::new("xdg-open").arg(&auth_url).spawn().ok();

    let (mut stream, _) = listener.accept().map_err(|e| format!("No callback: {}", e))?;
    let mut buf = [0u8; 4096];
    let n = stream.read(&mut buf).map_err(|e| format!("Read error: {}", e))?;
    let request = String::from_utf8_lossy(&buf[..n]).to_string();

    let code = request.lines().next()
        .and_then(|l| l.split_whitespace().nth(1))
        .and_then(|u| u.split("code=").nth(1).map(|c| c.split('&').next().unwrap_or(c).to_string()))
        .ok_or("No code in callback")?;

    let html = "<html><body style='font-family:system-ui;text-align:center;padding:60px'><h2>登录成功</h2><p>可以关闭此页面</p></body></html>";
    let resp = format!("HTTP/1.1 200 OK\r\nContent-Type:text/html;charset=utf-8\r\nContent-Length:{}\r\n\r\n{}", html.len(), html);
    stream.write_all(resp.as_bytes()).ok();
    drop(stream);
    drop(listener);

    let client = reqwest::Client::new();
    let res = client.post("https://github.com/login/oauth/access_token")
        .header("Accept", "application/json")
        .form(&[("client_id", &client_id), ("client_secret", &client_secret), ("code", &code)])
        .send().await.map_err(|e| format!("Token exchange failed: {}", e))?;

    let data: serde_json::Value = res.json().await.map_err(|e| format!("Parse failed: {}", e))?;
    if let Some(err) = data.get("error").and_then(|v| v.as_str()) {
        return Err(format!("GitHub: {}", err));
    }
    Ok(data)
}

/// Run a shell command and return output
#[tauri::command]
pub async fn run_shell_cmd(command: String, timeout_secs: Option<u64>) -> Result<CliResult, String> {
    let _timeout = std::time::Duration::from_secs(timeout_secs.unwrap_or(120));

    let mut cmd = Command::new("sh");
    cmd.arg("-c").arg(&command);
    with_augmented_path(&mut cmd);

    let output = cmd.output()
        .map_err(|e| format!("Failed to run command: {}", e))?;

    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();

    Ok(CliResult {
        stdout: stdout.clone(),
        stderr,
        success: output.status.success(),
        json: serde_json::from_str(&stdout).ok(),
    })
}

#[tauri::command]
pub async fn open_terminal_command(command: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        #[cfg(target_os = "macos")]
        {
            let escaped = escape_for_applescript(&command);
            Command::new("osascript")
                .arg("-e")
                .arg(format!("tell application \"Terminal\" to do script \"{}\"", escaped))
                .arg("-e")
                .arg("tell application \"Terminal\" to activate")
                .status()
                .map_err(|error| format!("Failed to open Terminal: {}", error))?;
            return Ok(());
        }

        #[cfg(target_os = "linux")]
        {
            Command::new("sh")
                .arg("-c")
                .arg(format!("x-terminal-emulator -e '{}'; true", command))
                .status()
                .map_err(|error| format!("Failed to open terminal: {}", error))?;
            return Ok(());
        }

        #[cfg(not(any(target_os = "macos", target_os = "linux")))]
        {
            let _ = command;
            return Err("Opening an interactive terminal is not supported on this platform".to_string());
        }
    })
    .await
    .map_err(|error| format!("Failed to run terminal launcher: {}", error))?
}

#[tauri::command]
pub async fn prompt_open_microphone_settings(app: tauri::AppHandle) -> Result<bool, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let should_open = app
            .dialog()
            .message("当前没有麦克风权限，请在“隐私与安全性 -> 麦克风”里允许 AgentHub 使用麦克风。")
            .title("无法使用麦克风")
            .kind(MessageDialogKind::Warning)
            .buttons(MessageDialogButtons::OkCancelCustom(
                "打开设置".to_string(),
                "取消".to_string(),
            ))
            .blocking_show();

        if should_open {
            #[cfg(target_os = "macos")]
            {
                Command::new("open")
                    .arg("x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone")
                    .status()
                    .map_err(|error| format!("Failed to open microphone privacy settings: {}", error))?;
            }

            #[cfg(not(target_os = "macos"))]
            {
                return Err("Opening microphone privacy settings is only supported on macOS right now".to_string());
            }
        }

        Ok(should_open)
    })
    .await
    .map_err(|error| format!("Failed to show microphone settings dialog: {}", error))?
}

#[tauri::command]
pub async fn transcribe_audio_clip(
    payload: AudioTranscriptionPayload,
) -> Result<AudioTranscriptionResult, String> {
    let target = resolve_transcription_target(
        payload.provider_id.as_deref(),
        payload.model_id.as_deref(),
    )?;

    let (_temp_dir, input_path) = write_payload_to_temp_audio(&payload.audio_base64, &payload.mime_type)?;
    let upload_path = ensure_supported_audio_file(&input_path)?;
    let upload_bytes = std::fs::read(&upload_path)
        .map_err(|error| format!("Failed to read prepared audio clip: {}", error))?;
    let upload_name = upload_path
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("speech.mp3")
        .to_string();

    let form = reqwest::multipart::Form::new()
        .text("model", target.model.clone())
        .text("stream", "false")
        .part(
            "file",
            reqwest::multipart::Part::bytes(upload_bytes)
                .file_name(upload_name)
                .mime_str(output_content_type(&upload_path))
                .map_err(|error| format!("Failed to build audio upload: {}", error))?,
        );

    let client = reqwest::Client::new();
    let response = client
        .post(target.endpoint.clone())
        .header("Authorization", format!("Bearer {}", target.api_key))
        .header("User-Agent", "AgentHub/0.1.0")
        .multipart(form)
        .send()
        .await
        .map_err(|error| format!("Speech transcription request failed: {}", error))?;

    let status = response.status();
    let response_json = response
        .json::<serde_json::Value>()
        .await
        .map_err(|error| format!("Failed to parse speech transcription response: {}", error))?;

    if !status.is_success() {
        return Err(format!(
            "Speech transcription API returned {}: {}",
            status,
            response_json
        ));
    }

    let text = response_json
        .get("text")
        .and_then(|value| value.as_str())
        .or_else(|| response_json.pointer("/data/text").and_then(|value| value.as_str()))
        .unwrap_or_default()
        .trim()
        .to_string();

    if text.is_empty() {
        return Err(format!("Speech transcription returned no text: {}", response_json));
    }

    Ok(AudioTranscriptionResult {
        text,
        provider_id: target.provider_id,
        provider_name: target.provider_name,
        model: target.model,
    })
}

#[tauri::command]
pub async fn save_audio_clip(payload: SaveAudioClipPayload) -> Result<SavedAudioClipResult, String> {
    let (_temp_dir, input_path) = write_payload_to_temp_audio(&payload.audio_base64, &payload.mime_type)?;
    let prepared_path = ensure_supported_audio_file(&input_path)?;
    let file_path = persist_prepared_audio_file(&prepared_path)?;
    let byte_length = std::fs::metadata(&file_path)
        .map(|metadata| metadata.len() as usize)
        .map_err(|error| format!("Failed to inspect saved audio clip: {}", error))?;
    let mime_type = output_content_type(&file_path).to_string();

    Ok(SavedAudioClipResult {
        file_path: file_path.to_string_lossy().to_string(),
        mime_type,
        byte_length,
    })
}

#[tauri::command]
pub async fn run_claude_sdk_cmd(window: tauri::Window, payload: serde_json::Value) -> Result<CliResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let manifest_dir = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"));
        let project_root = manifest_dir
            .parent()
            .ok_or("Cannot determine project root")?
            .to_path_buf();
        let script_path = manifest_dir.join("scripts").join("claude-runtime.mjs");

        if !script_path.exists() {
            return Err(format!("Claude runtime script not found: {}", script_path.display()));
        }

        let mut cmd = Command::new("node");
        cmd.arg(script_path);
        cmd.current_dir(&project_root);
        cmd.stdin(Stdio::piped());
        cmd.stdout(Stdio::piped());
        cmd.stderr(Stdio::piped());
        with_augmented_path(&mut cmd);

        let mut child = cmd
            .spawn()
            .map_err(|e| format!("Failed to spawn Claude SDK runtime: {}", e))?;

        if let Some(mut stdin) = child.stdin.take() {
            let payload_str = serde_json::to_string(&payload)
                .map_err(|e| format!("Failed to serialize Claude runtime payload: {}", e))?;
            stdin
                .write_all(payload_str.as_bytes())
                .map_err(|e| format!("Failed to write Claude runtime payload: {}", e))?;
        }

        let stdout = child
            .stdout
            .take()
            .ok_or("Failed to capture Claude runtime stdout")?;
        let stderr = child
            .stderr
            .take()
            .ok_or("Failed to capture Claude runtime stderr")?;

        let stderr_handle = std::thread::spawn(move || {
            let mut reader = BufReader::new(stderr);
            let mut buffer = String::new();
            let _ = reader.read_to_string(&mut buffer);
            buffer
        });

        let mut stdout_lines = Vec::new();
        let mut final_json: Option<serde_json::Value> = None;

        for line in BufReader::new(stdout).lines() {
            let line = line.map_err(|e| format!("Failed to read Claude runtime stdout: {}", e))?;
            let trimmed = line.trim();
            if trimmed.is_empty() {
                continue;
            }

            stdout_lines.push(trimmed.to_string());

            let parsed = match serde_json::from_str::<serde_json::Value>(trimmed) {
                Ok(value) => value,
                Err(_) => continue,
            };

            match parsed.get("type").and_then(|value| value.as_str()) {
                Some("partial") => {
                    let _ = window.emit("agenthub://runtime-stream", &parsed);
                }
                Some("final") => {
                    if let Some(object) = parsed.as_object() {
                        let mut next = serde_json::Map::new();
                        for (key, value) in object {
                            if key != "type" {
                                next.insert(key.clone(), value.clone());
                            }
                        }
                        final_json = Some(serde_json::Value::Object(next));
                    } else {
                        final_json = Some(parsed);
                    }
                }
                _ => {
                    final_json = Some(parsed);
                }
            }
        }

        let status = child
            .wait()
            .map_err(|e| format!("Failed to wait for Claude SDK runtime: {}", e))?;

        let stderr = stderr_handle
            .join()
            .unwrap_or_else(|_| "Failed to join Claude runtime stderr reader".to_string());
        let stdout = stdout_lines.join("\n");

        Ok(CliResult {
            stdout: stdout.clone(),
            stderr,
            success: status.success(),
            json: final_json.or_else(|| serde_json::from_str(&stdout).ok()),
        })
    })
    .await
    .map_err(|e| format!("Claude SDK task join error: {}", e))?
}

#[cfg(test)]
mod tests {
    use super::{
        resolve_transcription_target_from_hub_config, transcription_endpoint, HubMediaConfig,
        ProviderConfig,
    };

    #[test]
    fn resolve_transcription_target_prefers_provider_audio_model() {
        let providers: Vec<ProviderConfig> = serde_json::from_value(serde_json::json!([
            {
                "id": "volcengine",
                "name": "豆包 Doubao",
                "apiKey": "test-key",
                "endpoints": [
                    {
                        "baseUrl": "https://ark.cn-beijing.volces.com/api/v3",
                        "apiType": "openai"
                    }
                ],
                "audio": {
                    "transcriptionModel": "doubao-asr-realtime-preview"
                }
            }
        ]))
        .expect("provider config should parse");

        let target = resolve_transcription_target_from_providers(&providers, Some("volcengine"))
            .expect("transcription target should resolve");

        assert_eq!(target.provider_id, "volcengine");
        assert_eq!(target.model, "doubao-asr-realtime-preview");
        assert_eq!(
            target.endpoint,
            transcription_endpoint("https://ark.cn-beijing.volces.com/api/v3")
        );
    }

    #[test]
    fn resolve_transcription_target_prefers_hub_media_voice_override() {
        let providers: Vec<ProviderConfig> = serde_json::from_value(serde_json::json!([
            {
                "id": "volcengine",
                "name": "豆包 Doubao",
                "apiKey": "test-key",
                "endpoints": [
                    {
                        "baseUrl": "https://ark.cn-beijing.volces.com/api/v3",
                        "apiType": "openai"
                    }
                ],
                "audio": {
                    "transcriptionModel": "doubao-asr-realtime-preview"
                }
            }
        ]))
        .expect("provider config should parse");

        let media: HubMediaConfig = serde_json::from_value(serde_json::json!({
            "voice": {
                "asrProviderId": "volcengine",
                "asrModelId": "doubao-asr-streaming-v2"
            }
        }))
        .expect("media config should parse");

        let target = resolve_transcription_target_from_hub_config(
            &providers,
            Some(&media),
            None,
            None,
        )
        .expect("transcription target should resolve");

        assert_eq!(target.provider_id, "volcengine");
        assert_eq!(target.model, "doubao-asr-streaming-v2");
    }

    #[test]
    fn resolve_transcription_target_falls_back_to_default_clip_model() {
        let providers: Vec<ProviderConfig> = serde_json::from_value(serde_json::json!([
            {
                "id": "bigmodel",
                "name": "智谱AI",
                "apiKey": "test-key",
                "endpoints": [
                    {
                        "baseUrl": "https://open.bigmodel.cn/api/paas/v4",
                        "apiType": "openai"
                    }
                ]
            }
        ]))
        .expect("provider config should parse");

        let target = resolve_transcription_target_from_hub_config(&providers, None, Some("bigmodel"), None)
            .expect("transcription target should resolve");

        assert_eq!(target.provider_id, "bigmodel");
        assert_eq!(target.model, "glm-asr-2512");
    }
}

/// Find the openclaw binary path
fn find_openclaw() -> Result<String, String> {
    // Check common locations
    let candidates = [
        dirs::home_dir()
            .map(|h| h.join(".npm-global/bin/openclaw").to_string_lossy().to_string()),
        Some("/usr/local/bin/openclaw".to_string()),
        Some("/opt/homebrew/bin/openclaw".to_string()),
    ];

    for candidate in candidates.iter().flatten() {
        if std::path::Path::new(candidate).exists() {
            return Ok(candidate.clone());
        }
    }

    // Try `which openclaw`
    let output = Command::new("which")
        .arg("openclaw")
        .output()
        .map_err(|e| format!("Failed to run 'which': {}", e))?;

    if output.status.success() {
        let path = String::from_utf8_lossy(&output.stdout).trim().to_string();
        if !path.is_empty() {
            return Ok(path);
        }
    }

    Err("openclaw CLI not found".to_string())
}

/// Run an openclaw CLI command and return the output.
/// `args` is a list of arguments (e.g. ["models", "list", "--json"]).
/// `config_path` optionally overrides the config file.
#[tauri::command]
pub async fn run_openclaw_cmd(
    args: Vec<String>,
    config_path: Option<String>,
) -> Result<CliResult, String> {
    let bin = find_openclaw()?;

    let mut cmd = Command::new(&bin);

    // Add HOME to PATH so node/npm are available
    if let Some(home) = dirs::home_dir() {
        let _ = home;
        with_augmented_path(&mut cmd);
    }

    // If a specific config path is given, set OPENCLAW_CONFIG_PATH
    if let Some(ref cp) = config_path {
        cmd.env("OPENCLAW_CONFIG_PATH", cp);
    }

    // Disable colors for clean parsing
    cmd.arg("--no-color");
    cmd.args(&args);

    let output = cmd
        .output()
        .map_err(|e| format!("Failed to run openclaw: {}", e))?;

    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();

    // Try to parse stdout as JSON (strip ANSI and plugin log lines first)
    let clean_stdout: String = stdout
        .lines()
        .filter(|line| {
            !line.starts_with("[plugins]")
                && !line.contains("[plugins]")
                && !line.starts_with("\x1b[35m")
        })
        .collect::<Vec<_>>()
        .join("\n");

    let json = serde_json::from_str::<serde_json::Value>(&clean_stdout).ok();

    Ok(CliResult {
        stdout: clean_stdout,
        stderr,
        success: output.status.success(),
        json,
    })
}

/// Scan a directory for skill/plugin subdirectories with optional SKILL.md reading
#[tauri::command]
pub fn scan_directory_items(path: String, read_frontmatter: bool) -> Result<Vec<serde_json::Value>, String> {
    let dir = std::path::PathBuf::from(&path);
    if !dir.exists() {
        return Ok(vec![]);
    }

    let mut items = Vec::new();
    let entries = std::fs::read_dir(&dir)
        .map_err(|e| format!("Failed to read directory: {}", e))?;

    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().to_string();
        if name.starts_with('.') { continue; }

        // Follow symlinks
        let entry_path = entry.path();
        let resolved = std::fs::canonicalize(&entry_path).unwrap_or(entry_path.clone());
        let is_dir = resolved.is_dir();

        if !is_dir { continue; }

        let mut item = serde_json::json!({
            "name": name,
            "path": resolved.to_string_lossy(),
            "isSymlink": entry_path.read_link().is_ok(),
        });

        if read_frontmatter {
            // Try to read SKILL.md frontmatter
            let skill_md = resolved.join("SKILL.md");
            if skill_md.exists() {
                if let Ok(content) = std::fs::read_to_string(&skill_md) {
                    // Parse YAML frontmatter between --- markers
                    let lines: Vec<&str> = content.lines().collect();
                    if lines.first() == Some(&"---") {
                        let mut description = String::new();
                        let mut fm_name = String::new();
                        for line in lines.iter().skip(1) {
                            if *line == "---" { break; }
                            if line.starts_with("description:") {
                                description = line.trim_start_matches("description:").trim().to_string();
                            }
                            if line.starts_with("name:") {
                                fm_name = line.trim_start_matches("name:").trim().to_string();
                            }
                        }
                        if !description.is_empty() {
                            item["description"] = serde_json::Value::String(description);
                        }
                        if !fm_name.is_empty() {
                            item["displayName"] = serde_json::Value::String(fm_name);
                        }
                    }
                }
            }
        }

        items.push(item);
    }

    // Sort by name
    items.sort_by(|a, b| {
        a["name"].as_str().unwrap_or("").cmp(b["name"].as_str().unwrap_or(""))
    });

    Ok(items)
}

/// Recursively scan a directory tree and return structure + file metadata
#[tauri::command]
pub fn scan_directory_tree(path: String) -> Result<serde_json::Value, String> {
    fn scan(dir: &std::path::Path, depth: usize) -> serde_json::Value {
        if depth > 5 || !dir.exists() {
            return serde_json::json!([]);
        }
        let mut items = Vec::new();
        if let Ok(entries) = std::fs::read_dir(dir) {
            let mut sorted: Vec<_> = entries.flatten().collect();
            sorted.sort_by_key(|e| {
                let is_dir = e.file_type().map(|ft| ft.is_dir()).unwrap_or(false);
                let name = e.file_name().to_string_lossy().to_lowercase();
                (!is_dir, name) // dirs first
            });
            for entry in sorted {
                let name = entry.file_name().to_string_lossy().to_string();
                if name.starts_with('.') { continue; }
                let entry_path = entry.path();
                let resolved = std::fs::canonicalize(&entry_path).unwrap_or(entry_path.clone());
                let is_dir = resolved.is_dir();
                let size = if !is_dir { std::fs::metadata(&resolved).map(|m| m.len()).unwrap_or(0) } else { 0 };

                let mut item = serde_json::json!({
                    "name": name,
                    "path": resolved.to_string_lossy(),
                    "isDir": is_dir,
                    "size": size,
                });

                if is_dir {
                    item["children"] = scan(&resolved, depth + 1);
                }
                items.push(item);
            }
        }
        serde_json::Value::Array(items)
    }

    let dir = std::path::PathBuf::from(&path);
    let resolved = std::fs::canonicalize(&dir).unwrap_or(dir);
    Ok(scan(&resolved, 0))
}

/// Read a file's content as string (for skill/config file viewing)
#[tauri::command]
pub fn read_text_file(path: String, max_bytes: Option<u64>) -> Result<String, String> {
    let file_path = std::path::PathBuf::from(&path);
    if !file_path.exists() {
        return Err("File not found".to_string());
    }
    let size = std::fs::metadata(&file_path).map(|m| m.len()).unwrap_or(0);
    let limit = max_bytes.unwrap_or(500_000); // 500KB default
    if size > limit {
        return Err(format!("File too large: {} bytes (limit {})", size, limit));
    }
    std::fs::read_to_string(&file_path)
        .map_err(|e| format!("Failed to read: {}", e))
}

/// Uninstall a skill by removing its directory (or symlink) from the skills folder
#[tauri::command]
pub fn uninstall_skill(path: String) -> Result<(), String> {
    let skill_path = std::path::PathBuf::from(&path);

    // Safety: only allow removing from known skills directories
    let path_str = skill_path.to_string_lossy();
    if !path_str.contains("/skills/") && !path_str.contains("/.claude/") {
        return Err("Not a valid skill path".to_string());
    }

    if skill_path.is_symlink() {
        // Remove the symlink only, don't touch the target
        std::fs::remove_file(&skill_path)
            .map_err(|e| format!("Failed to remove symlink: {}", e))?;
    } else if skill_path.is_dir() {
        std::fs::remove_dir_all(&skill_path)
            .map_err(|e| format!("Failed to remove directory: {}", e))?;
    } else {
        return Err("Path does not exist".to_string());
    }

    Ok(())
}

/// Read marketplace.json and list all available plugins with install status
#[tauri::command]
pub fn list_marketplace_plugins(home_dir: String) -> Result<serde_json::Value, String> {
    let base = std::path::PathBuf::from(&home_dir).join("plugins/marketplaces");
    if !base.exists() {
        return Ok(serde_json::json!({ "marketplaces": [] }));
    }

    let mut marketplaces = Vec::new();

    for entry in std::fs::read_dir(&base).map_err(|e| e.to_string())?.flatten() {
        let mp_dir = entry.path();
        if !mp_dir.is_dir() { continue; }
        let mp_name = entry.file_name().to_string_lossy().to_string();
        if mp_name.starts_with('.') { continue; }

        let manifest_path = mp_dir.join(".claude-plugin/marketplace.json");
        if !manifest_path.exists() { continue; }

        let content = std::fs::read_to_string(&manifest_path).map_err(|e| e.to_string())?;
        let manifest: serde_json::Value = serde_json::from_str(&content).map_err(|e| e.to_string())?;

        // Check which plugins are installed (have local directory)
        let plugins_dir = mp_dir.join("plugins");
        let external_dir = mp_dir.join("external_plugins");

        let mut plugins_with_status = Vec::new();
        if let Some(plugins) = manifest.get("plugins").and_then(|v| v.as_array()) {
            for plugin in plugins {
                let name = plugin.get("name").and_then(|v| v.as_str()).unwrap_or("");
                let installed = plugins_dir.join(name).exists() || external_dir.join(name).exists();
                let mut p = plugin.clone();
                if let Some(obj) = p.as_object_mut() {
                    obj.insert("installed".to_string(), serde_json::Value::Bool(installed));
                }
                plugins_with_status.push(p);
            }
        }

        marketplaces.push(serde_json::json!({
            "name": mp_name,
            "description": manifest.get("description").and_then(|v| v.as_str()).unwrap_or(""),
            "plugins": plugins_with_status,
            "totalPlugins": plugins_with_status.len(),
        }));
    }

    Ok(serde_json::json!({ "marketplaces": marketplaces }))
}

/// Read a JSON file and return parsed content
#[tauri::command]
pub fn read_json_file(path: String) -> Result<serde_json::Value, String> {
    let file_path = std::path::PathBuf::from(&path);
    if !file_path.exists() {
        return Ok(serde_json::json!({}));
    }
    let content = std::fs::read_to_string(&file_path)
        .map_err(|e| format!("Failed to read {}: {}", path, e))?;
    // Try JSON first, then JSON5
    serde_json::from_str(&content)
        .or_else(|_| json5::from_str(&content).map_err(|e| format!("Parse error: {}", e)))
}

fn launch_claude_terminal() -> Result<CliResult, String> {
    let output = Command::new("open")
        .args(["-a", "Terminal", "--args", "claude"])
        .output()
        .or_else(|_| {
            Command::new("osascript")
                .args(["-e", "tell application \"Terminal\" to do script \"claude\""])
                .output()
        })
        .map_err(|e| format!("Failed to launch Claude runtime: {}", e))?;

    Ok(CliResult {
        stdout: String::from_utf8_lossy(&output.stdout).to_string(),
        stderr: String::from_utf8_lossy(&output.stderr).to_string(),
        success: output.status.success(),
        json: None,
    })
}

fn resolve_custom_agent_runtime(agent_id: &str) -> Option<String> {
    let hub = super::config::read_hub_config().ok()?;
    let custom_agents = hub.get("customAgents")?;
    let configs = serde_json::from_value::<Vec<CustomAgentConfig>>(custom_agents.clone()).ok()?;

    configs
        .into_iter()
        .find(|config| config.id == agent_id)
        .map(|config| config.runtime_profile.runtime_family)
}

/// Launch an agent process (openclaw gateway, claude code, etc.)
#[tauri::command]
pub async fn launch_agent(agent_type: String, config_path: Option<String>) -> Result<CliResult, String> {
    let resolved_agent_type = resolve_custom_agent_runtime(&agent_type).unwrap_or(agent_type.clone());

    match resolved_agent_type.as_str() {
        "openclaw" | "qclaw" => {
            // Start openclaw gateway
            let args = vec!["gateway".to_string()];
            run_openclaw_cmd(args, config_path).await
        }
        "claude-code" => launch_claude_terminal(),
        "workbuddy" => {
            let output = Command::new("open")
                .args(["-a", "WorkBuddy"])
                .output()
                .map_err(|e| format!("Failed to launch WorkBuddy: {}", e))?;
            Ok(CliResult {
                stdout: String::new(),
                stderr: String::from_utf8_lossy(&output.stderr).to_string(),
                success: output.status.success(),
                json: None,
            })
        }
        "autoclaw" => {
            let output = Command::new("open")
                .args(["-a", "QClaw"])
                .output()
                .or_else(|_| Command::new("open").args(["-a", "AutoClaw"]).output())
                .map_err(|e| format!("Failed to launch: {}", e))?;
            Ok(CliResult {
                stdout: String::new(),
                stderr: String::from_utf8_lossy(&output.stderr).to_string(),
                success: output.status.success(),
                json: None,
            })
        }
        _ => Err(format!("Unknown agent type: {}", agent_type)),
    }
}

/// Kill an agent process by PID
#[tauri::command]
pub fn kill_agent(pid: u32) -> Result<(), String> {
    let output = Command::new("kill")
        .arg(pid.to_string())
        .output()
        .map_err(|e| format!("Failed to kill process: {}", e))?;

    if output.status.success() {
        Ok(())
    } else {
        Err(format!("kill failed: {}", String::from_utf8_lossy(&output.stderr)))
    }
}

/// Shortcut: openclaw config get <path> --json
#[tauri::command]
pub async fn openclaw_config_get(
    path: String,
    config_path: Option<String>,
) -> Result<CliResult, String> {
    run_openclaw_cmd(vec!["config".into(), "get".into(), path, "--json".into()], config_path).await
}

/// Write a JSON string to any config file (for agents that don't use our module system)
#[tauri::command]
pub fn write_json_file(path: String, data: String) -> Result<(), String> {
    let file_path = std::path::PathBuf::from(&path);

    // Safety: only allow writing to known config locations
    let path_str = file_path.to_string_lossy();
    let allowed = path_str.contains(".claude/")
        || path_str.contains(".codex/")
        || path_str.contains(".workbuddy/")
        || path_str.contains(".config/opencode/")
        || path_str.contains(".openclaw/")
        || path_str.contains(".qclaw/")
        || path_str.contains("AutoClaw/")
        || path_str.contains(".agenthub/");

    if !allowed {
        return Err(format!("Writing to {} is not allowed", path));
    }

    // Validate JSON
    serde_json::from_str::<serde_json::Value>(&data)
        .map_err(|e| format!("Invalid JSON: {}", e))?;

    // Backup existing file
    if file_path.exists() {
        let backup = file_path.with_extension("json.bak");
        let _ = std::fs::copy(&file_path, &backup);
    }

    // Atomic write
    if let Some(dir) = file_path.parent() {
        let tmp = tempfile::NamedTempFile::new_in(dir)
            .map_err(|e| format!("Failed to create temp file: {}", e))?;
        std::fs::write(tmp.path(), &data)
            .map_err(|e| format!("Failed to write: {}", e))?;
        tmp.persist(&file_path)
            .map_err(|e| format!("Failed to persist: {}", e))?;
    } else {
        std::fs::write(&file_path, &data)
            .map_err(|e| format!("Failed to write: {}", e))?;
    }

    Ok(())
}

/// Shortcut: openclaw config set <path> <value>
#[tauri::command]
pub async fn openclaw_config_set(
    path: String,
    value: String,
    config_path: Option<String>,
) -> Result<CliResult, String> {
    run_openclaw_cmd(vec!["config".into(), "set".into(), path, value], config_path).await
}
