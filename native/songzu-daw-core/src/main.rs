mod audio;
mod playback;

use audio::{
    estimate_latency, list_devices, list_recoverable_recordings, recording_status,
    recover_partial_recordings, start_recording, stop_recording, EngineState, LatencyRequest,
    StartRecordingRequest, StopRecordingRequest, MonitorRecordingRequest, update_recording_monitor,
};
use playback::{
    disk_streaming_status, start_disk_streaming_playback, stop_disk_streaming_playback,
    StartPlaybackRequest, StopPlaybackRequest,
};
use serde_json::{json, Value};
use std::env;
use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

const VERSION: &str = "0.4.0";
const MAX_REQUEST_BYTES: usize = 65_536;

fn now_ms() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or(0)
}

fn http_response(status: u16, label: &str, body: &Value) -> String {
    let body = body.to_string();
    format!(
        "HTTP/1.1 {status} {label}\r\nContent-Type: application/json; charset=utf-8\r\nAccess-Control-Allow-Origin: *\r\nAccess-Control-Allow-Methods: GET, POST, OPTIONS\r\nAccess-Control-Allow-Headers: Content-Type\r\nCache-Control: no-store\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
        body.len(),
        body
    )
}

fn ok(body: Value) -> String {
    http_response(200, "OK", &body)
}

fn bad_request(message: impl Into<String>) -> String {
    http_response(
        400,
        "Bad Request",
        &json!({ "ok": false, "error": message.into() }),
    )
}

fn conflict(message: impl Into<String>) -> String {
    http_response(
        409,
        "Conflict",
        &json!({ "ok": false, "error": message.into() }),
    )
}

fn not_found_response() -> String {
    http_response(
        404,
        "Not Found",
        &json!({ "ok": false, "error": "not_found" }),
    )
}

fn status_json() -> Value {
    json!({
        "ok": true,
        "engine": "songzu-daw-core",
        "version": VERSION,
        "mode": "native_service",
        "timestampMs": now_ms(),
        "capabilities": [
            "coreaudio_devices",
            "wav_24bit_recording",
            "discrete_input_routing",
            "live_recording_monitor_gate",
            "input_level_meter",
            "headphone_monitor_route",
            "latency_estimate",
            "engine_health_counters",
            "crash_safe_partial_wav",
            "recording_recovery",
            "native_disk_streaming_playback",
            "render_bridge_stub"
        ],
        "openCoreBoundary": "core-code-format-sdk-only"
    })
}

fn devices_json() -> Value {
    match list_devices() {
        Ok((input_devices, output_devices)) => json!({
            "ok": true,
            "mode": "native_service",
            "inputDevices": input_devices,
            "outputDevices": output_devices,
            "message": "CoreAudio 裝置已由本機 Rust 引擎列出。"
        }),
        Err(error) => json!({
            "ok": false,
            "mode": "native_service",
            "inputDevices": [],
            "outputDevices": [],
            "error": error,
            "message": "CoreAudio 裝置列舉失敗。"
        }),
    }
}

fn render_json() -> Value {
    json!({
        "ok": true,
        "mode": "native_service",
        "status": "accepted_by_bridge",
        "message": "目前由 Next 與 ffmpeg 橋接輸出；原生錄音已獨立使用 CoreAudio。"
    })
}

fn parse_json<T: serde::de::DeserializeOwned>(body: &str) -> Result<T, String> {
    serde_json::from_str(body).map_err(|error| format!("JSON 格式錯誤：{error}"))
}

fn is_stateless_route(method: &str, path: &str) -> bool {
    method == "OPTIONS"
        || matches!(
            (method, path),
            ("GET", "/status")
                | ("GET", "/devices")
                | ("POST", "/latency-test")
                | ("POST", "/render")
        )
}

