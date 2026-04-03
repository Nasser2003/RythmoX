import { create } from 'zustand';
import { invoke, convertFileSrc } from '@tauri-apps/api/core';
import { open, save } from '@tauri-apps/plugin-dialog';
import type { Project, Character, Dialogue, BandSettings, VideoInfo, VideoMetadata } from '../types/project';
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
  videoUrl: string | null;
  isLoading: boolean;
  loadingMessage: string;
  ffmpegAvailable: boolean;

  // Actions - Project
  newProject: () => void;
  saveProject: () => Promise<void>;
  saveProjectAs: () => Promise<void>;
  loadProject: () => Promise<void>;
  setProjectName: (name: string) => void;

  // Actions - Video
  importVideo: () => Promise<void>;
  setVideoUrl: (url: string | null) => void;

  // Actions - Playback
  setCurrentTime: (time: number) => void;
  setIsPlaying: (playing: boolean) => void;

  // Actions - Characters
  addCharacter: (name: string) => void;
  updateCharacter: (id: string, updates: Partial<Character>) => void;
  deleteCharacter: (id: string) => void;

  // Actions - Dialogues
  addDialogue: (dialogue: Omit<Dialogue, 'id'>) => void;
  updateDialogue: (id: string, updates: Partial<Dialogue>) => void;
  deleteDialogue: (id: string) => void;
  selectDialogue: (id: string | null) => void;

  // Actions - Settings
  updateSettings: (updates: Partial<BandSettings>) => void;

  // Actions - System
  checkFfmpeg: () => Promise<void>;
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
  settings: { ...DEFAULT_SETTINGS },
};

export const useProjectStore = create<ProjectState>((set, get) => ({
  project: { ...emptyProject },
  projectPath: null,
  isDirty: false,
  currentTime: 0,
  isPlaying: false,
  selectedDialogueId: null,
  videoUrl: null,
  isLoading: false,
  loadingMessage: '',
  ffmpegAvailable: false,

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
      console.error('Save failed:', e);
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
        console.error('Save failed:', e);
      }
    }
  },

  loadProject: async () => {
    const path = await open({
      title: 'Open RythmoX Project',
      filters: [{ name: 'RythmoX Project', extensions: ['rythmox'] }],
      multiple: false,
    });
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
        console.error('Load failed:', e);
        set({ isLoading: false });
      }
    }
  },

  setProjectName: (name) => {
    set((state) => ({
      project: { ...state.project, name },
      isDirty: true,
    }));
  },

  // -- Video actions --
  importVideo: async () => {
    const path = await open({
      title: 'Import Video',
      filters: [{
        name: 'Video Files',
        extensions: ['mp4', 'mov', 'mkv', 'avi', 'wmv', 'flv', 'webm', 'mxf', 'prores'],
      }],
      multiple: false,
    });

    if (!path) return;

    try {
      set({ isLoading: true, loadingMessage: 'Importing video...' });

      const videoInfo: VideoInfo = {
        original_path: path as string,
        proxy_path: null,
        duration: 0,
        fps: 24,
        resolution: [1920, 1080],
      };

      // Try to get metadata via FFmpeg (optional)
      try {
        const metadata = await invoke<VideoMetadata>('get_video_metadata', { videoPath: path });
        videoInfo.duration = metadata.duration;
        videoInfo.fps = metadata.fps;
        videoInfo.resolution = [metadata.width, metadata.height];

        // Check if we need a proxy (file > 500MB or not H.264)
        const needsProxy = metadata.file_size > 500 * 1024 * 1024 || 
                            !['h264', 'avc'].includes(metadata.codec.toLowerCase());

        if (needsProxy && get().ffmpegAvailable) {
          set({ loadingMessage: 'Creating proxy video...' });
          const proxyPath = await invoke<string>('create_proxy', { videoPath: path });
          videoInfo.proxy_path = proxyPath;
        }
      } catch {
        console.warn('FFmpeg metadata extraction failed, loading video directly');
      }

      // Use proxy if available, otherwise original
      const filePath = videoInfo.proxy_path || videoInfo.original_path;
      const videoUrl = convertFileSrc(filePath);

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
    }));
  },

  selectDialogue: (id) => set({ selectedDialogueId: id }),

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
}));
