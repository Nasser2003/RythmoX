import type { Project, Character, Dialogue, DialogueStyle, DialogueVisualCut, Marker, BandSettings, ViewState, ExportSettings, VideoInfo, VideoMetadata } from '../types/project';
import { create } from 'zustand';
import { invoke, convertFileSrc } from '@tauri-apps/api/core';
import { open, save } from '@tauri-apps/plugin-dialog';
import { DEFAULT_SETTINGS, DEFAULT_EXPORT_SETTINGS, CHARACTER_COLORS } from '../types/project';

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
  fontPreviewDialogueId: string | null;
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
  addDialogueVisualCut: (id: string, atTime: number) => void;
  updateDialogue: (id: string, updates: Partial<Dialogue>) => void;
  deleteDialogue: (id: string) => void;
  deleteSelected: () => void;
  selectDialogue: (id: string | null) => void;
  toggleDialogueSelection: (id: string) => void;
  selectLayerDialogues: (charId: string, addToSelection: boolean) => void;
  splitDialogue: (id: string, atTime: number) => void;
  fuseDialogues: () => void;
  requestDialogueEdit: (id: string) => void;
  setDefaultDialogueStyle: (dialogueId: string) => void;
  setDefaultDialogueStyleForRole: (dialogueId: string) => void;

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
  clearFontPreview: () => void;
  updateViewState: (updates: Partial<ViewState>) => void;
  updateExportSettings: (updates: Partial<ExportSettings>) => void;

  // Actions - Undo / Redo
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
}

function generateId(): string {
  return crypto.randomUUID();
}

// -- Undo / Redo history --
const MAX_UNDO = 60;
const undoStack: Project[] = [];
const redoStack: Project[] = [];

function pushUndo(project: Project) {
  undoStack.push(JSON.parse(JSON.stringify(project)));
  if (undoStack.length > MAX_UNDO) undoStack.shift();
  redoStack.length = 0; // clear redo on new action
}

/** Call before any project mutation inside the store */
function recordUndo(get: () => ProjectState, set: (partial: Partial<ProjectState>) => void) {
  pushUndo(get().project);
  set({ canUndo: true, canRedo: false });
}

