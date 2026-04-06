import { useEffect, useRef, useState, useCallback } from 'react';
import { listen } from '@tauri-apps/api/event';
import { openUrl } from '@tauri-apps/plugin-opener';
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
    undo,
    redo,
  } = useProjectStore();

  // Check FFmpeg on mount
  useEffect(() => {
    checkFfmpeg();
  }, [checkFfmpeg]);

  const [isExporting, setIsExporting] = useState(false);
  // Ref so the keyboard handler closure always sees the latest value without re-registering
  const isExportingRef = useRef(false);
  useEffect(() => { isExportingRef.current = isExporting; }, [isExporting]);
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

  // Disable the native WebView/Chrome context menu everywhere in the app.
  // Custom in-app context menus still work because they call preventDefault and render their own UI.
  useEffect(() => {
    const handleContextMenu = (event: MouseEvent) => {
      event.preventDefault();
    };

    window.addEventListener('contextmenu', handleContextMenu, { capture: true });
    return () => window.removeEventListener('contextmenu', handleContextMenu, { capture: true });
  }, []);

  // Close any click-opened menu/popover when clicking elsewhere.
  useEffect(() => {
    const handlePointerDown = (e: PointerEvent) => {
      const target = e.target as HTMLElement;
      // Only close menus if clicking outside menu elements
      const isInMenu = target.closest('.menu-dropdown');
      if (!isInMenu) {
        window.dispatchEvent(new CustomEvent('rythmox:close-transient-menus'));
      }
    };

    window.addEventListener('pointerdown', handlePointerDown, { capture: true });
    return () => window.removeEventListener('pointerdown', handlePointerDown, { capture: true });
  }, []);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't intercept when typing in inputs
      const tag = (e.target as HTMLElement).tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      // Export modal is open — let it handle its own interactions
      if (isExportingRef.current) return;

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
        case 'z':
          if (e.ctrlKey && !e.shiftKey) {
            e.preventDefault();
            undo();
          }
          break;
        case 'y':
          if (e.ctrlKey) {
            e.preventDefault();
            redo();
          }
          break;
        case 'Z':
          if (e.ctrlKey && e.shiftKey) {
            e.preventDefault();
            redo();
          }
          break;
        case 'm':
          // Add marker at hovered timeline placement or playback head
          e.preventDefault();
          const state = useProjectStore.getState();
          const targetTime = state.hoveredTime !== null ? state.hoveredTime : state.currentTime;
          addMarker(targetTime);
          break;
        case 'x':
          if (!e.ctrlKey && !e.altKey && !e.shiftKey) {
            e.preventDefault();
            const st = useProjectStore.getState();
            if (st.selectedDialogueId) st.splitDialogue(st.selectedDialogueId, st.currentTime);
          }
          break;
        case 'Delete':
          e.preventDefault();
          useProjectStore.getState().deleteSelected();
          break;
        case 'f':
          if (!e.ctrlKey && !e.altKey && !e.shiftKey) {
            e.preventDefault();
            useProjectStore.getState().fuseDialogues();
          }
          break;
        case 'd':
          if (!e.ctrlKey && !e.altKey && !e.shiftKey) {
            e.preventDefault();
            // Trigger add dialogue via the store — mirrors handleAdd logic in DialogueEditor
            const dst = useProjectStore.getState();
            const { characters: dChars, dialogues: dDialogues, settings: dSettings } = dst.project;
            if (dChars.length === 0) break;
            let charId: string;
            if (dst.selectedCharacterId && dChars.find(c => c.id === dst.selectedCharacterId)) {
              charId = dst.selectedCharacterId;
            } else {
              const lastUse = dDialogues.length > 0 ? dDialogues[dDialogues.length - 1].character_id : '';
              charId = dChars.find(c => c.id === lastUse) ? lastUse : dChars[0].id;
            }
            dst.addDialogue({
              character_id: charId,
              start_time: dst.currentTime,
              end_time: dst.currentTime + 2.0,
              text: '',
              symbols: [],
              visual_cuts: [],
              font_family: dSettings.font_family,
              bold: false,
              italic: false,
              underline: false,
              crossed: false,
            });
          }
          break;
        case 'c':
          if (!e.ctrlKey && !e.altKey && !e.shiftKey) {
            e.preventDefault();
            const st = useProjectStore.getState();
            if (st.selectedDialogueId) st.addDialogueVisualCut(st.selectedDialogueId, st.currentTime);
          }
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [videoSync, saveProject, saveProjectAs, loadProject, newProject, addMarker, undo, redo]);

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
          <MenuBar
            onImportSubtitles={() => setSubtitleModal('import')}
            onExportSubtitles={() => setSubtitleModal('export')}
            onExportVideo={() => { videoSync.pause(); setIsExporting(true); }}
          />
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
      
      {isExporting && <ExportModal onClose={() => { setIsExporting(false); }} />}
      {subtitleModal && <SubtitleIOModal mode={subtitleModal} initialFilePath={droppedSubtitlePath} onClose={() => { setSubtitleModal(null); setDroppedSubtitlePath(undefined); }} />}
    </div>
  );
}

