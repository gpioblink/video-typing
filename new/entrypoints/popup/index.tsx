import React, { useCallback, useEffect, useMemo, useState } from 'react';
import ReactDOM from 'react-dom/client';
import {
  clearStoredProgressState,
  clearStoredSubtitleSetting,
  loadStoredSubtitle,
  loadStoredTypingProgress,
} from '../../src/lib/storage';
import {
  createStoredSubtitleUnknownWordCsvRows,
  createUnknownWordCsv,
} from '../../src/lib/localPlayerReview';
import { subtitleCueToCaptionFrame } from '../../src/lib/subtitles';
import type {
  StoredSubtitleData,
  StoredTypingProgressData,
  SubtitleCue,
  TimedCaptionFrame,
} from '../../src/types';
import '../../src/styles/popup.css';

interface TabContext {
  tabId: number;
  url: string;
  title: string;
  video: CurrentVideoInfo | null;
}

interface CurrentVideoInfo {
  title: string;
  url: string;
  thumbnailUrl: string;
  currentTime: number;
  duration: number;
  paused: boolean;
  hasVideo: boolean;
}

interface PopupState {
  loading: boolean;
  context: TabContext | null;
  subtitle: StoredSubtitleData | undefined;
  typingProgress: StoredTypingProgressData;
  status: string;
}

