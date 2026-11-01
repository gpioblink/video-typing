import React, { useEffect, useState } from 'react';
import { deleteSavedClip, isMatchingClipSource, loadSavedClips, MAX_SAVED_CLIPS, saveClip, type SavedClip } from '../lib/savedClips';
import type { ClipRange } from '../lib/clipLaunch';

interface Props {
  currentTitle: string;
  currentUrl: string;
  hasVideo: boolean;
  start: string;
  end: string;
  disabled: boolean;
  onPlay: (range: ClipRange) => Promise<void>;
}

export function SavedClips({ currentTitle, currentUrl, hasVideo, start, end, disabled, onPlay }: Props) {
  const [clips, setClips] = useState<SavedClip[]>([]);
  const [title, setTitle] = useState(currentTitle.slice(0, 200));
  const [language, setLanguage] = useState('en');
  const [busy, setBusy] = useState(true);
  const [status, setStatus] = useState('');
  useEffect(() => { setTitle(currentTitle.slice(0, 200)); }, [currentTitle, currentUrl]);
  useEffect(() => {
    let alive = true;
    void loadSavedClips().then(items => { if (alive) setClips(items); })
      .catch(() => { if (alive) setStatus('保存済みクリップを読み込めませんでした。'); })
      .finally(() => { if (alive) setBusy(false); });
    return () => { alive = false; };
  }, []);

  const save = async () => {
    setBusy(true); setStatus('');
    try {
      if (!start.trim() || !end.trim()) throw new Error('開始・終了秒を指定してください。');
      setClips(await saveClip({ title, url: currentUrl, start: Number(start), end: Number(end), language }));
      setStatus('クリップを保存しました。');
    } catch (error) { setStatus((error as Error).message); }
    finally { setBusy(false); }
  };
  const remove = async (id: string) => {
    setBusy(true); setStatus('');
    try { setClips(await deleteSavedClip(id)); }
    catch { setStatus('クリップを削除できませんでした。'); }
    finally { setBusy(false); }
  };
  const choose = async (clip: SavedClip) => {
    setBusy(true); setStatus('');
    try {
      if (isMatchingClipSource(clip, currentUrl)) {
        if (!hasVideo) throw new Error('動画を再生してから、もう一度クリップを選んでください。');
        await onPlay({ start: clip.start, end: clip.end });
      } else {
        await chrome.tabs.create({ url: clip.url });
        window.close();
      }
    } catch (error) { setStatus((error as Error).message); }
    finally { setBusy(false); }
  };

  return <section className="actions" aria-label="保存済みクリップ">
    <h2 className="sectionTitle">保存済みクリップ（{clips.length}/{MAX_SAVED_CLIPS}）</h2>
    {hasVideo && <form className="actions" onSubmit={event => { event.preventDefault(); void save(); }}>
      <label>クリップ名<input aria-label="保存するクリップ名" value={title} maxLength={200} onChange={event => setTitle(event.target.value)} style={{ display: 'block', width: '100%' }} /></label>
      <label>言語<input aria-label="保存するクリップの言語" value={language} maxLength={35} onChange={event => setLanguage(event.target.value)} placeholder="en / zh-CN" style={{ marginLeft: 8, width: 100 }} /></label>
      <p className="metaLine">上の開始・終了秒を保存します。字幕・音声は通常版で選択します。</p>
      <button className="button" type="submit" disabled={busy || disabled}>この区間を保存</button>
    </form>}
    {!clips.length && !busy && <p className="metaLine">まだ保存済みクリップはありません。</p>}
    {clips.map(clip => <article className="progressBox" key={clip.id}>
      <strong>{clip.title}</strong><span>{clip.kind === 'netflix' ? 'Netflix' : clip.kind === 'youtube' ? 'YouTube' : '動画'} · {clip.language} · {clip.start}–{clip.end} 秒</span>
      <button className="button" type="button" disabled={busy || disabled} onClick={() => void choose(clip)}>{isMatchingClipSource(clip, currentUrl) ? 'このタブで練習する' : '動画ページを開く'}</button>
      <button className="button danger" type="button" disabled={busy || disabled} aria-label={`${clip.title}を削除`} onClick={() => void remove(clip.id)}>削除</button>
    </article>)}
    <p className="metaLine">別の動画を開いた場合は、そのタブで拡張機能をもう一度クリックし、保存済みクリップから選んでください。保存されるのはタイトル・URL・区間・言語だけです。</p>
    {status && <p className="status" role="status">{status}</p>}
  </section>;
}
