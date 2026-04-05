import React, { useRef, useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { useProjectStore } from '../stores/projectStore';
import { save } from '@tauri-apps/plugin-dialog';

// Helper for translucent backgrounds
const hexToRgba = (hex: string, alpha: number) => {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
};

// Common drawing utility for both preview and final export images
const drawBande = (
  ctx: CanvasRenderingContext2D,
  time: number,
  pps: number,
  scale: number,
  project: any,
  activeCharacters: any[],
  TRACK_OFFSET_X: number,
  overlayWidth: number,
  overlayHeight: number,
  LABEL_WIDTH: number,
  LANE_HEIGHT: number,
  LANE_PADDING: number,
  TOP_BORDER: number,
  isAbsMode = false
) => {
  try {
    activeCharacters.forEach((char, i) => {
      const laneY = TOP_BORDER + i * LANE_HEIGHT;
      const blockH = LANE_HEIGHT - LANE_PADDING * 2;

      project.dialogues.filter((d: any) => d.character_id === char.id).forEach((d: any) => {
        const absStartX = d.start_time * pps;
        const absEndX = d.end_time * pps;
        
        let startX, endX;
        if (isAbsMode) {
          startX = absStartX - (time * pps);
          endX = absEndX - (time * pps);
        } else {
          startX = TRACK_OFFSET_X + (d.start_time - time) * pps;
          endX = TRACK_OFFSET_X + (d.end_time - time) * pps;
        }

        const blockWidth = endX - startX;
        if (endX < LABEL_WIDTH && !isAbsMode) return;
        if (startX > overlayWidth) return;

        const clampedStart = isAbsMode ? Math.max(startX, 0) : Math.max(startX, LABEL_WIDTH);
        const clampedWidth = (isAbsMode ? Math.min(endX, overlayWidth) : Math.min(endX, overlayWidth)) - clampedStart;

        if (clampedWidth <= 0) return;

        ctx.fillStyle = hexToRgba(char.color, 0.25);
        ctx.fillRect(clampedStart, laneY + LANE_PADDING, clampedWidth, blockH);

        ctx.fillStyle = char.color;
        ctx.fillRect(clampedStart, laneY + LANE_PADDING, clampedWidth, 3);

        if (d.text && blockWidth > 20) {
          ctx.fillStyle = '#ffffff';
          const fontSize = Math.min(blockH, 28 * scale);
          const fontStyle = d.italic ? 'italic ' : '';
          const fontWeight = d.bold ? 'bold' : '500';
          ctx.font = `${fontStyle}${fontWeight} ${fontSize}px ${d.font_family || 'sans-serif'}`;
          ctx.textBaseline = 'middle';
          ctx.textAlign = 'left';

          const cuts: Array<{ position: number; char_index?: number }> = (d.visual_cuts || [])
            .slice()
            .sort((a: any, b: any) => a.position - b.position);

          if (cuts.length === 0) {
            // Single-stretch: no visual cuts
            const textWidth = ctx.measureText(d.text).width;
            ctx.save();
            ctx.beginPath();
            ctx.rect(clampedStart, laneY + LANE_PADDING, clampedWidth, blockH);
            ctx.clip();
            ctx.translate(startX + 8, laneY + LANE_HEIGHT / 2);
            const targetWidth = Math.max(1, blockWidth - 16);
            if (textWidth > 0) ctx.scale(targetWidth / textWidth, 1);
            ctx.fillText(d.text, 0, 0);
            if (d.underline) ctx.fillRect(0, fontSize * 0.2, textWidth, Math.max(1, fontSize * 0.08));
            if (d.crossed) ctx.fillRect(0, -fontSize * 0.35, textWidth, Math.max(1, fontSize * 0.08));
            ctx.restore();
          } else {
            // Segmented rendering: each zone stretched independently (mirrors buildDialogueTextSegments)
            const leftPad = 8;
            const rightPad = 8;
            const contentWidth = Math.max(1, blockWidth - leftPad - rightPad);
            const segmentGap = Math.min(8, Math.max(4, blockWidth * 0.015));
            const usableWidth = Math.max(1, contentWidth - cuts.length * segmentGap);

            const normalizedCuts = cuts.map((cut) => ({
              position: Math.max(0.02, Math.min(0.98, cut.position)),
              char_index: cut.char_index,
            }));

            const boundaries = [0, ...normalizedCuts.map((cut) => cut.position), 1];
            const totalChars = d.text.length;
            const charBoundaries = [0];
            for (let idx = 0; idx < normalizedCuts.length; idx++) {
              const cut = normalizedCuts[idx];
              const rawIndex = typeof cut.char_index === 'number'
                ? cut.char_index
                : Math.round(totalChars * cut.position);
              const prev = charBoundaries[charBoundaries.length - 1];
              const remaining = normalizedCuts.length - idx - 1;
              const maxIdx = Math.max(prev, totalChars - remaining);
              charBoundaries.push(Math.max(prev, Math.min(maxIdx, rawIndex)));
            }
            charBoundaries.push(totalChars);

            const textY = laneY + LANE_HEIGHT / 2;
            let cursorX = leftPad;

            boundaries.slice(0, -1).forEach((_start, index) => {
              const end = boundaries[index + 1];
              const segWidth = Math.max(1, usableWidth * (end - boundaries[index]));
              const segText = d.text.slice(charBoundaries[index], charBoundaries[index + 1]);
              const segX = startX + cursorX;

              if (segText && segWidth >= 4) {
                const segTextWidth = ctx.measureText(segText).width;
                ctx.save();
                ctx.beginPath();
                ctx.rect(segX, laneY + LANE_PADDING, segWidth, blockH);
                ctx.clip();
                ctx.translate(segX, textY);
                if (segTextWidth > 0) ctx.scale(segWidth / segTextWidth, 1);
                ctx.fillText(segText, 0, 0);
                if (d.underline) ctx.fillRect(0, fontSize * 0.2, segTextWidth, Math.max(1, fontSize * 0.08));
                if (d.crossed) ctx.fillRect(0, -fontSize * 0.35, segTextWidth, Math.max(1, fontSize * 0.08));
                ctx.restore();
              }

              cursorX += segWidth + segmentGap;
            });
          }
        }
      });
    });

    project.markers.forEach((m: any) => {
      let mx;
      if (isAbsMode) {
        mx = (m.time - time) * pps;
      } else {
        mx = TRACK_OFFSET_X + (m.time - time) * pps;
      }
      if (mx >= (isAbsMode ? 0 : LABEL_WIDTH) && mx <= overlayWidth) {
        // Marker line
        ctx.fillStyle = m.color;
        ctx.fillRect(mx - 1, 0, 2, overlayHeight);

        // Marker label
        if (m.label) {
          const fontSize = Math.max(9, Math.round(11 * scale));
          ctx.font = `600 ${fontSize}px sans-serif`;
          ctx.textBaseline = 'top';
          ctx.textAlign = 'left';
          const padding = 3;
          const textW = ctx.measureText(m.label).width;
          // Background pill so label is readable over video
          ctx.fillStyle = m.color;
          ctx.fillRect(mx + 2, 2, textW + padding * 2, fontSize + padding * 2);
          ctx.fillStyle = '#000000';
          ctx.fillText(m.label, mx + 2 + padding, 2 + padding);
        }
      }
    });

  } catch (err) {
    console.error("render error", err);
  }
};

const ExportModal: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const { project, currentTime, videoUrl } = useProjectStore();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const previewCanvasRef = useRef<HTMLCanvasElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);

  const [redrawTrigger, setRedrawTrigger] = useState(0);

  const [progress, setProgress] = useState(0);
  const [stage, setStage] = useState('Initializing...');
  const [isExporting, setIsExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [scale, setScale] = useState(1.0);
  const [pps, setPps] = useState(200);
  const [gpu, setGpu] = useState<'none' | 'nvenc' | 'qsv' | 'amf'>('none');
  const [availableGpus, setAvailableGpus] = useState<string[] | null>(null);
  const trimStart = Math.max(0, Math.min(project.video?.duration || 0, project.settings.export_start || 0));
  const trimEndValue = project.settings.export_end && project.settings.export_end > 0 ? project.settings.export_end : (project.video?.duration || 0);
  const trimEnd = Math.max(trimStart + 0.1, Math.min(project.video?.duration || trimEndValue, trimEndValue));
  const exportDuration = Math.max(0.1, trimEnd - trimStart);

  // Detect available GPU encoders once on mount
  useEffect(() => {
    invoke<string[]>('detect_gpu_encoders')
      .then(setAvailableGpus)
      .catch(() => setAvailableGpus(['none']));
  }, []);

  // Layout constants
  const LANE_HEIGHT = Math.floor(50 * scale);    
  const LANE_PADDING = 0;      
  const LABEL_WIDTH = Math.floor(120 * scale);     
  const TOP_BORDER = Math.max(20, Math.floor(22 * scale)); 

  const activeCharacters = project.characters.filter(char => 
    project.dialogues.some(d => d.character_id === char.id)
  );
  const numChars = activeCharacters.length;
  const overlayHeight = numChars * LANE_HEIGHT + TOP_BORDER;
  const overlayWidth = project.video?.resolution?.[0] || 1920;

  const TRACK_WIDTH = overlayWidth - LABEL_WIDTH;
  const TRACK_OFFSET_X = LABEL_WIDTH + TRACK_WIDTH / 3;

  // Sync hidden video time
  useEffect(() => {
    if (videoRef.current) {
      if (Math.abs(videoRef.current.currentTime - currentTime) > 0.1) {
        videoRef.current.currentTime = currentTime;
      }
    }
  }, [currentTime]);

  // Real-time Preview logic
  useEffect(() => {
    const canvas = previewCanvasRef.current;
    if (!canvas || isExporting) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const videoWidth = project.video?.resolution?.[0] || 1920;
    const videoHeight = project.video?.resolution?.[1] || 1080;

    const displayW = canvas.clientWidth * 2; // high-dpi
    const drawScale = displayW / Math.max(1, videoWidth);
    const displayH = Math.ceil(videoHeight * drawScale);

    canvas.width = displayW;
    canvas.height = displayH;

    ctx.clearRect(0, 0, displayW, displayH);
    ctx.fillStyle = '#0A0C18';
    ctx.fillRect(0, 0, displayW, displayH);

    ctx.save();
    ctx.scale(drawScale, drawScale);
    
    // 1. Draw Video Frame
    if (videoRef.current && videoRef.current.readyState >= 2) {
      ctx.drawImage(videoRef.current, 0, 0, videoWidth, videoHeight);
    } else {
      ctx.fillStyle = '#1e293b';
      ctx.fillRect(0, 0, videoWidth, videoHeight);
      ctx.fillStyle = '#94a3b8';
      ctx.font = '50px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('Video preview', videoWidth / 2, videoHeight / 2);
    }

    // 2. Translate to bottom to overlay Bande Rythmo
    ctx.translate(0, videoHeight - overlayHeight);

    // Transparent strip background
    ctx.fillStyle = 'rgba(10, 12, 24, 0.92)';
    ctx.fillRect(0, 0, overlayWidth, overlayHeight);

    // Draw dialogues at current project time
    drawBande(ctx, currentTime, pps, scale, project, activeCharacters, TRACK_OFFSET_X, overlayWidth, overlayHeight, LABEL_WIDTH, LANE_HEIGHT, LANE_PADDING, TOP_BORDER);

    // UI Panel (labels background - starts below marker header strip)
    ctx.fillStyle = '#0f121a'; 
    ctx.fillRect(0, TOP_BORDER, LABEL_WIDTH, overlayHeight - TOP_BORDER);

    ctx.strokeStyle = '#475569';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(LABEL_WIDTH, 0);
    ctx.lineTo(LABEL_WIDTH, overlayHeight);
    ctx.stroke();

    // Red playhead line
    ctx.strokeStyle = '#ef4444';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(TRACK_OFFSET_X, 0);
    ctx.lineTo(TRACK_OFFSET_X, overlayHeight);
    ctx.stroke();

    // Character labels
    activeCharacters.forEach((char, i) => {
      const laneY = TOP_BORDER + i * LANE_HEIGHT;
      ctx.fillStyle = char.color;
      ctx.font = `bold ${Math.max(10, 16 * scale)}px sans-serif`;
      ctx.textBaseline = 'middle';
      ctx.textAlign = 'left';
      ctx.fillText(char.name, 8 * scale, laneY + LANE_HEIGHT / 2, LABEL_WIDTH - (16 * scale));
    });

    ctx.restore();
  }, [scale, pps, currentTime, project, activeCharacters, isExporting, overlayHeight, overlayWidth, TRACK_OFFSET_X, LABEL_WIDTH, LANE_HEIGHT, LANE_PADDING, TOP_BORDER, redrawTrigger]);

  useEffect(() => {
    const unlisten = listen<{ percent: number, stage: string }>('export-progress', (event) => {
      const { percent, stage: stageMsg } = event.payload;
      setStage(stageMsg);
      const mapped = 45 + (percent * 0.55);
      setProgress(mapped);
    });

    return () => {
      unlisten.then(f => f());
    };
  }, []);

  const startExport = async () => {
    if (!project.video?.original_path) {
      setError('No video imported.');
      return;
    }

    const outputPath = await save({
      title: 'Export Video',
      filters: [{ name: 'MP4 Video', extensions: ['mp4'] }],
      defaultPath: project.name + '_rythmox.mp4'
    });

    if (!outputPath) return;

    setIsExporting(true);
    setStage('Rendering Bande Rythmo overlay...');
    setProgress(0);

    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    try {
      const duration = exportDuration;
      // Single mega-chunk: reduces FFmpeg overlay chain depth from N+2 to 3,
      // and eliminates redundant canvas renders + IPC calls.
      // WebView2 (Chromium) handles canvases up to ~40 000px wide without issues.
      const MAX_CHUNK_PX = 40000;
      const chunkDuration = Math.min(duration, Math.max(1, Math.floor(MAX_CHUNK_PX / pps)));
      const numChunks = Math.ceil(duration / chunkDuration);
      const chunkPaths: string[] = [];

      setProgress(5);
setStage(`Generating timeline strip (${numChunks} chunk${numChunks > 1 ? 's' : ''})...`);

      for (let c = 0; c < numChunks; c++) {
        const startTime = c * chunkDuration;
        const sourceTime = trimStart + startTime;
        const currentChunkDuration = Math.min(chunkDuration, duration - startTime);
        const chunkWidth = Math.ceil(currentChunkDuration * pps);
        
        canvas.width = chunkWidth;
        canvas.height = overlayHeight;
        ctx.clearRect(0, 0, chunkWidth, overlayHeight);
        // Opaque dark background so JPEG encoding works correctly
        ctx.fillStyle = '#0a0c18';
        ctx.fillRect(0, 0, chunkWidth, overlayHeight);

        drawBande(ctx, sourceTime, pps, scale, project, activeCharacters, 0, chunkWidth, overlayHeight, 0, LANE_HEIGHT, LANE_PADDING, TOP_BORDER, true);

        // JPEG: 5-10× faster than PNG, 3-5× smaller → much faster IPC transfer
        // Quality 0.85 is visually identical to 0.92 for synthetic content (text/colors)
        const blob = await new Promise<Blob | null>(res => canvas.toBlob(res, 'image/jpeg', 0.85));
        if (blob) {
          const arrayBuffer = await blob.arrayBuffer();
          const path = await invoke<string>('save_image_chunk', { data: Array.from(new Uint8Array(arrayBuffer)), suffix: c.toString() });
          chunkPaths.push(path);
        }
        setProgress(5 + ((c + 1) / numChunks) * 35);
      }

      setStage('Generating UI overlay...');
      canvas.width = overlayWidth;
      canvas.height = overlayHeight;
      ctx.clearRect(0, 0, overlayWidth, overlayHeight);

      ctx.strokeStyle = '#334155';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(0, 1);
      ctx.lineTo(overlayWidth, 1);
      ctx.stroke();

      ctx.fillStyle = '#0f121a'; 
      ctx.fillRect(0, TOP_BORDER, LABEL_WIDTH, overlayHeight - TOP_BORDER);

      ctx.strokeStyle = '#475569';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(LABEL_WIDTH, 0);
      ctx.lineTo(LABEL_WIDTH, overlayHeight);
      ctx.stroke();

      ctx.strokeStyle = '#ef4444';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(TRACK_OFFSET_X, 0);
      ctx.lineTo(TRACK_OFFSET_X, overlayHeight);
      ctx.stroke();

      activeCharacters.forEach((char, i) => {
        const laneY = TOP_BORDER + i * LANE_HEIGHT;
        if (i > 0) {
          ctx.strokeStyle = 'rgba(51,65,85,0.5)';
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(0, laneY);
          ctx.lineTo(overlayWidth, laneY);
          ctx.stroke();
        }
        ctx.fillStyle = char.color;
        ctx.font = `bold ${Math.max(10, 16 * scale)}px sans-serif`;
        ctx.textBaseline = 'middle';
        ctx.textAlign = 'left';
        ctx.fillText(char.name, 8 * scale, laneY + LANE_HEIGHT / 2, LABEL_WIDTH - (16 * scale));
      });

      const uiBlob = await new Promise<Blob | null>(res => canvas.toBlob(res, "image/png"));
      let uiPath = '';
      if (uiBlob) {
        const arrayBuffer = await uiBlob.arrayBuffer();
        uiPath = await invoke<string>('save_image_chunk', { data: Array.from(new Uint8Array(arrayBuffer)), suffix: 'ui' });
      }

      setProgress(45);
      setStage('Compositing in FFmpeg (fast mode)...');

      await invoke('export_fast_video', {
        videoPath: project.video.original_path,
        chunkPaths,
        uiPath,
        outputPath,
        duration,
        trimStart,
        pps,
        chunkDuration,
        trackOffsetX: TRACK_OFFSET_X,
        overlayWidth,
        overlayHeight,
        gpu,
      });

      setStage('Done!');
      setProgress(100);
      setTimeout(onClose, 2000);

    } catch (err: any) {
      setError(err.toString());
    }
  };

  return (
    <div style={modalOverlayStyle}>
      <div style={modalStyle} className="glass-card">
        <h3 style={{ margin: 0, fontSize: '20px', fontWeight: '600' }}>Export Video</h3>

        {!isExporting && !error && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
            <p style={{ margin: 0, opacity: 0.8, fontSize: '14px' }}>Adjust the strip appearance before FFmpeg encoding.</p>
            
            {/* Preview Box */}
            <div style={{
              width: '100%',
              backgroundColor: '#0A0C18',
              borderRadius: '8px',
              border: '1px solid rgba(255,255,255,0.15)',
              overflow: 'hidden',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              boxShadow: '0 4px 20px rgba(0,0,0,0.4), inset 0 0 20px rgba(0,0,0,0.5)',
              aspectRatio: project.video?.resolution ? `${project.video.resolution[0]} / ${project.video.resolution[1]}` : '16/9'
            }}>
              <canvas ref={previewCanvasRef} style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
              <div>
                <label style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '13px', marginBottom: '8px', fontWeight: '500' }}>
                  <span>Strip Scale (Vertical Zoom)</span>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                    <input
                      type="number"
                      min="10"
                      max="500"
                      step="10"
                      value={Math.round(scale * 100)}
                      onChange={(e) => {
                        const v = parseInt(e.target.value);
                        if (!isNaN(v) && v >= 10) setScale(v / 100);
                      }}
                      style={{ width: '64px', background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.2)', borderRadius: '4px', color: '#4ade80', fontSize: '13px', padding: '2px 6px', textAlign: 'right', outline: 'none' }}
                    />
                    <span style={{ color: '#4ade80', fontSize: '13px' }}>%</span>
                  </div>
                </label>
                <input type="range" min="0.5" max="2.0" step="0.1" value={Math.min(scale, 2.0)} onChange={(e) => setScale(parseFloat(e.target.value))} style={rangeStyle} />
              </div>
              
              <div>
                <label style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '13px', marginBottom: '8px', fontWeight: '500' }}>
                  <span>Scroll speed (Horizontal Zoom)</span>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                    <input
                      type="number"
                      min="100"
                      max="500"
                      step="10"
                      value={pps}
                      onChange={(e) => {
                        const v = parseInt(e.target.value);
                        if (!isNaN(v) && v >= 100 && v <= 500) setPps(v);
                      }}
                      style={{ width: '64px', background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.2)', borderRadius: '4px', color: '#4ade80', fontSize: '13px', padding: '2px 6px', textAlign: 'right', outline: 'none' }}
                    />
                    <span style={{ color: '#4ade80', fontSize: '13px' }}>px/s</span>
                  </div>
                </label>
                <input type="range" min="100" max="500" step="10" value={Math.min(Math.max(pps, 100), 500)} onChange={(e) => setPps(parseInt(e.target.value))} style={rangeStyle} />
              </div>
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '13px', marginBottom: '8px', fontWeight: '500' }}>
                Hardware Acceleration (GPU)
              </label>
              {availableGpus === null ? (
                <div style={{ fontSize: '12px', opacity: 0.5, padding: '8px 0' }}>Detecting hardware...</div>
              ) : (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '8px' }}>
                  {([
                    { value: 'none',  label: 'CPU',    desc: 'libx264' },
                    { value: 'nvenc', label: 'NVIDIA', desc: 'h264_nvenc' },
                    { value: 'qsv',   label: 'Intel',  desc: 'h264_qsv' },
                    { value: 'amf',   label: 'AMD',    desc: 'h264_amf' },
                  ] as const).map(opt => {
                    const isAvailable = availableGpus.includes(opt.value);
                    return (
                      <button
                        key={opt.value}
                        onClick={() => isAvailable && setGpu(opt.value)}
                        disabled={!isAvailable}
                        title={isAvailable ? undefined : 'Not available on this system'}
                        style={{
                          display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '2px',
                          padding: '8px 4px', borderRadius: '6px', cursor: isAvailable ? 'pointer' : 'not-allowed',
                          fontSize: '12px',
                          border: gpu === opt.value ? '1px solid #4ade80' : '1px solid rgba(255,255,255,0.15)',
                          background: gpu === opt.value ? 'rgba(74,222,128,0.12)' : 'rgba(255,255,255,0.05)',
                          color: isAvailable
                            ? (gpu === opt.value ? '#4ade80' : 'rgba(255,255,255,0.7)')
                            : 'rgba(255,255,255,0.25)',
                          transition: 'all 0.15s',
                          opacity: isAvailable ? 1 : 0.45,
                        }}
                      >
                        <span style={{ fontWeight: '600' }}>{opt.label}</span>
                        <span style={{ opacity: 0.6, fontSize: '10px' }}>{isAvailable ? opt.desc : 'unavailable'}</span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            <div style={{ marginTop: '10px', display: 'flex', gap: '12px' }}>
              <button className="btn btn-primary" style={{ flex: 1 }} onClick={startExport}>Start Final Export</button>
              <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
            </div>
          </div>
        )}

        {isExporting && !error && (
          <div style={{ textAlign: 'center', padding: '20px 0' }}>
            <p style={{ fontWeight: '500', marginBottom: '15px' }}>{stage}</p>
            <div style={{ width: '100%', backgroundColor: 'rgba(255,255,255,0.1)', height: '12px', borderRadius: '6px', overflow: 'hidden', boxShadow: 'inset 0 1px 3px rgba(0,0,0,0.5)' }}>
              <div style={{ width: `${progress}%`, backgroundColor: '#4ade80', height: '100%', transition: 'width 0.3s ease-out', boxShadow: '0 0 10px rgba(74, 222, 128, 0.5)' }} />
            </div>
            <p style={{ marginTop: '10px', fontSize: '12px', opacity: 0.6 }}>{Math.round(progress)}% complete</p>
          </div>
        )}

        {error && (
          <div style={{ padding: '10px', border: '1px solid #ef4444', borderRadius: '8px', backgroundColor: 'rgba(239, 68, 68, 0.1)' }}>
            <h4 style={{ color: '#ef4444', marginTop: 0 }}>Export Failed</h4>
            <p style={{ color: '#f87171', fontSize: '12px', wordBreak: 'break-all' }}>{error}</p>
            <button className="btn btn-ghost" onClick={onClose} style={{ marginTop: '10px' }}>Close</button>
          </div>
        )}

        <canvas ref={canvasRef} style={{ display: 'none' }} />
        <video 
          ref={videoRef} 
          src={videoUrl || undefined} 
          style={{ display: 'none' }} 
          onSeeked={() => setRedrawTrigger(v => v + 1)}
          onCanPlay={() => setRedrawTrigger(v => v + 1)}
        />
      </div>
    </div>
  );
};

const modalOverlayStyle: React.CSSProperties = {
  position: 'fixed',
  top: 0, left: 0, right: 0, bottom: 0,
  backgroundColor: 'rgba(0,0,0,0.85)',
  backdropFilter: 'blur(4px)',
  zIndex: 1000,
  display: 'flex',
  justifyContent: 'center',
  alignItems: 'center',
  padding: '20px'
};

const modalStyle: React.CSSProperties = {
  width: '100%',
  maxWidth: '600px',
  padding: '30px',
  display: 'flex',
  flexDirection: 'column',
  gap: '20px',
  border: '1px solid rgba(255,255,255,0.1)'
};

const rangeStyle: React.CSSProperties = {
  width: '100%',
  accentColor: '#4ade80',
  cursor: 'pointer'
};

export default ExportModal;
