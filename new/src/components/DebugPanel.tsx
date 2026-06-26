import React, { useState } from 'react';
import { HINT_DEBUG_BUILD_TIME } from '../lib/hintDebug';
import { getVideoElement, seekVideo } from '../lib/video';

interface Props {
  targetId: string;
  currentTime: number;
  duration: number;
}

export function DebugPanel({
  targetId,
  currentTime,
  duration,
}: Props) {
  const [seekText, setSeekText] = useState('0');
  const video = getVideoElement(targetId);

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
      <div style={{ fontSize: 11, opacity: 0.75 }}>
        Build: {formatBuildTime(HINT_DEBUG_BUILD_TIME)}
      </div>
    </div>
  );
}

function formatBuildTime(value: string) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleString();
}

const rowStyle: React.CSSProperties = {
  display: 'flex',
  gap: 8,
};
