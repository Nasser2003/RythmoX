use std::fs::File;
use std::io::{Write, Read, BufReader, BufRead};
use std::process::Stdio;
use serde::{Deserialize, Serialize};
use std::path::Path;
use tauri::{command, Emitter};

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct VideoMetadata {
    pub duration: f64,
    pub fps: f64,
    pub width: u32,
    pub height: u32,
    pub codec: String,
    pub file_size: u64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ProxyProgress {
    pub percent: f64,
    pub stage: String,
}

/// Locate ffmpeg binary by checking PATH then common installation dirs
fn find_ffmpeg() -> String {
    // Common install paths on Windows
    let candidates = [
        "ffmpeg",
        r"C:\ffmpeg\bin\ffmpeg.exe",
        r"C:\Program Files\Krita (x64)\bin\ffmpeg.exe",
        r"C:\ProgramData\chocolatey\bin\ffmpeg.exe",
        r"C:\tools\ffmpeg\bin\ffmpeg.exe",
    ];
    for path in &candidates {
        // Use file existence check rather than spawning a process
        if *path == "ffmpeg" || Path::new(path).exists() {
            // Verify it actually runs
            let result = std::process::Command::new(*path).arg("-version").output();
            if result.map(|o| o.status.success()).unwrap_or(false) {
                return path.to_string();
            }
        }
    }
    // Last resort: return first path that exists even if -version failed
    for path in &candidates[1..] {
        if Path::new(path).exists() {
            return path.to_string();
        }
    }
    "ffmpeg".to_string() // fallback
}

/// Locate ffprobe binary (same logic)
fn find_ffprobe() -> String {
    // Try to derive ffprobe from ffmpeg location
    let ffmpeg = find_ffmpeg();
    if ffmpeg != "ffmpeg" {
        let probe = ffmpeg.replace("ffmpeg.exe", "ffprobe.exe").replace("ffmpeg", "ffprobe");
        if Path::new(&probe).exists() {
            return probe;
        }
    }
    let candidates = [
        "ffprobe",
        r"C:\ffmpeg\bin\ffprobe.exe",
        r"C:\Program Files\Krita (x64)\bin\ffprobe.exe",
        r"C:\ProgramData\chocolatey\bin\ffprobe.exe",
        r"C:\tools\ffmpeg\bin\ffprobe.exe",
    ];
    for path in &candidates {
        if Path::new(path).exists() {
            return path.to_string();
        }
    }
    "ffprobe".to_string()
}

/// Get video metadata using ffprobe
#[command]
pub async fn get_video_metadata(video_path: String) -> Result<VideoMetadata, String> {
    let path = Path::new(&video_path);
    if !path.exists() {
        return Err(format!("File not found: {}", video_path));
    }

    let file_size = std::fs::metadata(path)
        .map_err(|e| format!("Cannot read file: {}", e))?
        .len();

    // Use ffprobe to get video info
    let output = std::process::Command::new(find_ffprobe())
        .args([
            "-v", "quiet",
            "-print_format", "json",
            "-show_format",
            "-show_streams",
            &video_path,
        ])
        .output()
        .map_err(|e| format!("FFprobe not found. Please install FFmpeg. Error: {}", e))?;

    if !output.status.success() {
        return Err("FFprobe failed to analyze the video".to_string());
    }

    let json_str = String::from_utf8_lossy(&output.stdout);
    let json: serde_json::Value = serde_json::from_str(&json_str)
        .map_err(|e| format!("Failed to parse ffprobe output: {}", e))?;

    // Find video stream
    let streams = json["streams"].as_array()
        .ok_or("No streams found in video")?;
    
    let video_stream = streams.iter()
        .find(|s| s["codec_type"].as_str() == Some("video"))
        .ok_or("No video stream found")?;

    let width = video_stream["width"].as_u64().unwrap_or(1920) as u32;
    let height = video_stream["height"].as_u64().unwrap_or(1080) as u32;
    let codec = video_stream["codec_name"].as_str().unwrap_or("unknown").to_string();

    // Parse FPS from r_frame_rate (e.g., "24000/1001")
    let fps_str = video_stream["r_frame_rate"].as_str().unwrap_or("24/1");
    let fps = parse_fps(fps_str);

    // Parse duration
    let duration = json["format"]["duration"].as_str()
        .and_then(|d| d.parse::<f64>().ok())
        .or_else(|| video_stream["duration"].as_str()?.parse::<f64>().ok())
        .unwrap_or(0.0);

    Ok(VideoMetadata {
        duration,
        fps,
        width,
        height,
        codec,
        file_size,
    })
}

fn parse_fps(fps_str: &str) -> f64 {
    if let Some((num, den)) = fps_str.split_once('/') {
        let n: f64 = num.parse().unwrap_or(24.0);
        let d: f64 = den.parse().unwrap_or(1.0);
        if d > 0.0 { n / d } else { 24.0 }
    } else {
        fps_str.parse().unwrap_or(24.0)
    }
}

/// Create a lightweight proxy video for smooth playback
#[command]
pub async fn create_proxy(
    video_path: String,
    app_handle: tauri::AppHandle,
) -> Result<String, String> {
    let source = Path::new(&video_path);
    if !source.exists() {
        return Err(format!("Source file not found: {}", video_path));
    }

    // Create proxy directory next to the source file
    let proxy_dir = source.parent()
        .ok_or("Cannot determine parent directory")?
        .join(".rythmox_proxy");
    
    std::fs::create_dir_all(&proxy_dir)
        .map_err(|e| format!("Cannot create proxy directory: {}", e))?;

    let stem = source.file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("video");
    let proxy_path = proxy_dir.join(format!("{}_proxy.mp4", stem));

    // If proxy already exists and is newer than source, skip
    if proxy_path.exists() {
        if let (Ok(src_meta), Ok(proxy_meta)) = (std::fs::metadata(source), std::fs::metadata(&proxy_path)) {
            if let (Ok(src_time), Ok(proxy_time)) = (src_meta.modified(), proxy_meta.modified()) {
                if proxy_time > src_time {
                    return Ok(proxy_path.to_string_lossy().to_string());
                }
            }
        }
    }

    // Emit progress event
    let _ = app_handle.emit("proxy-progress", ProxyProgress {
        percent: 0.0,
        stage: "Starting transcode...".to_string(),
    });

    // Run FFmpeg transcode
    let output = std::process::Command::new(find_ffmpeg())
        .args([
            "-y",                        // Overwrite
            "-i", &video_path,           // Input
            "-c:v", "libx264",           // H.264 codec
            "-preset", "fast",           // Fast encoding
            "-crf", "23",                // Good quality
            "-c:a", "aac",               // AAC audio
            "-b:a", "128k",              // Audio bitrate
            "-movflags", "+faststart",   // Web optimized
            "-vf", "scale='min(1280,iw)':-2",  // Max 720p proxy
            proxy_path.to_str().unwrap_or("output.mp4"),
        ])
        .output()
        .map_err(|e| format!("FFmpeg not found. Please install FFmpeg. Error: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("FFmpeg transcode failed: {}", stderr));
    }

    let _ = app_handle.emit("proxy-progress", ProxyProgress {
        percent: 100.0,
        stage: "Proxy created!".to_string(),
    });

    Ok(proxy_path.to_string_lossy().to_string())
}

/// Check if FFmpeg is available on the system
#[command]
pub async fn check_ffmpeg() -> Result<String, String> {
    let output = std::process::Command::new(find_ffmpeg())
        .arg("-version")
        .output()
        .map_err(|_| "FFmpeg not found. Please install FFmpeg and add it to your PATH.".to_string())?;

    if output.status.success() {
        let version = String::from_utf8_lossy(&output.stdout);
        let first_line = version.lines().next().unwrap_or("FFmpeg installed");
        Ok(first_line.to_string())
    } else {
        Err("FFmpeg is installed but returned an error.".to_string())
    }
}

/// Extract audio peaks from video using FFmpeg for waveform visualization
#[command]
pub async fn extract_audio_waveform(
    video_path: String,
    peaks_per_second: u32,
    app_handle: tauri::AppHandle,
) -> Result<Vec<u8>, String> {
    let _ = app_handle.emit("proxy-progress", ProxyProgress {
        percent: 0.0,
        stage: "Extracting audio waveform...".to_string(),
    });

    let sample_rate = 8000;
    let samples_per_peak = sample_rate / peaks_per_second;

    let mut command = std::process::Command::new(find_ffmpeg());
    command.args([
        "-i", &video_path,
        "-vn",               // No video
        "-ac", "1",          // Mono
        "-ar", &sample_rate.to_string(), // 8kHz
        "-f", "s16le",       // signed 16-bit little-endian PCM
        "-"                  // output to stdout
    ])
    .stdout(std::process::Stdio::piped())
    .stderr(std::process::Stdio::null());

    let mut child = command.spawn().map_err(|e| format!("Failed to spawn ffmpeg: {}", e))?;
    let mut stdout = child.stdout.take().ok_or("Failed to capture stdout")?;

    let mut peaks: Vec<u8> = Vec::new();
    let mut current_max = 0_i16;
    let mut current_min = 0_i16;
    let mut sample_count = 0;

    let mut buffer = [0u8; 8192];
    loop {
        let bytes_read = stdout.read(&mut buffer).map_err(|e| e.to_string())?;
        if bytes_read == 0 {
            break;
        }

        // Process bytes as i16 (little endian)
        for chunk in buffer[..bytes_read].chunks_exact(2) {
            let sample = i16::from_le_bytes([chunk[0], chunk[1]]);
            if sample > current_max { current_max = sample; }
            if sample < current_min { current_min = sample; }

            sample_count += 1;
            if sample_count >= samples_per_peak {
                let abs_max = current_max.saturating_abs().max(current_min.saturating_abs());
                let normalized = ((abs_max as f64 / 32768.0).sqrt() * 255.0).min(255.0) as u8;
                peaks.push(normalized);

                current_max = 0;
                current_min = 0;
                sample_count = 0;
            }
        }
    }

    let _ = child.wait(); // Clean up process
    Ok(peaks)
}

/// Save a base64 encoded image chunk to a generic temp file
#[command]
pub async fn save_image_chunk(data: Vec<u8>, suffix: String, _app_handle: tauri::AppHandle) -> Result<String, String> {
    let temp_dir = std::env::temp_dir().join("rythmox");
    std::fs::create_dir_all(&temp_dir)
        .map_err(|e| format!("Cannot create temp directory: {}", e))?;
    
    // Auto-detect format from magic bytes so JPEG chunks get the correct extension
    let ext = if data.len() >= 2 && data[0] == 0xFF && data[1] == 0xD8 { "jpg" } else { "png" };
    let file_path = temp_dir.join(format!("chunk_{}_{}.{}", std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_millis(), suffix, ext));
    
    let mut file = File::create(&file_path)
        .map_err(|e| format!("Cannot create img file: {}", e))?;
        
    file.write_all(&data)
        .map_err(|e| format!("Cannot write img data: {}", e))?;
        
    Ok(file_path.to_string_lossy().to_string())
}

/// Composite the track PNG chunks onto the original video using mathematical panning
#[command]
pub async fn export_fast_video(
    video_path: String,
    chunk_paths: Vec<String>,
    ui_path: String,
    output_path: String,
    duration: f64,
    trim_start: f64,
    pps: f64,
    chunk_duration: f64,
    track_offset_x: f64,
    overlay_width: u32,
    overlay_height: u32,
    gpu: Option<String>,
    app_handle: tauri::AppHandle,
) -> Result<String, String> {
    let _ = app_handle.emit("export-progress", ProxyProgress {
        percent: 0.0,
        stage: "Compositing video...".to_string(),
    });

    let mut args = vec![
        "-y".to_string(),
        "-threads".to_string(), "0".to_string(), // Use all CPU cores
        "-ss".to_string(), trim_start.to_string(),
        "-t".to_string(), duration.to_string(),
        "-i".to_string(), video_path,
    ];

    for chunk in &chunk_paths {
        args.push("-loop".to_string());
        args.push("1".to_string());
        args.push("-i".to_string());
        args.push(chunk.clone());
    }
    
    args.push("-loop".to_string());
    args.push("1".to_string());
    args.push("-i".to_string());
    args.push(ui_path.clone());

    // Build the filter_complex graph
    // [0:v] is main video
    // [1:v] to [N:v] are chunks
    // [N+1:v] is ui.png
    let mut filter = format!("color=c=#0A0C18@0.92:s={}x{}:d={}[strip_bg];", overlay_width, overlay_height, duration);
    let mut last_label = "strip_bg".to_string();

    for (i, _) in chunk_paths.iter().enumerate() {
        let input_idx = i + 1;
        let start_time = (i as f64) * chunk_duration;
        let next_label = format!("strip{}", i);
        // Expression: x='TRACK_OFFSET + (START - t)*pps'
        // 'shortest=0' prevents the overlay from terminating early.
        filter.push_str(&format!("[{}][{}:v]overlay=x='{}+({}-t)*{}':y=0:shortest=0[{}];", 
            last_label, input_idx, track_offset_x, start_time, pps, next_label));
        last_label = next_label;
    }

    let ui_idx = chunk_paths.len() + 1;
    let final_strip_label = "final_strip";
    filter.push_str(&format!("[{}][{}:v]overlay=x=0:y=0:shortest=0[{}];", last_label, ui_idx, final_strip_label));
    
    filter.push_str(&format!("[0:v][{}]overlay=x=0:y=H-{}:shortest=1[out]", final_strip_label, overlay_height));

    // Select video codec + encoder settings based on requested GPU acceleration
    let codec_args: Vec<String> = match gpu.as_deref().unwrap_or("none") {
        "nvenc" => vec![
            "-c:v".into(), "h264_nvenc".into(),
            "-preset".into(), "p4".into(),
            "-rc".into(), "vbr".into(),
            "-cq".into(), "23".into(),
        ],
        "qsv" => vec![
            "-c:v".into(), "h264_qsv".into(),
            "-global_quality".into(), "23".into(),
            "-preset".into(), "medium".into(),
        ],
        "amf" => vec![
            "-c:v".into(), "h264_amf".into(),
            "-quality".into(), "balanced".into(),
            "-qp_i".into(), "22".into(),
            "-qp_p".into(), "24".into(),
        ],
        _ => vec![
            "-c:v".into(), "libx264".into(),
            "-preset".into(), "veryfast".into(), // ~1.5× faster than "fast", same CRF quality
            "-crf".into(), "23".into(),
        ],
    };

    args.extend(vec![
        "-filter_complex".to_string(), filter,
        "-map".to_string(), "[out]".to_string(),
        "-map".to_string(), "0:a?".to_string(),
    ]);
    args.extend(codec_args);
    args.extend(vec![
        "-c:a".to_string(), "aac".to_string(),
        "-b:a".to_string(), "192k".to_string(),
        output_path.clone(),
    ]);

    let mut child = std::process::Command::new(find_ffmpeg())
        .args(&args)
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("FFmpeg execution failed: {}", e))?;

    let stderr = child.stderr.take().ok_or("Failed to capture stderr")?;
    let reader = BufReader::new(stderr);

    let mut collected_stderr: Vec<String> = Vec::new();

    // Read stderr line by line for progress (FFmpeg uses \r for progress lines)
    for line in reader.split(b'\r') {
        if let Ok(bytes) = line {
            let s = String::from_utf8_lossy(&bytes).to_string();
            // Collect all lines for error reporting
            if !s.trim().is_empty() {
                collected_stderr.push(s.clone());
            }
            if let Some(time_pos) = s.find("time=") {
                let time_part = &s[time_pos + 5..];
                if let Some(space_pos) = time_part.find(' ') {
                    let time_str = &time_part[..space_pos];
                    // Parse HH:MM:SS.ms
                    let parts: Vec<&str> = time_str.split(':').collect();
                    if parts.len() == 3 {
                        let h: f64 = parts[0].parse().unwrap_or(0.0);
                        let m: f64 = parts[1].parse().unwrap_or(0.0);
                        let s_parts: Vec<&str> = parts[2].split('.').collect();
                        let sec: f64 = s_parts[0].parse().unwrap_or(0.0);
                        let total_sec = h * 3600.0 + m * 60.0 + sec;
                        
                        let percent = (total_sec / duration * 100.0).min(100.0);
                        let _ = app_handle.emit("export-progress", ProxyProgress {
                            percent,
                            stage: format!("Encodage... ({:.1}%)", percent),
                        });
                    }
                }
            }
        }
    }

    let status = child.wait().map_err(|e| format!("FFmpeg failed to exit: {}", e))?;

    if !status.success() {
        // Return the last 20 lines of stderr so the user sees the real error
        let tail: Vec<&String> = collected_stderr.iter()
            .filter(|l| !l.contains("time=") && !l.starts_with("frame="))
            .collect();
        let relevant: String = tail.iter().rev().take(20).rev()
            .map(|l| l.trim())
            .filter(|l| !l.is_empty())
            .collect::<Vec<_>>()
            .join("\n");
        return Err(format!("FFmpeg error:\n{}", relevant));
    }

    let _ = app_handle.emit("export-progress", ProxyProgress {
        percent: 100.0,
        stage: "Export complete!".to_string(),
    });

    // Cleanup temp images
    for chunk in &chunk_paths {
        let _ = std::fs::remove_file(chunk);
    }
    let _ = std::fs::remove_file(&ui_path);

    Ok(output_path)
}

/// Probe which hardware video encoders are actually usable on this machine.
/// Tries a tiny dummy encode with each encoder; returns a list of working encoder keys.
/// "none" (CPU/libx264) is always included first.
#[command]
pub async fn detect_gpu_encoders() -> Result<Vec<String>, String> {
    let ffmpeg = find_ffmpeg();
    let mut available: Vec<String> = vec!["none".to_string()];

    let candidates = [
        ("nvenc", "h264_nvenc"),
        ("qsv",   "h264_qsv"),
        ("amf",   "h264_amf"),
    ];

    for (key, encoder) in &candidates {
        // Attempt a minimal dummy encode: 1 frame, 64x64, no output file
        let result = std::process::Command::new(&ffmpeg)
            .args([
                "-f", "lavfi",
                "-i", "nullsrc=s=64x64:d=0.04",
                "-frames:v", "1",
                "-c:v", encoder,
                "-f", "null",
                "-",
            ])
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status();

        if result.map(|s| s.success()).unwrap_or(false) {
            available.push(key.to_string());
        }
    }

    Ok(available)
}
