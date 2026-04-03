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
  const { project, currentTime, isPlaying } = useProjectStore();
  const [rate, setRate] = useState(1.0);
  const fps = project.video?.fps || 24;
  const duration = getDuration();

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
