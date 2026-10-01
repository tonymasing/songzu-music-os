use cpal::traits::{DeviceTrait, HostTrait};
use rodio::{Decoder, OutputStream, Sink, Source};
use serde::{Deserialize, Serialize};
use std::fs::File;
use std::io::BufReader;
use std::path::{Component, Path, PathBuf};
use std::time::{Duration, Instant};

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlaybackClipRequest {
    pub relative_path: String,
    pub delay_seconds: f64,
    pub offset_seconds: f64,
    pub duration_seconds: f64,
    pub gain: f32,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StartPlaybackRequest {
    pub playback_id: String,
    pub output_device_name: Option<String>,
    pub clips: Vec<PlaybackClipRequest>,
    pub master_gain: Option<f32>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StopPlaybackRequest {
    pub playback_id: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlaybackStartResult {
    pub ok: bool,
    pub mode: &'static str,
    pub status: &'static str,
    pub playback_id: String,
    pub output_device_name: String,
    pub scheduled_clips: usize,
    pub skipped_clips: usize,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlaybackStatus {
    pub ok: bool,
    pub mode: &'static str,
    pub status: &'static str,
    pub playback_id: Option<String>,
    pub output_device_name: Option<String>,
    pub scheduled_clips: usize,
    pub active_clips: usize,
    pub elapsed_seconds: f64,
    pub disk_streaming: bool,
    pub error: Option<String>,
}

pub struct ActivePlayback {
    pub playback_id: String,
    pub output_device_name: String,
    pub started_at: Instant,
    pub scheduled_clips: usize,
    pub _stream: OutputStream,
    pub sinks: Vec<Sink>,
    pub last_error: Option<String>,
}

fn protected_relative_path(data_root: &Path, relative_path: &str) -> Result<PathBuf, String> {
    let relative = Path::new(relative_path);
    if relative.is_absolute()
        || relative
            .components()
            .any(|component| matches!(component, Component::ParentDir | Component::Prefix(_)))
    {
        return Err("原生播放路徑必須位於音樂 OS 資料根目錄內。".to_string());
    }
    let absolute = data_root.join(relative);
    if !absolute.is_file() {
        return Err(format!("找不到播放音檔：{}", relative_path));
    }
    Ok(absolute)
}

fn output_device(requested_name: Option<&str>) -> Result<(cpal::Device, String), String> {
    let host = cpal::default_host();
    if let Some(name) = requested_name.filter(|name| !name.trim().is_empty()) {
        let device = host
            .output_devices()
            .map_err(|error| format!("無法列出輸出裝置：{error}"))?
            .find(|device| device.name().ok().as_deref() == Some(name))
            .ok_or_else(|| format!("找不到輸出裝置：{name}"))?;
        return Ok((device, name.to_string()));
    }
    let device = host
        .default_output_device()
        .ok_or_else(|| "找不到預設輸出裝置。".to_string())?;
    let name = device.name().unwrap_or_else(|_| "系統預設輸出".to_string());
    Ok((device, name))
}

pub fn start_disk_streaming_playback(
    active: &mut Option<ActivePlayback>,
    data_root: &Path,
    request: StartPlaybackRequest,
) -> Result<PlaybackStartResult, String> {
    if request.playback_id.trim().is_empty() {
        return Err("playbackId 不可為空。".to_string());
    }
    if request.clips.is_empty() {
        return Err("沒有可播放的音訊片段。".to_string());
    }
    if let Some(current) = active.take() {
        for sink in current.sinks {
            sink.stop();
        }
    }

    let (device, device_name) = output_device(request.output_device_name.as_deref())?;
    let (stream, handle) = OutputStream::try_from_device(&device)
        .map_err(|error| format!("無法開啟原生輸出串流：{error}"))?;
    let master_gain = request.master_gain.unwrap_or(1.0).clamp(0.0, 2.0);
    let mut sinks = Vec::new();
    let mut skipped = 0_usize;

    for clip in &request.clips {
        let absolute = match protected_relative_path(data_root, &clip.relative_path) {
            Ok(path) => path,
            Err(_) => {
                skipped += 1;
                continue;
            }
        };
        let file = match File::open(&absolute) {
            Ok(file) => file,
            Err(_) => {
                skipped += 1;
                continue;
            }
        };
        let decoder = match Decoder::new(BufReader::new(file)) {
            Ok(decoder) => decoder,
            Err(_) => {
                skipped += 1;
                continue;
            }
        };
        let sink =
            Sink::try_new(&handle).map_err(|error| format!("無法建立原生播放節點：{error}"))?;
        sink.pause();
        sink.append(
            decoder
                .skip_duration(Duration::from_secs_f64(clip.offset_seconds.max(0.0)))
                .take_duration(Duration::from_secs_f64(clip.duration_seconds.max(0.01)))
                .delay(Duration::from_secs_f64(clip.delay_seconds.max(0.0)))
                .amplify((clip.gain * master_gain).clamp(0.0, 2.0)),
        );
        sinks.push(sink);
    }

    if sinks.is_empty() {
        return Err("所有片段都無法由原生解碼器開啟，請使用 Web Audio fallback。".to_string());
    }
    for sink in &sinks {
        sink.play();
    }
    let scheduled_clips = sinks.len();
    *active = Some(ActivePlayback {
        playback_id: request.playback_id.clone(),
        output_device_name: device_name.clone(),
        started_at: Instant::now(),
        scheduled_clips,
        _stream: stream,
        sinks,
        last_error: None,
    });
    Ok(PlaybackStartResult {
        ok: true,
        mode: "native_disk_streaming",
        status: "playing",
        playback_id: request.playback_id,
        output_device_name: device_name,
        scheduled_clips,
        skipped_clips: skipped,
    })
}

pub fn stop_disk_streaming_playback(
    active: &mut Option<ActivePlayback>,
    request: &StopPlaybackRequest,
) -> Result<PlaybackStatus, String> {
    let current = active
        .take()
        .ok_or_else(|| "目前沒有原生播放工作。".to_string())?;
    if current.playback_id != request.playback_id {
        *active = Some(current);
        return Err("playbackId 與目前原生播放工作不一致。".to_string());
    }
    let status = status_for(Some(&current));
    for sink in current.sinks {
        sink.stop();
    }
    Ok(PlaybackStatus {
        status: "stopped",
        active_clips: 0,
        ..status
    })
}

fn status_for(active: Option<&ActivePlayback>) -> PlaybackStatus {
    match active {
        Some(playback) => {
            let active_clips = playback.sinks.iter().filter(|sink| !sink.empty()).count();
            PlaybackStatus {
                ok: playback.last_error.is_none(),
                mode: "native_disk_streaming",
                status: if active_clips > 0 {
                    "playing"
                } else {
                    "finished"
                },
                playback_id: Some(playback.playback_id.clone()),
                output_device_name: Some(playback.output_device_name.clone()),
                scheduled_clips: playback.scheduled_clips,
                active_clips,
                elapsed_seconds: playback.started_at.elapsed().as_secs_f64(),
                disk_streaming: true,
                error: playback.last_error.clone(),
            }
        }
        None => PlaybackStatus {
            ok: true,
            mode: "native_disk_streaming",
            status: "idle",
            playback_id: None,
            output_device_name: None,
            scheduled_clips: 0,
            active_clips: 0,
            elapsed_seconds: 0.0,
            disk_streaming: true,
            error: None,
        },
    }
}

pub fn disk_streaming_status(active: &Option<ActivePlayback>) -> PlaybackStatus {
    status_for(active.as_ref())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn protected_paths_reject_parent_traversal() {
        assert!(protected_relative_path(Path::new("/tmp"), "../secret.wav").is_err());
    }

    #[test]
    fn idle_status_is_explicit() {
        let status = disk_streaming_status(&None);
        assert_eq!(status.status, "idle");
        assert!(status.disk_streaming);
    }
}
