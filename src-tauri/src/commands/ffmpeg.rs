use std::fs::File;
use std::io::Write;
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

/// Save a base64 encoded image chunk to a generic temp file
#[command]
pub async fn save_image_chunk(data: Vec<u8>, suffix: String, _app_handle: tauri::AppHandle) -> Result<String, String> {
    let temp_dir = std::env::temp_dir().join("rythmox");
    std::fs::create_dir_all(&temp_dir)
        .map_err(|e| format!("Cannot create temp directory: {}", e))?;
    
    let file_path = temp_dir.join(format!("chunk_{}_{}.png", std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_millis(), suffix));
    
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
    pps: f64,
    chunk_duration: f64,
    track_offset_x: f64,
    overlay_width: u32,
    overlay_height: u32,
    app_handle: tauri::AppHandle,
) -> Result<String, String> {
    let _ = app_handle.emit("export-progress", ProxyProgress {
        percent: 0.0,
        stage: "Compositing video...".to_string(),
    });

    let mut args = vec![
        "-y".to_string(),
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

    args.extend(vec![
        "-filter_complex".to_string(), filter,
        "-map".to_string(), "[out]".to_string(),
        "-map".to_string(), "0:a?".to_string(), // Copy audio if it exists
        "-c:v".to_string(), "libx264".to_string(),
        "-preset".to_string(), "fast".to_string(),
        "-crf".to_string(), "23".to_string(),
        "-c:a".to_string(), "aac".to_string(),
        "-b:a".to_string(), "192k".to_string(),
        output_path.clone()
    ]);

    let output = std::process::Command::new(find_ffmpeg())
        .args(&args)
        .output()
        .map_err(|e| format!("FFmpeg execution failed: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("Export failed: {}", stderr));
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

