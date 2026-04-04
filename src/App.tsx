import { useEffect, useState } from 'react';
import { listen } from '@tauri-apps/api/event';
import { useVideoSync } from './hooks/useVideoSync';
import { useProjectStore } from './stores/projectStore';
import VideoPlayer from './components/VideoPlayer';
import TransportControls from './components/TransportControls';

import Timeline from './components/Timeline';
import DialogueEditor from './components/DialogueEditor';
import ExportModal from './components/ExportModal';
import SubtitleIOModal from './components/SubtitleIOModal';
import CharacterManager from './components/CharacterManager';
import MarkerManager from './components/MarkerManager';
import './App.css';

function App() {
  const videoSync = useVideoSync();
  const {
    project,
    isDirty,
    isLoading,
    loadingMessage,
    ffmpegAvailable,
    errorMessage,
    clearError,
    newProject,
    saveProject,
    saveProjectAs,
    loadProject,
    importVideo,
    checkFfmpeg,
    setProjectName,
    addMarker,
  } = useProjectStore();

  // Check FFmpeg on mount
  useEffect(() => {
    checkFfmpeg();
  }, [checkFfmpeg]);

  const [isExporting, setIsExporting] = useState(false);
  const [subtitleModal, setSubtitleModal] = useState<'import' | 'export' | null>(null);
  const [droppedSubtitlePath, setDroppedSubtitlePath] = useState<string | undefined>(undefined);

  // Handle Drag & Drop of video files
  useEffect(() => {
    let unlisten: () => void;

    const setupListener = async () => {
      // Listen to both event names to support different Tauri configurations/versions
      unlisten = await listen<{ paths: string[] }>('tauri://drag-drop', (event) => {
        const payload = event.payload;
        // The payload could be an object with paths array or just the array itself
        const paths = Array.isArray(payload) ? payload : (payload as any)?.paths || [];
        
        if (paths.length > 0) {
          const file = paths[0];
          const ext = file.split('.').pop()?.toLowerCase();
          const videoExts = ['mp4', 'mov', 'mkv', 'avi', 'wmv', 'flv', 'webm', 'mxf', 'prores'];
          const subtitleExts = ['srt', 'ass'];
          if (ext === 'rythmox') {
            loadProject(file);
          } else if (ext && videoExts.includes(ext)) {
            importVideo(file);
          } else if (ext && subtitleExts.includes(ext)) {
            setDroppedSubtitlePath(file);
            setSubtitleModal('import');
          }
        }
      });
    };

    setupListener();

    return () => {
      if (unlisten) unlisten();
    };
  }, [importVideo]);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't intercept when typing in inputs
      const tag = (e.target as HTMLElement).tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

      switch (e.key) {
        case ' ':
          e.preventDefault();
          videoSync.togglePlay();
          break;
        case 'ArrowLeft':
          e.preventDefault();
          if (e.shiftKey) videoSync.seek(useProjectStore.getState().currentTime - 5);
          else videoSync.stepFrame(false);
          break;
        case 'ArrowRight':
          e.preventDefault();
          if (e.shiftKey) videoSync.seek(useProjectStore.getState().currentTime + 5);
          else videoSync.stepFrame(true);
          break;
        case 'j':
          videoSync.seek(useProjectStore.getState().currentTime - 10);
          break;
        case 'k':
          videoSync.togglePlay();
          break;
        case 'l':
          videoSync.seek(useProjectStore.getState().currentTime + 10);
          break;
        case 's':
          if (e.ctrlKey) {
            e.preventDefault();
            if (e.shiftKey) saveProjectAs();
            else saveProject();
          }
          break;
        case 'o':
          if (e.ctrlKey) {
            e.preventDefault();
            loadProject();
          }
          break;
        case 'n':
          if (e.ctrlKey) {
            e.preventDefault();
            newProject();
          }
          break;
        case 'm':
          // Add marker at hovered timeline placement or playback head
          e.preventDefault();
          const state = useProjectStore.getState();
          const targetTime = state.hoveredTime !== null ? state.hoveredTime : state.currentTime;
          addMarker(targetTime);
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [videoSync, saveProject, saveProjectAs, loadProject, newProject, addMarker]);

  return (
    <div className="app" id="app-root">
      {/* Error banner */}
      {errorMessage && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, zIndex: 9999,
          background: 'rgba(239,68,68,0.95)', color: '#fff',
          padding: '12px 20px', display: 'flex', alignItems: 'flex-start', gap: '12px',
          boxShadow: '0 4px 16px rgba(0,0,0,0.5)', backdropFilter: 'blur(8px)',
        }}>
          <span style={{ fontSize: '18px', lineHeight: 1 }}>⚠</span>
          <pre style={{ margin: 0, flex: 1, fontSize: '13px', fontFamily: 'inherit', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{errorMessage}</pre>
          <button onClick={clearError} style={{ background: 'none', border: '1px solid rgba(255,255,255,0.5)', color: '#fff', borderRadius: '4px', padding: '2px 10px', cursor: 'pointer', fontSize: '13px', flexShrink: 0 }}>Dismiss</button>
        </div>
      )}

      {/* Loading overlay */}
      {isLoading && (
        <div className="loading-overlay" id="loading-overlay">
          <div className="loading-card glass-card">
            <div className="loading-spinner" />
            <p>{loadingMessage}</p>
          </div>
        </div>
      )}

      {/* Top Bar */}
      <header className="top-bar" id="top-bar">
        <div className="top-bar-left">
          <div className="app-logo">
            <span className="logo-icon">🎬</span>
            <span className="logo-text">RythmoX</span>
          </div>
          <div className="menu-buttons">
            <button className="menu-btn" onClick={newProject} title="New Project (Ctrl+N)" id="menu-new">
              New
            </button>
            <button className="menu-btn" onClick={() => loadProject()} title="Open Project (Ctrl+O)" id="menu-open">
              Open
            </button>
            <button className="menu-btn" onClick={saveProject} title="Save (Ctrl+S)" id="menu-save">
              Save
            </button>
            <button className="menu-btn" onClick={saveProjectAs} title="Save As (Ctrl+Shift+S)" id="menu-save-as">
              Save As
            </button>
            <span className="menu-divider" />
            <button className="menu-btn accent" onClick={() => importVideo()} title="Import Video" id="menu-import">
              📁 Import Video
            </button>
            <span className="menu-divider" />
            <button className="menu-btn" onClick={() => setSubtitleModal('import')} title="Import SRT / ASS" id="menu-import-sub" style={{ color: '#93c5fd' }}>
              📥 Import Subtitles
            </button>
            <button className="menu-btn" onClick={() => setSubtitleModal('export')} title="Export SRT / ASS" id="menu-export-sub" style={{ color: '#93c5fd' }}>
              📤 Export Subtitles
            </button>
            <button className="menu-btn" onClick={() => setIsExporting(true)} title="Export final video" id="menu-export" style={{ marginLeft: '10px', backgroundColor: 'rgba(74, 222, 128, 0.2)', color: '#4ade80' }}>
              🎥 Export Video
            </button>
          </div>
        </div>
        <div className="top-bar-center">
          <input
            type="text"
            className="project-name-input"
            value={project.name}
            onChange={(e) => setProjectName(e.target.value)}
            id="project-name"
          />
          {isDirty && <span className="dirty-indicator" title="Unsaved changes">●</span>}
        </div>
        <div className="top-bar-right">
          {!ffmpegAvailable && (
            <span className="ffmpeg-warning" title="FFmpeg not found — proxy creation disabled">
              ⚠ FFmpeg missing
            </span>
          )}
        </div>
      </header>

      {/* Main Content */}
      <div className="main-content" id="main-content">
        {/* Left panel: Video + Controls */}
        <div className="center-panel">
          <VideoPlayer videoSync={videoSync} />
          <TransportControls videoSync={videoSync} />
          <Timeline videoSync={videoSync} />
        </div>

        {/* Right panel: Editor */}
        <div className="right-panel">
          <RightPanelTabs />
          <div className="panel-divider" />
          <DialogueEditor videoSync={videoSync} />
        </div>
      </div>
      
      {isExporting && <ExportModal onClose={() => setIsExporting(false)} />}
      {subtitleModal && <SubtitleIOModal mode={subtitleModal} initialFilePath={droppedSubtitlePath} onClose={() => { setSubtitleModal(null); setDroppedSubtitlePath(undefined); }} />}
    </div>
  );
}

