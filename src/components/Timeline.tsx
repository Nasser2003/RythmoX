import React, { useRef, useEffect, useCallback, useState, useMemo } from 'react';
import { createPortal, flushSync } from 'react-dom';
import { useProjectStore } from '../stores/projectStore';
import { useVideoSync } from '../hooks/useVideoSync';
import { useDrag } from '@use-gesture/react';
import type { Dialogue, Marker } from '../types/project';

interface TimelineProps {
  videoSync: ReturnType<typeof useVideoSync>;
}

const TRACK_OFFSET = 120;
const MIN_EXPORT_RANGE = 0.1;

const ctxItemStyle: React.CSSProperties = {
  display: 'block', width: '100%', padding: '7px 14px',
  background: 'transparent', border: 'none', color: '#e2e8f0',
  fontSize: '13px', textAlign: 'left', cursor: 'pointer',
};

const DIALOGUE_CTX_MENU_WIDTH = 240;
const DIALOGUE_CTX_MENU_SINGLE_HEIGHT = 122;
const DIALOGUE_CTX_MENU_MULTI_HEIGHT = 44;
const DIALOGUE_CTX_MENU_VIEWPORT_MARGIN = 12;
const DIALOGUE_DRAG_POINTER_CONFIG = { buttons: 1, capture: false, keys: false } as const;

const TimelineTrimHandle = ({
  time,
  pps,
  color,
  onUpdate,
}: {
  time: number;
  pps: number;
  color: string;
  onUpdate: (time: number) => void;
}) => {
  const bindDrag = useDrag(({ movement: [mx], event, first, memo }) => {
    event.stopPropagation();
    if (first) return time;
    onUpdate((memo as number) + mx / pps);
    return memo;
  });

  return (
    <div
      {...(bindDrag() as any)}
      style={{
        position: 'absolute',
        left: time * pps + TRACK_OFFSET,
        top: 0,
        bottom: 0,
        transform: 'translateX(-50%)',
        zIndex: 36,
        cursor: 'ew-resize',
        touchAction: 'none',
      }}
      title="Drag export trim handle"
    >
      <div style={{ position: 'absolute', top: 0, bottom: 0, left: '50%', width: '2px', transform: 'translateX(-50%)', background: color, boxShadow: `0 0 0 1px rgba(15,23,42,0.9), 0 0 6px ${color}55` }} />
      <div style={{ position: 'absolute', top: 2, left: '50%', width: '10px', height: '10px', transform: 'translateX(-50%)', background: color, borderRadius: '2px', boxShadow: '0 0 0 2px rgba(15,23,42,0.9)' }} />
    </div>
  );
};

const TimelineMarkerBlock = ({ m, pps, onUpdate }: { m: Marker, pps: number, onUpdate: (id: string, updates: Partial<Marker>) => void }) => {
  const selectMarker = useProjectStore((s) => s.selectMarker);
  const toggleMarkerSelection = useProjectStore((s) => s.toggleMarkerSelection);
  const requestMarkerEdit = useProjectStore((s) => s.requestMarkerEdit);
  const selectedMarkerIds = useProjectStore((s) => s.selectedMarkerIds);
  const isSelected = selectedMarkerIds.includes(m.id);

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
      onClick={(e) => {
        e.stopPropagation();
        if (e.ctrlKey || e.metaKey) {
          toggleMarkerSelection(m.id);
        } else {
          selectMarker(m.id);
        }
      }}
      onDoubleClick={(e) => {
        e.stopPropagation();
        requestMarkerEdit(m.id);
      }}
      style={{ position: 'absolute', left: m.time * pps + TRACK_OFFSET, bottom: 0, transform: 'translateX(-50%)', display: 'flex', flexDirection: 'column', alignItems: 'center' }}
    >
      <div style={{ padding: '2px 6px', backgroundColor: m.color, color: '#000', fontSize: '8px', fontWeight: 'bold', borderRadius: '4px 4px 0 0', cursor: 'ew-resize', pointerEvents: 'auto', userSelect: 'none', boxShadow: isSelected ? `0 0 0 2px #fff, 0 -2px 5px rgba(0,0,0,0.5)` : '0 -2px 5px rgba(0,0,0,0.5)', outline: isSelected ? '2px solid white' : 'none', outlineOffset: '1px' }}>
        {m.label}
      </div>
    </div>
  );
};

type DialogueTextSegment = {
  key: string;
  text: string;
  x: number;
  width: number;
  clipId: string;
};

