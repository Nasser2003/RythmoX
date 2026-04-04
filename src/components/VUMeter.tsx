import React, { useEffect, useRef } from 'react';

interface VUMeterProps {
  videoRef: React.RefObject<HTMLVideoElement | null>;
}

const VUMeter: React.FC<VUMeterProps> = ({ videoRef }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const sourceRef = useRef<MediaElementAudioSourceNode | null>(null);
  const animationRef = useRef<number | null>(null);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const setupAudio = () => {
      try {
        if (!audioCtxRef.current) {
          audioCtxRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
          analyserRef.current = audioCtxRef.current.createAnalyser();
          analyserRef.current.fftSize = 256;
          analyserRef.current.smoothingTimeConstant = 0.5;

          sourceRef.current = audioCtxRef.current.createMediaElementSource(video);
          sourceRef.current.connect(analyserRef.current);
          analyserRef.current.connect(audioCtxRef.current.destination);
        }
      } catch (err) {
        console.warn('VU Meter audio context failed (likely CORS or interaction requirement):', err);
      }
    };

    // Chrome requires interaction to start AudioContext, but since it's connected to a video,
    // we try to set it up when the video starts playing or metadata loads.
    const handleInit = () => {
      setupAudio();
      if (audioCtxRef.current && audioCtxRef.current.state === 'suspended') {
        audioCtxRef.current.resume();
      }
    };

    video.addEventListener('play', handleInit);
    video.addEventListener('loadedmetadata', handleInit);

    const dataArray = new Uint8Array(128);
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');

    const render = () => {
      if (analyserRef.current && ctx && canvas) {
        analyserRef.current.getByteFrequencyData(dataArray);

        let sum = 0;
        // Focus on lower to mid frequencies for general volume
        for (let i = 0; i < 40; i++) {
          sum += dataArray[i];
        }
        const average = sum / 40;
        const volume = average / 255; // 0 to 1

        const w = canvas.width;
        const h = canvas.height;
        ctx.clearRect(0, 0, w, h);

        // Draw meter background
        ctx.fillStyle = 'rgba(0,0,0,0.3)';
        ctx.fillRect(0, 0, w, h);

        // Gradient for VU Meter
        const grad = ctx.createLinearGradient(0, h, 0, 0);
        grad.addColorStop(0, '#22c55e'); // Green
        grad.addColorStop(0.6, '#eab308'); // Yellow
        grad.addColorStop(0.9, '#ef4444'); // Red

        const barH = volume * h;
        ctx.fillStyle = grad;
        ctx.fillRect(0, h - barH, w, barH);

        // Peek indicator line
        ctx.fillStyle = volume > 0.8 ? '#fff' : 'rgba(255,255,255,0.2)';
        ctx.fillRect(0, h - barH - 2, w, 2);
      }
      animationRef.current = requestAnimationFrame(render);
    };

    animationRef.current = requestAnimationFrame(render);

    return () => {
      video.removeEventListener('play', handleInit);
      video.removeEventListener('loadedmetadata', handleInit);
      if (animationRef.current) cancelAnimationFrame(animationRef.current);
    };
  }, [videoRef]);

  return (
    <div style={{ width: '12px', height: '100%', padding: '2px', backgroundColor: '#0f0f1e', borderRadius: '2px', border: '1px solid rgba(255,255,255,0.1)' }}>
      <canvas ref={canvasRef} width={10} height={200} style={{ width: '100%', height: '100%', display: 'block' }} />
    </div>
  );
};

export default VUMeter;
