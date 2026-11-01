import { localStorageArea, type LocalStorageArea } from './browserStorage';
import { validateClipRange, type ClipRange } from './clipLaunch';
import { parseYouTubeId } from './clips';

export const SAVED_CLIPS_KEY = 'videoTypingSavedClipsV1';
export const MAX_SAVED_CLIPS = 20;

export interface SavedClipInput extends ClipRange {
  title: string;
  url: string;
  language: string;
}

export interface SavedClip extends SavedClipInput {
  id: string;
  kind: 'youtube' | 'netflix' | 'html5';
  createdAt: number;
}

/** Canonicalize provider identities without retaining tracking/account query parameters. */
export function clipSource(input: string): { url: string; identity: string; kind: SavedClip['kind'] } {
  if (typeof input !== 'string' || input.length > 2048 || /[\u0000-\u0020\u007f]/.test(input)) {
    throw new Error('動画のHTTPS URLを使ってください。');
  }
  let url: URL;
  try { url = new URL(input); } catch { throw new Error('動画のHTTPS URLを使ってください。'); }
  if (url.href.length > 2048 || url.protocol !== 'https:' || url.username || url.password || url.port) {
    throw new Error('認証情報や独自ポートを含まないHTTPS URLを使ってください。');
  }
  if (['youtube.com', 'www.youtube.com', 'm.youtube.com', 'youtu.be'].includes(url.hostname)) {
    const id = parseYouTubeId(url.href);
    return { url: `https://www.youtube.com/watch?v=${id}`, identity: `youtube:${id}`, kind: 'youtube' };
  }
  if (url.hostname === 'netflix.com' || url.hostname === 'www.netflix.com') {
    const id = /^\/watch\/([1-9][0-9]{0,15})\/?$/.exec(url.pathname)?.[1];
    if (!id) throw new Error('Netflixでは再生中の /watch/動画ID のURLを使ってください。');
    return { url: `https://www.netflix.com/watch/${id}`, identity: `netflix:${id}`, kind: 'netflix' };
  }
  return { url: url.href, identity: `html5:${url.href}`, kind: 'html5' };
}

function validatedInput(value: unknown): SavedClipInput & { kind: SavedClip['kind'] } {
  if (!value || typeof value !== 'object') throw new Error('保存するクリップの情報がありません。');
  const input = value as Partial<SavedClipInput>;
  const range = validateClipRange(input);
  if (typeof input.title !== 'string' || !input.title.trim() || input.title.length > 200 || /[\u0000-\u001f\u007f]/.test(input.title)) {
    throw new Error('クリップ名を200文字以内で入力してください。');
  }
  if (typeof input.language !== 'string' || input.language.length > 35 || !/^[a-z]{2,3}(?:-[a-z0-9]{2,8})*$/i.test(input.language)) {
    throw new Error('言語を en、zh-CN などの形式で入力してください。');
  }
  const source = clipSource(input.url as string);
  return { ...range, title: input.title.trim(), url: source.url, language: input.language.toLowerCase(), kind: source.kind };
}

function normalizeSavedClip(value: unknown): SavedClip {
  const input = validatedInput(value);
  const record = value as Partial<SavedClip>;
  if (typeof record.id !== 'string' || !/^[a-z0-9-]{1,64}$/i.test(record.id)
    || !Number.isSafeInteger(record.createdAt) || record.createdAt! < 0) throw new Error('Invalid saved clip.');
  // Pick only metadata fields: subtitle text, files and any unexpected data are discarded.
  return { ...input, id: record.id, createdAt: record.createdAt! };
}

function metadataIdentity(clip: SavedClipInput) {
  return JSON.stringify([clipSource(clip.url).identity, clip.start, clip.end, clip.language]);
}

export function normalizeSavedClips(value: unknown): SavedClip[] {
  if (!Array.isArray(value)) return [];
  const ids = new Set<string>();
  const identities = new Set<string>();
  const result: SavedClip[] = [];
  for (const candidate of value.slice(0, MAX_SAVED_CLIPS)) {
    try {
      const clip = normalizeSavedClip(candidate);
      const identity = metadataIdentity(clip);
      if (ids.has(clip.id) || identities.has(identity)) continue;
      ids.add(clip.id); identities.add(identity); result.push(clip);
    } catch { /* Invalid stored records do not stop valid clips from being used. */ }
  }
  return result;
}

export function addSavedClip(records: SavedClip[], value: SavedClipInput): SavedClip[] {
  const input = validatedInput(value);
  const clips = normalizeSavedClips(records);
  const identity = metadataIdentity(input);
  const previous = clips.find(clip => metadataIdentity(clip) === identity);
  if (!previous && clips.length >= MAX_SAVED_CLIPS) {
    throw new Error('保存できるクリップは20件までです。不要な項目を削除してください。');
  }
  const clip: SavedClip = previous ? { ...input, id: previous.id, createdAt: previous.createdAt }
    : { ...input, id: crypto.randomUUID(), createdAt: Date.now() };
  return [clip, ...clips.filter(item => item.id !== clip.id)];
}

export function isMatchingClipSource(clip: SavedClip, currentUrl: string): boolean {
  try { return clipSource(clip.url).identity === clipSource(currentUrl).identity; }
  catch { return false; }
}

export async function loadSavedClips(storage: LocalStorageArea = localStorageArea) {
  const result = await storage.get(SAVED_CLIPS_KEY);
  return normalizeSavedClips(result[SAVED_CLIPS_KEY]);
}

// Serialize this surface's mutations so two rapid button actions do not drop a save/delete.
let mutations: Promise<unknown> = Promise.resolve();
function mutateSavedClips(update: (clips: SavedClip[]) => SavedClip[], storage: LocalStorageArea) {
  const operation = mutations.then(async () => {
    const clips = update(await loadSavedClips(storage));
    await storage.set({ [SAVED_CLIPS_KEY]: clips });
    return clips;
  });
  mutations = operation.catch(() => undefined);
  return operation;
}

export function saveClip(value: SavedClipInput, storage: LocalStorageArea = localStorageArea) {
  return mutateSavedClips(clips => addSavedClip(clips, value), storage);
}

export function deleteSavedClip(id: string, storage: LocalStorageArea = localStorageArea) {
  return mutateSavedClips(clips => clips.filter(clip => clip.id !== id), storage);
}
