import assert from 'node:assert/strict';
import test from 'node:test';
import { createAnkiTsv } from '../src/lib/ankiExport.ts';
import { subtitleCueToCaptionFrame } from '../src/lib/subtitles.ts';

const SOURCE = 'https://www.youtube.com/watch?v=abcdefghijk';
const hint = (headword = 'take care', meaning = 'be careful') => ({ headword, meaning, selectedText: 'take care', selectedAt: 123 });
const tag = (id, content = 'ignorance', selected = hint()) => ({ id, pastedCharIds: ['0'], content, hint: selected });
function fixture(cues, tags) {
  const frames = cues.map((cue) => ({ ...subtitleCueToCaptionFrame(cue), start: cue.start, end: cue.end }));
  return {
    subtitle: { fileName: 'original-test.srt', cues },
    progress: Object.fromEntries(frames.map((frame, index) => [frame.id, { finishedCharIds: [], tags: tags[index] || [] }])),
    frames,
  };
}

// A small standard quoted-TSV reader: tests inspect the fields Anki imports,
// rather than comparing an implementation-specific sequence of quote escapes.
function notes(tsv) {
  return tsv.trimEnd().split('\n').filter((line) => !line.startsWith('#')).map((line) => {
    const fields = [];
    let quoted = false;
    let field = '';
    for (let index = 0; index < line.length; index += 1) {
      if (line[index] === '"') {
        if (quoted && line[index + 1] === '"') { field += '"'; index += 1; }
        else quoted = !quoted;
      } else if (line[index] === '\t' && !quoted) { fields.push(field); field = ''; }
      else field += line[index];
    }
    assert.equal(quoted, false, 'every row has balanced TSV quoting');
    fields.push(field);
    assert.equal(fields.length, 2, 'Basic notes always contain exactly Front and Back');
    return fields;
  });
}

test('Basic Anki headers and notes include selected unknown words, meanings, context and timestamp links', () => {
  const cue = { start: 125.75, end: 129, text: 'Please take care.' };
  const f = fixture([cue], [[tag('selected')]]);
  const result = createAnkiTsv(f.subtitle, f.progress, SOURCE);
  assert.ok(result.startsWith('#separator:Tab\n#html:true\n#notetype:Basic\n#columns:Front\tBack\n'));
  const rows = notes(result);
  assert.equal(rows.length, 1);
  assert.equal(rows[0][0], 'take care');
  assert.match(rows[0][1], /^be careful<br><br>Please take care\./);
  assert.match(rows[0][1], /href="https:\/\/www.youtube.com\/watch\?v=abcdefghijk&amp;t=125s"/);
  assert.match(rows[0][1], />2:05 — 元の動画<\/a>/);
});

test('listening/spelling/other flags and unknowns without selected or usable meanings are excluded', () => {
  const f = fixture([{ start: 0, end: 1, text: 'Take care.' }], [[
    tag('heard', 'unaudible'), tag('typo', 'spelling'), tag('other', 'others'),
    { id: 'no-selection', content: 'ignorance', pastedCharIds: ['0'] },
    tag('empty-word', 'ignorance', hint(' ', 'meaning')),
    tag('empty-meaning', 'ignorance', hint('word', ' ')), tag('selected'),
  ]]);
  assert.equal(notes(createAnkiTsv(f.subtitle, f.progress, SOURCE)).length, 1);
});

test('removed review flags are excluded even if original custom typing frames retain old tags', () => {
  const f = fixture([{ start: 1, end: 2, text: 'Take care.' }], [[tag('selected')]]);
  f.subtitle.typingFrames = [{ ...f.frames[0], tags: [tag('old-tag')] }];
  f.progress[f.frames[0].id].tags = [];
  assert.deepEqual(notes(createAnkiTsv(f.subtitle, f.progress, SOURCE)), []);
});

