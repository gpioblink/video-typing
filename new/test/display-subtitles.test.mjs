import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { findDisplaySubtitleCue } from '../src/lib/displaySubtitles.ts';
import { RECOMMENDED_VIDEOS } from '../src/data/recommendedVideos.ts';
function readCues(text) {
  const seconds = value => {
    const [hours, minutes, rest] = value.trim().replace(',', '.').split(':').map(Number);
    return hours * 3600 + minutes * 60 + rest;
  };
  return text.trim().split(/\r?\n\s*\r?\n/).map(block => {
    const lines = block.split(/\r?\n/);
    const index = lines.findIndex(line => line.includes('-->'));
    const [start, end] = lines[index].split('-->').map(seconds);
    return { start, end, text: lines.slice(index + 1).join('\n') };
  });
}

test('translated captions follow absolute question times instead of array indexes', () => {
  const translations = [{ start: 1, end: 2, text: '別の場面' }, { start: 10, end: 15, text: '日本語の意味' }];
  assert.equal(findDisplaySubtitleCue({ start: 11, end: 14, text: 'An English answer' }, translations)?.text, '日本語の意味');
  assert.equal(findDisplaySubtitleCue({ start: 20, end: 22, text: 'Do not reveal this answer as Japanese' }, translations), undefined);
  assert.equal(findDisplaySubtitleCue(null, translations), undefined);
  assert.equal(findDisplaySubtitleCue({ start: 10, end: 11, text: 'Answer' }, []), undefined);
});

test('both licensed Japanese originals cover the recommended English questions without changing their source bytes', () => {
  const hashes = [
    '865182d78d9d5df40192df19a1d0d91addcab91567bce08f7736bd9cd4086f0a',
    'dae49f0d9231c93a3ca02f02ab08023a4e5379aa8dfa9e22f78bc40d8754ad74',
  ];
  for (const [index, video] of RECOMMENDED_VIDEOS.entries()) {
    assert.equal(video.displaySubtitle?.language, 'ja');
    assert.equal(video.displaySubtitle.license, 'CC BY 3.0');
    const bytes = readFileSync(new URL(`../public/${video.displaySubtitle.url}`, import.meta.url));
    assert.equal(createHash('sha256').update(bytes).digest('hex'), hashes[index]);
    const translated = readCues(bytes.toString('utf8'));
    const english = readCues(readFileSync(new URL(`../public/${video.subtitle.url}`, import.meta.url), 'utf8'));
    for (const question of english.filter(cue => cue.start < video.clips[0].end && cue.end > video.clips[0].start)) {
      assert.match(findDisplaySubtitleCue(question, translated)?.text || '', /[\u3040-\u30ff\u4e00-\u9fff]/);
    }
  }
});