function RightPanelTabs() {
  const [activeTab, setActiveTab] = useState<'chars' | 'markers'>('chars');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: 'auto', minHeight: '30vh' }}>
      <div style={{ display: 'flex', borderBottom: '1px solid rgba(255,255,255,0.05)', marginBottom: '8px' }}>
        <button
          onClick={() => setActiveTab('chars')}
          style={{ flex: 1, padding: '10px', background: activeTab === 'chars' ? 'rgba(255,255,255,0.05)' : 'transparent', color: activeTab === 'chars' ? '#fff' : '#64748b', border: 'none', borderBottom: activeTab === 'chars' ? '2px solid #ef4444' : '2px solid transparent', cursor: 'pointer', fontWeight: 'bold' }}
        >
          Characters
        </button>
        <button
          onClick={() => setActiveTab('markers')}
          style={{ flex: 1, padding: '10px', background: activeTab === 'markers' ? 'rgba(255,255,255,0.05)' : 'transparent', color: activeTab === 'markers' ? '#fff' : '#64748b', border: 'none', borderBottom: activeTab === 'markers' ? '2px solid #fbbf24' : '2px solid transparent', cursor: 'pointer', fontWeight: 'bold' }}
        >
          Markers
        </button>
      </div>

      <div style={{ flex: 1, overflowY: 'auto' }}>
        {activeTab === 'chars' ? <CharacterManager /> : <MarkerManager />}
      </div>
    </div>
  );
}

export default App;
