import test from 'node:test';
import assert from 'node:assert/strict';
import { validateClip, parseYouTubeId, clipPlaybackData } from '../src/lib/clips.ts';

const baseClip = { id:'test-clip',title:'Test',description:'Test input',language:'en',source:{kind:'youtube',videoId:'abcdefghijk'},start:0,end:40,cues:[{start:0,end:40,text:'Original test words.'}],sync:{offsetSeconds:0,showText:true} };
test('validated clips share timing settings for the normal learning UI', () => {
  assert.equal(validateClip(baseClip), baseClip);
  assert.deepEqual(clipPlaybackData(baseClip).cues, baseClip.cues);
});
test('reject malformed clips, executable media URLs, bad ranges and text', () => {
  const base = baseClip;
  for (const bad of [null, {}, {...base, end: Infinity}, {...base, start: -1}, {...base, end: 20}, {...base, language: 'xx'}, {...base, source:{kind:'media',src:'javascript:alert(1)'}}, {...base, source:{kind:'media',src:'./demo/../../secret.webm'}}, {...base, source:{kind:'youtube',videoId:'<iframe>'}}, {...base, cues:[{start:10,end:5,text:'hello'}]}, {...base, cues:[{start:0,end:10,text:'你好'}]}, {...base, sync:{offsetSeconds:NaN,showText:true}}, {...base, sync:{offsetSeconds:1,showText:true}}]) {
    assert.throws(() => validateClip(bad));
  }
});
test('YouTube URL parsing uses exact HTTPS origins and IDs', () => {
  for (const input of ['M7lc1UVf-VE', 'https://youtu.be/M7lc1UVf-VE?t=10', 'https://www.youtube.com/watch?v=M7lc1UVf-VE', 'https://youtube.com/embed/M7lc1UVf-VE']) assert.equal(parseYouTubeId(input), 'M7lc1UVf-VE');
  for (const input of ['javascript:alert(1)', 'https://youtube.com.evil.test/watch?v=M7lc1UVf-VE', 'https://evil.test', 'http://youtu.be/M7lc1UVf-VE', 'https://user:pass@youtube.com/watch?v=M7lc1UVf-VE', 'https://youtu.be/invalid']) assert.throws(() => parseYouTubeId(input));
});