function buildDialogueTextSegments(
  dialogueId: string,
  text: string,
  cuts: Array<{ position: number; char_index?: number }>,
  blockWidth: number
): DialogueTextSegment[] {
  const leftPad = 10;
  const rightPad = 10;
  const contentWidth = Math.max(1, blockWidth - leftPad - rightPad);
  const segmentGap = cuts.length > 0 ? Math.min(8, Math.max(4, blockWidth * 0.015)) : 0;
  const usableWidth = Math.max(1, contentWidth - cuts.length * segmentGap);
  const normalizedCuts = [...cuts]
    .map((cut) => ({
      position: Math.max(0.02, Math.min(0.98, cut.position)),
      char_index: cut.char_index,
    }))
    .sort((a, b) => a.position - b.position);
  const boundaries = [0, ...normalizedCuts.map((cut) => cut.position), 1];
  const totalChars = text.length;
  const charBoundaries = [0];

  for (let index = 0; index < normalizedCuts.length; index += 1) {
    const cut = normalizedCuts[index]!;
    const rawIndex = typeof cut.char_index === 'number'
      ? cut.char_index
      : Math.round(totalChars * cut.position);
    const previousIndex = charBoundaries[charBoundaries.length - 1];
    const remainingCuts = normalizedCuts.length - index - 1;
    const maxIndex = Math.max(previousIndex, totalChars - remainingCuts);
    charBoundaries.push(Math.max(previousIndex, Math.min(maxIndex, rawIndex)));
  }

  charBoundaries.push(totalChars);

  let cursorX = leftPad;
  return boundaries.slice(0, -1).map((start, index) => {
    const end = boundaries[index + 1];
    const segmentWidth = Math.max(1, usableWidth * (end - start));
    const segmentText = text.slice(charBoundaries[index], charBoundaries[index + 1]);
    const segment = {
      key: `segment-${index}`,
      text: segmentText,
      x: cursorX,
      width: segmentWidth,
      clipId: `dialogue-${dialogueId}-segment-${index}`,
    };
    cursorX += segmentWidth + segmentGap;
    return segment;
  });
}

const TimelineDialogueCutHandle = ({
  cut,
  color,
  blockWidth,
  onMove,
  onDelete,
}: {
  cut: { id: string; position: number };
  color: string;
  blockWidth: number;
  onMove: (position: number) => void;
  onDelete: () => void;
}) => {
  const bindCutDrag = useDrag(({ movement: [mx], event, first, memo }) => {
    event.stopPropagation();
    if (first) return cut.position;
    onMove((memo as number) + mx / Math.max(blockWidth, 1));
    return memo;
  }, { pointer: DIALOGUE_DRAG_POINTER_CONFIG });

  return (
    <div
      {...(bindCutDrag() as any)}
      data-cut-handle="true"
      onClick={(e) => {
        e.stopPropagation();
      }}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onDelete();
      }}
      title="Drag to move visual separator. Right click to remove."
      style={{
        position: 'absolute',
        left: `${cut.position * blockWidth}px`,
        top: 2,
        bottom: 2,
        width: '0px',
        transform: 'translateX(-50%)',
        zIndex: 6,
        pointerEvents: 'auto',
      }}
    >
      <div
        style={{
          position: 'absolute',
          top: 0,
          bottom: 0,
          left: '-1px',
          width: '2px',
          background: color,
          opacity: 0.9,
          boxShadow: `0 0 0 1px rgba(15,23,42,0.75), 0 0 8px ${color}55`,
          borderRadius: '999px',
        }}
      />
      <div
        style={{
          position: 'absolute',
          top: '50%',
          left: '50%',
          width: '10px',
          height: '10px',
          transform: 'translate(-50%, -50%) rotate(45deg)',
          background: color,
          borderRadius: '2px',
          boxShadow: '0 0 0 2px rgba(15,23,42,0.9)',
          cursor: 'ew-resize',
        }}
      />
    </div>
  );
};