fn stateless_route_response(method: &str, path: &str, body: &str) -> Option<String> {
    let response = match (method, path) {
        ("OPTIONS", _) => ok(json!({ "ok": true })),
        ("GET", "/status") => ok(status_json()),
        ("GET", "/devices") => ok(devices_json()),
        ("POST", "/latency-test") => {
            let request = if body.trim().is_empty() {
                LatencyRequest::default()
            } else {
                match parse_json::<LatencyRequest>(body) {
                    Ok(request) => request,
                    Err(error) => return Some(bad_request(error)),
                }
            };
            ok(serde_json::to_value(estimate_latency(&request))
                .unwrap_or_else(|_| json!({ "ok": false })))
        }
        ("POST", "/render") => ok(render_json()),
        _ => return None,
    };
    Some(response)
}

fn route_response(
    method: &str,
    path: &str,
    body: &str,
    state: &Arc<Mutex<EngineState>>,
    data_root: &Path,
) -> String {
    if let Some(response) = stateless_route_response(method, path, body) {
        return response;
    }
    match (method, path) {
        ("GET", "/recordings/status") => match state.lock() {
            Ok(state) => ok(serde_json::to_value(recording_status(&state))
                .unwrap_or_else(|_| json!({ "ok": false }))),
            Err(_) => conflict("原生錄音狀態鎖定失敗。"),
        },
        ("GET", "/health") => match state.lock() {
            Ok(state) => ok(json!({
                "ok": true,
                "mode": "native_service",
                "recording": recording_status(&state),
                "playback": disk_streaming_status(&state.playback),
                "recoverableRecordings": list_recoverable_recordings(data_root)
            })),
            Err(_) => conflict("原生錄音狀態鎖定失敗。"),
        },
        ("GET", "/recordings/recovery") => ok(json!({
            "ok": true,
            "files": list_recoverable_recordings(data_root)
        })),
        ("GET", "/playback/status") => match state.lock() {
            Ok(state) => ok(serde_json::to_value(disk_streaming_status(&state.playback))
                .unwrap_or_else(|_| json!({ "ok": false }))),
            Err(_) => conflict("原生播放狀態鎖定失敗。"),
        },
        ("POST", "/playback/start") => {
            let request = match parse_json::<StartPlaybackRequest>(body) {
                Ok(request) => request,
                Err(error) => return bad_request(error),
            };
            let mut engine = match state.lock() {
                Ok(engine) => engine,
                Err(_) => return conflict("原生播放狀態鎖定失敗。"),
            };
            match start_disk_streaming_playback(&mut engine.playback, data_root, request) {
                Ok(result) => {
                    ok(serde_json::to_value(result).unwrap_or_else(|_| json!({ "ok": false })))
                }
                Err(error) => conflict(error),
            }
        }
        ("POST", "/playback/stop") => {
            let request = match parse_json::<StopPlaybackRequest>(body) {
                Ok(request) => request,
                Err(error) => return bad_request(error),
            };
            let mut engine = match state.lock() {
                Ok(engine) => engine,
                Err(_) => return conflict("原生播放狀態鎖定失敗。"),
            };
            match stop_disk_streaming_playback(&mut engine.playback, &request) {
                Ok(result) => {
                    ok(serde_json::to_value(result).unwrap_or_else(|_| json!({ "ok": false })))
                }
                Err(error) => conflict(error),
            }
        }
        ("POST", "/recordings/recovery") => {
            ok(serde_json::to_value(recover_partial_recordings(data_root))
                .unwrap_or_else(|_| json!({ "ok": false })))
        }
        ("POST", "/recordings/start") => {
            let request = match parse_json::<StartRecordingRequest>(body) {
                Ok(request) => request,
                Err(error) => return bad_request(error),
            };
            let mut engine = match state.lock() {
                Ok(engine) => engine,
                Err(_) => return conflict("原生錄音狀態鎖定失敗。"),
            };
            match start_recording(&mut engine, data_root, request) {
                Ok(result) => {
                    ok(serde_json::to_value(result).unwrap_or_else(|_| json!({ "ok": false })))
                }
                Err(error) => conflict(error),
            }
        }
        ("POST", "/recordings/monitor") => {
            let request = match parse_json::<MonitorRecordingRequest>(body) {
                Ok(request) => request,
                Err(error) => return bad_request(error),
            };
            let engine = match state.lock() {
                Ok(engine) => engine,
                Err(_) => return conflict("原生錄音狀態鎖定失敗。"),
            };
            match update_recording_monitor(&engine, &request) {
                Ok(result) => ok(serde_json::to_value(result).unwrap_or_else(|_| json!({ "ok": false }))),
                Err(error) => conflict(error),
            }
        }
        ("POST", "/recordings/stop") => {
            let request = match parse_json::<StopRecordingRequest>(body) {
                Ok(request) => request,
                Err(error) => return bad_request(error),
            };
            let mut engine = match state.lock() {
                Ok(engine) => engine,
                Err(_) => return conflict("原生錄音狀態鎖定失敗。"),
            };
            match stop_recording(&mut engine, &request) {
                Ok(result) => {
                    ok(serde_json::to_value(result).unwrap_or_else(|_| json!({ "ok": false })))
                }
                Err(error) => conflict(error),
            }
        }
        _ => not_found_response(),
    }
}