function PopupApp() {
  const [state, setState] = useState<PopupState>({
    loading: true,
    context: null,
    subtitle: undefined,
    typingProgress: {},
    status: '',
  });
  const [showSubtitles, setShowSubtitles] = useState(false);

  const loadState = useCallback(async (status = '') => {
    setState((current) => ({ ...current, loading: true, status }));

    try {
      const context = await loadCurrentTabContext();
      const [subtitle, typingProgress] = await Promise.all([
        loadStoredSubtitle(context.url),
        loadStoredTypingProgress(context.url),
      ]);

      setState({
        loading: false,
        context,
        subtitle,
        typingProgress,
        status,
      });
    } catch (error) {
      setState({
        loading: false,
        context: null,
        subtitle: undefined,
        typingProgress: {},
        status: error instanceof Error ? error.message : 'Failed to load current video.',
      });
    }
  }, []);

  useEffect(() => {
    void loadState();
  }, [loadState]);

  const hasProgress = Object.keys(state.typingProgress).length > 0;
  const videoTitle = state.context?.video?.title || state.context?.title || 'Current tab';
  const thumbnailUrl = state.context?.video?.thumbnailUrl || '';
  const progressSummary = useMemo(() => (
    state.subtitle
      ? summarizeProgress(state.subtitle.cues, state.typingProgress, state.subtitle.typingFrames)
      : ''
  ), [state.subtitle, state.typingProgress]);
  const gameStartedAt = useMemo(() => getGameStartedAt(state.typingProgress), [state.typingProgress]);
  const shouldShowOfflineHistoryButton = !state.loading && !state.context?.video?.hasVideo;

  const startOverlay = async (mode: 'typing' | 'type-review') => {
    if (!state.context) {
      setState((current) => ({ ...current, status: 'No active tab found.' }));
      return;
    }

    try {
      const response = await chrome.runtime.sendMessage({
        type: 'videoTypingStartOverlay',
        tabId: state.context.tabId,
        url: state.context.url,
        mode,
      });

      if (!response?.ok) {
        throw new Error(response?.error || 'Failed to start video-typing.');
      }

      window.close();
    } catch (error) {
      setState((current) => ({
        ...current,
        status: error instanceof Error ? error.message : 'Failed to start video-typing.',
      }));
    }
  };

  const openOfflineGameHistory = () => {
    void chrome.tabs.create({ url: chrome.runtime.getURL('player.html#history') });
    window.close();
  };

  const exportUnknownWordsCsv = () => {
    if (!state.subtitle || !state.context) {
      setState((current) => ({ ...current, status: '字幕データが見つかりません。' }));
      return;
    }

    const rows = createStoredSubtitleUnknownWordCsvRows(state.subtitle, state.typingProgress);
    downloadCsv(videoTitle, createUnknownWordCsv(rows));
    setState((current) => ({
      ...current,
      status: `${rows.length.toLocaleString()} 件の知らなかった単語をCSV出力しました。`,
    }));
  };

  const deleteProgress = async () => {
    if (!state.context) {
      return;
    }

    const confirmed = window.confirm(
      '進捗データを削除します。タイピングゲームの達成状況と再生位置は元に戻せません。\n本当に削除しますか？',
    );

    if (!confirmed) {
      return;
    }

    try {
      await clearStoredProgressState(state.context.url);
      setShowSubtitles(false);
      await loadState('進捗データを削除しました。');
    } catch {
      setState((current) => ({ ...current, status: '進捗データの削除に失敗しました。' }));
    }
  };

  const deleteSubtitle = async () => {
    if (!state.context) {
      return;
    }

    const confirmed = window.confirm(
      '字幕データを削除します。登録済みの字幕情報は元に戻せません。\n本当に削除しますか？',
    );

    if (!confirmed) {
      return;
    }

    try {
      await clearStoredSubtitleSetting(state.context.url);
      setShowSubtitles(false);
      await loadState('字幕データを削除しました。');
    } catch {
      setState((current) => ({ ...current, status: '字幕データの削除に失敗しました。' }));
    }
  };

  return (
    <main className="popupPage">
      <header className="popupHeader">
        <h1>Video Typing</h1>
      </header>

      <section>
        <h2 className="sectionTitle">現在再生中のビデオ</h2>
        <div className="videoCard">
          {thumbnailUrl ? (
            <img className="thumbnail" src={thumbnailUrl} alt="" />
          ) : (
            <div className="thumbnailFallback">No image</div>
          )}
          <div className="videoMeta">
            <p className="videoTitle">{videoTitle}</p>
            <p className="metaLine">
              再生位置 {formatPlaybackPosition(state.context?.video?.currentTime, state.context?.video?.duration)}
            </p>
            {!state.context?.video?.hasVideo && !state.loading ? (
              <p className="metaLine">video 要素が見つかりません。</p>
            ) : null}
          </div>
        </div>
      </section>

      {hasProgress ? (
        <section className="progressBox">
          <strong>達成状況 {progressSummary || '字幕データなし'}</strong>
          <span>ゲーム開始日 {gameStartedAt ? formatDateTime(gameStartedAt) : '未記録'}</span>
        </section>
      ) : null}

      <section className="actions">
        {shouldShowOfflineHistoryButton ? (
          <button className="button primary" type="button" onClick={openOfflineGameHistory}>
            ゲーム履歴
          </button>
        ) : null}
        <button
          className={shouldShowOfflineHistoryButton ? 'button' : 'button primary'}
          type="button"
          disabled={state.loading || !state.context?.video?.hasVideo}
          onClick={() => void startOverlay('typing')}
        >
          {hasProgress ? 'タイピングゲーム再開' : '新規タイピングゲーム'}
        </button>

        {hasProgress ? (
          <>
            <button
              className="button"
              type="button"
              disabled={!state.subtitle}
              onClick={() => void startOverlay('type-review')}
            >
              復習ゲーム
            </button>
            <button
              className="button"
              type="button"
              disabled={!state.subtitle}
              onClick={exportUnknownWordsCsv}
            >
              知らなかった単語をCSV出力
            </button>
            <button
              className="button"
              type="button"
              disabled={!state.subtitle}
              onClick={() => setShowSubtitles((current) => !current)}
            >
              全字幕データを表示
            </button>
            <button className="button danger" type="button" onClick={() => void deleteProgress()}>
              進捗データを削除
            </button>
            <button
              className="button danger"
              type="button"
              disabled={!state.subtitle}
              onClick={() => void deleteSubtitle()}
            >
              字幕データを削除
            </button>
          </>
        ) : null}
      </section>

      {state.status ? <p className="status">{state.status}</p> : null}

      {showSubtitles && state.subtitle ? (
        <SubtitleList cues={state.subtitle.cues} />
      ) : null}
    </main>
  );
}

function SubtitleList({ cues }: { cues: SubtitleCue[] }) {
  return (
    <section className="subtitlePanel">
      {cues.map((cue, index) => (
        <article className="subtitleCue" key={`${cue.start}-${cue.end}-${index}`}>
          <div className="cueMeta">
            #{index + 1} {formatCueTime(cue.start)} - {formatCueTime(cue.end)}
          </div>
          <p className="cueText">{cue.text}</p>
        </article>
      ))}
    </section>
  );
}

