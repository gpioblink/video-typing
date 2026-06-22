import React, { useState } from 'react';
import { getVideoElement, seekVideo } from '../lib/video';

interface Props {
  targetId: string;
  currentTime: number;
  duration: number;
  englishHintQueryHistory: string[];
}

export function DebugPanel({
  targetId,
  currentTime,
  duration,
  englishHintQueryHistory,
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
      {englishHintQueryHistory.length > 0 ? (
        <div style={{ display: 'grid', gap: 6, fontSize: 12 }}>
          <div style={{ fontWeight: 600 }}>English hint queries</div>
          <div style={historyListStyle}>
            {englishHintQueryHistory.map((query) => (
              <div key={query} style={historyItemStyle}>
                {query}
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

const rowStyle: React.CSSProperties = {
  display: 'flex',
  gap: 8,
};

const historyListStyle: React.CSSProperties = {
  display: 'grid',
  gap: 4,
  maxHeight: 120,
  overflowY: 'auto',
};

const historyItemStyle: React.CSSProperties = {
  overflowWrap: 'anywhere',
  opacity: 0.85,
};
