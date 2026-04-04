import { create } from 'zustand';
import { invoke, convertFileSrc } from '@tauri-apps/api/core';
import { open, save } from '@tauri-apps/plugin-dialog';
import type { Project, Character, Dialogue, Marker, BandSettings, VideoInfo, VideoMetadata } from '../types/project';
import { DEFAULT_SETTINGS, CHARACTER_COLORS } from '../types/project';

interface ProjectState {
  // Project data
  project: Project;
  projectPath: string | null;
  isDirty: boolean;

  // UI state
  currentTime: number;
  isPlaying: boolean;
  selectedDialogueId: string | null;
  selectedDialogueIds: string[];
  editingDialogueId: string | null;
  selectedMarkerIds: string[];
  activeRightTab: 'chars' | 'markers';
  editingMarkerId: string | null;
  selectedCharacterId: string | null;
  autoAddOnSelect: boolean;
  videoUrl: string | null;
  isLoading: boolean;
  loadingMessage: string;
  ffmpegAvailable: boolean;
  hoveredTime: number | null;
  errorMessage: string | null;

  // Actions - Project
  newProject: () => void;
  saveProject: () => Promise<void>;
  saveProjectAs: () => Promise<void>;
  loadProject: (filePath?: string) => Promise<void>;
  setProjectName: (name: string) => void;
  clearError: () => void;

  // Actions - Video
  importVideo: (filePath?: string) => Promise<void>;
  setVideoUrl: (url: string | null) => void;

  // Actions - Playback
  setCurrentTime: (time: number) => void;
  setIsPlaying: (playing: boolean) => void;

  // Actions - Characters
  addCharacter: (name: string) => void;
  updateCharacter: (id: string, updates: Partial<Character>) => void;
  deleteCharacter: (id: string) => void;
  reorderCharacters: (fromIndex: number, toIndex: number) => void;
  selectCharacter: (id: string | null) => void;
  toggleAutoAddOnSelect: () => void;

  // Actions - Dialogues
  addDialogue: (dialogue: Omit<Dialogue, 'id'>) => void;
  updateDialogue: (id: string, updates: Partial<Dialogue>) => void;
  deleteDialogue: (id: string) => void;
  deleteSelected: () => void;
  selectDialogue: (id: string | null) => void;
  toggleDialogueSelection: (id: string) => void;
  splitDialogue: (id: string, atTime: number) => void;
  fuseDialogues: () => void;
  requestDialogueEdit: (id: string) => void;

  // Actions - Markers
  addMarker: (time: number) => void;
  updateMarker: (id: string, updates: Partial<Marker>) => void;
  deleteMarker: (id: string) => void;
  selectMarker: (id: string | null) => void;
  toggleMarkerSelection: (id: string) => void;
  requestMarkerEdit: (id: string) => void;
  setActiveRightTab: (tab: 'chars' | 'markers') => void;

  // Actions - Settings
  updateSettings: (updates: Partial<BandSettings>) => void;

  // Actions - System
  checkFfmpeg: () => Promise<void>;

  // Actions - Subtitle import/export
  importSubtitles: (filePath: string, extractRole: boolean) => Promise<void>;
  exportSubtitles: (format: 'srt' | 'ass', outputPath: string, includeRole: boolean, includeMarkers: boolean) => Promise<void>;

  // Actions - Timeline
  setHoveredTime: (time: number | null) => void;
}

function generateId(): string {
  return crypto.randomUUID();
}

const emptyProject: Project = {
  version: '1.0',
  name: 'New Project',
  created: new Date().toISOString(),
  modified: new Date().toISOString(),
  video: null,
  characters: [],
  dialogues: [],
  markers: [],
  settings: { ...DEFAULT_SETTINGS },
};

