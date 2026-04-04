import React, { useRef, useEffect, useCallback, useState } from 'react';
import { useProjectStore } from '../stores/projectStore';
import { useVideoSync } from '../hooks/useVideoSync';
import { useDrag } from '@use-gesture/react';
import type { Dialogue, Marker } from '../types/project';

interface TimelineProps {
  videoSync: ReturnType<typeof useVideoSync>;
}

const TRACK_OFFSET = 120;

const TimelineMarkerBlock = ({ m, pps, height, onUpdate, onDelete }: { m: Marker, pps: number, height: number, onUpdate: (id: string, updates: Partial<Marker>) => void, onDelete: (id: string) => void }) => {
  const bindDrag = useDrag(({ movement: [mx], event, first, memo }) => {
    event.stopPropagation();
    if (first) return m.time;
    const dt = mx / pps;
    if (dt !== 0) {
      onUpdate(m.id, { time: Math.max(0, memo + dt) });
    }
    return memo;
  });

  return (
    <div
      {...(bindDrag() as any)}
      onDoubleClick={(e) => {
        e.stopPropagation();
        onDelete(m.id);
      }}
      style={{ position: 'absolute', left: m.time * pps + TRACK_OFFSET, bottom: 0, transform: 'translateX(-50%)', display: 'flex', flexDirection: 'column', alignItems: 'center' }}
    >
      <div style={{ padding: '2px 6px', backgroundColor: m.color, color: '#000', fontSize: '8px', fontWeight: 'bold', borderRadius: '4px 4px 0 0', cursor: 'ew-resize', pointerEvents: 'auto', userSelect: 'none', boxShadow: '0 -2px 5px rgba(0,0,0,0.5)' }}>
        {m.label}
      </div>
      {/* The vertical descending line */}
      <div style={{ width: '2px', height: `${height}px`, backgroundColor: `${m.color}80`, position: 'absolute', top: '100%', zIndex: 15, pointerEvents: 'none' }} />
    </div>
  );
};

