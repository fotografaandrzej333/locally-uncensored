//! Local neural Text-to-Speech via Piper (rhasspy/piper, `piper-tts` on PyPI).
//!
//! 100% local — no cloud. We shell out to the same Python LU installs
//! faster-whisper into (ComfyUI venv → system Python) running the Piper CLI
//! one-shot per utterance: `python -m piper -m voice.onnx -c voice.onnx.json
//! -f out.wav` with the text on stdin. One-shot (vs a persistent server) costs
//! ~1-2 s of ONNX model load per "speak", which is acceptable for chat TTS and
//! avoids a long-lived process + version-specific Python API. The voice model
//! is downloaded by `install_tts` (commands/install.rs) into the app-data dir.

use std::io::Write;
use std::path::PathBuf;
use std::process::{Command, Stdio};

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

use base64::Engine;
use tauri::{Manager, State};

use crate::state::AppState;

#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x08000000;

/// The default Piper voice LU downloads + speaks with. Medium-quality English,
/// ~63 MB. The two files land in `<app_data>/piper_voices/`.
pub const PIPER_VOICE: &str = "en_US-lessac-medium";

/// Resolve `(model.onnx, model.onnx.json)` paths for the bundled voice under
/// the app-data piper_voices dir.
pub fn piper_voice_paths(app: &tauri::AppHandle) -> Result<(PathBuf, PathBuf), String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("no app data dir: {}", e))?
        .join("piper_voices");
    let onnx = dir.join(format!("{}.onnx", PIPER_VOICE));
    let config = dir.join(format!("{}.onnx.json", PIPER_VOICE));
    Ok((onnx, config))
}

/// Whether neural TTS is usable: `import piper` succeeds AND the voice model is
/// present. The Settings badge + the chat SpeakerButton gate on this.
#[tauri::command]
pub fn tts_status(state: State<'_, AppState>, app: tauri::AppHandle) -> Result<serde_json::Value, String> {
    let python = crate::commands::install::resolve_lu_python(state.inner());

    let mut piper_importable = false;
    if !python.is_empty() && crate::python::is_real_python(&python) {
        let mut cmd = Command::new(&python);
        cmd.args(["-c", "import piper"]).stdout(Stdio::null()).stderr(Stdio::null());
        #[cfg(target_os = "windows")]
        cmd.creation_flags(CREATE_NO_WINDOW);
        piper_importable = cmd.output().map(|o| o.status.success()).unwrap_or(false);
    }

    let voice_ready = piper_voice_paths(&app).map(|(onnx, _)| onnx.exists()).unwrap_or(false);

    Ok(serde_json::json!({
        "available": piper_importable && voice_ready,
        "piper": piper_importable,
        "voice": voice_ready,
    }))
}

/// Synthesize `text` to a 22.05 kHz mono WAV and return it base64-encoded for
/// the frontend to play. Runs the Piper CLI one-shot.
#[tauri::command]
pub fn synthesize(
    text: String,
    state: State<'_, AppState>,
    app: tauri::AppHandle,
) -> Result<serde_json::Value, String> {
    let text = text.trim().to_string();
    if text.is_empty() {
        return Err("empty text".to_string());
    }

    let python = crate::commands::install::resolve_lu_python(state.inner());
    if python.is_empty() || !crate::python::is_real_python(&python) {
        return Err("no_python: install Python first.".to_string());
    }

    let (onnx, config) = piper_voice_paths(&app)?;
    if !onnx.exists() || !config.exists() {
        return Err("no_voice: neural TTS not installed — install it in Settings → Voice & Remote.".to_string());
    }

    let stamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    let out_wav = std::env::temp_dir().join(format!("lu-tts-{}.wav", stamp));

    let mut cmd = Command::new(&python);
    cmd.args([
        "-m",
        "piper",
        "-m",
        &onnx.to_string_lossy(),
        "-c",
        &config.to_string_lossy(),
        "-f",
        &out_wav.to_string_lossy(),
    ])
    .stdin(Stdio::piped())
    .stdout(Stdio::piped())
    .stderr(Stdio::piped());
    #[cfg(target_os = "windows")]
    cmd.creation_flags(CREATE_NO_WINDOW);

    let mut child = cmd.spawn().map_err(|e| format!("Failed to start piper: {}", e))?;
    // Feed the text on stdin, then close it so piper proceeds.
    if let Some(mut stdin) = child.stdin.take() {
        let _ = stdin.write_all(text.as_bytes());
        // dropped at end of block → stdin closed
    }
    let output = child
        .wait_with_output()
        .map_err(|e| format!("piper wait failed: {}", e))?;

    if !output.status.success() {
        let _ = std::fs::remove_file(&out_wav);
        return Err(format!(
            "piper synthesis failed: {}",
            String::from_utf8_lossy(&output.stderr)
        ));
    }

    let bytes = std::fs::read(&out_wav).map_err(|e| format!("read wav: {}", e))?;
    let _ = std::fs::remove_file(&out_wav);
    if bytes.is_empty() {
        return Err("piper produced an empty WAV".to_string());
    }

    let b64 = base64::engine::general_purpose::STANDARD.encode(&bytes);
    Ok(serde_json::json!({ "audio_base64": b64, "mime": "audio/wav" }))
}
