import React, { useRef, useEffect, useCallback } from 'react';
import { useProjectStore } from '../stores/projectStore';
import type { Character } from '../types/project';

const BandeRythmo: React.FC = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const animRef = useRef<number>(0);
  const { project, selectDialogue } = useProjectStore();
  const { settings } = project;

  const getCharacter = useCallback(
    (id: string, chars: Character[]): Character | undefined => chars.find((c) => c.id === id),
    []
  );

  const drawBand = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Pull immediate state without causing re-renders
    const state = useProjectStore.getState();
    const { currentTime, selectedDialogueId, project } = state;
    const { settings, dialogues, characters } = project;

    const { width, height } = canvas;
    const { scroll_speed, font_size, font_family, show_timecodes } = settings;

    // The playhead is at center
    const playheadX = width / 2;

    // -- Clear --
    ctx.clearRect(0, 0, width, height);

    // -- Background gradient --
    const bgGrad = ctx.createLinearGradient(0, 0, 0, height);
    bgGrad.addColorStop(0, 'rgba(15, 15, 25, 0.95)');
    bgGrad.addColorStop(0.5, 'rgba(20, 20, 40, 0.98)');
    bgGrad.addColorStop(1, 'rgba(15, 15, 25, 0.95)');
    ctx.fillStyle = bgGrad;
    ctx.fillRect(0, 0, width, height);

    // -- Top and bottom border glow --
    const borderGrad = ctx.createLinearGradient(0, 0, width, 0);
    borderGrad.addColorStop(0, 'rgba(99, 102, 241, 0.0)');
    borderGrad.addColorStop(0.3, 'rgba(99, 102, 241, 0.4)');
    borderGrad.addColorStop(0.5, 'rgba(139, 92, 246, 0.6)');
    borderGrad.addColorStop(0.7, 'rgba(99, 102, 241, 0.4)');
    borderGrad.addColorStop(1, 'rgba(99, 102, 241, 0.0)');
    ctx.fillStyle = borderGrad;
    ctx.fillRect(0, 0, width, 2);
    ctx.fillRect(0, height - 2, width, 2);

    // -- Time grid lines --
    if (show_timecodes) {
      const startTime = Math.max(0, currentTime - (playheadX / scroll_speed) - 1);
      const endTime = currentTime + ((width - playheadX) / scroll_speed) + 1;

      for (let t = Math.floor(startTime); t <= Math.ceil(endTime); t++) {
        const x = playheadX + (t - currentTime) * scroll_speed;
        if (x < -10 || x > width + 10) continue;

        const isWholeSecond = t % 1 === 0;
        const isFiveSeconds = t % 5 === 0;

        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, height);
        ctx.strokeStyle = isFiveSeconds
          ? 'rgba(99, 102, 241, 0.25)'
          : 'rgba(255, 255, 255, 0.06)';
        ctx.lineWidth = isFiveSeconds ? 1.5 : 0.5;
        ctx.stroke();

        // Time label every 5 seconds
        if (isFiveSeconds && isWholeSecond) {
          const minutes = Math.floor(t / 60);
          const seconds = t % 60;
          const label = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
          ctx.fillStyle = 'rgba(148, 163, 184, 0.5)';
          ctx.font = '10px Inter, sans-serif';
          ctx.textAlign = 'center';
          ctx.fillText(label, x, 14);
        }
      }
    }

    // -- Draw dialogues --
    dialogues.forEach((dialogue) => {
      const character = getCharacter(dialogue.character_id, characters);
      const color = character?.color || '#94a3b8';

      // Calculate x positions
      const startX = playheadX + (dialogue.start_time - currentTime) * scroll_speed;
      const endX = playheadX + (dialogue.end_time - currentTime) * scroll_speed;
      const dialogueWidth = endX - startX;

      // Skip if off-screen
      if (endX < -50 || startX > width + 50) return;

      // Dialogue background
      const isSelected = dialogue.id === selectedDialogueId;
      ctx.fillStyle = isSelected
        ? hexToRgba(color, 0.25)
        : hexToRgba(color, 0.12);
      ctx.beginPath();
      roundRect(ctx, startX, 24, dialogueWidth, height - 48, 6);
      ctx.fill();

      // Dialogue border (top)
      ctx.fillStyle = hexToRgba(color, isSelected ? 0.9 : 0.6);
      ctx.fillRect(startX, 24, dialogueWidth, 3);

      // Character name label
      if (character && dialogueWidth > 40) {
        ctx.fillStyle = hexToRgba(color, 0.9);
        ctx.font = `bold 11px ${font_family}, sans-serif`;
        ctx.textAlign = 'left';
        const nameText = character.name.toUpperCase();
        ctx.fillText(nameText, startX + 8, 42);
      }

      // Dialogue text — spread across the duration
      if (dialogue.text && dialogueWidth > 20) {
        const usedFont = dialogue.font_family || font_family;
        const usedSize = dialogue.font_size || font_size;
        ctx.fillStyle = '#e2e8f0';
        ctx.font = `${usedSize}px ${usedFont}, sans-serif`;
        ctx.textAlign = 'left';

        // Letter spacing: spread text across width
        const text = dialogue.text;
        const textWidth = ctx.measureText(text).width;
        const availableWidth = dialogueWidth - 16;
        const textY = height / 2 + usedSize / 3;

        if (textWidth <= availableWidth) {
          // Spread letters evenly
          const spacing = text.length > 1 ? (availableWidth - textWidth) / (text.length - 1) : 0;
          let xPos = startX + 8;
          for (let i = 0; i < text.length; i++) {
            ctx.fillText(text[i], xPos, textY);
            xPos += ctx.measureText(text[i]).width + spacing;
          }
        } else {
          // Text too long, just draw normally (will clip)
          ctx.save();
          ctx.beginPath();
          ctx.rect(startX + 4, 20, dialogueWidth - 8, height - 40);
          ctx.clip();
          ctx.fillText(text, startX + 8, textY);
          ctx.restore();
        }
      }

      // Draw rythmo symbols
      dialogue.symbols.forEach((sym) => {
        const symX = playheadX + (sym.time - currentTime) * scroll_speed;
        if (symX < startX - 10 || symX > endX + 10) return;

        let icon = '';
        switch (sym.symbol_type) {
          case 'breath': icon = '⟡'; break;
          case 'pause': icon = '‖'; break;
          case 'laugh': icon = '😄'; break;
          case 'cry': icon = '😢'; break;
          case 'noise': icon = '♪'; break;
        }
        ctx.fillStyle = hexToRgba(color, 0.7);
        ctx.font = '14px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(icon, symX, height - 12);
      });
    });

    // -- Playhead (red vertical line) --
    // Glow effect
    const glowGrad = ctx.createRadialGradient(playheadX, height / 2, 0, playheadX, height / 2, 30);
    glowGrad.addColorStop(0, 'rgba(239, 68, 68, 0.3)');
    glowGrad.addColorStop(1, 'rgba(239, 68, 68, 0)');
    ctx.fillStyle = glowGrad;
    ctx.fillRect(playheadX - 30, 0, 60, height);

    // Main line
    ctx.beginPath();
    ctx.moveTo(playheadX, 0);
    ctx.lineTo(playheadX, height);
    ctx.strokeStyle = '#ef4444';
    ctx.lineWidth = 2.5;
    ctx.shadowColor = '#ef4444';
    ctx.shadowBlur = 8;
    ctx.stroke();
    ctx.shadowBlur = 0;

    // Playhead triangle
    ctx.beginPath();
    ctx.moveTo(playheadX - 8, 0);
    ctx.lineTo(playheadX + 8, 0);
    ctx.lineTo(playheadX, 10);
    ctx.closePath();
    ctx.fillStyle = '#ef4444';
    ctx.fill();
  }, [getCharacter]);

  // Animation loop
  useEffect(() => {
    const render = () => {
      drawBand();
      animRef.current = requestAnimationFrame(render);
    };
    animRef.current = requestAnimationFrame(render);
    return () => cancelAnimationFrame(animRef.current);
  }, [drawBand]);

  // Resize canvas to container
  useEffect(() => {
    const resize = () => {
      const container = containerRef.current;
      const canvas = canvasRef.current;
      if (!container || !canvas) return;

      const dpr = window.devicePixelRatio || 1;
      const rect = container.getBoundingClientRect();
      canvas.width = rect.width * dpr;
      canvas.height = settings.band_height * dpr;
      canvas.style.width = `${rect.width}px`;
      canvas.style.height = `${settings.band_height}px`;

      const ctx = canvas.getContext('2d');
      if (ctx) ctx.scale(dpr, dpr);
      // Re-set logical dimensions for drawing
      canvas.width = rect.width * dpr;
      canvas.height = settings.band_height * dpr;
      const ctx2 = canvas.getContext('2d');
      if (ctx2) ctx2.scale(dpr, dpr);
    };

    resize();
    window.addEventListener('resize', resize);
    return () => window.removeEventListener('resize', resize);
  }, [settings.band_height]);

  // Handle click on canvas to select dialogue
  const handleCanvasClick = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      const canvas = canvasRef.current;
      if (!canvas) return;

      const state = useProjectStore.getState();
      const { currentTime, project } = state;
      const { settings, dialogues } = project;

      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const playheadX = rect.width / 2;
      const { scroll_speed } = settings;

      // Find clicked dialogue
      const clickedTime = currentTime + (x - playheadX) / scroll_speed;
      const clicked = dialogues.find(
        (d) => clickedTime >= d.start_time && clickedTime <= d.end_time
      );
      selectDialogue(clicked?.id || null);
    },
    [selectDialogue]
  );

  return (
    <div className="bande-rythmo" ref={containerRef} id="bande-rythmo">
      <canvas
        ref={canvasRef}
        className="bande-canvas"
        onClick={handleCanvasClick}
        id="bande-canvas"
      />
    </div>
  );
};

// -- Helpers --

function hexToRgba(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
) {
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.arcTo(x + w, y, x + w, y + r, r);
  ctx.lineTo(x + w, y + h - r);
  ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
  ctx.lineTo(x + r, y + h);
  ctx.arcTo(x, y + h, x, y + h - r, r);
  ctx.lineTo(x, y + r);
  ctx.arcTo(x, y, x + r, y, r);
}

export default BandeRythmo;
