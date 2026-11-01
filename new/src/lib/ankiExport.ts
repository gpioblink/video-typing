import type { StoredSubtitleData, StoredTypingProgressData } from '../types';
import { buildStoredSubtitleReviewFrames } from './localPlayerReview';

// Anki 2.1.54+ import headers: https://docs.ankiweb.net/importing/text-files.html
const HEADERS = '#separator:Tab\n#html:true\n#notetype:Basic\n#columns:Front\tBack\n';

function escapeHtml(value: string): string {
  const entities: Record<string, string> = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
    '[': '&#91;',
    ']': '&#93;',
  };
  // Encode brackets too: Anki has its own [sound:...] and [latex] syntax.
  return value
    .replace(/[&<>"'\[\]]/g, (character) => entities[character])
    .replace(/\r\n?|\n/g, '<br>')
    .replace(/\t/g, '&#9;')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '');
}

function tsvField(html: string): string {
  // Quoting also protects headwords beginning with Anki's comment marker '#'.
  return `"${html.replace(/"/g, '""')}"`;
}

function validateSourceUrl(value: string): URL {
  if (typeof value !== 'string' || value.length > 8192 || /[\u0000-\u0020]/.test(value)) {
    throw new Error('元の動画のHTTPS URLを指定してください。');
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error('元の動画のHTTPS URLを指定してください。');
  }
  if (url.protocol !== 'https:' || url.username || url.password) {
    throw new Error('元の動画のHTTPS URLを指定してください。');
  }
  return url;
}

function sourceAtTime(source: URL, seconds: number): URL {
  const url = new URL(source.href);
  const youtubeHost = [
    'www.youtube.com',
    'youtube.com',
    'm.youtube.com',
    'www.youtube-nocookie.com',
  ].includes(url.hostname);
  const videoId =
    url.hostname === 'youtu.be'
      ? url.pathname.slice(1)
      : youtubeHost
        ? url.pathname === '/watch'
          ? url.searchParams.get('v')
          : /^\/(?:embed|shorts)\/([A-Za-z0-9_-]{11})$/.exec(url.pathname)?.[1]
        : undefined;
  if (videoId && /^[A-Za-z0-9_-]{11}$/.test(videoId)) {
    // Watch URLs work when Anki opens the link in the external browser, even
    // when the source was an embed URL with a different clip start parameter.
    const target = new URL('https://www.youtube.com/watch');
    target.searchParams.set('v', videoId);
    target.searchParams.set('t', `${seconds}s`);
    return target;
  }
  if (/\.(?:mp4|webm|ogv|ogg|m4v)$/i.test(url.pathname)) url.hash = `t=${seconds}`;
  // Netflix and other providers do not share a universal documented seek URL.
  // Keep their original link and show the precise timestamp in the note text.
  return url;
}

function timestamp(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor(seconds / 60) % 60;
  const remainder = String(seconds % 60).padStart(2, '0');
  return hours
    ? `${hours}:${String(minutes).padStart(2, '0')}:${remainder}`
    : `${minutes}:${remainder}`;
}

/** Export unresolved, dictionary-selected unknown words as two-field Basic notes.
 * An empty source URL represents a local file and exports its timestamp without
 * a link or local filename. Identical headword/meaning pairs retain their first
 * cue. Different meanings remain separate rows; Anki's importer must allow
 * duplicate first fields to keep multiple notes for the same headword. */
export function createAnkiTsv(
  subtitle: StoredSubtitleData,
  progress: StoredTypingProgressData,
  sourceUrl: string,
): string {
  const source = sourceUrl === '' ? null : validateSourceUrl(sourceUrl);
  const seen = new Set<string>();
  const rows: string[] = [];
  for (const { cue, tags } of buildStoredSubtitleReviewFrames(subtitle, progress)) {
    for (const tag of tags) {
      if (tag.content !== 'ignorance' || !tag.hint) continue;
      const { headword, meaning } = tag.hint;
      if (
        typeof headword !== 'string' ||
        typeof meaning !== 'string' ||
        !headword.trim() ||
        !meaning.trim()
      )
        continue;
      const key = JSON.stringify([headword, meaning]);
      if (seen.has(key)) continue;
      if (!Number.isFinite(cue.start) || cue.start < 0)
        throw new Error('字幕の開始時刻が正しくありません。');
      seen.add(key);
      const seconds = Math.floor(cue.start);
      const link = source ? sourceAtTime(source, seconds) : null;
      const back =
        `${escapeHtml(meaning)}<br><br>${escapeHtml(cue.text)}<br>` +
        (link
          ? `<a href="${escapeHtml(link.href)}">${timestamp(seconds)} — 元の動画</a>`
          : timestamp(seconds));
      rows.push(`${tsvField(escapeHtml(headword))}\t${tsvField(back)}`);
    }
  }
  return HEADERS + (rows.length ? `${rows.join('\n')}\n` : '');
}