const TimelineDialogueBlock = React.memo(({
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
  const requestDialogueEdit = useProjectStore((s) => s.requestDialogueEdit);
  const selectedDialogueId = useProjectStore((s) => s.selectedDialogueId);
  const selectedDialogueIds = useProjectStore((s) => s.selectedDialogueIds);
  const toggleDialogueSelection = useProjectStore((s) => s.toggleDialogueSelection);
  const fontPreviewDialogueId = useProjectStore((s) => s.fontPreviewDialogueId);
  const deleteDialogue = useProjectStore((s) => s.deleteDialogue);
  const deleteSelected = useProjectStore((s) => s.deleteSelected);
  const setDefaultDialogueStyle = useProjectStore((s) => s.setDefaultDialogueStyle);
  const setDefaultDialogueStyleForRole = useProjectStore((s) => s.setDefaultDialogueStyleForRole);
  const isSelected = selectedDialogueId === dialogue.id;
  const isMultiSelected = selectedDialogueIds.includes(dialogue.id);
  const isMultiSelectMode = selectedDialogueIds.length > 1;
  const [ctxMenu, setCtxMenu] = React.useState<{ x: number; y: number } | null>(null);
  const [isBlockDragging, setIsBlockDragging] = useState(false);
  const [blockDragPreview, setBlockDragPreview] = useState<{ start: number; end: number } | null>(null);
  const suppressClickRef = useRef(false);
  const blockDragCleanupRef = useRef<(() => void) | null>(null);
  const visualCuts = [...(dialogue.visual_cuts ?? [])].sort((a, b) => a.position - b.position);

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

  const handleBlockPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    if ((e.target as HTMLElement).closest('.resize-handle, [data-cut-handle="true"]')) return;

    e.stopPropagation();
    blockDragCleanupRef.current?.();

    if (!isSelected && !isMultiSelected && !e.ctrlKey && !e.metaKey) {
      selectDialogue(dialogue.id);
    }

    const dragState = {
      pointerId: e.pointerId,
      startClientX: e.clientX,
      startStart: dialogue.start_time,
      startEnd: dialogue.end_time,
      moved: false,
      previewStart: dialogue.start_time,
      previewEnd: dialogue.end_time,
    };

    const cleanup = () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerEnd);
      window.removeEventListener('pointercancel', handlePointerEnd);
      blockDragCleanupRef.current = null;
      setIsBlockDragging(false);
      setBlockDragPreview(null);
    };

    const handlePointerMove = (event: PointerEvent) => {
      if (event.pointerId !== dragState.pointerId) return;

      const dx = event.clientX - dragState.startClientX;
      if (Math.abs(dx) > 2) {
        dragState.moved = true;
        suppressClickRef.current = true;
      }

      let newStart = dragState.startStart + dx / pps;
      const duration = dragState.startEnd - dragState.startStart;
      let newEnd = newStart + duration;

      if (!event.altKey) {
        const snappedStart = checkSnap(newStart, event);
        if (snappedStart !== newStart) {
          newStart = snappedStart;
        } else {
          const snappedEnd = checkSnap(newEnd, event);
          if (snappedEnd !== newEnd) {
            newStart = snappedEnd - duration;
          }
        }
      }

      if (newStart < 0) {
        newStart = 0;
      }

      if (maxTime > 0 && newStart + duration > maxTime) {
        newStart = Math.max(0, maxTime - duration);
      }

      dragState.previewStart = newStart;
      dragState.previewEnd = newStart + duration;
      setBlockDragPreview({
        start: dragState.previewStart,
        end: dragState.previewEnd,
      });
    };

    const handlePointerEnd = (event: PointerEvent) => {
      if (event.pointerId !== dragState.pointerId) return;
      if (event.type === 'pointerup' && dragState.moved) {
        onUpdate(dialogue.id, {
          start_time: dragState.previewStart,
          end_time: dragState.previewEnd,
        });
      }
      cleanup();
    };

    blockDragCleanupRef.current = cleanup;
    setIsBlockDragging(true);
    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerEnd);
    window.addEventListener('pointercancel', handlePointerEnd);
  }, [checkSnap, dialogue.id, dialogue.end_time, dialogue.start_time, isMultiSelected, isSelected, maxTime, onUpdate, pps, selectDialogue]);

  useEffect(() => {
    return () => {
      blockDragCleanupRef.current?.();
    };
  }, []);

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
  }, { pointer: DIALOGUE_DRAG_POINTER_CONFIG });

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
  }, { pointer: DIALOGUE_DRAG_POINTER_CONFIG });

  const displayStart = blockDragPreview?.start ?? dialogue.start_time;
  const displayEnd = blockDragPreview?.end ?? dialogue.end_time;
  const blockWidth = Math.max(4, (displayEnd - displayStart) * pps);
  const textSegments = buildDialogueTextSegments(dialogue.id, dialogue.text, visualCuts, blockWidth);
  const updateVisualCuts = useCallback((nextCuts: { id: string; position: number; char_index?: number }[]) => {
    onUpdate(dialogue.id, { visual_cuts: nextCuts });
  }, [dialogue.id, onUpdate]);

  const moveVisualCut = useCallback((cutId: string, nextPosition: number) => {
    const currentIndex = visualCuts.findIndex((cut) => cut.id === cutId);
    if (currentIndex === -1) return;
    const minGap = Math.min(0.08, 14 / Math.max(blockWidth, 1));
    const previous = currentIndex > 0 ? visualCuts[currentIndex - 1].position : 0;
    const next = currentIndex < visualCuts.length - 1 ? visualCuts[currentIndex + 1].position : 1;
    const clamped = Math.max(previous + minGap, Math.min(next - minGap, nextPosition));
    updateVisualCuts(visualCuts.map((cut) => cut.id === cutId ? { ...cut, position: clamped } : cut));
  }, [blockWidth, updateVisualCuts, visualCuts]);

  const deleteVisualCut = useCallback((cutId: string) => {
    updateVisualCuts(visualCuts.filter((cut) => cut.id !== cutId));
  }, [updateVisualCuts, visualCuts]);

  const getClampedContextMenuPosition = useCallback((clientX: number, clientY: number) => {
    const menuHeight = isMultiSelectMode ? DIALOGUE_CTX_MENU_MULTI_HEIGHT : DIALOGUE_CTX_MENU_SINGLE_HEIGHT;
    const maxX = Math.max(
      DIALOGUE_CTX_MENU_VIEWPORT_MARGIN,
      window.innerWidth - DIALOGUE_CTX_MENU_WIDTH - DIALOGUE_CTX_MENU_VIEWPORT_MARGIN,
    );
    const maxY = Math.max(
      DIALOGUE_CTX_MENU_VIEWPORT_MARGIN,
      window.innerHeight - menuHeight - DIALOGUE_CTX_MENU_VIEWPORT_MARGIN,
    );

    return {
      x: Math.max(DIALOGUE_CTX_MENU_VIEWPORT_MARGIN, Math.min(clientX, maxX)),
      y: Math.max(DIALOGUE_CTX_MENU_VIEWPORT_MARGIN, Math.min(clientY, maxY)),
    };
  }, [isMultiSelectMode]);

  return (
    <div
      className={`timeline-block ${isSelected ? 'selected' : ''}`}
      onPointerDown={handleBlockPointerDown}
      onDoubleClick={(e) => {
        e.stopPropagation();
        requestDialogueEdit(dialogue.id);
      }}
      onClick={(e) => {
        e.stopPropagation();
        if (suppressClickRef.current) {
          suppressClickRef.current = false;
          return;
        }
        setCtxMenu(null);
        if (e.ctrlKey || e.metaKey) {
          toggleDialogueSelection(dialogue.id);
        } else {
          selectDialogue(dialogue.id);
        }
      }}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
        if (!isMultiSelected) selectDialogue(dialogue.id);
        setCtxMenu(getClampedContextMenuPosition(e.clientX, e.clientY));
      }}
      style={{
        left: displayStart * pps + TRACK_OFFSET,
        width: blockWidth,
        backgroundColor: isMultiSelected ? `${color}40` : `${color}20`,
        borderTop: `3px solid ${isMultiSelected ? color : `${color}60`}`,
        outline: isMultiSelected && !isSelected ? `2px dashed ${color}` : 'none',
        outlineOffset: '-2px',
        borderRadius: '6px',
        position: 'absolute',
        height: '40px',
        top: '10px',
        boxSizing: 'border-box',
        cursor: isBlockDragging ? 'grabbing' : 'grab',
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

      {/* Physically Stretched Text */}
      <svg
        width="100%"
        height="100%"
        preserveAspectRatio="none"
        style={{ position: 'absolute', left: 0, top: 0, pointerEvents: 'none', zIndex: 1 }}
      >
        <defs>
          {textSegments.map((segment) => (
            <clipPath key={segment.clipId} id={segment.clipId}>
              <rect x={segment.x} y="11" width={Math.max(0, segment.width)} height="20" rx="1" />
            </clipPath>
          ))}
        </defs>
        {textSegments.map((segment) => (
          <g key={segment.key} clipPath={`url(#${segment.clipId})`}>
            {segment.width >= 6 && (
              <text
                x={segment.x}
                y="28"
                fill="#e2e8f0"
                fontFamily={isSelected && fontPreviewDialogueId !== dialogue.id ? `'Courier New', monospace` : (dialogue.font_family || 'sans-serif')}
                fontSize={12}
                fontWeight={dialogue.bold ? 'bold' : '500'}
                fontStyle={dialogue.italic ? 'italic' : 'normal'}
                style={{ textDecoration: [dialogue.underline && 'underline', dialogue.crossed && 'line-through'].filter(Boolean).join(' ') || 'none' }}
                textLength={segment.text.trim().length > 0 ? Math.max(1, segment.width) : undefined}
                lengthAdjust="spacingAndGlyphs"
              >
                {segment.text}
              </text>
            )}
          </g>
        ))}
      </svg>

      {visualCuts.map((cut) => (
        <TimelineDialogueCutHandle
          key={cut.id}
          cut={cut}
          color={color}
          blockWidth={blockWidth}
          onMove={(position) => moveVisualCut(cut.id, position)}
          onDelete={() => deleteVisualCut(cut.id)}
        />
      ))}

      <div
        {...(bindRight() as any)}
        className="resize-handle right"
        style={{ position: 'absolute', right: 0, top: 0, bottom: 0, width: 8, cursor: 'ew-resize', touchAction: 'none', zIndex: 5 }}
      />

      {ctxMenu && createPortal(
        <div
          style={{ position: 'fixed', inset: 0, zIndex: 9998, cursor: 'default' }}
          onPointerDown={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setCtxMenu(null);
          }}
          onContextMenu={(e) => e.preventDefault()}
        >
          <div
            style={{
              position: 'fixed',
              left: ctxMenu.x,
              top: ctxMenu.y,
              background: '#1e293b',
              border: '1px solid rgba(255,255,255,0.15)',
              borderRadius: '6px',
              padding: '4px 0',
              zIndex: 9999,
              width: `${DIALOGUE_CTX_MENU_WIDTH}px`,
              boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
            }}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
            onContextMenu={(e) => e.preventDefault()}
          >
            {!isMultiSelectMode && (
              <>
                <button
                  style={ctxItemStyle}
                  onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(255,255,255,0.08)')}
                  onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                  onClick={() => { setDefaultDialogueStyle(dialogue.id); setCtxMenu(null); }}
                >
                  ✦ Set as default style
                </button>
                <button
                  style={ctxItemStyle}
                  onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(255,255,255,0.08)')}
                  onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                  onClick={() => { setDefaultDialogueStyleForRole(dialogue.id); setCtxMenu(null); }}
                >
                  ✦ Set as default style for this role
                </button>
                <div style={{ borderTop: '1px solid rgba(255,255,255,0.1)', margin: '4px 0' }} />
              </>
            )}
            <button
              style={{ ...ctxItemStyle, color: '#f87171' }}
              onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(248,113,113,0.12)')}
              onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
              onClick={() => {
                setCtxMenu(null);
                if (isMultiSelectMode) deleteSelected();
                else deleteDialogue(dialogue.id);
              }}
            >
              🗑 Delete{isMultiSelectMode ? ` (${selectedDialogueIds.length} selected)` : ''}
            </button>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
});

const TimelineAudioWaveform: React.FC<{ waveform: number[], pps: number, duration: number, containerRef: React.RefObject<HTMLDivElement | null> }> = ({ waveform, pps, duration, containerRef }) => {
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
  const lastHoveredTimeRef = useRef<number | null>(null);
  // Granular selectors: project does NOT contain currentTime, so this won't
  // re-render on every 60fps setCurrentTime call while video is playing.
  const project = useProjectStore((s) => s.project);
  const updateDialogue = useProjectStore((s) => s.updateDialogue);
  const updateMarker = useProjectStore((s) => s.updateMarker);
  const updateSettings = useProjectStore((s) => s.updateSettings);
  const setHoveredTime = useProjectStore((s) => s.setHoveredTime);
  const selectedCharacterId = useProjectStore((s) => s.selectedCharacterId);
  const selectedMarkerIds = useProjectStore((s) => s.selectedMarkerIds);
  const selectCharacter = useProjectStore((s) => s.selectCharacter);
  const updateViewState = useProjectStore((s) => s.updateViewState);
  const { seek, getDuration } = videoSync;
  const savedViewState = project.view_state;
  const [pps, setPps] = useState(() => savedViewState?.timeline_zoom ?? 150);
  const ppsRef = useRef(savedViewState?.timeline_zoom ?? 150); // mirror for synchronous read in wheel handler
  const duration = getDuration() || 60; // fallback strictly for timeline bounds

  const { dialogues, characters, markers } = project;
  const trimStart = Math.max(0, Math.min(duration, project.settings.export_start ?? 0));
  const trimEndRaw = project.settings.export_end && project.settings.export_end > 0 ? project.settings.export_end : duration;
  const trimEnd = Math.max(trimStart + MIN_EXPORT_RANGE, Math.min(duration, trimEndRaw));
  const updateTrimStart = useCallback((nextStart: number) => {
    const clamped = Math.max(0, Math.min(trimEnd - MIN_EXPORT_RANGE, nextStart));
    updateSettings({ export_start: clamped });
  }, [trimEnd, updateSettings]);

  const updateTrimEnd = useCallback((nextEnd: number) => {
    const clamped = Math.max(trimStart + MIN_EXPORT_RANGE, Math.min(duration, nextEnd));
    updateSettings({ export_end: clamped });
  }, [duration, trimStart, updateSettings]);

  // Restore scroll position after first render
  useEffect(() => {
    const container = containerRef.current;
    const saved = useProjectStore.getState().project.view_state;
    if (container && saved?.timeline_scroll != null) {
      container.scrollLeft = saved.timeline_scroll;
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Persist pps when it changes
  useEffect(() => {
    updateViewState({ timeline_zoom: pps });
  }, [pps, updateViewState]);

  // Persist scroll position on scroll
  const handleScrollPersist = useCallback(() => {
    if (containerRef.current) {
      updateViewState({ timeline_scroll: containerRef.current.scrollLeft });
    }
  }, [updateViewState]);

  // --- Lane drag-to-select ---
  const [laneSelection, setLaneSelection] = useState<{ charId: string; startTime: number; endTime: number } | null>(null);
  const laneSelectionRef = useRef<{ charId: string; startTime: number; endTime: number } | null>(null);
  laneSelectionRef.current = laneSelection;
  const laneDragRef = useRef<{ charId: string; startX: number; startTime: number; pointerId: number; hadSelection: boolean } | null>(null);

  const clientXToTime = useCallback((clientX: number) => {
    const container = containerRef.current;
    if (!container) return 0;
    const rect = container.getBoundingClientRect();
    return Math.max(0, (clientX - rect.left + container.scrollLeft - TRACK_OFFSET) / pps);
  }, [pps]);

  const handleLanePointerDown = useCallback((e: React.PointerEvent, charId: string) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    e.nativeEvent.stopPropagation();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    const t = clientXToTime(e.clientX);
    laneDragRef.current = {
      charId,
      startX: e.clientX,
      startTime: t,
      pointerId: e.pointerId,
      hadSelection: laneSelectionRef.current !== null,
    };
    setLaneSelection({ charId, startTime: t, endTime: t });
  }, [clientXToTime]);

  const handleLanePointerMove = useCallback((e: React.PointerEvent) => {
    const drag = laneDragRef.current;
    if (!drag || drag.pointerId !== e.pointerId) return;
    const t = clientXToTime(e.clientX);
    setLaneSelection({ charId: drag.charId, startTime: drag.startTime, endTime: t });
  }, [clientXToTime]);

  const handleLanePointerUp = useCallback((e: React.PointerEvent, charId: string) => {
    const drag = laneDragRef.current;
    if (!drag || drag.pointerId !== e.pointerId) return;
    const dx = Math.abs(e.clientX - drag.startX);
    laneDragRef.current = null;

    const clearSelections = () => {
      useProjectStore.setState({
        selectedDialogueId: null,
        selectedDialogueIds: [],
        editingDialogueId: null,
        selectedMarkerIds: [],
        editingMarkerId: null,
      });
    };

    if (dx < 8) {
      if (drag.hadSelection) {
        setLaneSelection(null);
        clearSelections();
        useProjectStore.getState().selectCharacter(charId);
        return;
      }
      setLaneSelection(null);
      clearSelections();
      useProjectStore.getState().selectCharacter(charId);
      return;
    }

    // Check auto-add flag
    const sel = laneSelectionRef.current;
    if (sel) {
      const selStart = Math.min(sel.startTime, sel.endTime);
      const selEnd = Math.max(sel.startTime, sel.endTime);

      if (useProjectStore.getState().autoAddOnSelect) {
        if (selEnd - selStart >= 0.05) {
          const store = useProjectStore.getState();
          store.addDialogue({
            character_id: charId,
            start_time: selStart,
            end_time: selEnd,
            text: '',
            symbols: [],
            font_family: store.project.settings.font_family,
            bold: false,
            underline: false,
            crossed: false,
            italic: false,
          });
          setLaneSelection(null);
        }
      } else {
        // Auto-add OFF: select all dialogues fully inside the range
        const store = useProjectStore.getState();
        const contained = store.project.dialogues.filter(
          d => d.character_id === charId && d.start_time >= selStart && d.end_time <= selEnd
        );
        if (contained.length > 0) {
          store.selectDialogue(contained[0].id);
          contained.slice(1).forEach(d => store.toggleDialogueSelection(d.id));
        }
      }
    }
  }, []);

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

  // Lane selection keyboard shortcuts (capture phase so they override App.tsx shortcuts)
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      const sel = laneSelectionRef.current;
      if (!sel) return;
      const tag = (e.target as HTMLElement).tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

      const selStart = Math.min(sel.startTime, sel.endTime);
      const selEnd = Math.max(sel.startTime, sel.endTime);
      if (selEnd - selStart < 0.01) { // ignore tiny selection
        if (e.key === 'Escape') setLaneSelection(null);
        return;
      }

      if (e.key === 'Delete') {
        e.preventDefault();
        e.stopPropagation();
        const store = useProjectStore.getState();
        const ids = store.project.dialogues
          .filter(d => d.character_id === sel.charId && d.start_time < selEnd && d.end_time > selStart)
          .map(d => d.id);
        ids.forEach(id => store.deleteDialogue(id));
        setLaneSelection(null);
      } else if (e.key === 'd' && !e.ctrlKey && !e.altKey && !e.shiftKey) {
        e.preventDefault();
        e.stopPropagation();
        const store = useProjectStore.getState();
        store.addDialogue({
          character_id: sel.charId,
          start_time: selStart,
          end_time: selEnd,
          text: '',
          symbols: [],
          font_family: store.project.settings.font_family,
          bold: false,
          underline: false,
          crossed: false,
          italic: false,
        });
        setLaneSelection(null);
      } else if (e.key === 'Escape') {
        setLaneSelection(null);
      }
    };
    window.addEventListener('keydown', handleKey, { capture: true });
    return () => window.removeEventListener('keydown', handleKey, { capture: true });
  }, []);

  // Zoom with Wheel
  const handleWheel = useCallback((e: React.WheelEvent) => {
    // Zoom if Ctrl or Alt is pressed, otherwise standard scrolling
    if (e.ctrlKey || e.altKey) {
      e.preventDefault();
      const delta = e.deltaY > 0 ? 0.8 : 1.25;
      const container = containerRef.current;
      const currentTime = useProjectStore.getState().currentTime;
      const oldPps = ppsRef.current;
      const newPps = Math.max(5, Math.min(500, oldPps * delta));
      ppsRef.current = newPps;
      // Flush React render synchronously so new pps layout is committed before we
      // correct scrollLeft — this prevents the one-frame "teleport" artifact
      flushSync(() => setPps(newPps));
      if (container) {
        container.scrollLeft += currentTime * (newPps - oldPps);
      }
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



  // Calculate generic markers interval – memoized so they don't recompute every render
  const END_PADDING = 400; // Extra padding so user can scroll past the end naturally
  const totalWidth = useMemo(() => duration * pps + TRACK_OFFSET + END_PADDING, [duration, pps]);
  const interval = useMemo(() => pps < 10 ? 60 : pps < 50 ? 10 : pps < 100 ? 5 : 1, [pps]);

  // Generate ticks
  const ticks = useMemo(() => {
    const result: number[] = [];
    for (let t = 0; t <= duration; t += interval) {
      result.push(t);
    }
    return result;
  }, [duration, interval]);

  // tracksHeight no longer needed for marker lines (they use bottom:0)

  return (
    <div
      className="timeline"
      ref={containerRef}
      id="timeline"
      onWheel={handleWheel}
      onScroll={handleScrollPersist}
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
            const newTime = (pointerX - TRACK_OFFSET) / pps;
            const prev = lastHoveredTimeRef.current;
            // Only update store if moved more than 2px – avoids 60fps store writes on every mouse pixel
            if (prev === null || Math.abs(newTime - prev) > 2 / pps) {
              lastHoveredTimeRef.current = newTime;
              setHoveredTime(newTime);
            }
          } else if (lastHoveredTimeRef.current !== null) {
            lastHoveredTimeRef.current = null;
            setHoveredTime(null);
          }
        }}
        onMouseLeave={() => { lastHoveredTimeRef.current = null; setHoveredTime(null); }}
        style={{ width: `${totalWidth}px`, position: 'relative', minHeight: '100%', touchAction: 'none' }}
      >
        {/* Time ruler */}
        <div className="timeline-ruler" style={{ height: '24px', borderBottom: '1px solid #334155', position: 'sticky', top: 0, backgroundColor: 'rgba(15, 15, 25, 0.95)', zIndex: 20, overflow: 'hidden' }}>
          {trimStart > 0 && (
            <div style={{ position: 'absolute', left: TRACK_OFFSET, top: 0, width: trimStart * pps, height: '100%', background: 'rgba(0,0,0,0.35)', pointerEvents: 'none', zIndex: 21 }} />
          )}
          {trimEnd < duration && (
            <div style={{ position: 'absolute', left: trimEnd * pps + TRACK_OFFSET, top: 0, right: 0, height: '100%', background: 'rgba(0,0,0,0.35)', pointerEvents: 'none', zIndex: 21 }} />
          )}
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
              <TimelineMarkerBlock key={m.id} m={m} pps={pps} onUpdate={updateMarker} />
            ))}
          </div>
          <TimelineTrimHandle time={trimStart} pps={pps} color="#fb7185" onUpdate={updateTrimStart} />
          <TimelineTrimHandle time={trimEnd} pps={pps} color="#38bdf8" onUpdate={updateTrimEnd} />
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

        {trimStart > 0 && (
          <div style={{ position: 'absolute', left: TRACK_OFFSET, top: 24, width: trimStart * pps, bottom: 0, background: 'rgba(0,0,0,0.22)', pointerEvents: 'none', zIndex: 4 }} />
        )}
        {trimEnd < duration && (
          <div style={{ position: 'absolute', left: trimEnd * pps + TRACK_OFFSET, top: 24, right: 0, bottom: 0, background: 'rgba(0,0,0,0.22)', pointerEvents: 'none', zIndex: 4 }} />
        )}

        {/* Marker vertical lines layer — rendered here (not inside the ruler) to avoid inflating scroll height */}
        {markers.map((m) => {
          const isSelected = selectedMarkerIds.includes(m.id);
          return (
            <div
              key={m.id}
              style={{
                position: 'absolute',
                left: m.time * pps + TRACK_OFFSET,
                top: 24,
                bottom: 0,
                width: '2px',
                transform: 'translateX(-50%)',
                backgroundColor: isSelected ? m.color : `${m.color}80`,
                pointerEvents: 'none',
                zIndex: 15,
              }}
            />
          );
        })}

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

        {characters.map((char) => {
          const isCharSelected = selectedCharacterId === char.id;
          const sel = laneSelection?.charId === char.id ? laneSelection : null;
          const selStart = sel ? Math.min(sel.startTime, sel.endTime) : 0;
          const selEnd = sel ? Math.max(sel.startTime, sel.endTime) : 0;
          const selWidth = (selEnd - selStart) * pps;
          return (
          <div key={char.id} className="timeline-lane" style={{ position: 'relative', height: '60px', borderBottom: '1px solid rgba(255,255,255,0.05)', backgroundColor: isCharSelected ? `${char.color}10` : 'transparent', cursor: 'default' }}>
            <div
              className="lane-header"
              onClick={() => selectCharacter(char.id)}
              style={{ position: 'sticky', left: 0, width: `${TRACK_OFFSET}px`, height: '100%', backgroundColor: isCharSelected ? `${char.color}22` : '#0f0f1e', zIndex: 30, padding: '0 8px', display: 'flex', alignItems: 'center', borderRight: `2px solid ${char.color}`, borderBottom: '1px solid rgba(255,255,255,0.02)', cursor: 'pointer', userSelect: 'none', transition: 'background-color 0.15s' }}
              title={isCharSelected ? `Layer ${char.name} selected` : `Select layer ${char.name} (default for new dialogues)`}
            >
              <span style={{ color: isCharSelected ? '#fff' : '#cbd5e1', fontSize: '11px', fontWeight: isCharSelected ? 'bold' : 'normal', textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap' }}>{char.name}</span>
              {isCharSelected && <span style={{ marginLeft: '4px', fontSize: '8px', color: char.color, flexShrink: 0 }}>●</span>}
            </div>

            {/* Drag-select background capture overlay (behind dialogue blocks) */}
            <div
              style={{ position: 'absolute', left: TRACK_OFFSET, top: 0, right: 0, bottom: 0, zIndex: 6 }}
              onPointerDown={(e) => handleLanePointerDown(e, char.id)}
              onPointerMove={handleLanePointerMove}
              onPointerUp={(e) => handleLanePointerUp(e, char.id)}
            />

            {/* Visual drag selection rectangle */}
            {sel && selWidth > 4 && (
              <div style={{
                position: 'absolute',
                left: selStart * pps + TRACK_OFFSET,
                top: 2,
                width: selWidth,
                height: 'calc(100% - 4px)',
                backgroundColor: `${char.color}20`,
                border: `1px dashed ${char.color}cc`,
                borderRadius: '3px',
                zIndex: 20,
                pointerEvents: 'none',
              }}>
                <span style={{ position: 'absolute', right: 4, top: 2, fontSize: '9px', color: char.color, fontFamily: 'monospace', userSelect: 'none' }}>
                  {(selEnd - selStart).toFixed(2)}s
                </span>
              </div>
            )}

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
          );
        })}
      </div>
    </div>
  );
};

export default Timeline;
