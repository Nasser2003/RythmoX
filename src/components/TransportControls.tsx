import React, { useState, useCallback } from 'react';
import { useVideoSync } from '../hooks/useVideoSync';
import { useProjectStore } from '../stores/projectStore';

interface TransportControlsProps {
  videoSync: ReturnType<typeof useVideoSync>;
}

function formatTimecode(seconds: number, fps: number = 24): string {
  if (!isFinite(seconds) || seconds < 0) return '00:00:00:00';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const f = Math.floor((seconds % 1) * fps);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}:${String(f).padStart(2, '0')}`;
}

const TransportControls: React.FC<TransportControlsProps> = ({ videoSync }) => {
  const { togglePlay, seek, stepFrame, setPlaybackRate, getDuration } = videoSync;
  const { project, currentTime, isPlaying, selectedDialogueId, selectedDialogueIds, splitDialogue, deleteDialogue, deleteSelected, fuseDialogues, autoAddOnSelect, toggleAutoAddOnSelect } = useProjectStore();
  const [rate, setRate] = useState(1.0);
  const fps = project.video?.fps || 24;
  const duration = getDuration();

  const selectedDialogue = project.dialogues.find(d => d.id === selectedDialogueId);
  const canSplit = !!selectedDialogue && currentTime > selectedDialogue.start_time && currentTime < selectedDialogue.end_time;

  const canFuse = (() => {
    if (selectedDialogueIds.length !== 2) return false;
    const pair = selectedDialogueIds.map(id => project.dialogues.find(d => d.id === id)).filter(Boolean);
    return pair.length === 2 && pair[0]!.character_id === pair[1]!.character_id;
  })();

  const hasMultiSelect = selectedDialogueIds.length > 1;

  const handleRateChange = useCallback((newRate: number) => {
    setRate(newRate);
    setPlaybackRate(newRate);
  }, [setPlaybackRate]);

  const handleSeekBar = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    seek(parseFloat(e.target.value));
  }, [seek]);

  const rates = [0.25, 0.5, 0.75, 1.0, 1.25, 1.5, 2.0];

  return (
    <div className="transport-controls" id="transport-controls">
      <div className="transport-seek">
        <input
          type="range"
          className="seek-bar"
          min={0}
          max={duration || 1}
          step={0.001}
          value={currentTime}
          onChange={handleSeekBar}
          id="seek-bar"
        />
      </div>
      <div className="transport-buttons">
        <div className="transport-left">
          <button className="transport-btn" onClick={() => seek(0)} title="Go to start" id="btn-start">
            ⏮
          </button>
          <button className="transport-btn" onClick={() => stepFrame(false)} title="Previous frame" id="btn-prev-frame">
            ◀◀
          </button>
          <button className="transport-btn play-btn" onClick={togglePlay} title={isPlaying ? 'Pause' : 'Play'} id="btn-play">
            {isPlaying ? '⏸' : '▶'}
          </button>
          <button className="transport-btn" onClick={() => stepFrame(true)} title="Next frame" id="btn-next-frame">
            ▶▶
          </button>
          <button className="transport-btn" onClick={() => seek(duration)} title="Go to end" id="btn-end">
            ⏭
          </button>
          <span style={{ width: '1px', height: '20px', background: 'rgba(255,255,255,0.15)', margin: '0 4px', display: 'inline-block', verticalAlign: 'middle' }} />
          <button
            className="transport-btn"
            title={canSplit ? 'Split dialogue at playhead (X)' : 'Select a dialogue and place the playhead inside it'}
            disabled={!canSplit}
            onClick={() => { if (selectedDialogueId) splitDialogue(selectedDialogueId, currentTime); }}
            style={{ opacity: canSplit ? 1 : 0.35, fontSize: '16px' }}
            id="btn-split"
          >
            ✂
          </button>
          <button
            className="transport-btn"
            title={canFuse ? 'Fuse 2 selected dialogues' : 'Select exactly 2 dialogues of the same character'}
            disabled={!canFuse}
            onClick={() => fuseDialogues()}
            style={{ opacity: canFuse ? 1 : 0.35, color: '#a78bfa', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
            id="btn-fuse"
          >
            <svg width="16" height="14" viewBox="0 0 16 14" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M1 2h5.5a2.5 2.5 0 0 1 0 5H8m0 0H6.5a2.5 2.5 0 0 0 0 5H12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
              <path d="M10.5 10l2 2-2 2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
              <circle cx="8" cy="7" r="1" fill="currentColor"/>
            </svg>
          </button>
          <button
            className="transport-btn"
            title={hasMultiSelect ? `Delete ${selectedDialogueIds.length} selected dialogues (Del)` : (selectedDialogueId ? 'Delete selected dialogue (Del)' : 'Select a dialogue first')}
            disabled={!selectedDialogueId && !hasMultiSelect}
            onClick={() => {
              if (hasMultiSelect) {
                deleteSelected();
              } else if (selectedDialogueId) {
                deleteDialogue(selectedDialogueId);
              }
            }}
            style={{ opacity: (selectedDialogueId || hasMultiSelect) ? 1 : 0.35, color: '#f87171', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
            id="btn-delete-dialogue"
          >
            <svg width="14" height="15" viewBox="0 0 14 15" fill="none" xmlns="http://www.w3.org/2000/svg">
              <rect x="1.5" y="4" width="11" height="10" rx="1.5" stroke="currentColor" strokeWidth="1.4"/>
              <path d="M5 7v4M9 7v4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
              <path d="M0.5 4h13M5 4V2a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v2" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
            </svg>
          </button>
          <button
            className="transport-btn"
            title={autoAddOnSelect ? 'Auto-add dialogue on lane drag (ON) — click to disable' : 'Auto-add dialogue on lane drag (OFF) — click to enable'}
            onClick={toggleAutoAddOnSelect}
            style={{ color: autoAddOnSelect ? '#4ade80' : 'rgba(255,255,255,0.35)', display: 'flex', alignItems: 'center', justifyContent: 'center', outline: autoAddOnSelect ? '1px solid #4ade8060' : 'none', borderRadius: '4px', transition: 'color 0.15s, outline 0.15s' }}
            id="btn-auto-add"
          >
            <svg width="15" height="15" viewBox="0 0 15 15" fill="none" xmlns="http://www.w3.org/2000/svg">
              <rect x="1" y="5" width="13" height="8" rx="1.5" stroke="currentColor" strokeWidth="1.3"/>
              <path d="M5 9h5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
              <path d="M7.5 7v4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
              <path d="M4 5V3.5A1.5 1.5 0 0 1 5.5 2h4A1.5 1.5 0 0 1 11 3.5V5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
              {autoAddOnSelect && <circle cx="12.5" cy="3.5" r="2" fill="currentColor"/>}
            </svg>
          </button>
        </div>

        <div className="transport-center">
          <span className="timecode" id="timecode-display">
            {formatTimecode(currentTime, fps)}
          </span>
          <span className="timecode-separator">/</span>
          <span className="timecode timecode-total">
            {formatTimecode(duration, fps)}
          </span>
        </div>

        <div className="transport-right">
          <div className="rate-selector">
            {rates.map((r) => (
              <button
                key={r}
                className={`rate-btn ${rate === r ? 'active' : ''}`}
                onClick={() => handleRateChange(r)}
                id={`rate-${r}`}
              >
                {r}x
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

export default TransportControls;
