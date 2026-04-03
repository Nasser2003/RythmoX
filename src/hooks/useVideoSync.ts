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
    }
    animFrameRef.current = requestAnimationFrame(syncLoop);
  }, [setCurrentTime]);

  useEffect(() => {
    animFrameRef.current = requestAnimationFrame(syncLoop);
    return () => cancelAnimationFrame(animFrameRef.current);
  }, [syncLoop]);

  const play = useCallback(() => {
    videoRef.current?.play();
    setIsPlaying(true);
  }, [setIsPlaying]);

  const pause = useCallback(() => {
    videoRef.current?.pause();
    setIsPlaying(false);
  }, [setIsPlaying]);

  const togglePlay = useCallback(() => {
    if (useProjectStore.getState().isPlaying) pause();
    else play();
  }, [play, pause]);

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
