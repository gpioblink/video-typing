import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { OverlayApp } from './OverlayApp';
import { RECOMMENDED_VIDEOS, type RecommendedVideo } from '../data/recommendedVideos';
import { parseYouTubeId, type PracticeClip } from '../lib/clips';
import { selectClipCues } from '../lib/clipSelection';
import { ClipSession, createHtml5Adapter, type ClipSnapshot } from '../lib/playback';
import { createYouTubeAdapter } from '../lib/youtubePlayer';
import { registerPlaybackTarget } from '../lib/video';
import { parseSubtitleFile, subtitleCueToCaptionFrame } from '../lib/subtitles';
import { importDictionaryTsv } from '../lib/dictionary';
import type { StoredTypingProgressData, SubtitleCue } from '../types';
import '../styles/player.css';
import '../styles/quick-play.css';

interface Selection {
  id: string;
  title: string;
  source: PracticeClip['source'];
  cues: SubtitleCue[];
  fileName: string;
  video?: RecommendedVideo;
}
interface OpenPractice {
  clip: PracticeClip;
  fileName: string;
  video?: RecommendedVideo;
  tutorial: boolean;
  run: number;
}
const TUTORIAL_KEY = 'video-typing-tutorial-v2';
function learned() {
  try {
    return localStorage.getItem(TUTORIAL_KEY) === 'done';
  } catch {
    return false;
  }
}
function time(seconds: number) {
  return `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
}

export function QuickPlayApp({ youtubeEnabled = true }: { youtubeEnabled?: boolean }) {
  const [selection, setSelection] = useState<Selection | null>(null);
  const [active, setActive] = useState<OpenPractice | null>(null);
  const [start, setStart] = useState(0);
  const [end, setEnd] = useState(45);
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const [url, setUrl] = useState('');
  const [customCues, setCustomCues] = useState<SubtitleCue[]>([]);
  const [customFileName, setCustomFileName] = useState('');
  const [withTutorial, setWithTutorial] = useState(() => !learned());
  const generation = useRef(0);
  const request = useRef<AbortController | null>(null);
  const run = useRef(0);
  useEffect(
    () => () => {
      generation.current += 1;
      request.current?.abort();
    },
    [],
  );

  const selectVideo = async (video: RecommendedVideo) => {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    const current = ++generation.current;
    setBusy(true);
    setStatus('字幕を読み込んでいます…');
    setSelection(null);
    const range = video.clips[0];
    setStart(range.start);
    setEnd(range.end);
    try {
      const response = await fetch(video.subtitle.url, { signal: controller.signal });
      if (!response.ok) throw new Error('字幕を読み込めませんでした。もう一度選択してください。');
      const text = await response.text();
      if (text.length > 2_000_000) throw new Error('字幕ファイルが大きすぎます。');
      const cues = parseSubtitleFile(video.subtitle.url, text).map((cue) => ({
        ...cue,
        start: cue.start + video.subtitle.offsetSeconds,
        end: cue.end + video.subtitle.offsetSeconds,
      }));
      if (!cues.length) throw new Error('使用できる字幕がありません。');
      if (current !== generation.current) return;
      setSelection({
        id: video.id,
        title: video.title,
        source: { kind: 'youtube', videoId: video.videoId },
        cues,
        fileName: video.subtitle.url.split('/').pop()!,
        video,
      });
      setStatus('');
    } catch (error) {
      if (current === generation.current && !controller.signal.aborted)
        setStatus((error as Error).message);
    } finally {
      if (current === generation.current) setBusy(false);
    }
  };
  const open = () => {
    if (!selection) return;
    try {
      const cues = selectClipCues(selection.cues, start, end);
      const clip: PracticeClip = {
        id: selection.id,
        title: selection.title,
        description: selection.title,
        source: selection.source,
        language: 'en',
        start,
        end,
        cues,
        sync: { offsetSeconds: 0, showText: false },
      };
      setActive({
        clip,
        fileName: selection.fileName,
        video: selection.video,
        tutorial: withTutorial,
        run: ++run.current,
      });
      setStatus('');
    } catch (error) {
      setStatus((error as Error).message);
    }
  };
  const selectedCues = useMemo(() => {
    try {
      return selection ? selectClipCues(selection.cues, start, end) : [];
    } catch {
      return [];
    }
  }, [selection, start, end]);
  if (active)
    return (
      <NormalPractice
        key={active.run}
        practice={active}
        onBack={() => {
          setActive(null);
          if (learned()) setWithTutorial(false);
        }}
        onRetry={() =>
          setActive({ ...active, tutorial: active.tutorial && !learned(), run: ++run.current })
        }
      />
    );
  return (
    <main className="playerPage">
      <div className="playerShell">
        <header className="playerHeader">
          <h1>Video Typing</h1>
          <span>動画と練習する区間を選んで「開く」</span>
        </header>
        <section className="playerPanel">
          <h2>おすすめクリップ</h2>
          <div className="clipCatalog">
            {RECOMMENDED_VIDEOS.map((video) => (
              <button
                type="button"
                key={video.id}
                className={`clipChoice${selection?.id === video.id ? ' selected' : ''}`}
                onClick={() => void selectVideo(video)}
              >
                <img src={`https://i.ytimg.com/vi/${video.videoId}/mqdefault.jpg`} alt="" />
                <span>
                  <strong>{video.title}</strong>
                  <small>
                    {video.creator} · {video.language.toUpperCase()} · {video.subtitle.license}
                  </small>
                  <small>{video.description}</small>
                </span>
              </button>
            ))}
          </div>
          {selection?.video && (
            <p className="clipAttribution">
              <a href={selection.video.sourceUrl} target="_blank" rel="noreferrer">
                {selection.video.title}
              </a>{' '}
              — {selection.video.attribution} /{' '}
              <a href={selection.video.subtitle.licenseUrl} target="_blank" rel="noreferrer">
                {selection.video.subtitle.license}
              </a>{' '}
              ·{' '}
              <a href="./captions/LICENSE.txt" target="_blank" rel="noreferrer">
                クレジット・変更内容
              </a>{' '}
              ·{' '}
              <a href={selection.video.subtitle.sourceUrl} target="_blank" rel="noreferrer">
                字幕の出典
              </a>
            </p>
          )}
        </section>
        {selection && (
          <section className="playerPanel clipEditor">
            <h2>クリップ選択 — {selection.title}</h2>
            {selection.video && (
              <label>
                おすすめの区間
                <select
                  aria-label="おすすめの区間"
                  onChange={(event) => {
                    const clip = selection.video!.clips.find(
                      (item) => item.id === event.target.value,
                    )!;
                    setStart(clip.start);
                    setEnd(clip.end);
                  }}
                  defaultValue={selection.video.clips[0].id}
                >
                  {selection.video.clips.map((clip) => (
                    <option key={clip.id} value={clip.id}>
                      {clip.title}（{time(clip.start)}–{time(clip.end)}）
                    </option>
                  ))}
                </select>
              </label>
            )}
            <div className="clipRange">
              <label>
                開始秒
                <input
                  aria-label="開始秒"
                  type="number"
                  min="0"
                  step="0.01"
                  value={start}
                  onChange={(event) => setStart(Number(event.target.value))}
                />
              </label>
              <label>
                終了秒
                <input
                  aria-label="終了秒"
                  type="number"
                  min="0"
                  step="0.01"
                  value={end}
                  onChange={(event) => setEnd(Number(event.target.value))}
                />
              </label>
              <span>{(end - start).toFixed(1)} 秒</span>
            </div>
            <div className="clipRange">
              <label>
                開始の字幕
                <select
                  aria-label="開始の字幕"
                  value={String(start)}
                  onChange={(event) => setStart(Number(event.target.value))}
                >
                  <option value={String(start)}>{time(start)}（指定位置）</option>
                  {selection.cues.map((cue, i) => (
                    <option key={i} value={cue.start}>
                      {time(cue.start)} {cue.text.slice(0, 80)}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                終了の字幕
                <select
                  aria-label="終了の字幕"
                  value={String(end)}
                  onChange={(event) => setEnd(Number(event.target.value))}
                >
                  <option value={String(end)}>{time(end)}（指定位置）</option>
                  {selection.cues.map((cue, i) => (
                    <option key={i} value={cue.end}>
                      {time(cue.end)} {cue.text.slice(0, 80)}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <ol className="clipPreview" aria-label="選択区間の字幕">
              {selectedCues.map((cue, i) => (
                <li key={i}>
                  <time>{time(cue.start)}</time>
                  <span>{cue.text}</span>
                </li>
              ))}
            </ol>
            <div className="playerActions">
              <label>
                <input
                  type="checkbox"
                  checked={withTutorial}
                  onChange={(event) => setWithTutorial(event.target.checked)}
                />{' '}
                操作チュートリアル
              </label>
              <button
                type="button"
                className="playerButton primary"
                disabled={busy || !selectedCues.length}
                onClick={open}
              >
                開く
              </button>
            </div>
          </section>
        )}
        {status && <p role={busy ? 'status' : 'alert'}>{status}</p>}
        {youtubeEnabled && (
          <details className="playerPanel">
            <summary>自分のYouTube動画・字幕を使う</summary>
            <p>映像はYouTubeで再生します。ご自身で利用できる字幕ファイルを読み込んでください。</p>
            <label>
              YouTube URL
              <input
                aria-label="YouTube URL"
                value={url}
                maxLength={2048}
                onChange={(event) => setUrl(event.target.value)}
              />
            </label>
            <label>
              字幕ファイル
              <input
                aria-label="字幕ファイル"
                type="file"
                accept=".srt,.vtt,.ttml,.xml,.txt"
                onChange={async (event) => {
                  const file = event.target.files?.[0];
                  if (!file) return;
                  try {
                    const cues = parseSubtitleFile(file.name, await file.text());
                    if (!cues.length) throw new Error('字幕がありません。');
                    setCustomCues(cues);
                    setCustomFileName(file.name);
                    setStatus('');
                  } catch (error) {
                    setStatus((error as Error).message);
                  }
                }}
              />
            </label>
            <button
              className="playerButton"
              disabled={!customCues.length}
              onClick={() => {
                try {
                  request.current?.abort();
                  generation.current += 1;
                  setBusy(false);
                  const id = parseYouTubeId(url);
                  setSelection({
                    id: `custom-${id}`,
                    title: 'YouTube',
                    source: { kind: 'youtube', videoId: id },
                    cues: customCues,
                    fileName: customFileName,
                  });
                  setStart(customCues[0].start);
                  setEnd(Math.min(customCues[customCues.length - 1].end, customCues[0].start + 45));
                  setStatus('');
                } catch (error) {
                  setStatus((error as Error).message);
                }
              }}
            >
              区間を選ぶ
            </button>
          </details>
        )}
        <details className="playerPanel">
          <summary>辞書設定</summary>
          <p>通常版と同じTSV辞書をこのブラウザに読み込めます。</p>
          <input
            aria-label="辞書TSV"
            type="file"
            accept=".tsv,.txt"
            onChange={async (event) => {
              const file = event.target.files?.[0];
              if (!file) return;
              try {
                const result = await importDictionaryTsv(file.name, await file.text());
                setStatus(`辞書 ${result.imported} 件を読み込みました。`);
              } catch {
                setStatus('辞書を読み込めませんでした。');
              }
            }}
          />
        </details>
        {!youtubeEnabled && (
          <p>
            <a href="player.html">手元の動画・履歴・復習へ</a> ·{' '}
            <a href="options.html">字幕・辞書設定</a>
          </p>
        )}
      </div>
    </main>
  );
}

function NormalPractice({
  practice,
  onBack,
  onRetry,
}: {
  practice: OpenPractice;
  onBack: () => void;
  onRetry: () => void;
}) {
  const { clip } = practice;
  const videoRef = useRef<HTMLVideoElement>(null);
  const youtubeRef = useRef<HTMLDivElement>(null);
  const sessionRef = useRef<ClipSession | null>(null);
  const progressRef = useRef<StoredTypingProgressData>({});
  const [snapshot, setSnapshot] = useState<ClipSnapshot>({
    status: 'loading',
    currentTime: clip.start,
    cueIndex: -1,
  });
  const [ready, setReady] = useState(false);
  const [showTutorial, setShowTutorial] = useState(practice.tutorial);
  const [didType, setDidType] = useState(false);
  const [didReplay, setDidReplay] = useState(false);
  const targetId = useMemo(() => `video-typing-clip-${Date.now()}-${practice.run}`, [practice.run]);
  const frames = useMemo(() => clip.cues.map(subtitleCueToCaptionFrame), [clip]);
  const range = useMemo(() => ({ start: clip.start, end: clip.end }), [clip]);
  const emptyProgress = useMemo(() => ({}), []);
  const complete = snapshot.status === 'completed';
  const storageKey = `practice:${clip.source.kind === 'youtube' ? clip.source.videoId : clip.id}:${clip.start}:${clip.end}`;
  const receiveProgress = useCallback((progress: StoredTypingProgressData) => {
    progressRef.current = progress;
    if (Object.values(progress).some((frame) => frame.finishedCharIds.length > 0)) setDidType(true);
  }, []);
  const replayed = useCallback(() => setDidReplay(true), []);
  const panelDefaults = useMemo(() => {
    const width = Math.max(280, Math.min(760, window.innerWidth - 410));
    const playerHeight = Math.max(200, Math.min(360, window.innerHeight - 430));
    const top = playerHeight + 94;
    const height = Math.max(160, Math.min(260, window.innerHeight - top - 190));
    return {
      typing: { position: { x: 16, y: top }, size: { width, height } },
      hint: {
        position: { x: width + 40, y: top + 44 },
        size: { width: 350, height: Math.max(160, window.innerHeight - top - 70) },
      },
      config: { position: { x: width + 40, y: top }, size: { width: 350, height: 520 } },
      subtitle: { position: { x: 16, y: top + height + 12 }, size: { width, height: 160 } },
    };
  }, []);
  useEffect(() => {
    const adapter =
      clip.source.kind === 'media'
        ? createHtml5Adapter(videoRef.current!)
        : createYouTubeAdapter(youtubeRef.current!);
    const session = new ClipSession(adapter, clip, {
      canComplete: () =>
        frames.every((frame) =>
          frame.caption
            .filter((char) => char.isTypeable)
            .every((char) => progressRef.current[frame.id]?.finishedCharIds.includes(char.id)),
        ),
    });
    sessionRef.current = session;
    const bridge = registerPlaybackTarget(targetId, adapter, {
      ...range,
      controls: {
        play: () => session.play(),
        pause: () => session.pause(),
        seek: (seconds) => session.seek(seconds),
      },
      isConnected: () => (videoRef.current || youtubeRef.current)?.isConnected ?? false,
    });
    const unsubscribe = session.subscribe((next) => {
      setSnapshot(next);
      if (next.status !== 'idle' && next.status !== 'loading' && next.status !== 'error')
        setReady(true);
    });
    void session.start();
    return () => {
      unsubscribe();
      bridge.dispose();
      session.destroy();
      sessionRef.current = null;
    };
  }, [clip, frames, range, targetId]);
  useEffect(() => {
    if (complete && showTutorial && didType && didReplay) {
      try {
        localStorage.setItem(TUTORIAL_KEY, 'done');
      } catch {
        /* Optional persistence. */
      }
    }
  }, [complete, showTutorial, didType, didReplay]);
  const typed = Object.values(progressRef.current).reduce(
    (sum, frame) => sum + frame.finishedCharIds.length,
    0,
  );
  return (
    <main className="playerPage playbackPage normalPractice">
      <div className="playerShell">
        <header className="playerHeader">
          <div>
            <h1>Video Typing</h1>
            <p>
              {clip.title} · {time(clip.start)}–{time(clip.end)}
            </p>
          </div>
          <div className="playerActions">
            <button className="playerButton" onClick={onBack}>
              クリップ選択に戻る
            </button>
            <button className="playerButton" onClick={onRetry}>
              再挑戦
            </button>
            <button className="playerButton" onClick={() => setShowTutorial(true)}>
              操作案内
            </button>
          </div>
        </header>
        <section className="videoStage">
          <div className="normalPlayerWindow">
            {clip.source.kind === 'media' ? (
              <video ref={videoRef} controls playsInline />
            ) : (
              <div className="normalYouTube" ref={youtubeRef} />
            )}
          </div>
          {practice.video && (
            <small className="normalCredit">
              {practice.video.attribution} ·{' '}
              <a href={practice.video.subtitle.licenseUrl} target="_blank" rel="noreferrer">
                {practice.video.subtitle.license}
              </a>{' '}
              ·{' '}
              <a href="./captions/LICENSE.txt" target="_blank" rel="noreferrer">
                出典・クレジット
              </a>
            </small>
          )}
          {ready && !complete && (
            <OverlayApp
              initialSubtitleCues={clip.cues}
              initialSubtitleFileName={practice.fileName}
              initialTypingProgress={emptyProgress}
              pageUrl={storageKey}
              targetId={targetId}
              shadowRoot={document.head}
              playbackRange={range}
              panelDefaults={panelDefaults}
              onTypingProgressChange={receiveProgress}
              onReplay={replayed}
            />
          )}
          {showTutorial && !complete && (
            <div className="normalTutorial" role="status">
              {!didType
                ? '1 / 3　Typingウィンドウをクリックして英字を入力します。空白・記号は自動です。'
                : !didReplay
                  ? '2 / 3　Typingの「聞き直す」を押して、もう一度聞いてみましょう。'
                  : '3 / 3　最後まで入力しましょう。未完了の問題は通常版と同じように繰り返します。'}{' '}
              <button
                type="button"
                style={{ pointerEvents: 'auto' }}
                onClick={() => setShowTutorial(false)}
              >
                スキップ
              </button>
            </div>
          )}
          {snapshot.status === 'loading' && (
            <p className="normalStatus" role="status">
              動画を読み込んでいます…
            </p>
          )}
          {(snapshot.status === 'ready' || snapshot.status === 'blocked') && (
            <button
              className="playerButton normalPlay"
              onClick={() => void sessionRef.current?.play()}
            >
              再生する（動画中央の再生ボタンも使えます）
            </button>
          )}
          {snapshot.status === 'error' && (
            <div className="normalError" role="alert">
              {snapshot.error}
              <button className="playerButton" onClick={onRetry}>
                読み込みを再試行
              </button>
              <button className="playerButton" onClick={onBack}>
                クリップ選択に戻る
              </button>
            </div>
          )}
          {complete && (
            <section className="normalResult" role="status">
              <h2>クリップ完走</h2>
              <p>{typed} 文字入力しました。</p>
              {showTutorial && (
                <p>
                  {didType && didReplay
                    ? 'チュートリアル完了'
                    : '聞き直しも体験するとチュートリアル完了です。'}
                </p>
              )}
              <button className="playerButton primary" onClick={onRetry}>
                もう一度プレイ
              </button>
              <button className="playerButton" onClick={onBack}>
                クリップ選択へ
              </button>
            </section>
          )}
        </section>
      </div>
    </main>
  );
}
