use serde::{Deserialize, Serialize};
use std::path::Path;
use tauri::command;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct RythmoSymbol {
    pub symbol_type: String, // "breath", "pause", "laugh", "cry", "noise"
    pub time: f64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Dialogue {
    pub id: String,
    pub character_id: String,
    pub start_time: f64,
    pub end_time: f64,
    pub text: String,
    pub detection: String,
    pub symbols: Vec<RythmoSymbol>,
    pub font_family: String,
    pub font_size: f64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Character {
    pub id: String,
    pub name: String,
    pub color: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct VideoInfo {
    pub original_path: String,
    pub proxy_path: Option<String>,
    pub duration: f64,
    pub fps: f64,
    pub resolution: (u32, u32),
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct BandSettings {
    pub scroll_speed: f64,
    pub band_height: f64,
    pub font_size: f64,
    pub font_family: String,
    pub show_timecodes: bool,
}

impl Default for BandSettings {
    fn default() -> Self {
        Self {
            scroll_speed: 200.0,
            band_height: 140.0,
            font_size: 20.0,
            font_family: "Inter".to_string(),
            show_timecodes: true,
        }
    }
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Project {
    pub version: String,
    pub name: String,
    pub created: String,
    pub modified: String,
    pub video: Option<VideoInfo>,
    pub characters: Vec<Character>,
    pub dialogues: Vec<Dialogue>,
    pub settings: BandSettings,
}

impl Default for Project {
    fn default() -> Self {
        Self {
            version: "1.0".to_string(),
            name: "New Project".to_string(),
            created: chrono_now(),
            modified: chrono_now(),
            video: None,
            characters: vec![],
            dialogues: vec![],
            settings: BandSettings::default(),
        }
    }
}

fn chrono_now() -> String {
    // Simple ISO 8601 timestamp
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    format!("{}", now)
}

#[command]
pub async fn save_project(project: Project, file_path: String) -> Result<(), String> {
    let mut project = project;
    project.modified = chrono_now();
    
    let json = serde_json::to_string_pretty(&project)
        .map_err(|e| format!("Failed to serialize project: {}", e))?;
    
    std::fs::write(&file_path, json)
        .map_err(|e| format!("Failed to write project file: {}", e))?;
    
    Ok(())
}

#[command]
pub async fn load_project(file_path: String) -> Result<Project, String> {
    let path = Path::new(&file_path);
    if !path.exists() {
        return Err(format!("Project file not found: {}", file_path));
    }

    let content = std::fs::read_to_string(path)
        .map_err(|e| format!("Failed to read project file: {}", e))?;
    
    let project: Project = serde_json::from_str(&content)
        .map_err(|e| format!("Failed to parse project file: {}", e))?;
    
    Ok(project)
}

#[command]
pub fn new_project() -> Project {
    Project::default()
}