const TimelineDialogueBlock = ({
  dialogue,
  color,
  charName,
  pps,
  maxTime,
  markers,
  dialogues,
  onUpdate
}: {
  dialogue: Dialogue,
  color: string,
  charName: string,
  pps: number,
  maxTime: number,
  markers: Marker[],
  dialogues: Dialogue[],
  onUpdate: (id: string, updates: Partial<Dialogue>) => void
}) => {
  const selectDialogue = useProjectStore((s) => s.selectDialogue);
  const selectedDialogueId = useProjectStore((s) => s.selectedDialogueId);
  const isSelected = selectedDialogueId === dialogue.id;

  const checkSnap = (time: number, event: any) => {
    // Some touch events may not have altKey, default to false
    const skipSnap = event && event.altKey === true;
    if (skipSnap) return time;

    const SNAP_THRESHOLD_SEC = 10 / pps; // 25 pixels snapping distance
    let closestTime = time;
    let minDistance = SNAP_THRESHOLD_SEC;

    if (time < SNAP_THRESHOLD_SEC) {
      closestTime = 0;
      minDistance = time;
    }

    // Snap to markers
    for (const m of markers) {
      const dist = Math.abs(time - m.time);
      if (dist < minDistance) {
        minDistance = dist;
        closestTime = m.time;
      }
    }

    // Snap to other dialogues
    for (const d of dialogues) {
      if (d.id === dialogue.id) continue;

      const distStart = Math.abs(time - d.start_time);
      if (distStart < minDistance) {
        minDistance = distStart;
        closestTime = d.start_time;
      }

      const distEnd = Math.abs(time - d.end_time);
      if (distEnd < minDistance) {
        minDistance = distEnd;
        closestTime = d.end_time;
      }
    }

    return closestTime;
  };

  // Center drag (move entire block)
  const bindDrag = useDrag(({ movement: [mx], event, first, memo }) => {
    event.stopPropagation();
    if (first) return { start: dialogue.start_time, end: dialogue.end_time };

    const initialStart = memo.start;
    const duration = memo.end - memo.start;
    let dt = mx / pps;
    let newStart = initialStart + dt;
    let newEnd = newStart + duration;

    // Smart Snapping for either edge
    if (!event.altKey) {
      const snappedStart = checkSnap(newStart, event);
      if (snappedStart !== newStart) {
        newStart = snappedStart;
      } else {
        // Try snapping the end if the start didn't snap
        const snappedEnd = checkSnap(newEnd, event);
        if (snappedEnd !== newEnd) {
          newStart = snappedEnd - duration;
        }
      }
    }

    // Constraint 1: t0 (cannot go below 0)
    if (newStart < 0) {
      newStart = 0;
    }

    // Constraint 2: t.max
    if (maxTime > 0 && newStart + duration > maxTime) {
      newStart = Math.max(0, maxTime - duration);
    }

    onUpdate(dialogue.id, {
      start_time: newStart,
      end_time: newStart + duration
    });
    return memo;
  });

  // Left edge drag (resize start)
  const bindLeft = useDrag(({ movement: [mx], event, first, memo }) => {
    event.stopPropagation();
    if (first) return dialogue.start_time;

    const dt = mx / pps;
    let newStart = Math.min(dialogue.end_time - 0.1, memo + dt);
    newStart = checkSnap(newStart, event);
    if (newStart < 0) newStart = 0;

    onUpdate(dialogue.id, {
      start_time: newStart
    });
    return memo;
  });

  // Right edge drag (resize end)
  const bindRight = useDrag(({ movement: [mx], event, first, memo }) => {
    event.stopPropagation();
    if (first) return dialogue.end_time;

    const dt = mx / pps;
    let newEnd = Math.max(dialogue.start_time + 0.1, memo + dt);
    newEnd = checkSnap(newEnd, event);
    if (maxTime > 0 && newEnd > maxTime) newEnd = maxTime;

    onUpdate(dialogue.id, {
      end_time: newEnd
    });
    return memo;
  });

  const blockWidth = Math.max(4, (dialogue.end_time - dialogue.start_time) * pps);

  return (
    <div
      {...(bindDrag() as any)}
      className={`timeline-block ${isSelected ? 'selected' : ''}`}
      onDoubleClick={(e) => {
        e.stopPropagation();
        selectDialogue(dialogue.id);
        // We could also focus the text editor here
      }}
      onClick={(e) => {
        e.stopPropagation();
        selectDialogue(dialogue.id);
      }}
      style={{
        left: dialogue.start_time * pps + TRACK_OFFSET,
        width: blockWidth,
        backgroundColor: isSelected ? `${color}40` : `${color}20`,
        borderTop: `3px solid ${isSelected ? color : `${color}a0`}`,
        borderRadius: '6px',
        position: 'absolute',
        height: '40px',
        top: '10px',
        boxSizing: 'border-box',
        cursor: 'grab',
        touchAction: 'none',
        display: 'flex',
        flexDirection: 'column',
        zIndex: 10
      }}
    >
      <div
        {...(bindLeft() as any)}
        className="resize-handle left"
        style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 8, cursor: 'ew-resize', touchAction: 'none', zIndex: 5 }}
      />

      {/* Name label if block is wide enough */}
      {blockWidth > 40 && (
        <div style={{ color: color, fontSize: '10px', fontWeight: 'bold', textTransform: 'uppercase', paddingLeft: '6px', paddingTop: '2px', pointerEvents: 'none', zIndex: 2 }}>
          {charName}
        </div>
      )}

      {/* Physically Stretched Text via SVG */}
      <svg
        width="100%"
        height="100%"
        preserveAspectRatio="none"
        style={{ position: 'absolute', left: 0, top: 0, pointerEvents: 'none', zIndex: 1 }}
      >
        <text
          x="10"
          y="28" // Approx vertical center / baseline depending on block height (40px)
          fill="#e2e8f0"
          fontFamily={dialogue.font_family || 'sans-serif'}
          fontSize={12}
          fontWeight={dialogue.bold ? 'bold' : '500'}
          style={{ textDecoration: [dialogue.underline && 'underline', dialogue.crossed && 'line-through'].filter(Boolean).join(' ') || 'none' }}
          textLength={Math.max(1, blockWidth - 20)}
          lengthAdjust="spacingAndGlyphs"
        >
          {dialogue.text}
        </text>
      </svg>
      <div
        {...(bindRight() as any)}
        className="resize-handle right"
        style={{ position: 'absolute', right: 0, top: 0, bottom: 0, width: 8, cursor: 'ew-resize', touchAction: 'none', zIndex: 5 }}
      />
    </div>
  );
};