fn read_request(stream: &mut TcpStream) -> Result<(String, String, String), String> {
    stream
        .set_read_timeout(Some(Duration::from_secs(3)))
        .map_err(|error| error.to_string())?;
    let mut request = Vec::new();
    let mut buffer = [0_u8; 4_096];
    let mut header_end = None;
    let mut expected_total = None;

    loop {
        let size = stream
            .read(&mut buffer)
            .map_err(|error| error.to_string())?;
        if size == 0 {
            break;
        }
        request.extend_from_slice(&buffer[..size]);
        if request.len() > MAX_REQUEST_BYTES {
            return Err("request_too_large".to_string());
        }
        if header_end.is_none() {
            header_end = request
                .windows(4)
                .position(|window| window == b"\r\n\r\n")
                .map(|position| position + 4);
            if let Some(end) = header_end {
                let headers = String::from_utf8_lossy(&request[..end]);
                let content_length = headers
                    .lines()
                    .find_map(|line| {
                        let (key, value) = line.split_once(':')?;
                        key.eq_ignore_ascii_case("content-length")
                            .then(|| value.trim().parse::<usize>().ok())
                            .flatten()
                    })
                    .unwrap_or(0);
                expected_total = Some(end + content_length);
            }
        }
        if expected_total.is_some_and(|expected| request.len() >= expected) {
            break;
        }
    }

    let end = header_end.ok_or_else(|| "invalid_http_request".to_string())?;
    let headers = String::from_utf8_lossy(&request[..end]);
    let first_line = headers.lines().next().unwrap_or("");
    let mut parts = first_line.split_whitespace();
    let method = parts.next().unwrap_or("").to_string();
    let path = parts.next().unwrap_or("/").to_string();
    let body = String::from_utf8_lossy(&request[end..]).to_string();
    Ok((method, path, body))
}

fn write_response(mut stream: TcpStream, response: String) {
    let _ = stream.write_all(response.as_bytes());
    let _ = stream.flush();
}

fn run_once(kind: &str, state: &Arc<Mutex<EngineState>>) {
    let body = match kind {
        "status" => status_json(),
        "devices" => devices_json(),
        "latency-test" | "latency" => {
            serde_json::to_value(estimate_latency(&LatencyRequest::default())).unwrap()
        }
        "recording-status" => state
            .lock()
            .map(|state| serde_json::to_value(recording_status(&state)).unwrap())
            .unwrap_or_else(|_| json!({ "ok": false })),
        "render" => render_json(),
        _ => json!({ "ok": false, "error": "unknown_once_command" }),
    };
    println!("{}", body);
}

