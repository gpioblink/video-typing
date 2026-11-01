import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { selectClipCues } from '../src/lib/clipSelection.ts';
import { RECOMMENDED_VIDEOS } from '../src/data/recommendedVideos.ts';
test('selection preserves source times and text without modifying downloaded subtitles', () => {
  const cues = [
    { start: 2, end: 5, text: 'One.' },
    { start: 6, end: 9, text: 'Two.' },
  ];
  assert.deepEqual(selectClipCues(cues, 3, 8), [
    { start: 3, end: 5, text: 'One.' },
    { start: 6, end: 8, text: 'Two.' },
  ]);
  assert.equal(cues[0].start, 2);
  assert.throws(() => selectClipCues(cues, 10, 20), /字幕/);
  for (const range of [
    [NaN, 10],
    [-1, 10],
    [10, 5],
    [0, 91],
  ])
    assert.throws(() => selectClipCues(cues, ...range));
});
test('overlapping captions become one problem at a time; silent directions are excluded', () => {
  assert.deepEqual(
    selectClipCues(
      [
        { start: 1, end: 4, text: 'One' },
        { start: 3, end: 5, text: 'Two' },
        { start: 5, end: 6, text: '音楽' },
      ],
      0,
      7,
    ),
    [
      { start: 1, end: 3, text: 'One' },
      { start: 3, end: 5, text: 'Two' },
    ],
  );
});
test('recommendations use original CC BY subtitle bytes with traceable attribution', () => {
  const hashes = [
    '4ed7e1f1bc5ff69fe33606960e4c048ba6766237bf33b132fef76e1a92cb64b2',
    'ce9578f6fe098a5821045a38884b229160f9e7ba27890448a92f5be330c6e6fe',
  ];
  assert.equal(RECOMMENDED_VIDEOS.length, 2);
  RECOMMENDED_VIDEOS.forEach((video, i) => {
    assert.match(video.videoId, /^[A-Za-z0-9_-]{11}$/);
    assert.equal(video.subtitle.license, 'CC BY 3.0');
    assert.match(video.attribution, /Blender Foundation/);
    assert.equal(
      createHash('sha256')
        .update(readFileSync(new URL(`../public/${video.subtitle.url}`, import.meta.url)))
        .digest('hex'),
      hashes[i],
    );
    for (const clip of video.clips)
      assert.ok(clip.end - clip.start >= 30 && clip.end - clip.start <= 90);
  });
});