const TimelineAudioWaveform: React.FC<{ waveform: number[], pps: number, duration: number, containerRef: React.RefObject<HTMLDivElement> }> = ({ waveform, pps, duration, containerRef }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerWidthRef = useRef<number>(1000);

  useEffect(() => {
    if (!containerRef.current) return;
    const observer = new ResizeObserver((entries) => {
      containerWidthRef.current = entries[0].contentRect.width;
    });
    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, [containerRef]);
  
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    
    let frameId: number;
    let lastRenderX = -1;
    let lastPps = -1;
    let lastWidth = -1;

    const peaksPerSecond = 100;

    const draw = () => {
      const container = containerRef.current;
      if (!container) return;

      const scrollLeft = container.scrollLeft;
      const width = Math.max(10, containerWidthRef.current - TRACK_OFFSET);

      if (Math.abs(scrollLeft - lastRenderX) > 2 || pps !== lastPps || width !== lastWidth) {
        lastRenderX = scrollLeft;
        lastPps = pps;
        lastWidth = width;

        const height = 40;
        if (canvas.width !== width) canvas.width = width;
        if (canvas.height !== height) canvas.height = height;

        ctx.clearRect(0, 0, width, height);

        if (waveform.length === 0) return;

        ctx.fillStyle = '#4ade80'; // Light green
        ctx.beginPath();

        const peakWidth = pps / peaksPerSecond;
        
        // Start time mapped smoothly
        const startTime = Math.max(0, scrollLeft / pps);
        const endTime = (scrollLeft + width) / pps;

        const startPeak = Math.max(0, Math.floor(startTime * peaksPerSecond));
        const endPeak = Math.min(waveform.length, Math.ceil(endTime * peaksPerSecond));

        if (peakWidth < 1) {
          // Heavy zoom-out: aggregate multiple peaks per screen pixel
          const peaksPerPixel = 1 / peakWidth;
          for (let px = 0; px < width; px++) {
            const peakIdxStart = Math.floor(startPeak + px * peaksPerPixel);
            const peakIdxEnd = Math.min(waveform.length, Math.floor(startPeak + (px + 1) * peaksPerPixel));
            
            if (peakIdxStart >= waveform.length) break;
            
            let maxVal = 0;
            for (let i = peakIdxStart; i < peakIdxEnd; i++) {
              if (waveform[i] > maxVal) maxVal = waveform[i];
            }
            
            const val = maxVal / 255.0;
            const h = Math.max(1, val * height);
            const y = height - h;
            ctx.rect(px, y, 1, h);
          }
        } else {
          // Zoomed-in: Each peak is at least 1 pixel wide
          for (let i = startPeak; i < endPeak; i++) {
            const val = waveform[i] / 255.0;
            const pixelX = (i / peaksPerSecond) * pps - scrollLeft;
            const h = Math.max(1, val * height);
            const y = height - h;
            ctx.rect(pixelX, y, peakWidth > 1 ? peakWidth - 0.5 : peakWidth, h);
          }
        }
        ctx.fill();
      }

      frameId = requestAnimationFrame(draw);
    };

    frameId = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frameId);
  }, [waveform, pps, duration, containerRef]);

  return (
    <div className="timeline-lane waveform-lane" style={{ display: 'flex', position: 'relative', height: '40px', borderBottom: '1px solid rgba(255,255,255,0.05)', backgroundColor: '#0f0f15' }}>
      <div className="lane-header" style={{ position: 'sticky', left: 0, width: `${TRACK_OFFSET}px`, minWidth: `${TRACK_OFFSET}px`, height: '100%', backgroundColor: '#0f0f1e', zIndex: 30, padding: '0 8px', display: 'flex', alignItems: 'center', borderRight: `2px solid #4ade80`, borderBottom: '1px solid rgba(255,255,255,0.02)' }}>
        <span style={{ color: '#4ade80', fontSize: '10px', fontWeight: 'bold', textTransform: 'uppercase', letterSpacing: '1px' }}>AUDIO</span>
      </div>
      <div style={{ position: 'sticky', left: TRACK_OFFSET, top: 0, bottom: 0, pointerEvents: 'none', overflow: 'hidden' }}>
        <canvas ref={canvasRef} style={{ height: '40px', opacity: 0.8, display: 'block' }} />
      </div>
    </div>
  );
};