fn main() {
    let args: Vec<String> = env::args().collect();
    let state = Arc::new(Mutex::new(EngineState::default()));
    if args.iter().any(|arg| arg == "--version") {
        println!("songzu-daw-core {}", VERSION);
        return;
    }

    if let Some(index) = args.iter().position(|arg| arg == "--once") {
        let kind = args.get(index + 1).map(String::as_str).unwrap_or("status");
        run_once(kind, &state);
        return;
    }

    let port = env::var("SONGZU_DAW_CORE_PORT").unwrap_or_else(|_| "39241".to_string());
    let data_root = env::var("SONGZU_MUSIC_OS_DATA_ROOT")
        .map(PathBuf::from)
        .unwrap_or_else(|_| env::current_dir().unwrap_or_else(|_| PathBuf::from(".")));
    let address = format!("127.0.0.1:{}", port);
    let listener = TcpListener::bind(&address).unwrap_or_else(|error| {
        eprintln!("failed to bind {}: {}", address, error);
        std::process::exit(1);
    });
    eprintln!(
        "songzu-daw-core {} listening on {} data_root={}",
        VERSION,
        address,
        data_root.display()
    );

    for stream in listener.incoming() {
        match stream {
            Ok(mut stream) => match read_request(&mut stream) {
                Ok((method, path, body)) if is_stateless_route(&method, &path) => {
                    std::thread::spawn(move || {
                        let response = stateless_route_response(&method, &path, &body)
                            .unwrap_or_else(not_found_response);
                        write_response(stream, response);
                    });
                }
                Ok((method, path, body)) => {
                    let response = route_response(&method, &path, &body, &state, &data_root);
                    write_response(stream, response);
                }
                Err(error) => write_response(stream, bad_request(error)),
            },
            Err(error) => eprintln!("connection error: {}", error),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn status_contract_identifies_engine_and_version() {
        let body = status_json();
        assert_eq!(body["engine"], "songzu-daw-core");
        assert_eq!(body["version"], VERSION);
        assert_eq!(body["mode"], "native_service");
        assert!(body["capabilities"]
            .as_array()
            .unwrap()
            .iter()
            .any(|value| value == "wav_24bit_recording"));
    }

    #[test]
    fn latency_contract_is_an_explicit_estimate() {
        let body = serde_json::to_value(estimate_latency(&LatencyRequest::default())).unwrap();
        assert_eq!(body["status"], "estimated");
        assert!(body["estimatedRoundTripMs"].as_f64().unwrap() > 0.0);
    }

    #[test]
    fn recording_status_contract_is_idle_by_default() {
        let state = EngineState::default();
        let body = serde_json::to_value(recording_status(&state)).unwrap();
        assert_eq!(body["status"], "idle");
        assert!(body["recordingId"].is_null());
    }

    #[test]
    fn known_routes_return_success_and_unknown_route_returns_404() {
        let state = Arc::new(Mutex::new(EngineState::default()));
        let root = Path::new("/tmp/songzu-test");
        for (method, path, body) in [
            ("GET", "/status", ""),
            ("POST", "/latency-test", "{}"),
            ("GET", "/recordings/status", ""),
            ("GET", "/health", ""),
            ("GET", "/recordings/recovery", ""),
            ("GET", "/playback/status", ""),
            ("POST", "/render", "{}"),
            ("OPTIONS", "/status", ""),
        ] {
            assert!(route_response(method, path, body, &state, root).starts_with("HTTP/1.1 200 OK"));
        }
        assert!(route_response("GET", "/missing", "", &state, root)
            .starts_with("HTTP/1.1 404 Not Found"));
    }

    #[test]
    fn response_content_length_matches_utf8_bytes() {
        let body = json!({ "message": "頌祖原生錄音" });
        let response = http_response(200, "OK", &body);
        let serialized = body.to_string();
        let expected = format!("Content-Length: {}", serialized.len());
        assert!(response.contains(&expected));
        assert!(response.ends_with(&serialized));
    }
}
