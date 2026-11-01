import test from 'node:test';
import assert from 'node:assert/strict';
import { RECOMMENDED_CLIPS, YOUTUBE_PRACTICE_CLIP, validateClip, parseYouTubeId, clipPlaybackData } from '../src/lib/clips.ts';

test('two original 40s clips and optional YouTube practice load through same schema', () => {
  for (const clip of [...RECOMMENDED_CLIPS, YOUTUBE_PRACTICE_CLIP]) {
    assert.equal(validateClip(clip), clip);
    assert.equal(clipPlaybackData(clip).cues.length, 4);
  }
  assert.equal(new Set(RECOMMENDED_CLIPS.map(c => c.id)).size, 2);
});
test('reject malformed clips, executable media URLs, bad ranges and text', () => {
  const base = RECOMMENDED_CLIPS[0];
  for (const bad of [null, {}, {...base, end: Infinity}, {...base, start: -1}, {...base, end: 20}, {...base, language: 'xx'}, {...base, source:{kind:'media',src:'javascript:alert(1)'}}, {...base, source:{kind:'media',src:'./demo/../../secret.webm'}}, {...base, source:{kind:'youtube',videoId:'<iframe>'}}, {...base, cues:[{start:10,end:5,text:'hello'}]}, {...base, cues:[{start:0,end:10,text:'你好'}]}, {...base, sync:{offsetSeconds:NaN,showText:true}}, {...base, sync:{offsetSeconds:1,showText:true}}]) {
    assert.throws(() => validateClip(bad));
  }
});
test('YouTube URL parsing uses exact HTTPS origins and IDs', () => {
  for (const input of ['M7lc1UVf-VE', 'https://youtu.be/M7lc1UVf-VE?t=10', 'https://www.youtube.com/watch?v=M7lc1UVf-VE', 'https://youtube.com/embed/M7lc1UVf-VE']) assert.equal(parseYouTubeId(input), 'M7lc1UVf-VE');
  for (const input of ['javascript:alert(1)', 'https://youtube.com.evil.test/watch?v=M7lc1UVf-VE', 'https://evil.test', 'http://youtu.be/M7lc1UVf-VE', 'https://user:pass@youtube.com/watch?v=M7lc1UVf-VE', 'https://youtu.be/invalid']) assert.throws(() => parseYouTubeId(input));
});
