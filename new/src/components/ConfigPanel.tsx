import React, { useRef, useState } from 'react';
import { HINT_DEBUG_BUILD_TIME } from '../lib/hintDebug';
import { parseSubtitleFile } from '../lib/subtitles';
import type { OverlayConfig, SubtitleCue } from '../types';

interface Props {
  config: OverlayConfig;
  currentCueNumber: number | null;
  cueCount: number;
  subtitleFileName: string;
  displaySubtitleFileName?: string;
  netflixSubtitleTracks?: Array<{
    id: string;
    label: string;
  }>;
  onConfigChange: (config: OverlayConfig) => void;
  onJumpToCue: (cueNumber: number) => void;
  canResetCurrentCueState: boolean;
  onResetCurrentCueState: () => void;
  onDisplaySubtitleChange: (fileName: string, cues: SubtitleCue[]) => Promise<void> | void;
  onLoadNetflixSubtitleTracks?: () => Promise<Array<{
    id: string;
    label: string;
  }>>;
  onNetflixSubtitleTrackChange?: (trackId: string) => Promise<void>;
}

const SUBTITLE_ACCEPT = '.srt,.vtt,.ttml,.xml,.txt';

export function ConfigPanel({
  config,
  currentCueNumber,
  cueCount,
  subtitleFileName,
  displaySubtitleFileName,
  netflixSubtitleTracks,
  onConfigChange,
  onJumpToCue,
  canResetCurrentCueState,
  onResetCurrentCueState,
  onDisplaySubtitleChange,
  onLoadNetflixSubtitleTracks,
  onNetflixSubtitleTrackChange,
}: Props) {
  const [cueText, setCueText] = useState('1');
  const [subtitleStatus, setSubtitleStatus] = useState('');
  const [loadedNetflixSubtitleTracks, setLoadedNetflixSubtitleTracks] = useState(netflixSubtitleTracks || []);
  const [selectedNetflixSubtitleTrackId, setSelectedNetflixSubtitleTrackId] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const availableNetflixSubtitleTracks = netflixSubtitleTracks || loadedNetflixSubtitleTracks;

  const patchConfig = (patch: Partial<OverlayConfig>) => {
    onConfigChange({
      ...config,
      ...patch,
      slowPlayback: {
        ...config.slowPlayback,
        ...patch.slowPlayback,
      },
      nativeReplay: {
        ...config.nativeReplay,
        ...patch.nativeReplay,
      },
    });
  };

  const handleNativeSubtitleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';

    if (!file) {
      return;
    }

    try {
      const cues = parseSubtitleFile(file.name, await file.text());

      if (cues.length === 0) {
        setSubtitleStatus('No usable subtitle cues found.');
        return;
      }

      await onDisplaySubtitleChange(file.name, cues);
      setSubtitleStatus(`Loaded ${cues.length.toLocaleString()} cues.`);
    } catch {
      setSubtitleStatus('Failed to load subtitle file.');
    }
  };

  const handleLoadNetflixSubtitleTracks = async () => {
    if (!onLoadNetflixSubtitleTracks) {
      return;
    }

    try {
      setSubtitleStatus('Loading Netflix subtitles...');
      const tracks = await onLoadNetflixSubtitleTracks();
      setLoadedNetflixSubtitleTracks(tracks);
      setSubtitleStatus(tracks.length > 0
        ? `Loaded ${tracks.length.toLocaleString()} Netflix subtitle tracks.`
        : 'No selectable Netflix subtitles found.');
    } catch {
      setSubtitleStatus('Failed to load Netflix subtitle tracks.');
    }
  };

  const handleNetflixSubtitleTrackChange = async (event: React.ChangeEvent<HTMLSelectElement>) => {
    const trackId = event.target.value;
    setSelectedNetflixSubtitleTrackId(trackId);

    if (!trackId || !onNetflixSubtitleTrackChange) {
      return;
    }

    try {
      setSubtitleStatus('Changing Netflix subtitle...');
      await onNetflixSubtitleTrackChange(trackId);
      setSubtitleStatus('Netflix subtitle changed.');
    } catch {
      setSubtitleStatus('Failed to change Netflix subtitle.');
    }
  };

  return (
    <div style={panelStyle}>
      <section style={sectionStyle}>
        <div style={sectionHeaderStyle}>
          <strong>Subtitle navigation</strong>
          <span style={mutedStyle}>Cue {currentCueNumber ?? '-'} / {cueCount}</span>
        </div>
        <div style={rowStyle}>
          <input
            value={cueText}
            onChange={(event) => setCueText(event.target.value)}
            style={inputStyle}
            aria-label="Cue number"
            inputMode="numeric"
          />
          <button
            type="button"
            disabled={cueCount === 0}
            onClick={() => onJumpToCue(Number(cueText))}
            style={buttonStyle}
          >
            Jump cue
          </button>
        </div>
        <button
          type="button"
          disabled={!canResetCurrentCueState}
          onClick={onResetCurrentCueState}
          style={{ ...buttonStyle, width: '100%' }}
        >
          Reset current cue
        </button>
      </section>

      <section style={sectionStyle}>
        <div style={sectionHeaderStyle}>
          <strong>Mistake behavior</strong>
        </div>
        <label style={checkRowStyle}>
          <input
            type="checkbox"
            checked={config.slowPlayback.enabled}
            onChange={(event) => patchConfig({
              slowPlayback: { ...config.slowPlayback, enabled: event.target.checked },
            })}
          />
          <span>Use 0.5x playback after mistakes</span>
        </label>
        <NumberSetting
          label="0.5x starts at mistake"
          value={config.slowPlayback.mistakeThreshold}
          disabled={!config.slowPlayback.enabled}
          onChange={(mistakeThreshold) => patchConfig({
            slowPlayback: { ...config.slowPlayback, mistakeThreshold },
          })}
        />
        <label style={checkRowStyle}>
          <input
            type="checkbox"
            checked={config.nativeReplay.mistakeReplayEnabled}
            onChange={(event) => patchConfig({
              nativeReplay: { ...config.nativeReplay, mistakeReplayEnabled: event.target.checked },
            })}
          />
          <span>Replay native audio after mistakes</span>
        </label>
        <NumberSetting
          label="Native audio starts at mistake"
          value={config.nativeReplay.mistakeThreshold}
          disabled={!config.nativeReplay.mistakeReplayEnabled}
          onChange={(mistakeThreshold) => patchConfig({
            nativeReplay: { ...config.nativeReplay, mistakeThreshold },
          })}
        />
        <NumberSetting
          label="Then replay every"
          suffix="mistakes"
          value={config.nativeReplay.mistakeInterval}
          disabled={!config.nativeReplay.mistakeReplayEnabled}
          onChange={(mistakeInterval) => patchConfig({
            nativeReplay: { ...config.nativeReplay, mistakeInterval },
          })}
        />
        <label style={checkRowStyle}>
          <input
            type="checkbox"
            checked={config.nativeReplay.completionReplayEnabled}
            onChange={(event) => patchConfig({
              nativeReplay: { ...config.nativeReplay, completionReplayEnabled: event.target.checked },
            })}
          />
          <span>Replay native audio after completing a cue</span>
        </label>
      </section>

      <section style={sectionStyle}>
        <div style={sectionHeaderStyle}>
          <strong>Subtitle files</strong>
        </div>
        <FileNameRow label="Typing" value={subtitleFileName} />
        <FileNameRow label="Native" value={displaySubtitleFileName || 'Typing subtitle is shown.'} />
        <input
          ref={fileInputRef}
          type="file"
          accept={SUBTITLE_ACCEPT}
          onChange={handleNativeSubtitleFileChange}
          style={{ display: 'none' }}
        />
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          style={{ ...buttonStyle, width: '100%' }}
        >
          Change native subtitle
        </button>
        {onLoadNetflixSubtitleTracks ? (
          <>
            <button
              type="button"
              onClick={handleLoadNetflixSubtitleTracks}
              style={{ ...buttonStyle, width: '100%' }}
            >
              Load Netflix subtitles
            </button>
            {availableNetflixSubtitleTracks.length > 0 ? (
              <select
                value={selectedNetflixSubtitleTrackId}
                onChange={handleNetflixSubtitleTrackChange}
                style={selectStyle}
                aria-label="Netflix subtitle track"
              >
                <option value="">Choose Netflix subtitle...</option>
                {availableNetflixSubtitleTracks.map((track) => (
                  <option key={track.id} value={track.id}>{track.label}</option>
                ))}
              </select>
            ) : null}
          </>
        ) : null}
        {subtitleStatus ? <div style={mutedStyle}>{subtitleStatus}</div> : null}
      </section>

      <div style={buildStyle}>Build: {formatBuildTime(HINT_DEBUG_BUILD_TIME)}</div>
    </div>
  );
}

