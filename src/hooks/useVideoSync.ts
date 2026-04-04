import { useRef, useCallback, useEffect } from 'react';
import { useProjectStore } from '../stores/projectStore';

export function useVideoSync() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const animFrameRef = useRef<number>(0);
  const setCurrentTime = useProjectStore((s) => s.setCurrentTime);
  const setIsPlaying = useProjectStore((s) => s.setIsPlaying);

  const syncLoop = useCallback(() => {
    if (videoRef.current && !videoRef.current.paused) {
      setCurrentTime(videoRef.current.currentTime);
      animFrameRef.current = requestAnimationFrame(syncLoop);
    }
  }, [setCurrentTime]);

  const play = useCallback(async () => {
    const video = videoRef.current;
    if (!video) return;

    // If video hasn't loaded enough data yet, wait for canplay
    if (video.readyState < 3) {
      await new Promise<void>((resolve) => {
        const onReady = () => { video.removeEventListener('canplay', onReady); resolve(); };
        video.addEventListener('canplay', onReady);
        // Safety timeout: don't wait forever
        setTimeout(() => { video.removeEventListener('canplay', onReady); resolve(); }, 5000);
      });
    }

    try {
      await video.play();
      setIsPlaying(true);
      // Start sync loop only when actually playing
      cancelAnimationFrame(animFrameRef.current);
      animFrameRef.current = requestAnimationFrame(syncLoop);
    } catch (err) {
      console.warn('Video play() failed:', err);
      setIsPlaying(false);
    }
  }, [setIsPlaying, syncLoop]);

  const pause = useCallback(() => {
    videoRef.current?.pause();
    cancelAnimationFrame(animFrameRef.current);
    // Sync one last time to get accurate position
    if (videoRef.current) setCurrentTime(videoRef.current.currentTime);
    setIsPlaying(false);
  }, [setIsPlaying, setCurrentTime]);

  const togglePlay = useCallback(() => {
    if (useProjectStore.getState().isPlaying) pause();
    else play();
  }, [play, pause]);

  // Stop sync loop on unmount
  useEffect(() => {
    return () => cancelAnimationFrame(animFrameRef.current);
  }, []);

  const seek = useCallback((time: number) => {
    if (videoRef.current) {
      videoRef.current.currentTime = Math.max(0, Math.min(time, videoRef.current.duration || 0));
      setCurrentTime(videoRef.current.currentTime);
    }
  }, [setCurrentTime]);

  const stepFrame = useCallback((forward: boolean) => {
    const fps = useProjectStore.getState().project.video?.fps || 24;
    const delta = 1 / fps;
    if (videoRef.current) {
      videoRef.current.currentTime += forward ? delta : -delta;
      setCurrentTime(videoRef.current.currentTime);
    }
  }, [setCurrentTime]);

  const setPlaybackRate = useCallback((rate: number) => {
    if (videoRef.current) {
      videoRef.current.playbackRate = rate;
    }
  }, []);

  const getDuration = useCallback(() => {
    return videoRef.current?.duration || useProjectStore.getState().project.video?.duration || 0;
  }, []);

  return {
    videoRef,
    play,
    pause,
    togglePlay,
    seek,
    stepFrame,
    setPlaybackRate,
    setIsPlaying,
    getDuration,
  };
}