/* ---- About Modal ---- */

function AboutModal({ onClose }: { onClose: () => void }) {
  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 10000,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(6px)',
    }} onClick={onClose}>
      <div className="glass-card" onClick={(e) => e.stopPropagation()} style={{
        width: '460px', padding: '36px 40px', display: 'flex', flexDirection: 'column',
        alignItems: 'center', gap: '16px', textAlign: 'center',
        border: '1px solid rgba(255,255,255,0.1)',
      }}>
        <div style={{ fontSize: '48px', lineHeight: 1 }}>🎬</div>
        <div>
          <h2 style={{ margin: 0, fontSize: '22px', fontWeight: '700', letterSpacing: '-0.5px' }}>RythmoX</h2>
          <span style={{ fontSize: '12px', color: '#64748b', fontFamily: 'monospace' }}>v1.0.0</span>
        </div>

        <p style={{ margin: 0, fontSize: '14px', lineHeight: '1.7', color: '#94a3b8', maxWidth: '360px' }}>
          I'm a passionate developer who loves building apps for fun, especially when I spot
          unmet needs. RythmoX was born from that — I kept seeing people on YouTube use{' '}
          <span
            onClick={() => openUrl('https://cappella.app/')}
            style={{ color: '#93c5fd', cursor: 'pointer', textDecoration: 'underline' }}
          >
            Cappella
          </span>
          , a free app last updated in 2008. Everyone deserved a modern alternative.
        </p>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', width: '100%', marginTop: '4px' }}>
          <button
            onClick={() => openUrl('https://github.com/Nasser2003/RythmoX')}
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px',
              padding: '10px 16px', borderRadius: '8px', cursor: 'pointer', fontSize: '14px', fontWeight: '500',
              background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.15)',
              color: '#e2e8f0', transition: 'background 0.15s',
            }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0 0 24 12c0-6.63-5.37-12-12-12z"/>
            </svg>
            GitHub — Nasser2003/RythmoX
          </button>

          <button
            onClick={() => openUrl('https://patreon.com/NasserKotiyev')}
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px',
              padding: '10px 16px', borderRadius: '8px', cursor: 'pointer', fontSize: '14px', fontWeight: '600',
              background: 'rgba(249,104,84,0.15)', border: '1px solid rgba(249,104,84,0.4)',
              color: '#f96854', transition: 'background 0.15s',
            }}
          >
            ❤ Support on Patreon
          </button>
        </div>

        <button onClick={onClose} style={{
          marginTop: '4px', background: 'none', border: 'none', color: '#475569',
          cursor: 'pointer', fontSize: '12px', padding: '4px 8px',
        }}>
          Close
        </button>
      </div>
    </div>
  );
}

/* ---- Menu Bar with dropdown sections ---- */

interface MenuDropdownProps {
  label: string;
  children: React.ReactNode;
}

function MenuDropdown({ label, children }: MenuDropdownProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const closeEvent = () => setOpen(false);
    window.addEventListener('rythmox:close-transient-menus', closeEvent);
    const handleClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('pointerdown', handleClick, { capture: true });
    return () => {
      window.removeEventListener('rythmox:close-transient-menus', closeEvent);
      window.removeEventListener('pointerdown', handleClick, { capture: true });
    };
  }, [open]);

  return (
    <div className="menu-dropdown" ref={ref}>
      <button className={`menu-dropdown-trigger${open ? ' active' : ''}`} onClick={() => {
        setOpen(!open);
      }}>
        {label}
      </button>
      {open && (
        <div className="menu-dropdown-panel" onClick={() => {
          queueMicrotask(() => setOpen(false));
        }}>
          {children}
        </div>
      )}
    </div>
  );
}