function FileNameRow({ label, value }: { label: string; value: string }) {
  return (
    <div style={fileNameRowStyle}>
      <span style={fileNameLabelStyle}>{label}</span>
      <span style={fileNameStyle}>{value}</span>
    </div>
  );
}

function NumberSetting({
  label,
  suffix,
  value,
  disabled,
  onChange,
}: {
  label: string;
  suffix?: string;
  value: number;
  disabled?: boolean;
  onChange: (value: number) => void;
}) {
  return (
    <label style={numberRowStyle}>
      <span>{label}</span>
      <span style={numberControlStyle}>
        <input
          type="number"
          min={1}
          step={1}
          value={value}
          disabled={disabled}
          onChange={(event) => {
            const nextValue = Math.max(1, Math.round(Number(event.target.value) || 1));
            onChange(nextValue);
          }}
          style={{ ...inputStyle, width: 72 }}
        />
        {suffix ? <span style={mutedStyle}>{suffix}</span> : null}
      </span>
    </label>
  );
}

function formatBuildTime(value: string) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleString();
}

const panelStyle: React.CSSProperties = {
  display: 'grid',
  gap: 12,
  width: '100%',
  minWidth: 0,
  fontFamily: 'system-ui, sans-serif',
  color: '#ecf2f1',
};

