import { useEffect } from 'react';
import { useVideoSync } from './hooks/useVideoSync';
import { useProjectStore } from './stores/projectStore';
import VideoPlayer from './components/VideoPlayer';
import TransportControls from './components/TransportControls';
import BandeRythmo from './components/BandeRythmo';
import Timeline from './components/Timeline';
import DialogueEditor from './components/DialogueEditor';
import CharacterManager from './components/CharacterManager';
import './App.css';

function App() {
  const videoSync = useVideoSync();
  const {
    project,
    isDirty,
    isLoading,
    loadingMessage,
    ffmpegAvailable,
    newProject,
    saveProject,
    saveProjectAs,
    loadProject,
    importVideo,
    checkFfmpeg,
    setProjectName,
  } = useProjectStore();

  // Check FFmpeg on mount
  useEffect(() => {
    checkFfmpeg();
  }, [checkFfmpeg]);

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
          if (e.shiftKey) videoSync.seek(videoSync.currentTime - 5);
          else videoSync.stepFrame(false);
          break;
        case 'ArrowRight':
          e.preventDefault();
          if (e.shiftKey) videoSync.seek(videoSync.currentTime + 5);
          else videoSync.stepFrame(true);
          break;
        case 'j':
          videoSync.seek(videoSync.currentTime - 10);
          break;
        case 'k':
          videoSync.togglePlay();
          break;
        case 'l':
          videoSync.seek(videoSync.currentTime + 10);
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
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [videoSync, saveProject, saveProjectAs, loadProject, newProject]);

  return (
    <div className="app" id="app-root">
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
            <button className="menu-btn" onClick={loadProject} title="Open Project (Ctrl+O)" id="menu-open">
              Open
            </button>
            <button className="menu-btn" onClick={saveProject} title="Save (Ctrl+S)" id="menu-save">
              Save
            </button>
            <button className="menu-btn" onClick={saveProjectAs} title="Save As (Ctrl+Shift+S)" id="menu-save-as">
              Save As
            </button>
            <span className="menu-divider" />
            <button className="menu-btn accent" onClick={importVideo} title="Import Video" id="menu-import">
              📁 Import Video
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
              ⚠ FFmpeg
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
          <BandeRythmo />
        </div>

        {/* Right panel: Editor */}
        <div className="right-panel">
          <CharacterManager />
          <div className="panel-divider" />
          <DialogueEditor />
        </div>
      </div>
    </div>
  );
}

export default App;
