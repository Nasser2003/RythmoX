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
    let output = std::process::Command::new("ffprobe")
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
    let output = std::process::Command::new("ffmpeg")
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
    let output = std::process::Command::new("ffmpeg")
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