const sectionStyle: React.CSSProperties = {
  display: 'grid',
  gap: 8,
  padding: 12,
  border: '1px solid rgba(236, 242, 241, 0.14)',
  borderRadius: 8,
  background: 'rgba(255, 255, 255, 0.04)',
};

const sectionHeaderStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 10,
  fontSize: 13,
};

const rowStyle: React.CSSProperties = {
  display: 'flex',
  gap: 8,
};

const checkRowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  fontSize: 13,
  lineHeight: 1.35,
};

const numberRowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 12,
  fontSize: 13,
};

const numberControlStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  flexShrink: 0,
};

const inputStyle: React.CSSProperties = {
  flex: 1,
  minWidth: 0,
  boxSizing: 'border-box',
  border: '1px solid rgba(236, 242, 241, 0.28)',
  borderRadius: 6,
  padding: '7px 8px',
  background: '#162229',
  color: '#ecf2f1',
};

const selectStyle: React.CSSProperties = {
  ...inputStyle,
  width: '100%',
};

const buttonStyle: React.CSSProperties = {
  border: '1px solid rgba(236, 242, 241, 0.24)',
  borderRadius: 6,
  padding: '7px 10px',
  background: '#314650',
  color: '#ecf2f1',
  cursor: 'pointer',
  fontWeight: 700,
};

const mutedStyle: React.CSSProperties = {
  fontSize: 12,
  opacity: 0.72,
};

const fileNameStyle: React.CSSProperties = {
  ...mutedStyle,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
};

const fileNameRowStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '64px minmax(0, 1fr)',
  alignItems: 'center',
  gap: 8,
};

const fileNameLabelStyle: React.CSSProperties = {
  fontSize: 12,
  fontWeight: 700,
  opacity: 0.82,
};

const buildStyle: React.CSSProperties = {
  ...mutedStyle,
  padding: '0 2px',
};