const Timeline: React.FC<TimelineProps> = ({ videoSync }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const playheadRef = useRef<HTMLDivElement>(null);
  const { project, updateDialogue, updateMarker, deleteMarker, setHoveredTime } = useProjectStore();
  const { seek, getDuration } = videoSync;
  const [pps, setPps] = useState(150); // pixels per second (3x default zoom)
  const duration = getDuration() || 60; // fallback strictly for timeline bounds

  const { dialogues, characters, markers } = project;

  const isPanningRef = useRef(false);
  const lastPanPos = useRef({ x: 0, y: 0 });

  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    // button === 1 is Middle Click
    if (e.button === 1) {
      e.preventDefault(); // Prevents the browser's default auto-scroll icon
      isPanningRef.current = true;
      lastPanPos.current = { x: e.clientX, y: e.clientY };
      document.body.style.cursor = 'grabbing';
    }
  }, []);

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    if (isPanningRef.current && containerRef.current) {
      e.preventDefault();
      const dx = e.clientX - lastPanPos.current.x;
      const dy = e.clientY - lastPanPos.current.y;
      
      containerRef.current.scrollLeft -= dx;
      containerRef.current.scrollTop -= dy;
      
      lastPanPos.current = { x: e.clientX, y: e.clientY };
    }
  }, []);

  const handlePointerUp = useCallback((e: React.PointerEvent) => {
    if (e.button === 1 && isPanningRef.current) {
      isPanningRef.current = false;
      document.body.style.cursor = 'default';
    }
  }, []);

  // Ensure panning stops if mouse leaves window or button is released outside
  useEffect(() => {
    const handleGlobalMouseUp = (e: MouseEvent) => {
      if (e.button === 1 && isPanningRef.current) {
        isPanningRef.current = false;
        document.body.style.cursor = 'default';
      }
    };
    window.addEventListener('mouseup', handleGlobalMouseUp);
    return () => window.removeEventListener('mouseup', handleGlobalMouseUp);
  }, []);

  // Zoom with Wheel
  const handleWheel = useCallback((e: React.WheelEvent) => {
    // Zoom if Ctrl or Alt is pressed, otherwise standard scrolling
    if (e.ctrlKey || e.altKey) {
      e.preventDefault();
      const delta = e.deltaY > 0 ? 0.8 : 1.25;
      setPps((prev) => Math.max(5, Math.min(500, prev * delta)));
    }
  }, []);

  // Auto-scroll inside playhead loop
  useEffect(() => {
    let frame: number;
    let lastTime = -1;
    const loop = () => {
      if (playheadRef.current) {
        const state = useProjectStore.getState();
        const time = state.currentTime;
        const px = time * pps;
        const screenPx = px + TRACK_OFFSET;
        playheadRef.current.style.transform = `translateX(${screenPx}px)`;

        const timeChanged = Math.abs(time - lastTime) > 0.001;

        // Keep playhead in view when time actively changes (playing or scrubbing)
        if (timeChanged && containerRef.current) {
          const container = containerRef.current;

          if (state.isPlaying) {
            // Suivi (Smooth tracking): once the playhead reaches the center, scroll the background seamlessly
            const centerThreshold = container.scrollLeft + container.clientWidth / 2;
            if (screenPx > centerThreshold) {
              container.scrollLeft = screenPx - container.clientWidth / 2;
            } else if (screenPx < container.scrollLeft + TRACK_OFFSET) {
              // if it somehow went off-screen left (e.g. rewind), recenter it
              container.scrollLeft = screenPx - container.clientWidth / 2;
            }
          } else {
            // While paused/scrubbing, only jump if it goes completely out of view
            const scrollRightThreshold = container.scrollLeft + container.clientWidth - 50;
            const scrollLeftThreshold = container.scrollLeft + TRACK_OFFSET + 50;

            if (screenPx > scrollRightThreshold || screenPx < scrollLeftThreshold) {
              container.scrollLeft = screenPx - container.clientWidth / 2;
            }
          }
        }
        lastTime = time;
      }
      frame = requestAnimationFrame(loop);
    };
    frame = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(frame);
  }, [pps]);

  const bindScrub = useDrag(({ event, movement: [mx, _my], active, memo }) => {
    event?.stopPropagation();
    if (active) {
      const container = containerRef.current;
      if (!container) return memo;

      let startX = memo;
      if (memo === undefined && event) {
        const rect = container.getBoundingClientRect();
        // @ts-ignore
        startX = (event.clientX || event.touches?.[0]?.clientX) - rect.left + container.scrollLeft;
        // Don't seek if clicking on the headers area
        if (startX > TRACK_OFFSET) {
          seek((startX - TRACK_OFFSET) / pps);
        }
      } else if (memo !== undefined && startX > TRACK_OFFSET) {
        seek((startX + mx - TRACK_OFFSET) / pps);
      }

      return startX;
    }
  });



  // Calculate generic markers interval
  const END_PADDING = 400; // Extra padding so user can scroll past the end naturally
  const totalWidth = duration * pps + TRACK_OFFSET + END_PADDING;
  const interval = pps < 10 ? 60 : pps < 50 ? 10 : pps < 100 ? 5 : 1;

  // Generate ticks
  const ticks = [];
  for (let t = 0; t <= duration; t += interval) {
    ticks.push(t);
  }

  const tracksHeight = (project.video?.waveform ? 40 : 0) + characters.length * 60 + 24;

  return (
    <div
      className="timeline"
      ref={containerRef}
      id="timeline"
      onWheel={handleWheel}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      style={{ overflowX: 'auto', overflowY: 'auto', position: 'relative', minHeight: '100px', maxHeight: '40vh', flexShrink: 0 }}
    >
      <div
        className="timeline-content"
        {...bindScrub()}
        onMouseMove={(e) => {
          if (!containerRef.current) return;
          const rect = containerRef.current.getBoundingClientRect();
          const scrollLeft = containerRef.current.scrollLeft;
          const pointerX = e.clientX - rect.left + scrollLeft;
          if (pointerX > TRACK_OFFSET) {
            setHoveredTime((pointerX - TRACK_OFFSET) / pps);
          } else {
            setHoveredTime(null);
          }
        }}
        onMouseLeave={() => setHoveredTime(null)}
        style={{ width: `${totalWidth}px`, position: 'relative', minHeight: '100%', touchAction: 'none' }}
      >
        {/* Time ruler */}
        <div className="timeline-ruler" style={{ height: '24px', borderBottom: '1px solid #334155', position: 'sticky', top: 0, backgroundColor: 'rgba(15, 15, 25, 0.95)', zIndex: 20 }}>
          <div style={{ position: 'absolute', right: '12px', top: '4px', fontSize: '10px', color: '#64748b' }}>
            Ctrl + Scroll to Zoom
          </div>
          {ticks.map((t) => (
            <div key={t} style={{ position: 'absolute', left: t * pps + TRACK_OFFSET, borderLeft: '1px solid rgba(255,255,255,0.2)', height: '100%', paddingLeft: '4px', fontSize: '10px', color: '#94a3b8' }}>
              {t}s
            </div>
          ))}
          {/* Markers Lane inside Ruler */}
          <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: '14px', pointerEvents: 'none', zIndex: 35 }}>
            {markers.map((m) => (
              <TimelineMarkerBlock key={m.id} m={m} pps={pps} height={tracksHeight} onUpdate={updateMarker} onDelete={deleteMarker} />
            ))}
          </div>
        </div>

        {/* Playhead */}
        <div
          ref={playheadRef}
          className="timeline-playhead-dom"
          style={{
            position: 'absolute',
            top: 0,
            bottom: 0,
            width: '2px',
            backgroundColor: '#ef4444',
            zIndex: 25,
            pointerEvents: 'none',
            transform: `translateX(${TRACK_OFFSET}px)`,
            boxShadow: '0 0 4px #ef4444'
          }}
        />

        {/* End of Video Void */}
        {duration > 0 && (
          <div
            style={{
              position: 'absolute',
              left: duration * pps + TRACK_OFFSET,
              top: 0,
              bottom: 0,
              width: `${END_PADDING}px`,
              backgroundColor: 'rgba(0, 0, 0, 0.4)',
              backgroundImage: 'repeating-linear-gradient(45deg, transparent, transparent 10px, rgba(255,255,255,0.03) 10px, rgba(255,255,255,0.03) 20px)',
              borderLeft: '2px dashed #ef4444',
              pointerEvents: 'none',
              zIndex: 5
            }}
          >
            <div style={{ position: 'sticky', left: duration * pps + TRACK_OFFSET + 8, padding: '2px 0', color: '#ef4444', fontSize: '9px', fontWeight: 'bold', textTransform: 'uppercase', letterSpacing: '1px' }}>
              End Limit
            </div>
          </div>
        )}

        {/* Audio Waveform */}
        {project.video?.waveform && (
          <TimelineAudioWaveform waveform={project.video.waveform} pps={pps} duration={duration} containerRef={containerRef} />
        )}

        {/* Lanes */}
        {characters.length === 0 && (
          <div className="timeline-empty-hint" style={{ padding: '20px', color: '#64748b' }}>
            Add characters to create timeline tracks.
          </div>
        )}

        {characters.map((char) => (
          <div key={char.id} className="timeline-lane" style={{ position: 'relative', height: '60px', borderBottom: '1px solid rgba(255,255,255,0.05)', backgroundColor: 'transparent' }}>
            <div className="lane-header" style={{ position: 'sticky', left: 0, width: `${TRACK_OFFSET}px`, height: '100%', backgroundColor: '#0f0f1e', zIndex: 30, padding: '0 8px', display: 'flex', alignItems: 'center', borderRight: `2px solid ${char.color}`, borderBottom: '1px solid rgba(255,255,255,0.02)' }}>
              <span style={{ color: '#fff', fontSize: '11px', fontWeight: 'bold', textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap' }}>{char.name}</span>
            </div>
            {dialogues
              .filter(d => d.character_id === char.id)
              .map(dialogue => (
                <TimelineDialogueBlock
                  key={dialogue.id}
                  dialogue={dialogue}
                  color={char.color}
                  charName={char.name}
                  pps={pps}
                  maxTime={duration}
                  markers={markers}
                  dialogues={dialogues}
                  onUpdate={updateDialogue}
                />
              ))}
          </div>
        ))}
      </div>
    </div>
  );
};

export default Timeline;
