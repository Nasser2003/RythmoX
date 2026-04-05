use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::Path;
use tauri::command;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct DialogueStyle {
    pub font_family: String,
    pub bold: bool,
    pub italic: bool,
    pub underline: bool,
    pub crossed: bool,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct RythmoSymbol {
    pub symbol_type: String, // "breath", "pause", "laugh", "cry", "noise"
    pub time: f64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct DialogueVisualCut {
    pub id: String,
    pub position: f64,
    #[serde(default)]
    pub char_index: Option<usize>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Dialogue {
    pub id: String,
    pub character_id: String,
    pub start_time: f64,
    pub end_time: f64,
    pub text: String,
    pub symbols: Vec<RythmoSymbol>,
    #[serde(default)]
    pub visual_cuts: Vec<DialogueVisualCut>,
    pub font_family: String,
    pub bold: bool,
    pub underline: bool,
    pub crossed: bool,
    #[serde(default)]
    pub italic: bool,
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
    #[serde(default)]
    pub export_start: f64,
    #[serde(default)]
    pub export_end: f64,
}

impl Default for BandSettings {
    fn default() -> Self {
        Self {
            scroll_speed: 200.0,
            band_height: 140.0,
            font_size: 20.0,
            font_family: "Inter".to_string(),
            show_timecodes: true,
            export_start: 0.0,
            export_end: 0.0,
        }
    }
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Marker {
    pub id: String,
    pub time: f64,
    pub label: String,
    pub color: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ViewState {
    pub current_time: f64,
    pub timeline_zoom: f64,
    pub timeline_scroll: f64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ExportSettings {
    pub scale: f64,
    pub pps: f64,
    pub opacity: f64,
    pub gpu: String,
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
    pub markers: Vec<Marker>,
    pub settings: BandSettings,
    #[serde(default)]
    pub view_state: Option<ViewState>,
    #[serde(default)]
    pub export_settings: Option<ExportSettings>,
    #[serde(default)]
    pub default_dialogue_style: Option<DialogueStyle>,
    #[serde(default)]
    pub default_dialogue_style_by_role: HashMap<String, DialogueStyle>,
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
            markers: vec![],
            settings: BandSettings::default(),
            view_state: None,
            export_settings: None,
            default_dialogue_style: None,
            default_dialogue_style_by_role: HashMap::new(),
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
        .map_err(|e| {
            let msg = e.to_string();
            // Serde messages look like "missing field `bold` at line X column Y"
            // or "unknown field `font_size`, expected one of ...".
            // Strip the noisy "at line X column Y" suffix and simplify.
            let core = if let Some(pos) = msg.find(" at line ") {
                msg[..pos].to_string()
            } else {
                msg
            };
            if core.contains("missing field") {
                format!("Incompatible project format: {core}.\nThis project may have been created with an older version of RythmoX.")
            } else if core.contains("unknown field") {
                format!("Incompatible project format: {core}.\nThis project may have been created with a newer version of RythmoX.")
            } else {
                format!("Failed to load project: {core}")
            }
        })?;
    
    Ok(project)
}

#[command]
pub fn new_project() -> Project {
    Project::default()
}