function MenuSep() {
  return <div className="menu-dropdown-sep" />;
}

interface MenuItemProps {
  label: string;
  shortcut?: string;
  onClick: () => void;
  disabled?: boolean;
  accent?: string;
}

function MenuItem({ label, shortcut, onClick, disabled, accent }: MenuItemProps) {
  return (
    <button
      className="menu-dropdown-item"
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      disabled={disabled}
      style={accent ? { color: accent } : undefined}
    >
      <span>{label}</span>
      {shortcut && <span className="menu-shortcut">{shortcut}</span>}
    </button>
  );
}

interface MenuBarProps {
  onImportSubtitles: () => void;
  onExportSubtitles: () => void;
  onExportVideo: () => void;
}

function MenuBar({ onImportSubtitles, onExportSubtitles, onExportVideo }: MenuBarProps) {
  const [aboutOpen, setAboutOpen] = useState(false);
  const {
    newProject, saveProject, saveProjectAs, loadProject, importVideo,
    undo, redo, canUndo, canRedo,
    addMarker, currentTime, hoveredTime,
    recentProjects, clearRecentProjects,
  } = useProjectStore();

  const handleAddMarker = useCallback(() => {
    const t = hoveredTime !== null ? hoveredTime : currentTime;
    addMarker(t);
  }, [hoveredTime, currentTime, addMarker]);

  return (
    <nav className="menu-bar">
      <MenuDropdown label="File">
        <MenuItem label="New Project" shortcut="Ctrl+N" onClick={newProject} />
        <MenuItem label="Open…" shortcut="Ctrl+O" onClick={() => loadProject()} />
        <MenuSep />
        <MenuItem label="Save" shortcut="Ctrl+S" onClick={saveProject} />
        <MenuItem label="Save As…" shortcut="Ctrl+Shift+S" onClick={saveProjectAs} />
        <MenuSep />
        <MenuItem label="Import Video…" onClick={() => importVideo()} />
        {recentProjects.length > 0 && (
          <>
            <MenuSep />
            <div className="menu-dropdown-label">Recent Projects</div>
            {recentProjects.map((r) => (
              <MenuItem
                key={r.path}
                label={r.name}
                onClick={() => loadProject(r.path)}
              />
            ))}
            <MenuItem label="Clear Recent" onClick={clearRecentProjects} accent="#64748b" />
          </>
        )}
      </MenuDropdown>

      <MenuDropdown label="Edit">
        <MenuItem label="Undo" shortcut="Ctrl+Z" onClick={undo} disabled={!canUndo} />
        <MenuItem label="Redo" shortcut="Ctrl+Y" onClick={redo} disabled={!canRedo} />
        <MenuSep />
        <MenuItem label="Delete Selection" shortcut="Del" onClick={() => useProjectStore.getState().deleteSelected()} />
        <MenuItem label="Split Dialogue" shortcut="X" onClick={() => { const s = useProjectStore.getState(); if (s.selectedDialogueId) s.splitDialogue(s.selectedDialogueId, s.currentTime); }} />
        <MenuItem label="Fuse Dialogues" shortcut="F" onClick={() => useProjectStore.getState().fuseDialogues()} />
        <MenuSep />
        <MenuItem label="Add Marker" shortcut="M" onClick={handleAddMarker} />
      </MenuDropdown>

      <MenuDropdown label="Subtitles">
        <MenuItem label="Import SRT / ASS…" onClick={onImportSubtitles} />
        <MenuItem label="Export SRT / ASS…" onClick={onExportSubtitles} />
      </MenuDropdown>

      <MenuDropdown label="Help">
        <MenuItem label="About RythmoX…" onClick={() => setAboutOpen(true)} />
        <MenuSep />
        <MenuItem label="GitHub" onClick={() => openUrl('https://github.com/Nasser2003/RythmoX')} />
        <MenuItem label="❤ Support on Patreon" onClick={() => openUrl('https://patreon.com/NasserKotiyev')} accent="#f96854" />
      </MenuDropdown>

      <button className="menu-export-btn" onClick={onExportVideo}>
        🎥 Export
      </button>

      {aboutOpen && <AboutModal onClose={() => setAboutOpen(false)} />}
    </nav>
  );
}

function RightPanelTabs() {
  const activeTab = useProjectStore((s) => s.activeRightTab);
  const setActiveTab = useProjectStore((s) => s.setActiveRightTab);

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
