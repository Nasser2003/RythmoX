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
          const explicitFontSize = d.font_size ? (d.font_size * scale) : 0;
          const fontSize = explicitFontSize || Math.min(blockH - (8 * scale), 22 * scale);
          ctx.font = `500 ${fontSize}px ${d.font_family || 'sans-serif'}`;
          ctx.textBaseline = 'middle';
          ctx.textAlign = 'left';

          const textWidth = ctx.measureText(d.text).width;
          ctx.save();
          ctx.beginPath();
          ctx.rect(clampedStart, laneY + LANE_PADDING, clampedWidth, blockH);
          ctx.clip();
          ctx.translate(startX + 8, laneY + LANE_HEIGHT / 2);
          const targetWidth = Math.max(1, blockWidth - 16);
          if (textWidth > 0) ctx.scale(targetWidth / textWidth, 1);
          ctx.fillText(d.text, 0, 0);
          ctx.restore();
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
        ctx.fillStyle = m.color;
        ctx.fillRect(mx - 1, 0, 2, overlayHeight);
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
  const [pps, setPps] = useState(150);
  const [gpu, setGpu] = useState<'none' | 'nvenc' | 'qsv' | 'amf'>('none');
  const [availableGpus, setAvailableGpus] = useState<string[] | null>(null);

  // Detect available GPU encoders once on mount
  useEffect(() => {
    invoke<string[]>('detect_gpu_encoders')
      .then(setAvailableGpus)
      .catch(() => setAvailableGpus(['none']));
  }, []);

  // Layout constants
  const LANE_HEIGHT = Math.floor(50 * scale);    
  const LANE_PADDING = Math.floor(8 * scale);      
  const LABEL_WIDTH = Math.floor(120 * scale);     
  const TOP_BORDER = Math.max(1, Math.floor(4 * scale)); 

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
      ctx.fillText('Video Preview', videoWidth / 2, videoHeight / 2);
    }

    // 2. Translate to bottom to overlay Bande Rythmo
    ctx.translate(0, videoHeight - overlayHeight);

    // Transparent strip background
    ctx.fillStyle = 'rgba(10, 12, 24, 0.92)';
    ctx.fillRect(0, 0, overlayWidth, overlayHeight);

    // Draw dialogues at current project time
    drawBande(ctx, currentTime, pps, scale, project, activeCharacters, TRACK_OFFSET_X, overlayWidth, overlayHeight, LABEL_WIDTH, LANE_HEIGHT, LANE_PADDING, TOP_BORDER);

    // UI Panel (labels background)
    ctx.fillStyle = '#0f121a'; 
    ctx.fillRect(0, 0, LABEL_WIDTH, overlayHeight);

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
      ctx.font = `bold ${Math.max(8, 13 * scale)}px sans-serif`;
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
      setError("No video imported.");
      return;
    }

    const outputPath = await save({
      title: 'Export Video',
      filters: [{ name: 'MP4 Video', extensions: ['mp4'] }],
      defaultPath: project.name + '_rythmox.mp4'
    });

    if (!outputPath) return;

    setIsExporting(true);
    setStage('Rendering Bande Rythmo Overlay...');
    setProgress(0);

    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    try {
      const duration = project.video.duration || 60;
      const chunkDuration = 100;
      const numChunks = Math.ceil(duration / chunkDuration);
      const chunkPaths: string[] = [];

      setProgress(5);
      setStage('Generating timeline blocks...');

      for (let c = 0; c < numChunks; c++) {
        const startTime = c * chunkDuration;
        const currentChunkDuration = Math.min(chunkDuration, duration - startTime);
        const chunkWidth = Math.ceil(currentChunkDuration * pps);
        
        canvas.width = chunkWidth;
        canvas.height = overlayHeight;
        ctx.clearRect(0, 0, chunkWidth, overlayHeight);

        drawBande(ctx, startTime, pps, scale, project, activeCharacters, 0, chunkWidth, overlayHeight, 0, LANE_HEIGHT, LANE_PADDING, TOP_BORDER, true);

        const blob = await new Promise<Blob | null>(res => canvas.toBlob(res, "image/png"));
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
      ctx.lineWidth = TOP_BORDER;
      ctx.beginPath();
      ctx.moveTo(0, TOP_BORDER / 2);
      ctx.lineTo(overlayWidth, TOP_BORDER / 2);
      ctx.stroke();

      ctx.fillStyle = '#0f121a'; 
      ctx.fillRect(0, 0, LABEL_WIDTH, overlayHeight);

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
        ctx.font = `bold ${Math.max(8, 13 * scale)}px sans-serif`;
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
      setStage('Compositing in FFmpeg (Fast Mode)...');

      await invoke('export_fast_video', {
        videoPath: project.video.original_path,
        chunkPaths,
        uiPath,
        outputPath,
        duration,
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
            <p style={{ margin: 0, opacity: 0.8, fontSize: '14px' }}>Ajustez l'apparence de la bande avant l'encodage FFmpeg.</p>
            
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
                  <span>Echelle de la bande (Zoom Vertical)</span>
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
                  <span>Vitesse de défilement (Zoom Horizontal)</span>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                    <input
                      type="number"
                      min="10"
                      max="2000"
                      step="10"
                      value={pps}
                      onChange={(e) => {
                        const v = parseInt(e.target.value);
                        if (!isNaN(v) && v >= 10) setPps(v);
                      }}
                      style={{ width: '64px', background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.2)', borderRadius: '4px', color: '#4ade80', fontSize: '13px', padding: '2px 6px', textAlign: 'right', outline: 'none' }}
                    />
                    <span style={{ color: '#4ade80', fontSize: '13px' }}>px/s</span>
                  </div>
                </label>
                <input type="range" min="50" max="400" step="10" value={Math.min(pps, 400)} onChange={(e) => setPps(parseInt(e.target.value))} style={rangeStyle} />
              </div>
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '13px', marginBottom: '8px', fontWeight: '500' }}>
                Accélération matérielle (GPU)
              </label>
              {availableGpus === null ? (
                <div style={{ fontSize: '12px', opacity: 0.5, padding: '8px 0' }}>Détection du matériel...</div>
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
                        title={isAvailable ? undefined : 'Non disponible sur ce système'}
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
                        <span style={{ opacity: 0.6, fontSize: '10px' }}>{isAvailable ? opt.desc : 'indisponible'}</span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            <div style={{ marginTop: '10px', display: 'flex', gap: '12px' }}>
              <button className="btn btn-primary" style={{ flex: 1 }} onClick={startExport}>Lancer l'Export final</button>
              <button className="btn btn-ghost" onClick={onClose}>Annuler</button>
            </div>
          </div>
        )}

        {isExporting && !error && (
          <div style={{ textAlign: 'center', padding: '20px 0' }}>
            <p style={{ fontWeight: '500', marginBottom: '15px' }}>{stage}</p>
            <div style={{ width: '100%', backgroundColor: 'rgba(255,255,255,0.1)', height: '12px', borderRadius: '6px', overflow: 'hidden', boxShadow: 'inset 0 1px 3px rgba(0,0,0,0.5)' }}>
              <div style={{ width: `${progress}%`, backgroundColor: '#4ade80', height: '100%', transition: 'width 0.3s ease-out', boxShadow: '0 0 10px rgba(74, 222, 128, 0.5)' }} />
            </div>
            <p style={{ marginTop: '10px', fontSize: '12px', opacity: 0.6 }}>{Math.round(progress)}% complété</p>
          </div>
        )}

        {error && (
          <div style={{ padding: '10px', border: '1px solid #ef4444', borderRadius: '8px', backgroundColor: 'rgba(239, 68, 68, 0.1)' }}>
            <h4 style={{ color: '#ef4444', marginTop: 0 }}>Export Failed</h4>
            <p style={{ color: '#f87171', fontSize: '12px', wordBreak: 'break-all' }}>{error}</p>
            <button className="btn btn-ghost" onClick={onClose} style={{ marginTop: '10px' }}>Fermer</button>
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
