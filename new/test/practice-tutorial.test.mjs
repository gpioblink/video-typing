import assert from 'node:assert/strict';
import test from 'node:test';
import { createPracticeTutorialState, practiceTutorialReducer } from '../src/lib/practiceTutorial.ts';

const word = { frameId: 'frame-1', query: 'Original' };
const reduce = (state, ...events) => events.reduce(practiceTutorialReducer, state);
function reasonStep() {
  return reduce(createPracticeTutorialState(), { type: 'mistake' }, { type: 'mistake-word-completed', ...word });
}
function dictionaryStep() {
  return reduce(reasonStep(), { type: 'reason-recorded' }, { type: 'dictionary-shown', ...word });
}

test('five tutorial stages follow actual input, mistake, reason and dictionary actions', () => {
  const initial = createPracticeTutorialState();
  assert.deepEqual(initial, { stage: 'type', reasonRecorded: false, shownDictionaryKeys: [] });
  assert.equal(practiceTutorialReducer(initial, { type: 'input' }), initial);
  const mistaken = practiceTutorialReducer(initial, { type: 'mistake' });
  assert.equal(mistaken.stage, 'mistake');
  assert.equal(practiceTutorialReducer(mistaken, { type: 'input' }), mistaken);
  const reason = practiceTutorialReducer(mistaken, { type: 'mistake-word-completed', ...word });
  assert.equal(reason.stage, 'reason');
  assert.equal(reason.wordKey, JSON.stringify(['frame-1', 'original']));
  const recorded = practiceTutorialReducer(reason, { type: 'reason-recorded' });
  assert.equal(recorded.stage, 'reason');
  assert.equal(recorded.reasonRecorded, true);
  const dictionary = practiceTutorialReducer(recorded, { type: 'dictionary-shown', ...word });
  assert.equal(dictionary.stage, 'dictionary');
  assert.equal(practiceTutorialReducer(dictionary, { type: 'confirm-dictionary' }).stage, 'complete');
});

test('a third-error dictionary response arriving before word completion cannot skip the reason step', () => {
  const mistaken = practiceTutorialReducer(createPracticeTutorialState(), { type: 'mistake' });
  const early = practiceTutorialReducer(mistaken, { type: 'dictionary-shown', ...word });
  assert.equal(early.stage, 'mistake');
  const reason = practiceTutorialReducer(early, { type: 'mistake-word-completed', ...word });
  assert.equal(reason.stage, 'reason');
  assert.equal(reason.reasonRecorded, false);
  assert.equal(practiceTutorialReducer(reason, { type: 'input' }), reason);
  assert.equal(practiceTutorialReducer(reason, { type: 'reason-recorded' }).stage, 'dictionary');
});

test('dictionary-first ordering still waits for the recorded reason for the same word', () => {
  const shown = practiceTutorialReducer(reasonStep(), { type: 'dictionary-shown', ...word });
  assert.equal(shown.stage, 'reason');
  assert.equal(practiceTutorialReducer(shown, { type: 'confirm-dictionary' }), shown);
  const dictionary = practiceTutorialReducer(shown, { type: 'reason-recorded' });
  assert.equal(dictionary.stage, 'dictionary');
  assert.equal(practiceTutorialReducer(dictionary, { type: 'input' }).stage, 'complete');
});

test('out-of-order events and correct typing alone never skip the first stage', () => {
  let state = createPracticeTutorialState();
  for (const event of [
    { type: 'input' }, { type: 'input' }, { type: 'reason-recorded' },
    { type: 'confirm-dictionary' }, { type: 'mistake-word-completed', ...word },
    { type: 'dictionary-shown', ...word }, { type: 'input' },
  ]) {
    state = practiceTutorialReducer(state, event);
    assert.equal(state.stage, 'type');
    assert.equal(state.reasonRecorded, false);
    assert.equal(state.wordKey, undefined);
  }
  state = practiceTutorialReducer(state, { type: 'mistake' });
  state = practiceTutorialReducer(state, { type: 'reason-recorded' });
  assert.equal(state.stage, 'mistake');
  assert.equal(state.reasonRecorded, false, 'an early reason event is not carried into the reason step');
});

