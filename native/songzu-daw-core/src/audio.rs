use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use cpal::{
    BufferSize, Device, SampleFormat, SampleRate, Stream, StreamConfig, SupportedBufferSize,
};
use hound::{SampleFormat as WavSampleFormat, WavSpec, WavWriter};
use rtrb::{Consumer, Producer, RingBuffer};
use serde::{Deserialize, Serialize};
use std::fs::{self, OpenOptions};
use std::io::{Seek, SeekFrom, Write};
use std::path::{Component, Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU32, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::thread::JoinHandle;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

fn now_ms() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or(0)
}

fn now_micros() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_micros() as u64)
        .unwrap_or(0)
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AudioDeviceInfo {
    pub name: String,
    pub label: String,
    pub is_default: bool,
    pub max_channels: u16,
    pub default_sample_rate: Option<u32>,
    pub supported_sample_rates: Vec<u32>,
    pub min_buffer_frames: Option<u32>,
    pub max_buffer_frames: Option<u32>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StartRecordingRequest {
    pub recording_id: String,
    pub relative_path: String,
    pub input_device_name: Option<String>,
    pub output_device_name: Option<String>,
    pub sample_rate: Option<u32>,
    pub channels: Option<u16>,
    pub input_channel_start: Option<u16>,
    pub bit_depth: Option<u16>,
    pub buffer_frames: Option<u32>,
    pub monitor_enabled: Option<bool>,
    pub monitor_level: Option<f32>,
    pub latency_compensation_ms: Option<f64>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StopRecordingRequest {
    pub recording_id: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MonitorRecordingRequest {
    pub recording_id: String,
    pub level: f32,
}

#[derive(Debug, Clone, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct LatencyRequest {
    pub sample_rate: Option<u32>,
    pub buffer_frames: Option<u32>,
    pub monitor_enabled: Option<bool>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LatencyEstimate {
    pub ok: bool,
    pub mode: &'static str,
    pub status: &'static str,
    pub sample_rate: u32,
    pub buffer_frames: u32,
    pub estimated_input_ms: f64,
    pub estimated_output_ms: f64,
    pub estimated_round_trip_ms: f64,
    pub suggested_compensation_ms: f64,
    pub message: &'static str,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecordingStatus {
    pub ok: bool,
    pub mode: &'static str,
    pub status: &'static str,
    pub recording_id: Option<String>,
    pub relative_path: Option<String>,
    pub input_device_name: Option<String>,
    pub output_device_name: Option<String>,
    pub sample_rate: Option<u32>,
    pub channels: Option<u16>,
    pub input_channel_start: Option<u16>,
    pub bit_depth: Option<u16>,
    pub monitor_enabled: bool,
    pub buffer_frames: Option<u32>,
    pub latency_compensation_ms: Option<f64>,
    pub elapsed_seconds: f64,
    pub peak: f32,
    pub rms: f32,
    pub clipping: bool,
    pub xrun_count: u64,
    pub input_overflow_count: u64,
    pub output_underflow_count: u64,
    pub disk_write_error_count: u64,
    pub callback_load: f32,
    pub free_disk_bytes: u64,
    pub safety_file_active: bool,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StoppedRecording {
    pub ok: bool,
    pub mode: &'static str,
    pub status: &'static str,
    pub recording_id: String,
    pub relative_path: String,
    pub input_device_name: String,
    pub output_device_name: Option<String>,
    pub sample_rate: u32,
    pub channels: u16,
    pub input_channel_start: u16,
    pub bit_depth: u16,
    pub buffer_frames: u32,
    pub monitor_enabled: bool,
    pub latency_compensation_ms: f64,
    pub duration_seconds: f64,
    pub file_size_bytes: u64,
    pub peak: f32,
    pub rms: f32,
    pub clipping: bool,
    pub xrun_count: u64,
    pub output_underflow_count: u64,
    pub disk_write_error_count: u64,
    pub callback_load: f32,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecoverableRecording {
    pub relative_path: String,
    pub file_size_bytes: u64,
    pub recoverable: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecordingRecoveryResult {
    pub ok: bool,
    pub recovered: Vec<String>,
    pub skipped: Vec<String>,
}

pub struct ActiveRecording {
    recording_id: String,
    relative_path: String,
    absolute_path: PathBuf,
    partial_path: PathBuf,
    input_device_name: String,
    output_device_name: Option<String>,
    sample_rate: u32,
    wav_channels: u16,
    input_channel_start: u16,
    bit_depth: u16,
    buffer_frames: u32,
    monitor_enabled: bool,
    monitor_gain: Arc<AtomicU32>,
    latency_compensation_ms: f64,
    started_at_ms: u128,
    input_stream: Stream,
    output_stream: Option<Stream>,
    writer_thread: JoinHandle<Result<(), String>>,
    sample_count: Arc<AtomicU64>,
    peak_bits: Arc<AtomicU32>,
    rms_bits: Arc<AtomicU32>,
    clipping: Arc<AtomicBool>,
    xrun_count: Arc<AtomicU64>,
    output_underflow_count: Arc<AtomicU64>,
    disk_write_error_count: Arc<AtomicU64>,
    callback_load_bits: Arc<AtomicU32>,
    free_disk_bytes: u64,
    last_error: Arc<Mutex<Option<String>>>,
}

#[derive(Default)]
pub struct EngineState {
    pub active: Option<ActiveRecording>,
    pub playback: Option<crate::playback::ActivePlayback>,
}

fn unique_rates(mut values: Vec<u32>) -> Vec<u32> {
    values.sort_unstable();
    values.dedup();
    values
}

fn buffer_range(configs: &[cpal::SupportedStreamConfigRange]) -> (Option<u32>, Option<u32>) {
    let mut mins = Vec::new();
    let mut maxs = Vec::new();
    for config in configs {
        if let SupportedBufferSize::Range { min, max } = config.buffer_size() {
            mins.push(*min);
            maxs.push(*max);
        }
    }
    (mins.into_iter().min(), maxs.into_iter().max())
}

fn input_device_info(device: Device, default_name: &str) -> Option<AudioDeviceInfo> {
    let name = device.name().ok()?;
    let configs: Vec<_> = device.supported_input_configs().ok()?.collect();
    let default_sample_rate = device
        .default_input_config()
        .ok()
        .map(|config| config.sample_rate().0);
    let max_channels = configs
        .iter()
        .map(|config| config.channels())
        .max()
        .unwrap_or(0);
    let rates = unique_rates(
        configs
            .iter()
            .flat_map(|config| [config.min_sample_rate().0, config.max_sample_rate().0])
            .collect(),
    );
    let (min_buffer_frames, max_buffer_frames) = buffer_range(&configs);
    Some(AudioDeviceInfo {
        label: name.clone(),
        is_default: name == default_name,
        name,
        max_channels,
        default_sample_rate,
        supported_sample_rates: rates,
        min_buffer_frames,
        max_buffer_frames,
    })
}

fn output_device_info(device: Device, default_name: &str) -> Option<AudioDeviceInfo> {
    let name = device.name().ok()?;
    let configs: Vec<_> = device.supported_output_configs().ok()?.collect();
    let default_sample_rate = device
        .default_output_config()
        .ok()
        .map(|config| config.sample_rate().0);
    let max_channels = configs
        .iter()
        .map(|config| config.channels())
        .max()
        .unwrap_or(0);
    let rates = unique_rates(
        configs
            .iter()
            .flat_map(|config| [config.min_sample_rate().0, config.max_sample_rate().0])
            .collect(),
    );
    let (min_buffer_frames, max_buffer_frames) = buffer_range(&configs);
    Some(AudioDeviceInfo {
        label: name.clone(),
        is_default: name == default_name,
        name,
        max_channels,
        default_sample_rate,
        supported_sample_rates: rates,
        min_buffer_frames,
        max_buffer_frames,
    })
}

pub fn list_devices() -> Result<(Vec<AudioDeviceInfo>, Vec<AudioDeviceInfo>), String> {
    let host = cpal::default_host();
    let default_input_name = host
        .default_input_device()
        .and_then(|device| device.name().ok())
        .unwrap_or_default();
    let default_output_name = host
        .default_output_device()
        .and_then(|device| device.name().ok())
        .unwrap_or_default();
    let inputs = host
        .input_devices()
        .map_err(|error| format!("無法列出輸入裝置：{error}"))?
        .filter_map(|device| input_device_info(device, &default_input_name))
        .collect();
    let outputs = host
        .output_devices()
        .map_err(|error| format!("無法列出輸出裝置：{error}"))?
        .filter_map(|device| output_device_info(device, &default_output_name))
        .collect();
    Ok((inputs, outputs))
}

pub fn estimate_latency(request: &LatencyRequest) -> LatencyEstimate {
    let sample_rate = request.sample_rate.unwrap_or(48_000).clamp(8_000, 192_000);
    let buffer_frames = request.buffer_frames.unwrap_or(256).clamp(32, 4_096);
    let input_ms = buffer_frames as f64 / sample_rate as f64 * 1_000.0;
    let output_ms = if request.monitor_enabled.unwrap_or(true) {
        input_ms
    } else {
        0.0
    };
    let scheduling_ms = 2.0;
    let round_trip_ms = input_ms + output_ms + scheduling_ms;
    LatencyEstimate {
        ok: true,
        mode: "native_service",
        status: "estimated",
        sample_rate,
        buffer_frames,
        estimated_input_ms: input_ms,
        estimated_output_ms: output_ms,
        estimated_round_trip_ms: round_trip_ms,
        suggested_compensation_ms: round_trip_ms,
        message:
            "目前為依 buffer 與 sample rate 計算的安全估值；接實體 loopback 後可再做精準校正。",
    }
}

fn find_input_device(name: Option<&str>) -> Result<Device, String> {
    let host = cpal::default_host();
    if let Some(target) = name.filter(|value| !value.trim().is_empty()) {
        if let Ok(mut devices) = host.input_devices() {
            if let Some(device) =
                devices.find(|device| device.name().ok().as_deref() == Some(target))
            {
                return Ok(device);
            }
        }
        return Err(format!("找不到輸入裝置：{target}"));
    }
    host.default_input_device()
        .ok_or_else(|| "找不到預設輸入裝置。".to_string())
}

fn find_output_device(name: Option<&str>) -> Result<Device, String> {
    let host = cpal::default_host();
    if let Some(target) = name.filter(|value| !value.trim().is_empty()) {
        if let Ok(mut devices) = host.output_devices() {
            if let Some(device) =
                devices.find(|device| device.name().ok().as_deref() == Some(target))
            {
                return Ok(device);
            }
        }
        return Err(format!("找不到耳機輸出裝置：{target}"));
    }
    host.default_output_device()
        .ok_or_else(|| "找不到預設耳機輸出裝置。".to_string())
}

fn choose_input_config(
    device: &Device,
    requested_rate: u32,
    buffer_frames: u32,
) -> Result<(StreamConfig, SampleFormat), String> {
    let mut supported: Vec<_> = device
        .supported_input_configs()
        .map_err(|error| format!("無法讀取輸入規格：{error}"))?
        .collect();
    supported.sort_by_key(|config| {
        let contains_rate = requested_rate >= config.min_sample_rate().0
            && requested_rate <= config.max_sample_rate().0;
        (!contains_rate, std::cmp::Reverse(config.channels()))
    });
    let range = supported
        .first()
        .ok_or_else(|| "輸入裝置沒有可用格式。".to_string())?;
    let sample_rate = requested_rate.clamp(range.min_sample_rate().0, range.max_sample_rate().0);
    let mut config: StreamConfig = range.with_sample_rate(SampleRate(sample_rate)).config();
    config.buffer_size = match range.buffer_size() {
        SupportedBufferSize::Range { min, max }
            if buffer_frames >= *min && buffer_frames <= *max =>
        {
            BufferSize::Fixed(buffer_frames)
        }
        _ => BufferSize::Default,
    };
    Ok((config, range.sample_format()))
}

fn choose_output_config(
    device: &Device,
    requested_rate: u32,
    buffer_frames: u32,
) -> Result<(StreamConfig, SampleFormat), String> {
    let mut supported: Vec<_> = device
        .supported_output_configs()
        .map_err(|error| format!("無法讀取輸出規格：{error}"))?
        .collect();
    supported.sort_by_key(|config| {
        let contains_rate = requested_rate >= config.min_sample_rate().0
            && requested_rate <= config.max_sample_rate().0;
        (!contains_rate, std::cmp::Reverse(config.channels()))
    });
    let range = supported
        .first()
        .ok_or_else(|| "輸出裝置沒有可用格式。".to_string())?;
    let sample_rate = requested_rate.clamp(range.min_sample_rate().0, range.max_sample_rate().0);
    let mut config: StreamConfig = range.with_sample_rate(SampleRate(sample_rate)).config();
    config.buffer_size = match range.buffer_size() {
        SupportedBufferSize::Range { min, max }
            if buffer_frames >= *min && buffer_frames <= *max =>
        {
            BufferSize::Fixed(buffer_frames)
        }
        _ => BufferSize::Default,
    };
    Ok((config, range.sample_format()))
}

fn safe_recording_path(root: &Path, relative_path: &str) -> Result<PathBuf, String> {
    let relative = Path::new(relative_path);
    if relative.as_os_str().is_empty()
        || relative
            .components()
            .any(|component| !matches!(component, Component::Normal(_)))
    {
        return Err("錄音路徑必須是資料根目錄內的安全相對路徑。".to_string());
    }
    let path = root.join(relative);
    if path
        .extension()
        .and_then(|value| value.to_str())
        .map(|value| value.to_ascii_lowercase())
        != Some("wav".to_string())
    {
        return Err("原生錄音只允許輸出 WAV。".to_string());
    }
    Ok(path)
}

fn spawn_wav_writer(
    path: &Path,
    spec: WavSpec,
    mut consumer: Consumer<f32>,
    errors: Arc<AtomicU64>,
) -> Result<JoinHandle<Result<(), String>>, String> {
    let mut writer =
        WavWriter::create(path, spec).map_err(|error| format!("無法建立 WAV 原檔：{error}"))?;
    std::thread::Builder::new()
        .name("songzu-wav-writer".into())
        .spawn(move || {
            loop {
                match consumer.pop() {
                    Ok(sample) => {
                        let value = (sample.clamp(-1.0, 1.0) * 8_388_607.0).round() as i32;
                        if writer.write_sample(value).is_err() {
                            errors.fetch_add(1, Ordering::Relaxed);
                        }
                    }
                    Err(_) => {
                        // Producer destruction is the stop signal. Drain before finalizing.
                        if consumer.is_abandoned() && consumer.slots() == 0 {
                            break;
                        }
                        std::thread::sleep(Duration::from_millis(1));
                    }
                }
            }
            writer
                .finalize()
                .map_err(|error| format!("WAV 封存失敗：{error}"))
        })
        .map_err(|error| format!("無法建立錄音寫檔執行緒：{error}"))
}

fn process_input<T: Copy>(
    data: &[T],
    convert: fn(T) -> f32,
    input_channels: usize,
    wav_channels: u16,
    input_channel_start: usize,
    output_channels: usize,
    capture_producer: &mut Producer<f32>,
    monitor_producer: &mut Option<Producer<f32>>,
    sample_count: &Arc<AtomicU64>,
    peak_bits: &Arc<AtomicU32>,
    rms_bits: &Arc<AtomicU32>,
    clipping: &Arc<AtomicBool>,
    xrun_count: &Arc<AtomicU64>,
    callback_load_bits: &Arc<AtomicU32>,
    last_callback_micros: &Arc<AtomicU64>,
    sample_rate: u32,
) {
    let callback_started = Instant::now();
    if input_channels == 0
        || wav_channels == 0
        || input_channel_start + wav_channels as usize > input_channels
    {
        return;
    }
    let frames_in_callback = data.len() / input_channels;
    let expected_micros =
        ((frames_in_callback as f64 / sample_rate.max(1) as f64) * 1_000_000.0).max(1.0);
    let callback_micros = now_micros();
    let previous_callback = last_callback_micros.swap(callback_micros, Ordering::Relaxed);
    if previous_callback > 0
        && callback_micros.saturating_sub(previous_callback) as f64 > expected_micros * 2.75
    {
        xrun_count.fetch_add(1, Ordering::Relaxed);
    }
    let mut peak = 0.0_f32;
    let mut square_sum = 0.0_f64;
    let mut frames = 0_u64;
    let mut written = 0_u64;
    for frame in data.chunks_exact(input_channels) {
        frames += 1;
        let capture_available = capture_producer.slots() >= wav_channels as usize;
        if !capture_available {
            xrun_count.fetch_add(1, Ordering::Relaxed);
        }
        // Only selected physical inputs enter the protected take. Never downmix.
        for channel in 0..wav_channels as usize {
            let source = convert(frame[input_channel_start + channel]);
            let source = if source.is_finite() { source } else { 0.0 };
            peak = peak.max(source.abs());
            square_sum += (source * source) as f64;
            if capture_available {
                let _ = capture_producer.push(source);
                written += 1;
            }
        }

        if let Some(producer) = monitor_producer.as_mut() {
            // Drop whole frames on overflow so L/R can never swap positions.
            if producer.slots() < output_channels {
                xrun_count.fetch_add(1, Ordering::Relaxed);
            } else {
                for channel in 0..output_channels {
                    let sample = if channel < 2 {
                        convert(frame[input_channel_start + channel.min(wav_channels as usize - 1)])
                    } else {
                        0.0
                    };
                    let _ = producer.push(if sample.is_finite() { sample } else { 0.0 });
                }
            }
        }
    }

    if frames > 0 {
        let rms = (square_sum / (frames * wav_channels as u64) as f64).sqrt() as f32;
        peak_bits.store(peak.to_bits(), Ordering::Relaxed);
        rms_bits.store(rms.to_bits(), Ordering::Relaxed);
        if peak >= 0.98 {
            clipping.store(true, Ordering::Relaxed);
        }
        sample_count.fetch_add(written, Ordering::Relaxed);
    }
    let load = (callback_started.elapsed().as_secs_f64() * 1_000_000.0 / expected_micros)
        .clamp(0.0, 8.0) as f32;
    callback_load_bits.store(load.to_bits(), Ordering::Relaxed);
}

struct MonitorEnvelope {
    gain: f32,
    channels: usize,
    step: f32,
    target: Arc<AtomicU32>,
}

fn fill_monitor_output<T>(
    data: &mut [T],
    consumer: &mut Consumer<f32>,
    underflows: &AtomicU64,
    envelope: &mut MonitorEnvelope,
    convert: fn(f32) -> T,
) {
    let mut starved = false;
    for frame in data.chunks_mut(envelope.channels) {
        let target = f32::from_bits(envelope.target.load(Ordering::Relaxed));
        envelope.gain += (target - envelope.gain).clamp(-envelope.step, envelope.step);
        let available = consumer.slots() >= frame.len();
        starved |= !available;
        for sample in frame {
            let value = if available {
                consumer.pop().unwrap_or(0.0)
            } else {
                0.0
            };
            *sample = convert((value * envelope.gain).clamp(-1.0, 1.0));
        }
    }
    if starved {
        underflows.fetch_add(1, Ordering::Relaxed);
    }
}

fn build_output_stream(
    device: &Device,
    config: &StreamConfig,
    sample_format: SampleFormat,
    mut consumer: Consumer<f32>,
    last_error: Arc<Mutex<Option<String>>>,
    output_underflow_count: Arc<AtomicU64>,
    xrun_count: Arc<AtomicU64>,
    monitor_gain: Arc<AtomicU32>,
) -> Result<Stream, String> {
    let mut envelope = MonitorEnvelope {
        gain: 0.0,
        channels: config.channels as usize,
        step: 1.5 / (config.sample_rate.0 as f32 * 0.006).max(1.0),
        target: monitor_gain,
    };
    let xrun_for_error = Arc::clone(&xrun_count);
    let error_callback = move |error| {
        xrun_for_error.fetch_add(1, Ordering::Relaxed);
        if let Ok(mut target) = last_error.lock() {
            *target = Some(format!("耳機監聽錯誤：{error}"));
        }
    };
    match sample_format {
        SampleFormat::F32 => device.build_output_stream(
            config,
            move |data: &mut [f32], _| {
                fill_monitor_output(
                    data,
                    &mut consumer,
                    &output_underflow_count,
                    &mut envelope,
                    |value| value,
                )
            },
            error_callback,
            None,
        ),
        SampleFormat::I16 => device.build_output_stream(
            config,
            move |data: &mut [i16], _| {
                fill_monitor_output(
                    data,
                    &mut consumer,
                    &output_underflow_count,
                    &mut envelope,
                    |value| (value * i16::MAX as f32) as i16,
                )
            },
            error_callback,
            None,
        ),
        SampleFormat::U16 => device.build_output_stream(
            config,
            move |data: &mut [u16], _| {
                fill_monitor_output(
                    data,
                    &mut consumer,
                    &output_underflow_count,
                    &mut envelope,
                    |value| (((value + 1.0) * 0.5) * u16::MAX as f32) as u16,
                )
            },
            error_callback,
            None,
        ),
        _ => return Err(format!("不支援的耳機輸出格式：{sample_format}")),
    }
    .map_err(|error| format!("無法建立耳機監聽：{error}"))
}

pub fn start_recording(
    state: &mut EngineState,
    data_root: &Path,
    request: StartRecordingRequest,
) -> Result<RecordingStatus, String> {
    if state.active.is_some() {
        return Err("已有一個原生錄音正在進行，請先停止再開始新的 take。".to_string());
    }
    if request.recording_id.trim().is_empty() {
        return Err("缺少 recordingId。".to_string());
    }

    let absolute_path = safe_recording_path(data_root, &request.relative_path)?;
    if absolute_path.exists() {
        return Err("錄音目的檔已存在；為保護原檔，原生引擎拒絕覆寫。".to_string());
    }
    if let Some(parent) = absolute_path.parent() {
        fs::create_dir_all(parent).map_err(|error| format!("無法建立錄音資料夾：{error}"))?;
    }
    let free_disk_bytes = fs2::available_space(absolute_path.parent().unwrap_or(data_root))
        .map_err(|error| format!("無法檢查錄音硬碟空間：{error}"))?;
    if free_disk_bytes < 512 * 1024 * 1024 {
        return Err(format!(
            "錄音硬碟剩餘空間不足 512 MB，目前僅 {} MB。",
            free_disk_bytes / 1024 / 1024
        ));
    }
    let partial_path = absolute_path.with_file_name(format!(
        "{}.partial",
        absolute_path
            .file_name()
            .and_then(|value| value.to_str())
            .unwrap_or("recording.wav")
    ));
    if partial_path.exists() {
        return Err("同一錄音目的地已有事故復原暫存檔，請先完成復原。".to_string());
    }

    let input_device = find_input_device(request.input_device_name.as_deref())?;
    let input_device_name = input_device
        .name()
        .unwrap_or_else(|_| "CoreAudio Input".to_string());
    let requested_rate = request.sample_rate.unwrap_or(48_000).clamp(8_000, 192_000);
    let requested_buffer = request.buffer_frames.unwrap_or(256).clamp(32, 4_096);
    let requested_channels = request.channels.unwrap_or(1).clamp(1, 2);
    let input_channel_start = request.input_channel_start.unwrap_or(0);
    let bit_depth = request.bit_depth.unwrap_or(24);
    if bit_depth != 24 {
        return Err("原生錄音 v1 固定使用 24-bit WAV。".to_string());
    }
    let (input_config, input_sample_format) =
        choose_input_config(&input_device, requested_rate, requested_buffer)?;
    let sample_rate = input_config.sample_rate.0;
    if u32::from(input_channel_start) + u32::from(requested_channels)
        > u32::from(input_config.channels)
    {
        return Err(format!(
            "所選 Input {}-{} 超過裝置的 {} 個聲道；錄音未開始。",
            input_channel_start as u32 + 1,
            input_channel_start as u32 + requested_channels as u32,
            input_config.channels
        ));
    }
    let monitor_enabled = request.monitor_enabled.unwrap_or(false);
    let monitor_level = request.monitor_level.unwrap_or(0.8).clamp(0.0, 1.5);
    let monitor_gain = Arc::new(AtomicU32::new(monitor_level.to_bits()));
    let latency_compensation_ms = request
        .latency_compensation_ms
        .unwrap_or(0.0)
        .clamp(0.0, 500.0);

    let sample_count = Arc::new(AtomicU64::new(0));
    let peak_bits = Arc::new(AtomicU32::new(0.0_f32.to_bits()));
    let rms_bits = Arc::new(AtomicU32::new(0.0_f32.to_bits()));
    let clipping = Arc::new(AtomicBool::new(false));
    let xrun_count = Arc::new(AtomicU64::new(0));
    let output_underflow_count = Arc::new(AtomicU64::new(0));
    let disk_write_error_count = Arc::new(AtomicU64::new(0));
    let callback_load_bits = Arc::new(AtomicU32::new(0.0_f32.to_bits()));
    let last_callback_micros = Arc::new(AtomicU64::new(0));
    let last_error = Arc::new(Mutex::new(None));

    let (mut monitor_producer, output_stream, output_device_name, output_channels) =
        if monitor_enabled {
            let output_device = find_output_device(request.output_device_name.as_deref())?;
            let output_name = output_device
                .name()
                .unwrap_or_else(|_| "CoreAudio Output".to_string());
            let (output_config, output_sample_format) =
                choose_output_config(&output_device, sample_rate, requested_buffer)?;
            if output_config.sample_rate.0 != sample_rate {
                return Err(format!(
                "耳機輸出取樣率 {} Hz 與錄音輸入 {} Hz 不一致；請在 macOS 音訊 MIDI 設定統一取樣率，或關閉 App 監聽。",
                output_config.sample_rate.0, sample_rate
            ));
            }
            let output_channels = output_config.channels as usize;
            let (producer, consumer) =
                RingBuffer::<f32>::new((sample_rate as usize * output_channels).max(4_096));
            let stream = build_output_stream(
                &output_device,
                &output_config,
                output_sample_format,
                consumer,
                Arc::clone(&last_error),
                Arc::clone(&output_underflow_count),
                Arc::clone(&xrun_count),
                Arc::clone(&monitor_gain),
            )?;
            (
                Some(producer),
                Some(stream),
                Some(output_name),
                output_channels,
            )
        } else {
            (None, None, None, 0)
        };

    // The realtime callback only pushes into bounded lock-free rings, never disk I/O.
    let (mut capture_producer, capture_consumer) =
        RingBuffer::new(sample_rate as usize * requested_channels as usize * 2);
    let writer_thread = spawn_wav_writer(
        &partial_path,
        WavSpec {
            channels: requested_channels,
            sample_rate,
            bits_per_sample: 24,
            sample_format: WavSampleFormat::Int,
        },
        capture_consumer,
        Arc::clone(&disk_write_error_count),
    )?;
    let count_for_input = Arc::clone(&sample_count);
    let peak_for_input = Arc::clone(&peak_bits);
    let rms_for_input = Arc::clone(&rms_bits);
    let clipping_for_input = Arc::clone(&clipping);
    let xrun_for_input = Arc::clone(&xrun_count);
    let xrun_for_data = Arc::clone(&xrun_count);
    let callback_load_for_input = Arc::clone(&callback_load_bits);
    let last_callback_for_input = Arc::clone(&last_callback_micros);
    let error_for_input = Arc::clone(&last_error);
    let input_channels = input_config.channels as usize;
    let error_callback = move |error| {
        xrun_for_input.fetch_add(1, Ordering::Relaxed);
        if let Ok(mut target) = error_for_input.lock() {
            *target = Some(format!("錄音輸入錯誤：{error}"));
        }
    };

    let input_stream_result = match input_sample_format {
        SampleFormat::F32 => input_device.build_input_stream(
            &input_config,
            move |data: &[f32], _| {
                process_input(
                    data,
                    |value| value,
                    input_channels,
                    requested_channels,
                    input_channel_start as usize,
                    output_channels,
                    &mut capture_producer,
                    &mut monitor_producer,
                    &count_for_input,
                    &peak_for_input,
                    &rms_for_input,
                    &clipping_for_input,
                    &xrun_for_data,
                    &callback_load_for_input,
                    &last_callback_for_input,
                    sample_rate,
                )
            },
            error_callback,
            None,
        ),
        SampleFormat::I16 => input_device.build_input_stream(
            &input_config,
            move |data: &[i16], _| {
                process_input(
                    data,
                    |value| value as f32 / i16::MAX as f32,
                    input_channels,
                    requested_channels,
                    input_channel_start as usize,
                    output_channels,
                    &mut capture_producer,
                    &mut monitor_producer,
                    &count_for_input,
                    &peak_for_input,
                    &rms_for_input,
                    &clipping_for_input,
                    &xrun_for_data,
                    &callback_load_for_input,
                    &last_callback_for_input,
                    sample_rate,
                )
            },
            error_callback,
            None,
        ),
        SampleFormat::U16 => input_device.build_input_stream(
            &input_config,
            move |data: &[u16], _| {
                process_input(
                    data,
                    |value| value as f32 / u16::MAX as f32 * 2.0 - 1.0,
                    input_channels,
                    requested_channels,
                    input_channel_start as usize,
                    output_channels,
                    &mut capture_producer,
                    &mut monitor_producer,
                    &count_for_input,
                    &peak_for_input,
                    &rms_for_input,
                    &clipping_for_input,
                    &xrun_for_data,
                    &callback_load_for_input,
                    &last_callback_for_input,
                    sample_rate,
                )
            },
            error_callback,
            None,
        ),
        _ => return Err(format!("不支援的錄音輸入格式：{input_sample_format}")),
    };
    let input_stream =
        input_stream_result.map_err(|error| format!("無法建立 CoreAudio 錄音：{error}"))?;

    if let Some(stream) = output_stream.as_ref() {
        stream
            .play()
            .map_err(|error| format!("無法啟動耳機監聽：{error}"))?;
    }
    input_stream
        .play()
        .map_err(|error| format!("無法啟動錄音：{error}"))?;

    state.active = Some(ActiveRecording {
        recording_id: request.recording_id,
        relative_path: request.relative_path,
        absolute_path,
        partial_path,
        input_device_name,
        output_device_name,
        sample_rate,
        wav_channels: requested_channels,
        input_channel_start,
        bit_depth,
        buffer_frames: requested_buffer,
        monitor_enabled,
        monitor_gain,
        latency_compensation_ms,
        started_at_ms: now_ms(),
        input_stream,
        output_stream,
        writer_thread,
        sample_count,
        peak_bits,
        rms_bits,
        clipping,
        xrun_count,
        output_underflow_count,
        disk_write_error_count,
        callback_load_bits,
        free_disk_bytes,
        last_error,
    });
    Ok(recording_status(state))
}

pub fn recording_status(state: &EngineState) -> RecordingStatus {
    let Some(active) = state.active.as_ref() else {
        return RecordingStatus {
            ok: true,
            mode: "native_service",
            status: "idle",
            recording_id: None,
            relative_path: None,
            input_device_name: None,
            output_device_name: None,
            sample_rate: None,
            channels: None,
            input_channel_start: None,
            bit_depth: None,
            monitor_enabled: false,
            buffer_frames: None,
            latency_compensation_ms: None,
            elapsed_seconds: 0.0,
            peak: 0.0,
            rms: 0.0,
            clipping: false,
            xrun_count: 0,
            input_overflow_count: 0,
            output_underflow_count: 0,
            disk_write_error_count: 0,
            callback_load: 0.0,
            free_disk_bytes: 0,
            safety_file_active: false,
            error: None,
        };
    };
    RecordingStatus {
        ok: true,
        mode: "native_service",
        status: "recording",
        recording_id: Some(active.recording_id.clone()),
        relative_path: Some(active.relative_path.clone()),
        input_device_name: Some(active.input_device_name.clone()),
        output_device_name: active.output_device_name.clone(),
        sample_rate: Some(active.sample_rate),
        channels: Some(active.wav_channels),
        input_channel_start: Some(active.input_channel_start),
        bit_depth: Some(active.bit_depth),
        monitor_enabled: active.monitor_enabled,
        buffer_frames: Some(active.buffer_frames),
        latency_compensation_ms: Some(active.latency_compensation_ms),
        elapsed_seconds: (now_ms().saturating_sub(active.started_at_ms)) as f64 / 1_000.0,
        peak: f32::from_bits(active.peak_bits.load(Ordering::Relaxed)),
        rms: f32::from_bits(active.rms_bits.load(Ordering::Relaxed)),
        clipping: active.clipping.load(Ordering::Relaxed),
        xrun_count: active.xrun_count.load(Ordering::Relaxed),
        input_overflow_count: active.xrun_count.load(Ordering::Relaxed),
        output_underflow_count: active.output_underflow_count.load(Ordering::Relaxed),
        disk_write_error_count: active.disk_write_error_count.load(Ordering::Relaxed),
        callback_load: f32::from_bits(active.callback_load_bits.load(Ordering::Relaxed)),
        free_disk_bytes: active.free_disk_bytes,
        safety_file_active: active.partial_path.exists(),
        error: active
            .last_error
            .lock()
            .ok()
            .and_then(|value| value.clone()),
    }
}

pub fn stop_recording(
    state: &mut EngineState,
    request: &StopRecordingRequest,
) -> Result<StoppedRecording, String> {
    let active = state
        .active
        .take()
        .ok_or_else(|| "目前沒有原生錄音。".to_string())?;
    if active.recording_id != request.recording_id {
        let expected = active.recording_id.clone();
        state.active = Some(active);
        return Err(format!("recordingId 不符，目前錄音為 {expected}。"));
    }

    let _ = active.input_stream.pause();
    if let Some(stream) = active.output_stream.as_ref() {
        let _ = stream.pause();
    }
    drop(active.input_stream);
    drop(active.output_stream);
    active
        .writer_thread
        .join()
        .map_err(|_| "錄音寫檔執行緒異常；已保留暫存 WAV。".to_string())??;
    fs::rename(&active.partial_path, &active.absolute_path)
        .map_err(|error| format!("無法原子完成 WAV 原檔：{error}"))?;

    let samples = active.sample_count.load(Ordering::Relaxed);
    let duration_seconds = samples as f64 / active.wav_channels as f64 / active.sample_rate as f64;
    let file_size_bytes = fs::metadata(&active.absolute_path)
        .map_err(|error| format!("無法確認 WAV 原檔：{error}"))?
        .len();
    Ok(StoppedRecording {
        ok: true,
        mode: "native_service",
        status: "stopped",
        recording_id: active.recording_id,
        relative_path: active.relative_path,
        input_device_name: active.input_device_name,
        output_device_name: active.output_device_name,
        sample_rate: active.sample_rate,
        channels: active.wav_channels,
        input_channel_start: active.input_channel_start,
        bit_depth: active.bit_depth,
        buffer_frames: active.buffer_frames,
        monitor_enabled: active.monitor_enabled,
        latency_compensation_ms: active.latency_compensation_ms,
        duration_seconds,
        file_size_bytes,
        peak: f32::from_bits(active.peak_bits.load(Ordering::Relaxed)),
        rms: f32::from_bits(active.rms_bits.load(Ordering::Relaxed)),
        clipping: active.clipping.load(Ordering::Relaxed),
        xrun_count: active.xrun_count.load(Ordering::Relaxed),
        output_underflow_count: active.output_underflow_count.load(Ordering::Relaxed),
        disk_write_error_count: active.disk_write_error_count.load(Ordering::Relaxed),
        callback_load: f32::from_bits(active.callback_load_bits.load(Ordering::Relaxed)),
    })
}

pub fn update_recording_monitor(
    state: &EngineState,
    request: &MonitorRecordingRequest,
) -> Result<RecordingStatus, String> {
    let active = state.active.as_ref().ok_or("目前沒有原生錄音。")?;
    if active.recording_id != request.recording_id {
        return Err("recordingId 不符。".to_string());
    }
    if !request.level.is_finite() || !(0.0..=1.5).contains(&request.level) {
        return Err("監聽音量不合法。".to_string());
    }
    if request.level > 0.0 && !active.monitor_enabled {
        return Err("本次未開啟軟體監聽輸出。".to_string());
    }
    active
        .monitor_gain
        .store(request.level.to_bits(), Ordering::Relaxed);
    Ok(recording_status(state))
}

fn collect_partial_files(root: &Path, directory: &Path, output: &mut Vec<RecoverableRecording>) {
    let Ok(entries) = fs::read_dir(directory) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            collect_partial_files(root, &path, output);
            continue;
        }
        let is_partial = path
            .file_name()
            .and_then(|value| value.to_str())
            .is_some_and(|value| value.ends_with(".wav.partial"));
        if !is_partial {
            continue;
        }
        let size = fs::metadata(&path).map(|value| value.len()).unwrap_or(0);
        let relative = path
            .strip_prefix(root)
            .unwrap_or(&path)
            .to_string_lossy()
            .to_string();
        output.push(RecoverableRecording {
            relative_path: relative,
            file_size_bytes: size,
            recoverable: size > 44,
        });
    }
}

pub fn list_recoverable_recordings(data_root: &Path) -> Vec<RecoverableRecording> {
    let mut files = Vec::new();
    for protected_root in [data_root.join("uploads"), data_root.join("recordings")] {
        collect_partial_files(data_root, &protected_root, &mut files);
    }
    files.sort_by(|left, right| left.relative_path.cmp(&right.relative_path));
    files
}

fn repair_pcm_wav_header(path: &Path) -> Result<(), String> {
    let size = fs::metadata(path)
        .map_err(|error| format!("無法讀取暫存 WAV：{error}"))?
        .len();
    if size <= 44 || size > u32::MAX as u64 {
        return Err("暫存 WAV 大小不合法。".to_string());
    }
    let mut file = OpenOptions::new()
        .read(true)
        .write(true)
        .open(path)
        .map_err(|error| format!("無法開啟暫存 WAV：{error}"))?;
    file.seek(SeekFrom::Start(4))
        .map_err(|error| error.to_string())?;
    file.write_all(&((size as u32) - 8).to_le_bytes())
        .map_err(|error| error.to_string())?;
    file.seek(SeekFrom::Start(40))
        .map_err(|error| error.to_string())?;
    file.write_all(&((size as u32) - 44).to_le_bytes())
        .map_err(|error| error.to_string())?;
    file.flush().map_err(|error| error.to_string())?;
    Ok(())
}

pub fn recover_partial_recordings(data_root: &Path) -> RecordingRecoveryResult {
    let files = list_recoverable_recordings(data_root);
    let mut recovered = Vec::new();
    let mut skipped = Vec::new();
    for item in files {
        let partial = data_root.join(&item.relative_path);
        if !item.recoverable || repair_pcm_wav_header(&partial).is_err() {
            skipped.push(item.relative_path);
            continue;
        }
        let partial_name = partial
            .file_name()
            .and_then(|value| value.to_str())
            .unwrap_or("recording.wav.partial");
        let final_name = partial_name
            .strip_suffix(".partial")
            .unwrap_or("recording-recovered.wav");
        let mut final_path = partial.with_file_name(final_name);
        if final_path.exists() {
            let stem = final_path
                .file_stem()
                .and_then(|value| value.to_str())
                .unwrap_or("recording");
            final_path = final_path.with_file_name(format!("{stem}-recovered-{}.wav", now_ms()));
        }
        match fs::rename(&partial, &final_path) {
            Ok(()) => recovered.push(
                final_path
                    .strip_prefix(data_root)
                    .unwrap_or(&final_path)
                    .to_string_lossy()
                    .to_string(),
            ),
            Err(_) => skipped.push(item.relative_path),
        }
    }
    RecordingRecoveryResult {
        ok: skipped.is_empty(),
        recovered,
        skipped,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn capture_fixture(
        data: &[f32],
        inputs: usize,
        start: usize,
        channels: u16,
        capacity: usize,
    ) -> (Vec<f32>, Vec<f32>, f32, bool) {
        static FIXTURE_ID: AtomicU64 = AtomicU64::new(0);
        let path = std::env::temp_dir().join(format!(
            "songzu-isolation-{}-{}-{}.wav",
            std::process::id(),
            FIXTURE_ID.fetch_add(1, Ordering::Relaxed),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let (mut capture_producer, capture_consumer) = RingBuffer::new(data.len().max(1));
        let errors = Arc::new(AtomicU64::new(0));
        let writer = spawn_wav_writer(
            &path,
            WavSpec {
                channels,
                sample_rate: 48_000,
                bits_per_sample: 24,
                sample_format: WavSampleFormat::Int,
            },
            capture_consumer,
            Arc::clone(&errors),
        )
        .unwrap();
        let (producer, mut consumer) = RingBuffer::new(capacity);
        let mut producer = Some(producer);
        let count = Arc::new(AtomicU64::new(0));
        let peak = Arc::new(AtomicU32::new(0));
        let clipping = Arc::new(AtomicBool::new(false));
        process_input(
            data,
            |v| v,
            inputs,
            channels,
            start,
            2,
            &mut capture_producer,
            &mut producer,
            &count,
            &peak,
            &Arc::new(AtomicU32::new(0)),
            &clipping,
            &Arc::new(AtomicU64::new(0)),
            &Arc::new(AtomicU32::new(0)),
            &Arc::new(AtomicU64::new(0)),
            48_000,
        );
        drop(capture_producer);
        writer.join().unwrap().unwrap();
        assert_eq!(errors.load(Ordering::Relaxed), 0);
        let mut reader = hound::WavReader::open(&path).unwrap();
        assert_eq!(reader.spec().channels, channels);
        let captured: Vec<f32> = reader
            .samples::<i32>()
            .map(|s| s.unwrap() as f32 / 8_388_607.0)
            .collect();
        assert_eq!(captured.len() as u64, count.load(Ordering::Relaxed));
        let mut monitor = Vec::new();
        while let Ok(value) = consumer.pop() {
            monitor.push(value);
        }
        fs::remove_file(path).unwrap();
        (
            captured,
            monitor,
            f32::from_bits(peak.load(Ordering::Relaxed)),
            clipping.load(Ordering::Relaxed),
        )
    }

    #[test]
    fn mono_input_never_contains_other_physical_channels() {
        for start in 0..3 {
            let frame = [0.0, 0.25, -0.5];
            let (take, monitor, peak, _) = capture_fixture(&frame.repeat(64), 3, start, 1, 1024);
            assert!(take.iter().all(|v| (v - frame[start]).abs() < 0.0000002));
            assert!(monitor.iter().all(|v| *v == frame[start]));
            assert_eq!(peak, frame[start].abs());
        }
    }

    #[test]
    fn stereo_keeps_selected_pair_and_detects_antiphase_clipping() {
        let (take, monitor, peak, clipped) =
            capture_fixture(&[0.4, 0.99, -0.99, 0.8].repeat(64), 4, 1, 2, 1024);
        for frame in take.chunks_exact(2) {
            assert!((frame[0] - 0.99).abs() < 0.0000002);
            assert!((frame[1] + 0.99).abs() < 0.0000002);
        }
        assert_eq!(monitor, [0.99, -0.99].repeat(64));
        assert_eq!(peak, 0.99);
        assert!(clipped);
    }

    #[test]
    fn monitor_overflow_drops_whole_frames_without_changing_take() {
        let (take, monitor, _, _) = capture_fixture(&[0.25, -0.5].repeat(64), 2, 0, 2, 3);
        assert_eq!(take.len(), 128);
        assert_eq!(monitor, [0.25, -0.5]);
    }

    #[test]
    fn monitor_mute_drains_queued_audio_and_reaches_exact_silence() {
        let (mut producer, mut consumer) = RingBuffer::new(2000);
        for _ in 0..1000 {
            producer.push(0.5).unwrap();
        }
        let target = Arc::new(AtomicU32::new(0.0_f32.to_bits()));
        let mut envelope = MonitorEnvelope {
            gain: 1.0,
            channels: 2,
            step: 1.5 / 288.0,
            target,
        };
        let mut output = vec![0.0; 1000];
        fill_monitor_output(
            &mut output,
            &mut consumer,
            &AtomicU64::new(0),
            &mut envelope,
            |v| v,
        );
        assert!(output[600..].iter().all(|v| *v == 0.0));
        assert_eq!(consumer.slots(), 0);
        assert!(output
            .windows(2)
            .all(|pair| (pair[1] - pair[0]).abs() < 0.003));
    }

    #[test]
    fn monitor_command_rejects_missing_recording() {
        assert!(update_recording_monitor(
            &EngineState::default(),
            &MonitorRecordingRequest {
                recording_id: "missing".into(),
                level: 0.0
            }
        )
        .is_err());
    }

    #[test]
    fn stalled_disk_ring_never_partially_writes_a_stereo_frame() {
        let (mut producer, mut consumer) = RingBuffer::new(3);
        let count = Arc::new(AtomicU64::new(0));
        let xruns = Arc::new(AtomicU64::new(0));
        process_input(
            &[0.25, -0.5, 0.8, -0.8],
            |v| v,
            2,
            2,
            0,
            0,
            &mut producer,
            &mut None,
            &count,
            &Arc::new(AtomicU32::new(0)),
            &Arc::new(AtomicU32::new(0)),
            &Arc::new(AtomicBool::new(false)),
            &xruns,
            &Arc::new(AtomicU32::new(0)),
            &Arc::new(AtomicU64::new(0)),
            48_000,
        );
        assert_eq!(count.load(Ordering::Relaxed), 2);
        assert_eq!(xruns.load(Ordering::Relaxed), 1);
        assert_eq!(consumer.pop(), Ok(0.25));
        assert_eq!(consumer.pop(), Ok(-0.5));
        assert!(consumer.pop().is_err());
    }

    #[test]
    fn rejects_paths_outside_data_root() {
        let root = Path::new("/tmp/songzu");
        assert!(safe_recording_path(root, "uploads/song/recording.wav").is_ok());
        assert!(safe_recording_path(root, "../outside.wav").is_err());
        assert!(safe_recording_path(root, "/tmp/outside.wav").is_err());
        assert!(safe_recording_path(root, "uploads/song/recording.mp3").is_err());
    }

    #[test]
    fn latency_estimate_is_stable() {
        let estimate = estimate_latency(&LatencyRequest {
            sample_rate: Some(48_000),
            buffer_frames: Some(256),
            monitor_enabled: Some(true),
        });
        assert_eq!(estimate.status, "estimated");
        assert!(estimate.estimated_round_trip_ms > 10.0);
        assert!(estimate.suggested_compensation_ms < 20.0);
    }

    #[test]
    fn idle_status_has_no_recording_id() {
        let state = EngineState::default();
        let status = recording_status(&state);
        assert_eq!(status.status, "idle");
        assert!(status.recording_id.is_none());
    }

    #[test]
    fn empty_directory_has_no_recoverable_recordings() {
        let root = std::env::temp_dir().join(format!("songzu-recovery-{}", now_ms()));
        fs::create_dir_all(&root).unwrap();
        assert!(list_recoverable_recordings(&root).is_empty());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn recovery_scan_only_reads_protected_recording_roots() {
        let root = std::env::temp_dir().join(format!("songzu-recovery-scope-{}", now_ms()));
        let protected = root.join("uploads/song/recordings");
        let ignored = root.join("node_modules/cache");
        fs::create_dir_all(&protected).unwrap();
        fs::create_dir_all(&ignored).unwrap();
        fs::write(protected.join("take.wav.partial"), vec![0_u8; 64]).unwrap();
        fs::write(ignored.join("foreign.wav.partial"), vec![0_u8; 64]).unwrap();
        let files = list_recoverable_recordings(&root);
        assert_eq!(files.len(), 1);
        assert!(files[0].relative_path.contains("uploads/song/recordings"));
        fs::remove_dir_all(root).unwrap();
    }
}
