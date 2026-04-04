mod commands;

use commands::ffmpeg;
use commands::project;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_fs::init())
        .invoke_handler(tauri::generate_handler![
            // FFmpeg commands
            ffmpeg::get_video_metadata,
            ffmpeg::create_proxy,
            ffmpeg::check_ffmpeg,
            ffmpeg::save_image_chunk,
            ffmpeg::export_fast_video,
            ffmpeg::extract_audio_waveform,
            // Project commands
            project::save_project,
            project::load_project,
            project::new_project,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