async function loadCurrentTabContext(): Promise<TabContext> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

  if (!tab?.id) {
    throw new Error('No active tab found.');
  }

  const [result] = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: getCurrentVideoInfo,
  });
  const video = (result?.result || null) as CurrentVideoInfo | null;
  const url = tab.url || video?.url || '';

  if (!url || url.startsWith('chrome://')) {
    throw new Error('This tab cannot run video-typing.');
  }

  return {
    tabId: tab.id,
    url,
    title: tab.title || video?.title || url,
    video,
  };
}

function getCurrentVideoInfo(): CurrentVideoInfo {
  const videos = Array.from(document.querySelectorAll('video')) as HTMLVideoElement[];
  const video = videos.find((item) => !item.paused)
    || videos.find((item) => item.currentTime > 0)
    || videos
      .slice()
      .sort((left, right) => (
        (right.clientWidth * right.clientHeight) - (left.clientWidth * left.clientHeight)
      ))[0]
    || null;
  const thumbnail = normalizePageUrl(
    video?.poster
      || getMetaContent('meta[property="og:image"]')
      || getMetaContent('meta[name="twitter:image"]')
      || getLinkHref('link[rel="image_src"]')
      || '',
  );

  return {
    title: document.title || location.href,
    url: location.href,
    thumbnailUrl: thumbnail,
    currentTime: Number.isFinite(video?.currentTime) ? video.currentTime : 0,
    duration: Number.isFinite(video?.duration) ? video.duration : 0,
    paused: Boolean(video?.paused),
    hasVideo: Boolean(video),
  };

  function getMetaContent(selector: string) {
    return document.querySelector<HTMLMetaElement>(selector)?.content || '';
  }

  function getLinkHref(selector: string) {
    return document.querySelector<HTMLLinkElement>(selector)?.href || '';
  }

  function normalizePageUrl(value: string) {
    if (!value) {
      return '';
    }

    try {
      return new URL(value, location.href).href;
    } catch {
      return value;
    }
  }
}

function summarizeProgress(
  subtitleCues: SubtitleCue[],
  typingProgress: StoredTypingProgressData,
  typingFrames?: TimedCaptionFrame[],
) {
  const frames = typingFrames || subtitleCues.map((cue) => ({
    ...subtitleCueToCaptionFrame(cue),
    start: cue.start,
    end: cue.end,
  }));
  const completed = frames.filter((frame) => {
    const typeableCount = frame.caption.filter((char) => char.isTypeable).length;
    const progress = typingProgress[frame.id];

    return typeableCount > 0 && (progress?.finishedCharIds.length || 0) >= typeableCount;
  }).length;

  return `${completed.toLocaleString()} / ${frames.length.toLocaleString()} subtitles completed`;
}

function getGameStartedAt(typingProgress: StoredTypingProgressData) {
  const timestamps = Object.values(typingProgress)
    .map((progress) => progress.updatedAt)
    .filter((value): value is number => typeof value === 'number');

  return timestamps.length ? Math.min(...timestamps) : undefined;
}

function formatPlaybackPosition(currentTime?: number, duration?: number) {
  const current = formatCueTime(currentTime || 0);

  if (!duration || !Number.isFinite(duration)) {
    return current;
  }

  return `${current} / ${formatCueTime(duration)}`;
}

function formatCueTime(seconds: number) {
  if (!Number.isFinite(seconds)) {
    return '0:00';
  }

  const wholeSeconds = Math.floor(Math.max(0, seconds));
  const minutes = Math.floor(wholeSeconds / 60);
  const remainingSeconds = wholeSeconds - minutes * 60;

  return `${minutes}:${String(remainingSeconds).padStart(2, '0')}`;
}

function formatDateTime(timestamp: number) {
  return new Date(timestamp).toLocaleString();
}

function sanitizeFileName(value: string) {
  return value.replace(/[\\/:*?"<>|]+/g, '_').trim() || 'video-typing';
}

function downloadCsv(title: string, csv: string) {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');

  link.href = url;
  link.download = `${sanitizeFileName(title)}-unknown-words.csv`;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(<PopupApp />);