export const useProjectStore = create<ProjectState>((set, get) => ({
  project: { ...emptyProject },
  projectPath: null,
  isDirty: false,
  currentTime: 0,
  isPlaying: false,
  selectedDialogueId: null,
  selectedDialogueIds: [],
  editingDialogueId: null,
  selectedMarkerIds: [],
  activeRightTab: 'chars' as const,
  editingMarkerId: null,
  selectedCharacterId: null,
  autoAddOnSelect: false,
  videoUrl: null,
  isLoading: false,
  loadingMessage: '',
  ffmpegAvailable: false,
  hoveredTime: null,
  errorMessage: null,

  // -- Project actions --
  newProject: () => {
    set({
      project: {
        ...emptyProject,
        created: new Date().toISOString(),
        modified: new Date().toISOString(),
      },
      projectPath: null,
      isDirty: false,
      videoUrl: null,
      currentTime: 0,
      isPlaying: false,
      selectedDialogueId: null,
      selectedDialogueIds: [],
      selectedMarkerIds: [],
      editingMarkerId: null,
      activeRightTab: 'chars' as const,
      selectedCharacterId: null,
    });
  },

  saveProject: async () => {
    const { project, projectPath } = get();
    if (!projectPath) {
      return get().saveProjectAs();
    }
    try {
      await invoke('save_project', { project, filePath: projectPath });
      set({ isDirty: false });
    } catch (e) {
      set({ errorMessage: String(e) });
    }
  },

  saveProjectAs: async () => {
    const { project } = get();
    const path = await save({
      title: 'Save RythmoX Project',
      filters: [{ name: 'RythmoX Project', extensions: ['rythmox'] }],
    });
    if (path) {
      try {
        await invoke('save_project', { project, filePath: path });
        set({ projectPath: path, isDirty: false });
      } catch (e) {
        set({ errorMessage: String(e) });
      }
    }
  },

  loadProject: async (filePath?: string) => {
    let path = filePath;
    if (!path) {
      const selected = await open({
        title: 'Open RythmoX Project',
        filters: [{ name: 'RythmoX Project', extensions: ['rythmox'] }],
        multiple: false,
      });
      if (!selected) return;
      path = selected as string;
    }
    if (path) {
      try {
        set({ isLoading: true, loadingMessage: 'Loading project...' });
        const project = await invoke<Project>('load_project', { filePath: path });

        let videoUrl: string | null = null;
        if (project.video?.proxy_path) {
          videoUrl = convertFileSrc(project.video.proxy_path);
        } else if (project.video?.original_path) {
          videoUrl = convertFileSrc(project.video.original_path);
        }

        set({
          project,
          projectPath: path as string,
          isDirty: false,
          videoUrl,
          currentTime: 0,
          isPlaying: false,
          selectedDialogueId: null,
          isLoading: false,
        });
      } catch (e) {
        set({ errorMessage: String(e), isLoading: false });
      }
    }
  },

  setProjectName: (name) => {
    set((state) => ({
      project: { ...state.project, name },
      isDirty: true,
    }));
  },

  clearError: () => set({ errorMessage: null }),

  // -- Video actions --
  importVideo: async (filePath?: string) => {
    let path = filePath;

    if (!path) {
      const selected = await open({
        title: 'Import Video',
        filters: [{
          name: 'Video Files',
          extensions: ['mp4', 'mov', 'mkv', 'avi', 'wmv', 'flv', 'webm', 'mxf', 'prores'],
        }],
        multiple: false,
      });
      if (!selected) return;
      path = selected as string;
    }

    try {
      set({ isLoading: true, loadingMessage: 'Importing video...' });

      const videoInfo: VideoInfo = {
        original_path: path as string,
        proxy_path: null,
        duration: 0,
        fps: 24,
        resolution: [1920, 1080],
      };

      try {
        const metadata = await invoke<VideoMetadata>('get_video_metadata', { videoPath: path });
        videoInfo.duration = metadata.duration;
        videoInfo.fps = metadata.fps;
        videoInfo.resolution = [metadata.width, metadata.height];

        const isWebCompatible = ['h264', 'avc', 'hevc', 'h265'].includes(metadata.codec.toLowerCase());

        // Set video immediately so user can start working
        const immediateUrl = convertFileSrc(path as string);
        set((state) => ({
          project: { ...state.project, video: { ...videoInfo } },
          videoUrl: immediateUrl,
          isDirty: true,
          isLoading: false,
          loadingMessage: '',
        }));

        // Proxy + waveform in background (non-blocking)
        if (!isWebCompatible && get().ffmpegAvailable) {
          set({ loadingMessage: 'Creating proxy for incompatible format...' });
          try {
            const proxyPath = await invoke<string>('create_proxy', { videoPath: path });
            videoInfo.proxy_path = proxyPath;
            const proxyUrl = convertFileSrc(proxyPath);
            set((state) => ({
              project: { ...state.project, video: { ...state.project.video!, proxy_path: proxyPath } },
              videoUrl: proxyUrl,
              loadingMessage: '',
            }));
          } catch (e) {
            console.warn('Proxy creation failed, using original', e);
            set({ loadingMessage: '' });
          }
        }

        if (get().ffmpegAvailable) {
          set({ loadingMessage: 'Extracting audio waveform...' });
          try {
            const waveform = await invoke<number[]>('extract_audio_waveform', {
              videoPath: path,
              peaksPerSecond: 100,
            });
            set((state) => ({
              project: { ...state.project, video: { ...state.project.video!, waveform } },
              loadingMessage: '',
            }));
          } catch (e) {
            console.warn('Waveform extraction failed', e);
            set({ loadingMessage: '' });
          }
        }

        return; // already set state above
      } catch (err) {
        console.warn('FFmpeg metadata extraction failed, loading video directly', err);
      }

      // Fallback: no metadata, load directly
      const videoUrl = convertFileSrc(path as string);
      set((state) => ({
        project: { ...state.project, video: videoInfo },
        videoUrl,
        isDirty: true,
        isLoading: false,
        loadingMessage: '',
      }));
    } catch (e) {
      console.error('Import failed:', e);
      set({ isLoading: false, loadingMessage: '' });
    }
  },

  setVideoUrl: (url) => set({ videoUrl: url }),

  // -- Playback actions --
  setCurrentTime: (time) => set({ currentTime: time }),
  setIsPlaying: (playing) => set({ isPlaying: playing }),

  // -- Character actions --
  selectCharacter: (id) => set({ selectedCharacterId: id }),

  toggleAutoAddOnSelect: () => set((state) => ({ autoAddOnSelect: !state.autoAddOnSelect })),

  addCharacter: (name) => {
    const { project } = get();
    const colorIndex = project.characters.length % CHARACTER_COLORS.length;
    const character: Character = {
      id: generateId(),
      name,
      color: CHARACTER_COLORS[colorIndex],
    };
    set((state) => ({
      project: {
        ...state.project,
        characters: [...state.project.characters, character],
      },
      isDirty: true,
    }));
  },

  updateCharacter: (id, updates) => {
    set((state) => ({
      project: {
        ...state.project,
        characters: state.project.characters.map((c) =>
          c.id === id ? { ...c, ...updates } : c
        ),
      },
      isDirty: true,
    }));
  },

  deleteCharacter: (id) => {
    set((state) => ({
      project: {
        ...state.project,
        characters: state.project.characters.filter((c) => c.id !== id),
        dialogues: state.project.dialogues.filter((d) => d.character_id !== id),
      },
      isDirty: true,
    }));
  },

  reorderCharacters: (fromIndex, toIndex) => {
    set((state) => {
      const chars = [...state.project.characters];
      const [moved] = chars.splice(fromIndex, 1);
      chars.splice(toIndex, 0, moved);
      return { project: { ...state.project, characters: chars }, isDirty: true };
    });
  },

  // -- Dialogue actions --
  addDialogue: (dialogueData) => {
    const dialogue: Dialogue = {
      ...dialogueData,
      id: generateId(),
    };
    set((state) => ({
      project: {
        ...state.project,
        dialogues: [...state.project.dialogues, dialogue].sort(
          (a, b) => a.start_time - b.start_time
        ),
      },
      isDirty: true,
      selectedDialogueId: dialogue.id,
      selectedDialogueIds: [dialogue.id],
      editingDialogueId: dialogue.id,
    }));
  },

  updateDialogue: (id, updates) => {
    set((state) => ({
      project: {
        ...state.project,
        dialogues: state.project.dialogues
          .map((d) => (d.id === id ? { ...d, ...updates } : d))
          .sort((a, b) => a.start_time - b.start_time),
      },
      isDirty: true,
    }));
  },

  deleteDialogue: (id) => {
    set((state) => ({
      project: {
        ...state.project,
        dialogues: state.project.dialogues.filter((d) => d.id !== id),
      },
      isDirty: true,
      selectedDialogueId: state.selectedDialogueId === id ? null : state.selectedDialogueId,
      selectedDialogueIds: state.selectedDialogueIds.filter((x) => x !== id),
    }));
  },

  deleteSelected: () => {
    const { selectedDialogueIds, selectedMarkerIds } = get();
    set((state) => ({
      project: {
        ...state.project,
        dialogues: state.project.dialogues.filter((d) => !selectedDialogueIds.includes(d.id)),
        markers: state.project.markers.filter((m) => !selectedMarkerIds.includes(m.id)),
      },
      isDirty: true,
      selectedDialogueId: null,
      selectedDialogueIds: [],
      selectedMarkerIds: [],
    }));
  },

  selectDialogue: (id) => set({ selectedDialogueId: id, selectedDialogueIds: id ? [id] : [], selectedMarkerIds: [], editingMarkerId: null }),

  toggleDialogueSelection: (id) => {
    const { selectedDialogueIds } = get();
    if (selectedDialogueIds.includes(id)) {
      const newIds = selectedDialogueIds.filter((x) => x !== id);
      set({
        selectedDialogueIds: newIds,
        selectedDialogueId: newIds.length === 1 ? newIds[0] : (newIds.length === 0 ? null : get().selectedDialogueId),
      });
    } else {
      set({ selectedDialogueIds: [...selectedDialogueIds, id] });
    }
  },

  requestDialogueEdit: (id) => set({ selectedDialogueId: id, selectedDialogueIds: [id], editingDialogueId: id, selectedMarkerIds: [], editingMarkerId: null }),

  splitDialogue: (id, atTime) => {
    const { project } = get();
    const d = project.dialogues.find((x) => x.id === id);
    if (!d) return;
    if (atTime <= d.start_time || atTime >= d.end_time) return;

    const ratio = (atTime - d.start_time) / (d.end_time - d.start_time);
    const splitChar = Math.round(ratio * d.text.length);
    const textA = d.text.slice(0, splitChar).trimEnd();
    const textB = d.text.slice(splitChar).trimStart();

    const idB = generateId();
    const dialogueA: Dialogue = { ...d, end_time: atTime, text: textA, symbols: d.symbols.filter(s => s.time < atTime) };
    const dialogueB: Dialogue = { ...d, id: idB, start_time: atTime, text: textB, symbols: d.symbols.filter(s => s.time >= atTime) };

    set((state) => ({
      project: {
        ...state.project,
        dialogues: state.project.dialogues
          .map((x) => (x.id === id ? dialogueA : x))
          .concat(dialogueB)
          .sort((a, b) => a.start_time - b.start_time),
      },
      isDirty: true,
      selectedDialogueId: idB,
    }));
  },

  fuseDialogues: () => {
    const { project, selectedDialogueIds } = get();
    if (selectedDialogueIds.length !== 2) return;
    const pair = selectedDialogueIds
      .map((id) => project.dialogues.find((d) => d.id === id))
      .filter(Boolean) as Dialogue[];
    if (pair.length !== 2) return;
    if (pair[0].character_id !== pair[1].character_id) return;
    // pair[0] = first selected → has parameter priority
    const priority = pair[0];
    const other = pair[1];
    // Text order follows temporal position
    const [earlier, later] = priority.start_time <= other.start_time ? [priority, other] : [other, priority];
    const fusedDialogue: Dialogue = {
      ...priority,
      start_time: Math.min(priority.start_time, other.start_time),
      end_time: Math.max(priority.end_time, other.end_time),
      text: earlier.text.trim() + ' ' + later.text.trim(),
      symbols: [...priority.symbols, ...other.symbols].sort((a, b) => a.time - b.time),
    };
    set((state) => ({
      project: {
        ...state.project,
        dialogues: state.project.dialogues
          .filter((d) => d.id !== other.id)
          .map((d) => (d.id === priority.id ? fusedDialogue : d))
          .sort((a, b) => a.start_time - b.start_time),
      },
      isDirty: true,
      selectedDialogueId: priority.id,
      selectedDialogueIds: [priority.id],
    }));
  },

  addMarker: (time) => {
    set((state) => ({
      project: {
        ...state.project,
        markers: [...state.project.markers, {
          id: generateId(),
          time,
          label: `Marker ${state.project.markers.length + 1}`,
          color: '#fbbf24'
        }],
      },
      isDirty: true,
    }));
  },

  updateMarker: (id, updates) => {
    set((state) => ({
      project: {
        ...state.project,
        markers: state.project.markers.map((m) =>
          m.id === id ? { ...m, ...updates } : m
        ),
      },
      isDirty: true,
    }));
  },

  deleteMarker: (id) => {
    set((state) => ({
      project: {
        ...state.project,
        markers: state.project.markers.filter((m) => m.id !== id),
      },
      isDirty: true,
      selectedMarkerIds: state.selectedMarkerIds.filter((x) => x !== id),
    }));
  },

  selectMarker: (id) => set({
    selectedMarkerIds: id ? [id] : [],
    selectedDialogueId: null,
    selectedDialogueIds: [],
    editingDialogueId: null,
    activeRightTab: 'markers' as const,
    editingMarkerId: null,
  }),

  toggleMarkerSelection: (id) => {
    const { selectedMarkerIds } = get();
    if (selectedMarkerIds.includes(id)) {
      set({ selectedMarkerIds: selectedMarkerIds.filter((x) => x !== id) });
    } else {
      set({ selectedMarkerIds: [...selectedMarkerIds, id] });
    }
  },

  requestMarkerEdit: (id) => set({
    selectedMarkerIds: [id],
    selectedDialogueId: null,
    selectedDialogueIds: [],
    editingDialogueId: null,
    activeRightTab: 'markers' as const,
    editingMarkerId: id,
  }),

  setActiveRightTab: (tab) => set({ activeRightTab: tab }),

  // -- Settings actions --
  updateSettings: (updates) => {
    set((state) => ({
      project: {
        ...state.project,
        settings: { ...state.project.settings, ...updates },
      },
      isDirty: true,
    }));
  },

  // -- System actions --
  checkFfmpeg: async () => {
    try {
      await invoke<string>('check_ffmpeg');
      set({ ffmpegAvailable: true });
    } catch {
      set({ ffmpegAvailable: false });
      console.warn('FFmpeg not available. Proxy creation disabled.');
    }
  },

  setHoveredTime: (time) => set({ hoveredTime: time }),

  importSubtitles: async (filePath: string, extractRole: boolean) => {
    const path = filePath;
    const ext = path.split('.').pop()?.toLowerCase();
    type SubEntry = { index: number; start: number; end: number; text: string; actor?: string; style?: string };
    type SubStyles = { name: string; font_family: string; font_size: number; color: string }[];
    type SubMarkers = { time: number; label: string }[];
    let result: { entries: SubEntry[]; styles: SubStyles; markers: SubMarkers };

    try {
      if (ext === 'ass') {
        result = await invoke('import_ass', { filePath: path, extractRole });
      } else {
        result = await invoke('import_srt', { filePath: path, extractRole });
      }
    } catch (e) {
      console.error('Import subtitles failed', e);
      return;
    }

    const { project } = get();

    // Build a character map: style/actor name → existing or new character
    const charMap = new Map<string, string>(); // name → id
    project.characters.forEach(c => charMap.set(c.name, c.id));

    const newCharacters = [...project.characters];
    const newDialogues: Dialogue[] = [];

    // Create a pseudo-style lookup for font info
    const styleMap = new Map<string, { font_family: string; font_size: number; color: string }>();
    result.styles.forEach((s) => styleMap.set(s.name, s));

    for (const e of result.entries) {
      const actorName = e.actor || e.style || (extractRole ? 'Inconnu' : 'Défaut');
      if (!charMap.has(actorName)) {
        const colors = ['#E63946','#457B9D','#2A9D8F','#E9C46A','#F4A261','#E76F51','#6A4C93','#8AC926'];
        const newChar: Character = {
          id: generateId(),
          name: actorName,
          color: colors[newCharacters.length % colors.length],
        };
        newCharacters.push(newChar);
        charMap.set(actorName, newChar.id);
      }
      const charId = charMap.get(actorName)!;
      const styleInfo = e.style ? styleMap.get(e.style) : undefined;
      newDialogues.push({
        id: generateId(),
        character_id: charId,
        start_time: e.start,
        end_time: e.end,
        text: e.text,
        symbols: [],
        font_family: styleInfo?.font_family || project.settings.font_family,
        bold: false,
        underline: false,
        crossed: false,
      });
    }

    set((state) => ({
      project: {
        ...state.project,
        characters: newCharacters,
        dialogues: [...state.project.dialogues, ...newDialogues],
        markers: extractRole
          ? [
              ...state.project.markers,
              ...result.markers.map(m => ({
                id: generateId(),
                time: m.time,
                label: m.label,
                color: '#fbbf24',
              })),
            ]
          : state.project.markers,
      },
      isDirty: true,
    }));
  },

  exportSubtitles: async (format: 'srt' | 'ass', outputPath: string, includeRole: boolean, includeMarkers: boolean) => {
    const { project } = get();

    // Build entries sorted by start time
    const charById = new Map(project.characters.map(c => [c.id, c]));
    const entries = [...project.dialogues]
      .sort((a, b) => a.start_time - b.start_time)
      .map((d, i) => ({
        index: i + 1,
        start: d.start_time,
        end: d.end_time,
        text: d.text,
        actor: charById.get(d.character_id)?.name ?? null,
        style: charById.get(d.character_id)?.name ?? null,
      }));

    const markers = project.markers.map(m => ({ time: m.time, label: m.label }));

    if (format === 'ass') {
      const styles = project.characters.map(c => ({
        name: c.name,
        font_family: c.name, // per-char style name = char name
        font_size: project.settings.font_size,
        color: c.color,
      }));
      await invoke('export_ass', {
        entries,
        styles,
        markers,
        outputPath,
        title: project.name,
        includeRole,
        includeMarkers,
      });
    } else {
      await invoke('export_srt', { entries, markers, outputPath, includeRole, includeMarkers });
    }
  },
}));
