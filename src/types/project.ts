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
  symbols: RythmoSymbol[];
  font_family: string;
  bold: boolean;
  underline: boolean;
  crossed: boolean;
}

export interface Character {
  id: string;
  name: string;
  color: string;
}

export interface Marker {
  id: string;
  time: number;
  label: string;
  color: string;
}

export interface VideoInfo {
  original_path: string;
  proxy_path: string | null;
  duration: number;
  fps: number;
  resolution: [number, number];
  waveform?: number[] | null;
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
  markers: Marker[];
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

export const DEFAULT_FONTS: { label: string; value: string }[] = [
  // Sans-serif
  { label: 'Inter',             value: 'Inter' },
  { label: 'Arial',             value: 'Arial' },
  { label: 'Verdana',           value: 'Verdana' },
  { label: 'Trebuchet MS',      value: 'Trebuchet MS' },
  { label: 'Segoe UI',          value: 'Segoe UI' },
  // Serif
  { label: 'Georgia',           value: 'Georgia' },
  { label: 'Times New Roman',   value: 'Times New Roman' },
  { label: 'Palatino',          value: 'Palatino Linotype' },
  // Monospace
  { label: 'Courier New',       value: 'Courier New' },
  { label: 'Roboto Mono',       value: 'Roboto Mono' },
  { label: 'Consolas',          value: 'Consolas' },
  { label: 'Lucida Console',    value: 'Lucida Console' },
  // Handwriting / Cursive
  { label: 'Segoe Script',      value: 'Segoe Script' },
  { label: 'Comic Sans MS',     value: 'Comic Sans MS' },
  { label: 'Brush Script MT',   value: 'Brush Script MT' },
  { label: 'Lucida Handwriting',value: 'Lucida Handwriting' },
  // Display
  { label: 'Impact',            value: 'Impact' },
  { label: 'Arial Black',       value: 'Arial Black' },
];

export const RYTHMO_SYMBOLS: { type: RythmoSymbol['symbol_type']; label: string; icon: string }[] = [
  { type: 'breath', label: 'Respiration', icon: '⟡' },
  { type: 'pause', label: 'Pause', icon: '‖' },
  { type: 'laugh', label: 'Rire', icon: '😄' },
  { type: 'cry', label: 'Pleur', icon: '😢' },
  { type: 'noise', label: 'Bruit', icon: '♪' },
];

export const CHARACTER_COLORS = [
  '#E63946', // vivid red
  '#616161', // gray
  '#457B9D', // steel blue
  '#2A9D8F', // dark turquoise
  '#E9C46A', // warm sand yellow
  '#F4A261', // soft orange
  '#E76F51', // coral red
  '#6A4C93', // deep violet
  '#8AC926', // lime green
  '#1982C4', // saturated blue
  '#FFCA3A', // bright yellow
  '#FF595E', // rose red
  '#6CCFF6', // light sky blue
  '#9D4EDD', // saturated purple
  '#4CAF50', // classic green
  '#F72585', // strong magenta
];
