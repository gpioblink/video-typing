import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { RECOMMENDED_CLIPS, YOUTUBE_PRACTICE_CLIP, clipPlaybackData, parseYouTubeId, validateClip, type PracticeClip } from '../lib/clips';
import { ClipSession, createHtml5Adapter, type ClipSnapshot } from '../lib/playback';
import { createYouTubeAdapter } from '../lib/youtubePlayer';
import { subtitleCueToCaptionFrame } from '../lib/subtitles';
import { searchExtensionDictionary } from '../lib/dictionaryClient';
import { Window as TypingWindow } from '../legacy-ui/TypingPart/Window';
import { Hint } from '../legacy-ui/Hint';
import type { DictionaryWord, ID, Tag } from '../types';
import '../styles/quick-play.css';

const TUTORIAL_KEY = 'video-typing-tutorial-v1';
const EMPTY_IDS: ID[] = [];
const GLOSSES: Record<string, string> = {
  hello: 'こんにちは', world: '世界', listen: '聞く', type: '入力する', small: '小さい', steps: '一歩ずつ', count: '大切である・数える',
  you: 'あなた', did: 'した（doの過去形）', it: 'それ', the: 'その', sun: '太陽', is: '〜である', warm: '暖かい', a: 'ひとつの', bird: '鳥', sings: '歌う',
  take: '取る', deep: '深い', breath: '息', today: '今日', new: '新しい', day: '日', and: 'そして',
};

function tutorialSeen() {
  try { return localStorage.getItem(TUTORIAL_KEY) === 'done'; } catch { return false; }
}

export function QuickPlayApp({ youtubeEnabled = true }: { youtubeEnabled?: boolean }) {
  const [active, setActive] = useState<{ clip: PracticeClip; run: number; tutorial: boolean } | null>(null);
  const [hasLearned, setHasLearned] = useState(tutorialSeen);
  const [input, setInput] = useState('');
  const [error, setError] = useState('');
  const [nextRun, setNextRun] = useState(0);
  const launch = (clip: PracticeClip, tutorial = !hasLearned) => {
    try {
      validateClip(clip);
      setActive({ clip, run: nextRun, tutorial });
      setNextRun(n => n + 1);
      setError('');
    } catch (reason) { setError(reason instanceof Error ? reason.message : '起動できませんでした。'); }
  };
  const finishTutorial = useCallback(() => {
    try { localStorage.setItem(TUTORIAL_KEY, 'done'); } catch { /* Practice still works with storage disabled. */ }
    setHasLearned(true);
  }, []);
  return <main className="quickPage">
    <header className="quickHeader">
      <a href="#" onClick={(event) => { event.preventDefault(); setActive(null); }} className="quickBrand">Video Typing<span>C109 · PLAY & LEARN</span></a>
      <span className="quickBadge">{youtubeEnabled ? 'インストール不要' : 'Chrome拡張版'}</span>
    </header>
    {active ? <Practice key={active.run} clip={active.clip} tutorial={active.tutorial}
      onRetry={() => launch(active.clip, active.tutorial && !hasLearned)} onLeave={() => setActive(null)} onTutorialComplete={finishTutorial} /> : <>
      <section className="quickIntro"><span className="quickEyebrow">まずは、40秒。</span><h1>聞く。打つ。<br />少し、わかる。</h1><p>動画に合わせて英語をタイピング。字幕ファイルの準備は必要ありません。</p></section>
      <div className="quickSectionHeading"><h2>おすすめクリップ</h2><span>英語 · 音声あり · 各40秒</span></div>
      <section className="quickCards" aria-label="おすすめクリップ">
        {RECOMMENDED_CLIPS.map((clip, index) => <button key={clip.id} className={`quickCard quickCard${index}`} onClick={() => launch(clip)}>
          <span className="quickCardNumber">0{index + 1} / ORIGINAL</span><strong>{clip.title}</strong><span>{clip.description}</span><span className="quickCardAction">{!hasLearned ? 'チュートリアル付きで始める' : 'プレイする'} <b>→</b></span>
        </button>)}
      </section>
      <div className="quickLinks"><button onClick={() => launch(RECOMMENDED_CLIPS[0], true)}>操作を練習する</button>
        {!youtubeEnabled && <><a href="player.html">手元の動画・復習へ</a><a href="options.html">字幕・辞書の設定</a></>}
      </div>
      {youtubeEnabled && <section className="quickFree"><h2>YouTubeで自由練習</h2><p>{YOUTUBE_PRACTICE_CLIP.description}</p>
        <button onClick={() => launch(YOUTUBE_PRACTICE_CLIP, false)}>サンプルを開く</button>
        <form onSubmit={event => { event.preventDefault(); try { launch({ ...YOUTUBE_PRACTICE_CLIP, source: { kind: 'youtube', videoId: parseYouTubeId(input) } }, false); } catch (reason) { setError((reason as Error).message); } }}>
          <label htmlFor="youtube-id">自分の動画ID / YouTube URL</label><div><input id="youtube-id" value={input} maxLength={2048} onChange={event => setInput(event.target.value)} placeholder="https://www.youtube.com/watch?v=…" required /><button type="submit">開く</button></div>
        </form><small>練習文は共通のオリジナル文です。動画の字幕取得は行いません。</small>
      </section>}
      {error && <p role="alert" className="quickError">{error}</p>}
    </>}
    <footer className="quickFooter">自分のペースで、何度でも。<span>Original practice clips · CC0</span></footer>
  </main>;
}

