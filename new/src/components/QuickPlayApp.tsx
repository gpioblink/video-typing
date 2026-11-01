import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { OverlayApp } from './OverlayApp';
import { PracticeTutorial } from './PracticeTutorial';
import { RECOMMENDED_VIDEOS, type RecommendedVideo } from '../data/recommendedVideos';
import { parseYouTubeId, type PracticeClip } from '../lib/clips';
import { selectClipCues } from '../lib/clipSelection';
import { ClipSession, createHtml5Adapter, type ClipSnapshot } from '../lib/playback';
import { createYouTubeAdapter } from '../lib/youtubePlayer';
import { registerPlaybackTarget } from '../lib/video';
import { parseSubtitleFile, subtitleCueToCaptionFrame } from '../lib/subtitles';
import { importDictionaryTsv } from '../lib/dictionary';
import { ensureDefaultDictionary } from '../lib/defaultDictionary';
import { calculatePracticeLayout } from '../lib/practiceLayout';
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
  const [displayMode, setDisplayMode] = useState<'mini' | 'fullscreen'>('mini');
  const [dictionaryStatus, setDictionaryStatus] = useState('EJDictを準備しています…');
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
  const prepareDictionary = useCallback(async () => {
    try {
      const result = await ensureDefaultDictionary();
      setDictionaryStatus(result.status === 'imported'
        ? `EJDictを読み込みました（${result.count.toLocaleString()}件）。`
        : `辞書を利用できます（${result.count.toLocaleString()}件）。`);
    } catch {
      setDictionaryStatus('辞書を読み込めませんでした。');
    }
  }, []);
  useEffect(() => { void prepareDictionary(); }, [prepareDictionary]);
  useEffect(() => {
    const changed = () => setDisplayMode(document.fullscreenElement ? 'fullscreen' : 'mini');
    document.addEventListener('fullscreenchange', changed);
    return () => document.removeEventListener('fullscreenchange', changed);
  }, []);
  const applyDisplayMode = (mode: 'mini' | 'fullscreen') => {
    setDisplayMode(mode);
    if (mode === 'fullscreen' && !document.fullscreenElement)
      void document.documentElement.requestFullscreen?.().catch(() => undefined);
    else if (mode === 'mini' && document.fullscreenElement)
      void document.exitFullscreen().catch(() => undefined);
  };

  const selectVideo = async (video: RecommendedVideo) => {
    applyDisplayMode(displayMode);
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
      await ensureDefaultDictionary().catch(() => undefined);
      if (current !== generation.current) return;
      const selected: Selection = {
        id: video.id,
        title: video.title,
        source: { kind: 'youtube', videoId: video.videoId },
        cues,
        fileName: video.subtitle.url.split('/').pop()!,
        video,
      };
      open(selected, range.start, range.end);
    } catch (error) {
      if (current === generation.current && !controller.signal.aborted)
        setStatus((error as Error).message);
    } finally {
      if (current === generation.current) setBusy(false);
    }
  };
  const open = (selected = selection, from = start, to = end) => {
    if (!selected) return;
    try {
      const cues = selectClipCues(selected.cues, from, to);
      const clip: PracticeClip = {
        id: selected.id,
        title: selected.title,
        description: selected.title,
        source: selected.source,
        language: 'en',
        start: from,
        end: to,
        cues,
        sync: { offsetSeconds: 0, showText: false },
      };
      setActive({
        clip,
        fileName: selected.fileName,
        video: selected.video,
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
        displayMode={displayMode}
        onDisplayModeChange={applyDisplayMode}
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
          <span>おすすめを選んですぐに学習</span>
        </header>
        <section className="playerPanel extensionNotice" aria-label="Chrome拡張機能版について">
          <h2>Chrome拡張機能版のデモページです</h2>
          <p>このページでは動画タイピングの一部を体験できます。すべての機能はChrome拡張機能版で利用できます。</p>
          <ul>
            <li>YouTubeのほか、Netflix・Prime Videoなど、さまざまな動画サイトに対応</li>
            <li>Bilibiliなどの動画を使った中国語タイピングにも対応</li>
            <li>動画・字幕・音声のローカルファイルを読み込み、オフラインでも学習可能</li>
            <li>対応する動画では、誤答時に日本語音声へ切り替えて聞き直し可能</li>
          </ul>
          <a href="https://github.com/gpioblink/video-typing#readme" target="_blank" rel="noreferrer">拡張機能版の詳細・導入方法</a>
        </section>
        <section className="playerPanel practicePreferences" aria-label="開始前の設定">
          <fieldset className="displayMode">
            <legend>動画の表示</legend>
            <label><input type="radio" name="display-mode" value="mini" checked={displayMode === 'mini'} onChange={() => setDisplayMode('mini')} />ミニ画面</label>
            <label><input type="radio" name="display-mode" value="fullscreen" checked={displayMode === 'fullscreen'} onChange={() => setDisplayMode('fullscreen')} />全画面</label>
          </fieldset>
          <label><input type="checkbox" checked={withTutorial} onChange={event => setWithTutorial(event.target.checked)} /> 操作チュートリアル</label>
        </section>
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
                  <small>{video.clips[0].end - video.clips[0].start}秒 · 選んで開始</small>
                </span>
              </button>
            ))}
          </div>
          <p className="clipAttribution"><a href="./captions/LICENSE.txt" target="_blank" rel="noreferrer">作品・字幕の出典とクレジット</a></p>
        </section>
        {selection && (
          <section className="playerPanel clipEditor">
            <h2>クリップ選択 — {selection.title}</h2>
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
              <button
                type="button"
                className="playerButton primary"
                disabled={busy || !selectedCues.length}
                onClick={() => { applyDisplayMode(displayMode); open(); }}
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
            <details className="subtitleHelp">
              <summary>YouTubeの字幕を取得するには</summary>
              <p><a href="https://github.com/yt-dlp/yt-dlp#installation" target="_blank" rel="noreferrer">yt-dlp</a>を導入したPCのターミナルで、動画URLを置き換えて実行します。動画を保存せず、英語字幕を取得します。</p>
              <pre><code>{'yt-dlp --skip-download --no-playlist --write-subs --sub-langs "en.*" --sub-format vtt "動画URL"'}</code></pre>
              <p>手動字幕がない場合は、上の <code>--write-subs</code> を <code>--write-auto-subs</code> に変えると自動字幕を取得できます。</p>
              <p>保存された <code>.vtt</code> を「字幕ファイル」で選んでください。別の言語は <code>--sub-langs</code> で指定できます。自動字幕には認識誤りが含まれる場合があります。</p>
            </details>
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
          <p role="status">{dictionaryStatus}</p>
          {dictionaryStatus === '辞書を読み込めませんでした。' && <button className="playerButton" onClick={() => void prepareDictionary()}>辞書の読み込みを再試行</button>}
          <p>Webデモは<a href="https://github.com/kujirahand/EJDict" target="_blank" rel="noreferrer">EJDict</a>（CC0）を使えます。Chrome拡張機能版では、好きな辞書をTSV形式で読み込めます。</p>
          <p>このブラウザに読み込んだ辞書がある場合は、その辞書を優先します。</p>
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
  displayMode,
  onDisplayModeChange,
  onBack,
  onRetry,
}: {
  practice: OpenPractice;
  displayMode: 'mini' | 'fullscreen';
  onDisplayModeChange: (mode: 'mini' | 'fullscreen') => void;
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
  const [viewport, setViewport] = useState(() => ({ width: window.innerWidth, height: window.innerHeight }));
  const [layoutRevision, setLayoutRevision] = useState(0);
  useEffect(() => {
    const resized = () => {
      setViewport({ width: window.innerWidth, height: window.innerHeight });
      setLayoutRevision(value => value + 1);
    };
    window.addEventListener('resize', resized);
    return () => window.removeEventListener('resize', resized);
  }, []);
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
  const layout = useMemo(() => calculatePracticeLayout(viewport.width, viewport.height, displayMode), [viewport, displayMode]);
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
    <main className={`playerPage playbackPage normalPractice display-${displayMode}`}>
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
          </div>
        </header>
        <section className="videoStage">
          <div className="normalPlayerWindow" style={{ left: layout.player.x, top: layout.player.y, width: layout.player.width, height: layout.player.height }}>
            {clip.source.kind === 'media' ? (
              <video ref={videoRef} controls playsInline />
            ) : (
              <div className="normalYouTube" ref={youtubeRef} />
            )}
          </div>
          {practice.video && (
            <small className="normalCredit" title={practice.video.attribution}>
              {practice.video.creator} ·{' '}
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
              panelDefaults={layout.panels}
              panelStorageScope={`web-practice-layout-v4:${displayMode}:${viewport.width < 760 ? 'narrow' : 'wide'}`}
              layoutRevision={layoutRevision}
              controlsExtra={<>
                <div className="practiceControlActions">
                  <button type="button" onClick={() => onDisplayModeChange(displayMode === 'mini' ? 'fullscreen' : 'mini')}>{displayMode === 'mini' ? '全画面にする' : 'ミニ画面にする'}</button>
                  <button type="button" onClick={() => setLayoutRevision(value => value + 1)}>配置をリセット</button>
                  <button type="button" onClick={() => setShowTutorial(true)}>操作案内</button>
                  <button type="button" onClick={onRetry}>再挑戦</button>
                </div>
                {snapshot.status === 'blocked' && <p role="status">動画中央の再生ボタンからも開始できます。</p>}
              </>}
              onTypingProgressChange={receiveProgress}
              onReplay={replayed}
            />
          )}
          {showTutorial && ready && !complete && (
            <PracticeTutorial step={!didType && (snapshot.status === 'ready' || snapshot.status === 'blocked') ? 'play' : !didType ? 'type' : !didReplay ? 'replay' : 'finish'} onSkip={() => setShowTutorial(false)} />
          )}
          {snapshot.status === 'loading' && (
            <p className="normalStatus" role="status">
              動画を読み込んでいます…
            </p>
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