test('stale frame and unrelated dictionary responses cannot satisfy the selected mistake word', () => {
  let state = practiceTutorialReducer(reasonStep(), { type: 'reason-recorded' });
  state = practiceTutorialReducer(state, { type: 'dictionary-shown', frameId: 'other-frame', query: word.query });
  assert.equal(state.stage, 'reason');
  state = practiceTutorialReducer(state, { type: 'dictionary-shown', frameId: word.frameId, query: 'Different' });
  assert.equal(state.stage, 'reason');
  state = practiceTutorialReducer(state, { type: 'dictionary-shown', frameId: word.frameId, query: '  ORIGINAL  ' });
  assert.equal(state.stage, 'dictionary');
});

test('the first completed mistake word is not overwritten by a later word', () => {
  const first = reasonStep();
  const later = reduce(first,
    { type: 'mistake' },
    { type: 'mistake-word-completed', frameId: 'frame-2', query: 'Later' },
  );
  assert.equal(later, first);
  const recorded = reduce(later, { type: 'reason-recorded' }, { type: 'dictionary-shown', frameId: 'frame-2', query: 'Later' });
  assert.equal(recorded.stage, 'reason');
  assert.equal(recorded.wordKey, first.wordKey);
});

test('structured word keys distinguish separator-containing frame and query combinations', () => {
  let state = reduce(createPracticeTutorialState(),
    { type: 'mistake' },
    { type: 'mistake-word-completed', frameId: 'a:b', query: 'c' },
    { type: 'reason-recorded' },
    { type: 'dictionary-shown', frameId: 'a', query: 'b:c' },
  );
  assert.equal(state.stage, 'reason');
  state = practiceTutorialReducer(state, { type: 'dictionary-shown', frameId: 'a:b', query: 'c' });
  assert.equal(state.stage, 'dictionary');
});

test('the dictionary cache retains at most one hundred recent distinct keys', () => {
  let state = createPracticeTutorialState();
  for (let index = 0; index < 105; index++) {
    state = practiceTutorialReducer(state, { type: 'dictionary-shown', frameId: 'frame', query: `word-${index}` });
  }
  assert.equal(state.stage, 'type');
  assert.equal(state.shownDictionaryKeys.length, 100);
  assert.equal(state.shownDictionaryKeys[0], JSON.stringify(['frame', 'word-5']));
  state = practiceTutorialReducer(state, { type: 'dictionary-shown', frameId: 'frame', query: 'WORD-5' });
  assert.equal(state.shownDictionaryKeys.length, 100);
  assert.equal(state.shownDictionaryKeys.at(-1), JSON.stringify(['frame', 'word-5']));
  assert.equal(new Set(state.shownDictionaryKeys).size, 100);
});

test('complete is stable until reset and reset discards all prior word and dictionary state', () => {
  const completed = practiceTutorialReducer(dictionaryStep(), { type: 'input' });
  for (const event of [
    { type: 'input' }, { type: 'mistake' }, { type: 'reason-recorded' }, { type: 'confirm-dictionary' },
    { type: 'mistake-word-completed', frameId: 'later', query: 'Later' },
    { type: 'dictionary-shown', frameId: 'later', query: 'Later' },
  ]) assert.equal(practiceTutorialReducer(completed, event), completed);
  const fresh = practiceTutorialReducer(completed, { type: 'reset' });
  assert.deepEqual(fresh, createPracticeTutorialState());
  assert.equal(Object.hasOwn(fresh, 'wordKey'), false);
  assert.notEqual(fresh.shownDictionaryKeys, completed.shownDictionaryKeys);
  assert.notEqual(createPracticeTutorialState().shownDictionaryKeys, fresh.shownDictionaryKeys);
});

test('blank word identities are ignored and reducers never mutate previous state', () => {
  const state = Object.freeze({ ...createPracticeTutorialState(), stage: 'mistake', shownDictionaryKeys: Object.freeze([]) });
  for (const fields of [{ frameId: '', query: 'word' }, { frameId: 'frame', query: '   ' }]) {
    assert.equal(practiceTutorialReducer(state, { type: 'mistake-word-completed', ...fields }), state);
    assert.equal(practiceTutorialReducer(state, { type: 'dictionary-shown', ...fields }), state);
  }
  const next = practiceTutorialReducer(state, { type: 'dictionary-shown', ...word });
  assert.deepEqual(state.shownDictionaryKeys, []);
  assert.equal(next.shownDictionaryKeys.length, 1);
});