function Practice({ clip, tutorial, onRetry, onLeave, onTutorialComplete }: {
  clip: PracticeClip; tutorial: boolean; onRetry: () => void; onLeave: () => void; onTutorialComplete: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const youtubeRef = useRef<HTMLDivElement>(null);
  const typingRef = useRef<HTMLDivElement>(null);
  const sessionRef = useRef<ClipSession | null>(null);
  const aliveRef = useRef(true);
  const hintGeneration = useRef(0);
  const [snapshot, setSnapshot] = useState<ClipSnapshot>({ status: 'loading', currentTime: clip.start, cueIndex: -1 });
  const [progress, setProgress] = useState<Record<string, ID[]>>({});
  const [tags, setTags] = useState<Record<string, Tag[]>>({});
  const [hints, setHints] = useState<DictionaryWord[]>([]);
  const [hintSelectable, setHintSelectable] = useState(false);
  const hintSelector = useRef<((word: DictionaryWord) => void) | null>(null);
  const [didType, setDidType] = useState(false);
  const [didReplay, setDidReplay] = useState(false);
  const [message, setMessage] = useState('');
  const [promptOpen, setPromptOpen] = useState(false);
  const resumeAfterPrompt = useRef(false);
  const frames = useMemo(() => clip.cues.map(subtitleCueToCaptionFrame), [clip]);
  const currentFrame = frames[snapshot.cueIndex];
  const frameWithTags = useMemo(() => currentFrame ? ({ ...currentFrame, tags: tags[currentFrame.id] || currentFrame.tags }) : undefined, [currentFrame, tags]);
  const completed = snapshot.status === 'completed';
  const tutorialComplete = tutorial && didType && didReplay && completed;
  const focusTyping = useCallback(() => typingRef.current?.querySelector<HTMLElement>('[tabindex="0"]')?.focus(), []);

  useEffect(() => {
    aliveRef.current = true;
    const adapter = clip.source.kind === 'media'
      ? createHtml5Adapter(videoRef.current!) : createYouTubeAdapter(youtubeRef.current!);
    const session = new ClipSession(adapter, clipPlaybackData(clip));
    sessionRef.current = session;
    const unsubscribe = session.subscribe(setSnapshot);
    void session.start();
    return () => {
      aliveRef.current = false;
      hintGeneration.current += 1;
      unsubscribe(); session.destroy(); sessionRef.current = null;
    };
  }, [clip]);
  useEffect(() => {
    hintGeneration.current += 1;
    setHints([]); setHintSelectable(false); hintSelector.current = null; setPromptOpen(false);
    if (currentFrame && !completed) focusTyping();
  }, [currentFrame?.id, completed, focusTyping]);
  useEffect(() => { if (tutorialComplete) onTutorialComplete(); }, [tutorialComplete, onTutorialComplete]);

  const saveFinished = useCallback((ids: ID[]) => {
    if (!currentFrame) return;
    if (ids.length) setDidType(true);
    setProgress(previous => {
      if ((previous[currentFrame.id] || []).join(',') === ids.join(',')) return previous;
      return { ...previous, [currentFrame.id]: ids };
    });
  }, [currentFrame]);
  const saveTags = useCallback((next: Tag[]) => {
    if (!currentFrame) return;
    setTags(previous => previous[currentFrame.id] === next ? previous : { ...previous, [currentFrame.id]: next });
  }, [currentFrame]);
  const requestExplanation = useCallback(async (query: string) => {
    const generation = hintGeneration.current;
    let words: DictionaryWord[] = [];
    try {
      if (typeof chrome !== 'undefined' && chrome.runtime?.id) {
        const entries = await searchExtensionDictionary(query);
        words = entries.map(entry => ({ title: entry.headword, content: entry.body, dictionaryEntryKey: entry.key }));
      }
    } catch { /* Built-in original sample hints remain available. */ }
    if (!words.length) words = [{ title: query, content: GLOSSES[query.toLowerCase()] || '意味を調べたい単語として記録できます。' }];
    if (aliveRef.current && generation === hintGeneration.current) setHints(words);
  }, []);
  const runAction = async (action: () => Promise<void> | void) => {
    try { await action(); if (aliveRef.current) focusTyping(); }
    catch (reason) { if (aliveRef.current) setMessage((reason as Error).message); }
  };
  const pauseForPrompt = () => { resumeAfterPrompt.current = sessionRef.current?.getSnapshot().status === 'playing'; setPromptOpen(true); sessionRef.current?.pause(); };
  const closePrompt = () => { setPromptOpen(false); if (resumeAfterPrompt.current) void runAction(() => sessionRef.current?.play()); else focusTyping(); };
  const typedCount = Object.values(progress).reduce((sum, ids) => sum + ids.length, 0);
  const totalCount = frames.reduce((sum, frame) => sum + frame.caption.filter(char => char.isTypeable).length, 0);
  const reviewTags = frames.flatMap(frame => (tags[frame.id] || []).map(tag => ({
    id: `${frame.id}-${tag.id}`, word: frame.caption.filter(char => tag.pastedCharIds.includes(char.id)).map(char => char.char).join(''), content: tag.content,
  })));
  return <section className="quickPractice">
    <div className="quickSectionHeading"><div><span className="quickEyebrow">{clip.language.toUpperCase()} / {clip.end - clip.start} SECONDS</span><h1>{clip.title}</h1></div><button onClick={onLeave}>クリップを選ぶ</button></div>
    {tutorial && <ol className="quickTutorial" aria-label="チュートリアル">
      <li aria-current={!didType ? 'step' : undefined} className={didType ? 'done' : ''}>1 入力{!didType && <small>英字を入力。空白・記号は自動です。</small>}</li>
      <li aria-current={didType && !didReplay ? 'step' : undefined} className={didReplay ? 'done' : ''}>2 聞き直し{didType && !didReplay && <small>「聞き直す」を押してみましょう。</small>}</li>
      <li aria-current={didType && didReplay ? 'step' : undefined} className={tutorialComplete ? 'done' : ''}>3 完走{didType && didReplay && !completed && <small>最後まで聞いて、入力してみましょう。</small>}</li>
    </ol>}
    <div className="quickPlayer">{clip.source.kind === 'media'
      ? <video ref={videoRef} controls playsInline preload="auto" aria-label={clip.title} />
      : <div ref={youtubeRef} className="quickYouTube" />}</div>
    {clip.source.kind === 'youtube' && <p className="quickNote">オリジナル練習文です。この動画の字幕ではありません。公式プレーヤーの操作も使えます。</p>}
    <div className="quickControls">
      <button disabled={completed || ['loading', 'error'].includes(snapshot.status) || promptOpen} onClick={() => void runAction(() => snapshot.status === 'playing' ? sessionRef.current?.pause() : sessionRef.current?.play())}>{snapshot.status === 'playing' ? '一時停止' : '再生する'}</button>
      <button disabled={!currentFrame || completed || ['loading', 'error'].includes(snapshot.status) || promptOpen} onClick={() => void runAction(async () => { await sessionRef.current?.replayCue(); if (aliveRef.current && sessionRef.current?.getSnapshot().status === 'playing') setDidReplay(true); })}>聞き直す</button>
      <label className="quickSeekLabel">再生位置<input aria-label="再生位置" type="range" min={clip.start} max={clip.end} step="0.1" value={Math.min(clip.end, snapshot.currentTime)} disabled={['loading', 'error'].includes(snapshot.status) || promptOpen} onChange={event => sessionRef.current?.seek(Number(event.target.value))} /></label>
      <span className="quickTime">{Math.floor(Math.max(0, snapshot.currentTime - clip.start))} / {clip.end - clip.start} 秒</span>
    </div>
    {(snapshot.status === 'blocked' || snapshot.status === 'ready') && <p role="status">再生ボタン、または動画中央の再生ボタンを押して始めましょう。</p>}
    {(snapshot.status === 'error' || message) && <div role="alert" className="quickError"><p>{snapshot.error || message}</p><button onClick={onRetry}>読み込みを再試行</button><button onClick={onLeave}>別のクリップへ</button></div>}
    {completed ? <div className="quickResult" role="status"><span className="quickEyebrow">NICE PRACTICE</span><h2>{clip.end - clip.start}秒、完走！</h2><p>{typedCount} / {totalCount} 文字入力できました。</p>
      {tutorial && <p>{tutorialComplete ? 'チュートリアル完了。次は好きなクリップで練習しましょう。' : '「入力」と「聞き直し」も体験するとチュートリアル完了です。'}</p>}
      <button className="quickPrimary" onClick={onRetry}>もう一度プレイ</button><button onClick={onLeave}>自由練習へ</button>
      {reviewTags.length > 0 && <div><h3>振り返り</h3>{reviewTags.map(tag => <p key={tag.id}>{tag.word} — {tag.content === 'ignorance' ? '知らなかった' : tag.content === 'unaudible' ? '聞き取れなかった' : 'スペルを練習'}</p>)}</div>}
    </div> : currentFrame ? <div className="quickTyping" ref={typingRef} data-cue-index={snapshot.cueIndex}>
      <div className="quickSectionHeading"><h2>ここをクリックして入力</h2><span>{snapshot.cueIndex + 1} / {frames.length}</span></div>
      {clip.sync.showText && <p className="quickTarget" lang="en">{clip.cues[snapshot.cueIndex].text}</p>}
      <TypingWindow key={currentFrame.id} frame={frameWithTags!} initialFinishedCharIds={progress[currentFrame.id] || EMPTY_IDS}
        sendCompleted={() => undefined} requestExplanation={requestExplanation} onFrameInteracted={() => undefined}
        onFinishedCharIdsChange={saveFinished} onTagsChange={saveTags} hintWords={hints}
        onMistakeReasonPromptOpen={pauseForPrompt} onMistakeReasonPromptClose={closePrompt}
        onUnknownHintSelectionActiveChange={setHintSelectable} onUnknownHintSelectionHandlerChange={handler => { hintSelector.current = handler; }} />
      <p className="quickNote">英字だけ入力します。間違えたら同じ文字をもう一度。単語をクリックするとヒントを表示します。</p>
    </div> : snapshot.status === 'loading' ? <p role="status">動画を準備しています…</p> : <p role="status">次のフレーズを待っています。</p>}
    {!completed && hints.length > 0 && <aside className="quickHints"><Hint words={hints} selectable={hintSelectable} onWordSelect={word => hintSelector.current?.(word)} /></aside>}
  </section>;
}