test('HTML and TSV metacharacters cannot create scripts, attributes, extra rows or import headers', () => {
  const f = fixture([{ start: 2, end: 3, text: '<img src=x onerror=alert(1)>\t"context"\n& again.' }], [[
    tag('selected', 'ignorance', hint('#html:false\t"word"', '<script>alert(1)</script>\r\n"quoted" & \'apostrophe\'\ttail')),
  ]]);
  const result = createAnkiTsv(f.subtitle, f.progress, 'https://example.test/video?x=%22%20onclick%3D%22alert(1)&y=1');
  const rows = notes(result);
  assert.equal(rows.length, 1);
  assert.equal(rows[0][0], '#html:false&#9;&quot;word&quot;');
  assert.match(rows[0][1], /&lt;script&gt;alert\(1\)&lt;\/script&gt;<br>&quot;quoted&quot; &amp; &#39;apostrophe&#39;&#9;tail/);
  assert.match(rows[0][1], /&lt;img src=x onerror=alert\(1\)&gt;&#9;&quot;context&quot;<br>&amp; again\./);
  assert.doesNotMatch(rows[0][1], /<script|<img| onclick="/);
  assert.equal((rows[0][1].match(/<a /g) || []).length, 1);
});

test('exact headword/meaning duplicates retain first context; different meanings remain separate notes', () => {
  const f = fixture([
    { start: 10, end: 11, text: 'First context.' }, { start: 20, end: 21, text: 'Later context.' },
  ], [[tag('first')], [tag('again'), tag('another-meaning', 'ignorance', hint('take care', 'look after'))]]);
  const rows = notes(createAnkiTsv(f.subtitle, f.progress, SOURCE));
  assert.equal(rows.length, 2);
  assert.match(rows[0][1], /First context/);
  assert.doesNotMatch(rows[0][1], /Later context/);
  assert.match(rows[0][1], /t=10s/);
  assert.match(rows[1][1], /^look after<br>/);
  assert.match(rows[1][1], /Later context/);
  assert.equal(rows[0][0], rows[1][0]);
});

test('untrusted dictionary text cannot become Anki media or LaTeX commands', () => {
  const f = fixture([{ start: 0, end: 1, text: '[sound:remote.mp3]' }], [[
    tag('selected', 'ignorance', hint('word', '[latex]untrusted[/latex]')),
  ]]);
  const back = notes(createAnkiTsv(f.subtitle, f.progress, SOURCE))[0][1];
  assert.match(back, /&#91;latex&#93;untrusted&#91;\/latex&#93;/);
  assert.match(back, /&#91;sound:remote.mp3&#93;/);
  assert.doesNotMatch(back, /\[(?:sound:|latex)/);
});

test('custom typing-frame IDs reuse existing review mapping to find source cue context and start', () => {
  const cue = { start: 100, end: 110, text: 'The full source sentence.' };
  const f = fixture([cue], [[]]);
  f.subtitle.typingFrames = [{ ...f.frames[0], id: 'custom', start: 103, end: 107 }];
  const result = createAnkiTsv(f.subtitle, { custom: { finishedCharIds: [], tags: [tag('selected')] } }, SOURCE);
  assert.match(notes(result)[0][1], /The full source sentence/);
  assert.match(notes(result)[0][1], /t=100s/);
});

test('YouTube short/embed/share URLs link to original watch page at the cue time', () => {
  const f = fixture([{ start: 3661.9, end: 3665, text: 'An hour later.' }], [[tag('selected')]]);
  for (const source of [
    'https://youtu.be/abcdefghijk?t=99', 'https://www.youtube.com/embed/abcdefghijk?start=99',
    'https://m.youtube.com/shorts/abcdefghijk', 'https://www.youtube-nocookie.com/embed/abcdefghijk',
  ]) {
    const back = notes(createAnkiTsv(f.subtitle, f.progress, source))[0][1];
    assert.match(back, /https:\/\/www.youtube.com\/watch\?v=abcdefghijk&amp;t=3661s/);
    assert.match(back, /1:01:01 — 元の動画/);
    assert.doesNotMatch(back, /t=99|start=99/);
  }
});

test('generic HTTPS and Netflix source links are safe and retain a visible timestamp without invented seek parameters', () => {
  const f = fixture([{ start: 65, end: 70, text: 'A source sentence.' }], [[tag('selected')]]);
  for (const source of ['https://www.netflix.com/watch/12345?trackId=1', 'https://example.test/watch/123']) {
    const back = notes(createAnkiTsv(f.subtitle, f.progress, source))[0][1];
    assert.ok(back.includes(`href="${source}"`));
    assert.match(back, /1:05 — 元の動画/);
  }
  const media = notes(createAnkiTsv(f.subtitle, f.progress, 'https://example.test/movie.webm'))[0][1];
  assert.match(media, /movie.webm#t=65/);
});

test('local-file export preserves meaning, cue and timestamp without URLs or filesystem names', () => {
  const f = fixture([{ start: 125, end: 129, text: 'Please take care.' }], [[tag('selected')]]);
  f.subtitle.fileName = 'C:\\Users\\private\\secret-movie.srt';
  const rows = notes(createAnkiTsv(f.subtitle, f.progress, ''));
  assert.equal(rows.length, 1);
  assert.equal(rows[0][0], 'take care');
  assert.equal(rows[0][1], 'be careful<br><br>Please take care.<br>2:05');
  assert.doesNotMatch(rows[0][1], /<a\b|href=|blob:|file:|secret-movie|private|Users/);
});

test('unsafe source URLs and invalid cue times fail before making unusable Anki links', () => {
  const f = fixture([{ start: 1, end: 2, text: 'Take care.' }], [[tag('selected')]]);
  for (const source of ['javascript:alert(1)', 'data:text/html,bad', 'http://example.test', 'https://user:password@example.test', 'https://example.test\n/path', '/relative', 'not a url']) {
    assert.throws(() => createAnkiTsv(f.subtitle, f.progress, source), /HTTPS URL/);
  }
  for (const start of [-1, NaN, Infinity]) {
    const invalid = fixture([{ start, end: 2, text: 'Take care.' }], [[tag('selected')]]);
    assert.throws(() => createAnkiTsv(invalid.subtitle, invalid.progress, SOURCE), /開始時刻/);
  }
});
