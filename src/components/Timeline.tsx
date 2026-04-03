import React, { useRef, useEffect, useCallback } from 'react';
import { useProjectStore } from '../stores/projectStore';
import { useVideoSync } from '../hooks/useVideoSync';

interface TimelineProps {
  videoSync: ReturnType<typeof useVideoSync>;
}

const Timeline: React.FC<TimelineProps> = ({ videoSync }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const { project } = useProjectStore();
  const { seek, getDuration } = videoSync;
  const { dialogues, characters } = project;
  const duration = getDuration();

  const getCharColor = useCallback(
    (id: string) => characters.find((c) => c.id === id)?.color || '#94a3b8',
    [characters]
  );

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const w = canvas.width / (window.devicePixelRatio || 1);
    const h = canvas.height / (window.devicePixelRatio || 1);
    const dur = duration || 1;
    const { currentTime } = useProjectStore.getState();

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Background
    ctx.fillStyle = 'rgba(15, 15, 25, 0.8)';
    ctx.fillRect(0, 0, w, h);

    // Time markers
    const interval = dur > 300 ? 60 : dur > 60 ? 10 : dur > 10 ? 5 : 1;
    for (let t = 0; t <= dur; t += interval) {
      const x = (t / dur) * w;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, h);
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
      ctx.lineWidth = 0.5;
      ctx.stroke();
    }

    // Dialogue blocks
    dialogues.forEach((d) => {
      const x = (d.start_time / dur) * w;
      const width = Math.max(2, ((d.end_time - d.start_time) / dur) * w);
      const color = getCharColor(d.character_id);

      ctx.fillStyle = hexToRgba(color, 0.5);
      ctx.fillRect(x, 4, width, h - 8);
      ctx.fillStyle = hexToRgba(color, 0.8);
      ctx.fillRect(x, 4, width, 2);
    });

    // Playhead
    const playX = (currentTime / dur) * w;
    ctx.beginPath();
    ctx.moveTo(playX, 0);
    ctx.lineTo(playX, h);
    ctx.strokeStyle = '#ef4444';
    ctx.lineWidth = 2;
    ctx.stroke();
  }, [duration, dialogues, getCharColor]);

  useEffect(() => {
    let frame: number;
    const loop = () => {
      draw();
      frame = requestAnimationFrame(loop);
    };
    frame = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(frame);
  }, [draw]);

  // Resize
  useEffect(() => {
    const resize = () => {
      const canvas = canvasRef.current;
      const container = containerRef.current;
      if (!canvas || !container) return;
      const dpr = window.devicePixelRatio || 1;
      const rect = container.getBoundingClientRect();
      canvas.width = rect.width * dpr;
      canvas.height = 40 * dpr;
      canvas.style.width = `${rect.width}px`;
      canvas.style.height = '40px';
      const ctx = canvas.getContext('2d');
      if (ctx) ctx.scale(dpr, dpr);
    };
    resize();
    window.addEventListener('resize', resize);
    return () => window.removeEventListener('resize', resize);
  }, []);

  // Click to seek
  const handleClick = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      const canvas = canvasRef.current;
      if (!canvas || !duration) return;
      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const time = (x / rect.width) * duration;
      seek(time);
    },
    [duration, seek]
  );

  return (
    <div className="timeline" ref={containerRef} id="timeline">
      <canvas ref={canvasRef} onClick={handleClick} className="timeline-canvas" id="timeline-canvas" />
    </div>
  );
};

function hexToRgba(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export default Timeline;
