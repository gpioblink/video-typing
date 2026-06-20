import React, { useState } from 'react';
import { getVideoElement, seekVideo } from '../lib/video';
import { isChineseTypingJsonFile, parseChineseTypingJson } from '../lib/chineseTyping';
import { parseSubtitleFile } from '../lib/subtitles';
import type { SubtitleCue, TimedCaptionFrame } from '../types';

interface Props {
  targetId: string;
  currentTime: number;
  duration: number;
  subtitleFileName: string;
  subtitleError: string;
  onSubtitleLoaded: (cues: SubtitleCue[], fileName: string, typingFrames?: TimedCaptionFrame[]) => void;
  onSubtitleError: (message: string) => void;
}

export function DebugPanel({
  targetId,
  currentTime,
  duration,
  subtitleFileName,
  subtitleError,
  onSubtitleLoaded,
  onSubtitleError,
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
      <label style={{ display: 'grid', gap: 6, fontSize: 12 }}>
        <span>Subtitle file</span>
        <input
          type="file"
          accept=".srt,.vtt,.ttml,.xml,.txt,.json"
          onChange={async (event) => {
            const file = event.target.files?.[0];

            if (!file) {
              return;
            }

            try {
              const text = await file.text();

              if (isChineseTypingJsonFile(file.name)) {
                const chineseTypingJson = parseChineseTypingJson(file.name, text);
                const sourceSubtitleFile = await selectSourceSubtitleFile();

                if (!sourceSubtitleFile) {
                  onSubtitleError('Original Chinese subtitle file is required.');
                  return;
                }

                const sourceText = await sourceSubtitleFile.text();
                const sourceCues = parseSubtitleFile(sourceSubtitleFile.name, sourceText);

                if (sourceCues.length === 0) {
                  onSubtitleError('No usable original subtitle cues found.');
                } else {
                  onSubtitleLoaded(sourceCues, sourceSubtitleFile.name, chineseTypingJson.typingFrames);
                }
                return;
              }

              const cues = parseSubtitleFile(file.name, text);

              if (cues.length === 0) {
                onSubtitleError('No usable subtitle cues found.');
              } else {
                onSubtitleLoaded(cues, file.name);
              }
            } catch {
              onSubtitleError('Failed to read subtitle file.');
            }

            event.target.value = '';
          }}
        />
      </label>
      <div style={{ fontSize: 11, opacity: 0.75 }}>
        {subtitleFileName || 'No subtitle loaded'}
      </div>
      {subtitleError ? (
        <div style={{ fontSize: 11, color: '#ff8f8f' }}>{subtitleError}</div>
      ) : null}
    </div>
  );
}

const rowStyle: React.CSSProperties = {
  display: 'flex',
  gap: 8,
};

function selectSourceSubtitleFile(): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.srt,.vtt,.ttml,.xml,.txt';
    input.style.display = 'none';
    input.addEventListener('change', () => {
      const file = input.files?.[0] || null;
      input.remove();
      resolve(file);
    });
    document.body.append(input);
    input.click();
  });
}
