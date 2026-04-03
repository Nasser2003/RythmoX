// RythmoX Project Types

export interface RythmoSymbol {
  symbol_type: 'breath' | 'pause' | 'laugh' | 'cry' | 'noise';
  time: number;
}

export interface Dialogue {
  id: string;
  character_id: string;
  start_time: number;
  end_time: number;
  text: string;
  detection: string;
  symbols: RythmoSymbol[];
  font_family: string;
  font_size: number;
}

export interface Character {
  id: string;
  name: string;
  color: string;
}

export interface VideoInfo {
  original_path: string;
  proxy_path: string | null;
  duration: number;
  fps: number;
  resolution: [number, number];
}

export interface BandSettings {
  scroll_speed: number;
  band_height: number;
  font_size: number;
  font_family: string;
  show_timecodes: boolean;
}

export interface Project {
  version: string;
  name: string;
  created: string;
  modified: string;
  video: VideoInfo | null;
  characters: Character[];
  dialogues: Dialogue[];
  settings: BandSettings;
}

export interface VideoMetadata {
  duration: number;
  fps: number;
  width: number;
  height: number;
  codec: string;
  file_size: number;
}

export const DEFAULT_SETTINGS: BandSettings = {
  scroll_speed: 200,
  band_height: 140,
  font_size: 20,
  font_family: 'Inter',
  show_timecodes: true,
};

export const DEFAULT_FONTS = [
  'Inter',
  'Roboto',
  'Roboto Mono',
  'Arial',
  'Courier New',
  'Georgia',
  'Times New Roman',
  'Verdana',
];

export const RYTHMO_SYMBOLS: { type: RythmoSymbol['symbol_type']; label: string; icon: string }[] = [
  { type: 'breath', label: 'Respiration', icon: '⟡' },
  { type: 'pause', label: 'Pause', icon: '‖' },
  { type: 'laugh', label: 'Rire', icon: '😄' },
  { type: 'cry', label: 'Pleur', icon: '😢' },
  { type: 'noise', label: 'Bruit', icon: '♪' },
];

export const CHARACTER_COLORS = [
  '#FF6B6B', '#4ECDC4', '#45B7D1', '#96CEB4',
  '#FFEAA7', '#DDA0DD', '#FF8C42', '#98D8C8',
  '#F7DC6F', '#BB8FCE', '#85C1E9', '#F0B27A',
  '#82E0AA', '#F1948A', '#AED6F1', '#D7BDE2',
];