/** Debounced variant: only records if > 400ms since last call (for high-frequency updates like dragging) */
let lastRecordTime = 0;
function recordUndoDebounced(get: () => ProjectState, set: (partial: Partial<ProjectState>) => void) {
  const now = Date.now();
  if (now - lastRecordTime > 400) {
    pushUndo(get().project);
    set({ canUndo: true, canRedo: false });
  }
  lastRecordTime = now;
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
  fontPreviewDialogueId: null,
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
  canUndo: false,
  canRedo: false,

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
    const { project, projectPath, currentTime } = get();
    if (!projectPath) {
      return get().saveProjectAs();
    }
    try {
      const projectToSave = { ...project, view_state: { ...project.view_state, current_time: currentTime, timeline_zoom: project.view_state?.timeline_zoom ?? 150, timeline_scroll: project.view_state?.timeline_scroll ?? 0 } };
      await invoke('save_project', { project: projectToSave, filePath: projectPath });
      set({ isDirty: false });
    } catch (e) {
      set({ errorMessage: String(e) });
    }
  },

  saveProjectAs: async () => {
    const { project, currentTime } = get();
    const path = await save({
      title: 'Save RythmoX Project',
      filters: [{ name: 'RythmoX Project', extensions: ['rythmox'] }],
    });
    if (path) {
      try {
        const projectToSave = { ...project, view_state: { ...project.view_state, current_time: currentTime, timeline_zoom: project.view_state?.timeline_zoom ?? 150, timeline_scroll: project.view_state?.timeline_scroll ?? 0 } };
        await invoke('save_project', { project: projectToSave, filePath: path });
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
          currentTime: project.view_state?.current_time ?? 0,
          isPlaying: false,
          selectedDialogueId: null,
          isLoading: false,
        });

        if (project.video?.original_path && get().ffmpegAvailable && (!project.video.waveform || project.video.waveform.length === 0)) {
          set({ loadingMessage: 'Extracting audio waveform...' });
          try {
            const waveform = await invoke<number[]>('extract_audio_waveform', {
              videoPath: project.video.original_path,
              peaksPerSecond: 100,
            });

            set((state) => ({
              project: state.project.video?.original_path === project.video?.original_path
                ? { ...state.project, video: { ...state.project.video!, waveform } }
                : state.project,
              loadingMessage: '',
            }));
          } catch (e) {
            console.warn('Waveform extraction failed after project load', e);
            set({ loadingMessage: '' });
          }
        }
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
    recordUndo(get, set);
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
    recordUndo(get, set);
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
    recordUndo(get, set);
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
    recordUndo(get, set);
    set((state) => {
      const chars = [...state.project.characters];
      const [moved] = chars.splice(fromIndex, 1);
      chars.splice(toIndex, 0, moved);
      return { project: { ...state.project, characters: chars }, isDirty: true };
    });
  },

  // -- Dialogue actions --
  addDialogue: (dialogueData) => {
    recordUndo(get, set);
    const { project } = get();
    // Pick the best matching style: per-role > global > none
    const roleStyle = project.default_dialogue_style_by_role?.[dialogueData.character_id];
    const globalStyle = project.default_dialogue_style;
    const style: Partial<DialogueStyle> = roleStyle ?? globalStyle ?? {};
    const dialogue: Dialogue = {
      ...dialogueData,
      font_family: style.font_family ?? dialogueData.font_family,
      bold: style.bold ?? dialogueData.bold,
      italic: style.italic ?? dialogueData.italic,
      underline: style.underline ?? dialogueData.underline,
      crossed: style.crossed ?? dialogueData.crossed,
      id: generateId(),
      visual_cuts: dialogueData.visual_cuts ?? [],
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

  addDialogueVisualCut: (id, atTime) => {
    const dialogue = get().project.dialogues.find((d) => d.id === id);
    if (!dialogue) return;
    const duration = dialogue.end_time - dialogue.start_time;
    if (duration <= 0) return;
    if (atTime <= dialogue.start_time || atTime >= dialogue.end_time) return;

    const position = (atTime - dialogue.start_time) / duration;
    const existingCuts = dialogue.visual_cuts ?? [];
    const minGap = 0.03;
    if (existingCuts.some((cut) => Math.abs(cut.position - position) < minGap)) return;
    const charIndex = Math.max(1, Math.min(Math.max(1, dialogue.text.length - 1), Math.round(dialogue.text.length * position)));

    get().updateDialogue(id, {
      visual_cuts: [...existingCuts, { id: generateId(), position, char_index: charIndex }],
    });
  },

  updateDialogue: (id, updates) => {
    recordUndoDebounced(get, set);
    set((state) => ({
      ...(updates.font_family !== undefined ? { fontPreviewDialogueId: id } : {}),
      project: {
        ...state.project,
        dialogues: state.project.dialogues
          .map((d) => (d.id === id ? {
            ...d,
            ...updates,
            visual_cuts: updates.visual_cuts
              ? [...updates.visual_cuts]
                  .map((cut) => ({
                    ...cut,
                    position: Math.max(0.02, Math.min(0.98, cut.position)),
                    char_index: typeof cut.char_index === 'number' ? Math.max(0, cut.char_index) : cut.char_index,
                  }))
                  .sort((a, b) => a.position - b.position)
              : d.visual_cuts ?? [],
          } : d))
          .sort((a, b) => a.start_time - b.start_time),
      },
      isDirty: true,
    }));
  },

  setDefaultDialogueStyle: (dialogueId) => {
    const d = get().project.dialogues.find((x) => x.id === dialogueId);
    if (!d) return;
    recordUndo(get, set);
    const style: DialogueStyle = { font_family: d.font_family, bold: d.bold, italic: d.italic, underline: d.underline, crossed: d.crossed };
    set((state) => ({
      project: {
        ...state.project,
        default_dialogue_style: style,
        default_dialogue_style_by_role: Object.fromEntries(
          state.project.characters.map((character) => [character.id, style])
        ),
      },
      isDirty: true,
    }));
  },

  setDefaultDialogueStyleForRole: (dialogueId) => {
    const d = get().project.dialogues.find((x) => x.id === dialogueId);
    if (!d) return;
    recordUndo(get, set);
    const style: DialogueStyle = { font_family: d.font_family, bold: d.bold, italic: d.italic, underline: d.underline, crossed: d.crossed };
    set((state) => ({
      project: {
        ...state.project,
        default_dialogue_style_by_role: {
          ...(state.project.default_dialogue_style_by_role ?? {}),
          [d.character_id]: style,
        },
      },
      isDirty: true,
    }));
  },

  deleteDialogue: (id) => {
    recordUndo(get, set);
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
    recordUndo(get, set);
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

  selectDialogue: (id) => set((state) => ({
    selectedDialogueId: id,
    selectedDialogueIds: id ? [id] : [],
    selectedMarkerIds: [],
    editingMarkerId: null,
    editingDialogueId: null,
    // Preserve fontPreview when clicking inside the already-selected dialogue
    fontPreviewDialogueId: id !== null && id === state.selectedDialogueId ? state.fontPreviewDialogueId : null,
  })),

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

  selectLayerDialogues: (charId, addToSelection) => {
    const { project, selectedDialogueIds } = get();
    const layerIds = project.dialogues.filter(d => d.character_id === charId).map(d => d.id);
    if (layerIds.length === 0) return;
    const newIds = addToSelection
      ? [...new Set([...selectedDialogueIds, ...layerIds])]
      : layerIds;
    set({
      selectedDialogueIds: newIds,
      selectedDialogueId: newIds[0] ?? null,
      editingDialogueId: null,
      selectedMarkerIds: [],
    });
  },

  requestDialogueEdit: (id) => set({ selectedDialogueId: id, selectedDialogueIds: [id], editingDialogueId: id, selectedMarkerIds: [], editingMarkerId: null }),

  splitDialogue: (id, atTime) => {
    recordUndo(get, set);
    const { project } = get();
    const d = project.dialogues.find((x) => x.id === id);
    if (!d) return;
    if (atTime <= d.start_time || atTime >= d.end_time) return;

    const ratio = (atTime - d.start_time) / (d.end_time - d.start_time);
    const splitChar = Math.round(ratio * d.text.length);
    const rawTextA = d.text.slice(0, splitChar);
    const rawTextB = d.text.slice(splitChar);
    const textA = rawTextA.trimEnd();
    const textB = rawTextB.trimStart();
    const removedLeadingB = rawTextB.length - textB.length;
    const cuts = d.visual_cuts ?? [];
    const cutsA: DialogueVisualCut[] = cuts
      .filter((cut) => (cut.char_index ?? Math.round((cut.position ?? 0) * d.text.length)) < splitChar)
      .map((cut) => ({
        ...cut,
        position: ratio > 0 ? cut.position / ratio : cut.position,
        char_index: Math.min(textA.length, cut.char_index ?? Math.round(cut.position * d.text.length)),
      }));
    const cutsB: DialogueVisualCut[] = cuts
      .filter((cut) => (cut.char_index ?? Math.round((cut.position ?? 0) * d.text.length)) > splitChar)
      .map((cut) => ({
        ...cut,
        position: ratio < 1 ? (cut.position - ratio) / (1 - ratio) : cut.position,
        char_index: Math.max(0, (cut.char_index ?? Math.round(cut.position * d.text.length)) - splitChar - removedLeadingB),
      }));

    const idB = generateId();
    const dialogueA: Dialogue = { ...d, end_time: atTime, text: textA, symbols: d.symbols.filter(s => s.time < atTime), visual_cuts: cutsA };
    const dialogueB: Dialogue = { ...d, id: idB, start_time: atTime, text: textB, symbols: d.symbols.filter(s => s.time >= atTime), visual_cuts: cutsB };

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
    recordUndo(get, set);
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
    const fusedStart = Math.min(priority.start_time, other.start_time);
    const fusedEnd = Math.max(priority.end_time, other.end_time);
    const fusedDuration = Math.max(0.001, fusedEnd - fusedStart);
    const fusedCuts = [earlier, later]
      .flatMap((dialogue) => (dialogue.visual_cuts ?? []).map((cut) => ({
        id: cut.id,
        position: ((dialogue.start_time - fusedStart) + cut.position * (dialogue.end_time - dialogue.start_time)) / fusedDuration,
        char_index: dialogue === earlier
          ? Math.min(earlier.text.trim().length, cut.char_index ?? Math.round(cut.position * earlier.text.length))
          : earlier.text.trim().length + 1 + Math.min(later.text.trim().length, cut.char_index ?? Math.round(cut.position * later.text.length)),
      })))
      .sort((a, b) => a.position - b.position);
    const fusedDialogue: Dialogue = {
      ...priority,
      start_time: fusedStart,
      end_time: fusedEnd,
      text: earlier.text.trim() + ' ' + later.text.trim(),
      symbols: [...priority.symbols, ...other.symbols].sort((a, b) => a.time - b.time),
      visual_cuts: fusedCuts,
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
    recordUndo(get, set);
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
    recordUndoDebounced(get, set);
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
    recordUndo(get, set);
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
    recordUndoDebounced(get, set);
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
  clearFontPreview: () => set({ fontPreviewDialogueId: null }),
  updateViewState: (updates) => set((state) => ({
    project: {
      ...state.project,
      view_state: { ...state.project.view_state, current_time: 0, timeline_zoom: 150, timeline_scroll: 0, ...updates },
    },
  })),

  updateExportSettings: (updates) => set((state) => ({
    project: {
      ...state.project,
      export_settings: { ...DEFAULT_EXPORT_SETTINGS, ...state.project.export_settings, ...updates },
    },
    isDirty: true,
  })),

  undo: () => {
    if (undoStack.length === 0) return;
    const current = get().project;
    redoStack.push(JSON.parse(JSON.stringify(current)));
    const prev = undoStack.pop()!;
    set({ project: prev, isDirty: true, canUndo: undoStack.length > 0, canRedo: true });
  },

  redo: () => {
    if (redoStack.length === 0) return;
    const current = get().project;
    undoStack.push(JSON.parse(JSON.stringify(current)));
    const next = redoStack.pop()!;
    set({ project: next, isDirty: true, canUndo: true, canRedo: redoStack.length > 0 });
  },

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
    recordUndo(get, set);

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
        italic: false,
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
