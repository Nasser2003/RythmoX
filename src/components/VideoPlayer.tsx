import React from 'react';
import { useVideoSync } from '../hooks/useVideoSync';
import { useProjectStore } from '../stores/projectStore';

interface VideoPlayerProps {
  videoSync: ReturnType<typeof useVideoSync>;
}

const VideoPlayer: React.FC<VideoPlayerProps> = ({ videoSync }) => {
  const { videoUrl } = useProjectStore();
  const { videoRef, togglePlay, setIsPlaying } = videoSync;

  React.useEffect(() => {
    if (videoUrl) console.log('[VideoPlayer] videoUrl =', videoUrl);
  }, [videoUrl]);

  return (
    <div className="video-player" id="video-player">
      {videoUrl ? (
        <video
          ref={videoRef}
          src={videoUrl}
          className="video-element"
          preload="auto"
          onClick={togglePlay}
          onEnded={() => setIsPlaying(false)}
          onError={(e) => {
            const v = e.currentTarget;
            const err = v.error;
            console.error('[VideoPlayer] Video error:', err?.code, err?.message, 'src=', v.src);
          }}
          onLoadedMetadata={() => {
            // Update duration from actual video if needed
            const store = useProjectStore.getState();
            if (videoRef.current && store.project.video) {
              const realDuration = videoRef.current.duration;
              if (Math.abs(realDuration - store.project.video.duration) > 1) {
                store.updateSettings({});
              }
            }
          }}
        />
      ) : (
        <div className="video-placeholder" onClick={() => useProjectStore.getState().importVideo()}>
          <div className="placeholder-icon">🎬</div>
          <div className="placeholder-text">Click to import a video</div>
          <div className="placeholder-subtext">Supports MP4, MOV, MKV, AVI, and more</div>
        </div>
      )}
    </div>
  );
};

export default VideoPlayer;
