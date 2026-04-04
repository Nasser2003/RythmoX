use serde::{Deserialize, Serialize};
use std::path::Path;
use tauri::command;

// ────────────────────────────────────────────────────────────────────────────
//  Shared data types (minimal, format-agnostic)
// ────────────────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SubtitleEntry {
    pub index: u32,
    pub start: f64,   // seconds
    pub end: f64,     // seconds
    pub text: String,
    pub actor: Option<String>, // character name (ASS only)
    pub style: Option<String>, // style name   (ASS only)
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ImportedSubtitles {
    pub entries: Vec<SubtitleEntry>,
    pub styles: Vec<AssStyle>,   // populated for ASS, empty for SRT
    pub markers: Vec<MarkerEntry>, // MARKER: NOTE blocks (SRT) or Comment: lines (ASS)
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AssStyle {
    pub name: String,
    pub font_family: String,
    pub font_size: f64,
    pub color: String, // #RRGGBB
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MarkerEntry {
    pub time: f64,
    pub label: String,
}

// ────────────────────────────────────────────────────────────────────────────
//  Helpers
// ────────────────────────────────────────────────────────────────────────────

/// Convert seconds to SRT timestamp  00:01:23,456
fn secs_to_srt(s: f64) -> String {
    let ms = ((s % 1.0) * 1000.0).round() as u32;
    let total = s as u64;
    let secs = total % 60;
    let mins = (total / 60) % 60;
    let hrs = total / 3600;
    format!("{:02}:{:02}:{:02},{:03}", hrs, mins, secs, ms)
}

/// Convert seconds to ASS timestamp  0:01:23.45
fn secs_to_ass(s: f64) -> String {
    let cs = ((s % 1.0) * 100.0).round() as u32;
    let total = s as u64;
    let secs = total % 60;
    let mins = (total / 60) % 60;
    let hrs = total / 3600;
    format!("{}:{:02}:{:02}.{:02}", hrs, mins, secs, cs)
}

/// Parse SRT timestamp  00:01:23,456  →  seconds
fn srt_to_secs(ts: &str) -> Option<f64> {
    // Accept both , and . as ms separator
    let ts = ts.replace(',', ".");
    let parts: Vec<&str> = ts.splitn(3, ':').collect();
    if parts.len() != 3 { return None; }
    let h: f64 = parts[0].trim().parse().ok()?;
    let m: f64 = parts[1].trim().parse().ok()?;
    let s: f64 = parts[2].trim().parse().ok()?;
    Some(h * 3600.0 + m * 60.0 + s)
}

/// Parse ASS timestamp  0:01:23.45  →  seconds
fn ass_to_secs(ts: &str) -> Option<f64> {
    let parts: Vec<&str> = ts.trim().splitn(3, ':').collect();
    if parts.len() != 3 { return None; }
    let h: f64 = parts[0].parse().ok()?;
    let m: f64 = parts[1].parse().ok()?;
    let s: f64 = parts[2].parse().ok()?;
    Some(h * 3600.0 + m * 60.0 + s)
}

/// Convert ASS BGR+alpha hex  &H00FFFFFF  →  #RRGGBB
fn ass_color_to_hex(c: &str) -> String {
    let c = c.trim_start_matches("&H").trim_start_matches("&h");
    if c.len() >= 8 {
        let r = u8::from_str_radix(&c[6..8], 16).unwrap_or(255);
        let g = u8::from_str_radix(&c[4..6], 16).unwrap_or(255);
        let b = u8::from_str_radix(&c[2..4], 16).unwrap_or(255);
        return format!("#{:02X}{:02X}{:02X}", r, g, b);
    }
    "#FFFFFF".to_string()
}

/// #RRGGBB  →  ASS &H00BBGGRR
fn hex_to_ass_color(hex: &str) -> String {
    let h = hex.trim_start_matches('#');
    if h.len() >= 6 {
        let r = &h[0..2];
        let g = &h[2..4];
        let b = &h[4..6];
        return format!("&H00{}{}{}", b, g, r);
    }
    "&H00FFFFFF".to_string()
}

// ────────────────────────────────────────────────────────────────────────────
//  SRT export
// ────────────────────────────────────────────────────────────────────────────

#[command]
pub async fn export_srt(entries: Vec<SubtitleEntry>, markers: Vec<MarkerEntry>, output_path: String, include_role: bool, include_markers: bool) -> Result<(), String> {
    let mut out = String::new();
    for (i, e) in entries.iter().enumerate() {
        out.push_str(&format!("{}\n", i + 1));
        out.push_str(&format!("{} --> {}\n", secs_to_srt(e.start), secs_to_srt(e.end)));
        let clean = strip_ass_tags(&e.text);
        // Prepend [Role] prefix if requested and actor is set
        let line = if include_role {
            if let Some(actor) = &e.actor {
                if !actor.is_empty() {
                    format!("[{}] {}", actor, clean)
                } else { clean }
            } else { clean }
        } else { clean };
        out.push_str(&line);
        out.push_str("\n\n");
    }

    // Append NOTE blocks for markers (SRT extension, ignored by most players)
    if include_markers {
        let mut sorted_markers = markers.clone();
        sorted_markers.sort_by(|a, b| a.time.partial_cmp(&b.time).unwrap_or(std::cmp::Ordering::Equal));
        for m in &sorted_markers {
            if !m.label.is_empty() {
                out.push_str(&format!("NOTE\nMARKER: {} @ {}\n\n", m.label, secs_to_srt(m.time)));
            }
        }
    }

    std::fs::write(&output_path, out)
        .map_err(|e| format!("Cannot write SRT: {}", e))
}

// ────────────────────────────────────────────────────────────────────────────
//  SRT import
// ────────────────────────────────────────────────────────────────────────────

#[command]
pub async fn import_srt(file_path: String, extract_role: bool) -> Result<ImportedSubtitles, String> {
    let path = Path::new(&file_path);
    let content = std::fs::read_to_string(path)
        .map_err(|e| format!("Cannot read SRT: {}", e))?;

    let mut entries: Vec<SubtitleEntry> = Vec::new();
    let mut markers: Vec<MarkerEntry> = Vec::new();
    let mut lines = content.lines().peekable();
    let mut index: u32 = 0;

    while let Some(line) = lines.next() {
        let line = line.trim();
        if line.is_empty() { continue; }

        // NOTE block — check for MARKER: inside
        if line.eq_ignore_ascii_case("NOTE") {
            while let Some(note_line) = lines.next() {
                let note_line = note_line.trim();
                if note_line.is_empty() { break; }
                if let Some(rest) = note_line.strip_prefix("MARKER:") {
                    let rest = rest.trim();
                    // Format: "label @ 00:01:23,000"
                    if let Some(at_pos) = rest.rfind(" @ ") {
                        let label = rest[..at_pos].trim().to_string();
                        let ts = &rest[at_pos + 3..];
                        let time = srt_to_secs(ts).unwrap_or(0.0);
                        markers.push(MarkerEntry { time, label });
                    } else {
                        // No timestamp, use 0
                        markers.push(MarkerEntry { time: 0.0, label: rest.to_string() });
                    }
                }
            }
            continue;
        }

        // Index line
        if line.parse::<u32>().is_ok() {
            index = line.parse().unwrap_or(index + 1);

            // Timestamp line
            if let Some(ts_line) = lines.next() {
                let parts: Vec<&str> = ts_line.splitn(2, "-->").collect();
                if parts.len() == 2 {
                    let start = srt_to_secs(parts[0].trim()).unwrap_or(0.0);
                    let end   = srt_to_secs(parts[1].trim()).unwrap_or(0.0);

                    // Text lines until blank
                    let mut text_lines: Vec<String> = Vec::new();
                    while let Some(tline) = lines.next() {
                        if tline.trim().is_empty() { break; }
                        text_lines.push(tline.to_string());
                    }
                    let raw_text = text_lines.join("\n");

                    // Parse [Role] prefix from first line if requested
                    let (actor, text) = if extract_role {
                        parse_role_prefix(&raw_text)
                    } else {
                        (None, raw_text)
                    };

                    entries.push(SubtitleEntry {
                        index,
                        start,
                        end,
                        text,
                        actor,
                        style: None,
                    });
                }
            }
        }
    }

    Ok(ImportedSubtitles { entries, styles: vec![], markers })
}

// ────────────────────────────────────────────────────────────────────────────
//  ASS export
// ────────────────────────────────────────────────────────────────────────────

#[command]
pub async fn export_ass(
    entries: Vec<SubtitleEntry>,
    styles: Vec<AssStyle>,
    markers: Vec<MarkerEntry>,
    output_path: String,
    title: String,
    include_role: bool,
    include_markers: bool,
) -> Result<(), String> {
    let mut out = String::new();

    // Script info
    out.push_str("[Script Info]\n");
    out.push_str("ScriptType: v4.00+\n");
    out.push_str("WrapStyle: 0\n");
    out.push_str("ScaledBorderAndShadow: yes\n");
    out.push_str("YCbCr Matrix: None\n");
    out.push_str(&format!("Title: {}\n\n", title));

    // V4+ Styles
    out.push_str("[V4+ Styles]\n");
    out.push_str("Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\n");

    if styles.is_empty() {
        // Default style
        out.push_str("Style: Default,Arial,20,&H00FFFFFF,&H000000FF,&H00000000,&H80000000,-1,0,0,0,100,100,0,0,1,2,0,2,10,10,10,1\n");
    } else {
        for s in &styles {
            let color = hex_to_ass_color(&s.color);
            out.push_str(&format!(
                "Style: {},{},{:.0},{},&H000000FF,&H00000000,&H80000000,0,0,0,0,100,100,0,0,1,2,0,2,10,10,10,1\n",
                s.name, s.font_family, s.font_size, color
            ));
        }
    }

    // Events
    out.push_str("\n[Events]\n");
    out.push_str("Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n");

    for e in &entries {
        let style = e.style.as_deref().unwrap_or("Default");
        let actor = e.actor.as_deref().unwrap_or("");
        // Escape newlines as ASS \N
        let base_text = e.text.replace('\n', "\\N");
        // Optionally prepend [Role] in text (in addition to native Name field)
        let text = if include_role && !actor.is_empty() {
            format!("[{}] {}", actor, base_text)
        } else {
            base_text
        };
        out.push_str(&format!(
            "Dialogue: 0,{},{},{},{},0,0,0,,{}\n",
            secs_to_ass(e.start),
            secs_to_ass(e.end),
            style,
            actor,
            text,
        ));
    }

    // Append Comment: lines for markers (native ASS comments, ignored by players)
    if include_markers {
        let mut sorted_markers = markers.clone();
        sorted_markers.sort_by(|a, b| a.time.partial_cmp(&b.time).unwrap_or(std::cmp::Ordering::Equal));
        for m in &sorted_markers {
            if !m.label.is_empty() {
                out.push_str(&format!(
                    "Comment: 0,{},{},Default,,0,0,0,,MARKER: {}\n",
                    secs_to_ass(m.time),
                    secs_to_ass(m.time),
                    m.label,
                ));
            }
        }
    }

    std::fs::write(&output_path, out)
        .map_err(|e| format!("Cannot write ASS: {}", e))
}

// ────────────────────────────────────────────────────────────────────────────
//  ASS import
// ────────────────────────────────────────────────────────────────────────────

#[command]
pub async fn import_ass(file_path: String, extract_role: bool) -> Result<ImportedSubtitles, String> {
    let path = Path::new(&file_path);
    let content = std::fs::read_to_string(path)
        .map_err(|e| format!("Cannot read ASS: {}", e))?;

    let mut styles: Vec<AssStyle> = Vec::new();
    let mut entries: Vec<SubtitleEntry> = Vec::new();
    let mut markers: Vec<MarkerEntry> = Vec::new();
    let mut in_events = false;
    let mut in_styles = false;
    let mut event_format: Vec<String> = Vec::new();
    let mut style_format: Vec<String> = Vec::new();
    let mut index: u32 = 0;

    for line in content.lines() {
        let line = line.trim();
        if line.eq_ignore_ascii_case("[V4+ Styles]") || line.eq_ignore_ascii_case("[V4 Styles]") {
            in_styles = true;
            in_events = false;
            continue;
        }
        if line.eq_ignore_ascii_case("[Events]") {
            in_events = true;
            in_styles = false;
            continue;
        }

        if in_styles {
            if line.starts_with("Format:") {
                style_format = line[7..].split(',').map(|s| s.trim().to_lowercase()).collect();
            } else if line.starts_with("Style:") {
                let values: Vec<&str> = line[6..].splitn(style_format.len(), ',').collect();
                let get = |key: &str| -> &str {
                    style_format.iter().position(|k| k == key)
                        .and_then(|i| values.get(i).copied())
                        .unwrap_or("").trim()
                };
                styles.push(AssStyle {
                    name: get("name").to_string(),
                    font_family: get("fontname").to_string(),
                    font_size: get("fontsize").parse().unwrap_or(20.0),
                    color: ass_color_to_hex(get("primarycolour")),
                });
            }
        }

        if in_events {
            if line.starts_with("Format:") {
                event_format = line[7..].split(',').map(|s| s.trim().to_lowercase()).collect();
            } else if line.starts_with("Comment:") && in_events {
                // Parse MARKER: comments
                let n = event_format.len();
                if n > 0 {
                    let raw = &line[8..]; // after "Comment:"
                    let values: Vec<&str> = raw.splitn(n, ',').collect();
                    let get_ev = |key: &str| -> &str {
                        event_format.iter().position(|k| k == key)
                            .and_then(|i| values.get(i).copied())
                            .unwrap_or("").trim()
                    };
                    let text_field = get_ev("text");
                    if let Some(rest) = text_field.strip_prefix("MARKER:") {
                        let label = rest.trim().to_string();
                        let time = ass_to_secs(get_ev("start")).unwrap_or(0.0);
                        markers.push(MarkerEntry { time, label });
                    }
                }
            } else if line.starts_with("Dialogue:") {
                // Text field may contain commas — split by count of fields-1 then rest is text
                let n = event_format.len();
                let raw = &line[9..]; // after "Dialogue:"
                let values: Vec<&str> = raw.splitn(n, ',').collect();
                let get = |key: &str| -> &str {
                    event_format.iter().position(|k| k == key)
                        .and_then(|i| values.get(i).copied())
                        .unwrap_or("").trim()
                };
                let start = ass_to_secs(get("start")).unwrap_or(0.0);
                let end   = ass_to_secs(get("end")).unwrap_or(0.0);
                let raw_text = get("text").replace("\\N", "\n").replace("\\n", "\n");
                let raw_text = strip_ass_tags(&raw_text);
                // Actor from Name field (native ASS) — also check [Role] prefix if extract_role
                let native_actor = get("name");
                let (prefix_actor, text) = if extract_role {
                    parse_role_prefix(&raw_text)
                } else {
                    (None, raw_text)
                };
                let final_actor = if !native_actor.is_empty() {
                    Some(native_actor.to_string())
                } else {
                    prefix_actor
                };
                let final_style = get("style");

                index += 1;
                entries.push(SubtitleEntry {
                    index,
                    start,
                    end,
                    text,
                    actor: final_actor,
                    style: if final_style.is_empty() { None } else { Some(final_style.to_string()) },
                });
            }
        }
    }

    Ok(ImportedSubtitles { entries, styles, markers })
}

// ────────────────────────────────────────────────────────────────────────────
//  Helpers
// ────────────────────────────────────────────────────────────────────────────

/// Remove ASS override tags: {\an8}, {\i1}, etc.
fn strip_ass_tags(text: &str) -> String {
    let mut result = String::new();
    let mut in_tag = false;
    for ch in text.chars() {
        match ch {
            '{' => in_tag = true,
            '}' => in_tag = false,
            _ if !in_tag => result.push(ch),
            _ => {}
        }
    }
    result
}

/// Parse a `[RoleName] rest of text` prefix.
/// Returns (Some(role_name), rest_text) if found, else (None, original).
fn parse_role_prefix(text: &str) -> (Option<String>, String) {
    let t = text.trim();
    if t.starts_with('[') {
        if let Some(close) = t.find(']') {
            let role = t[1..close].trim().to_string();
            let rest = t[close + 1..].trim().to_string();
            if !role.is_empty() {
                return (Some(role), rest);
            }
        }
    }
    (None, text.to_string())
}
