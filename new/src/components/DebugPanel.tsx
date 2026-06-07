import React, { useEffect, useState } from 'react';
import { getVideoElement, seekVideo } from '../lib/video';

interface Props {
  targetId: string;
}

export function DebugPanel({ targetId }: Props) {
  const [seekText, setSeekText] = useState('0');
  const [currentTime, setCurrentTime] = useState(0);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setCurrentTime(getVideoElement(targetId)?.currentTime || 0);
    }, 500);
    return () => {
      window.clearInterval(timer);
    };
  }, [targetId]);

  const video = getVideoElement(targetId);
  const duration = video?.duration || 0;

  return (
    <div style={{ display: 'grid', gap: 8, width: 220, fontFamily: 'system-ui, sans-serif' }}>
      <div style={rowStyle}>
        <button onClick={() => void video?.play()}>Play</button>
        <button onClick={() => video?.pause()}>Pause</button>
      </div>
      <div style={rowStyle}>
        <button onClick={() => seekVideo(targetId, currentTime - 5)}>-5s</button>
        <button onClick={() => seekVideo(targetId, currentTime + 5)}>+5s</button>
      </div>
      <div style={rowStyle}>
        <input
          value={seekText}
          onChange={(event) => setSeekText(event.target.value)}
          style={{ flex: 1, minWidth: 0 }}
        />
        <button onClick={() => seekVideo(targetId, Number(seekText) || 0)}>Go</button>
      </div>
      <div style={{ fontSize: 12, opacity: 0.9 }}>
        {currentTime.toFixed(1)} / {duration.toFixed(1)}
      </div>
    </div>
  );
}

const rowStyle: React.CSSProperties = {
  display: 'flex',
  gap: 8,
};
