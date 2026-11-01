export type PracticeTutorialStage = 'type' | 'mistake' | 'reason' | 'dictionary' | 'complete';

export interface PracticeTutorialState {
  stage: PracticeTutorialStage;
  wordKey?: string;
  reasonRecorded: boolean;
  shownDictionaryKeys: string[];
}

export type PracticeTutorialEvent =
  | { type: 'input' | 'mistake' | 'reason-recorded' | 'confirm-dictionary' | 'reset' }
  | { type: 'mistake-word-completed' | 'dictionary-shown'; frameId: string; query: string };

const MAX_DICTIONARY_KEYS = 100;

export function createPracticeTutorialState(): PracticeTutorialState {
  return { stage: 'type', reasonRecorded: false, shownDictionaryKeys: [] };
}

function wordKey(frameId: string, query: string): string | undefined {
  if (typeof frameId !== 'string' || !frameId || typeof query !== 'string' || !query.trim()) return undefined;
  return JSON.stringify([frameId, query.trim().toLowerCase()]);
}

/** Record observed practice actions only; no stage advances from a timer or
 * from an unrelated word's asynchronous dictionary response. */
export function practiceTutorialReducer(
  state: PracticeTutorialState,
  event: PracticeTutorialEvent,
): PracticeTutorialState {
  if (event.type === 'reset') return createPracticeTutorialState();
  if (state.stage === 'complete') return state;
  switch (event.type) {
    case 'input':
    case 'confirm-dictionary':
      return state.stage === 'dictionary' ? { ...state, stage: 'complete' } : state;
    case 'mistake':
      return state.stage === 'type' ? { ...state, stage: 'mistake' } : state;
    case 'mistake-word-completed': {
      if (state.stage !== 'mistake' || state.wordKey) return state;
      const key = wordKey(event.frameId, event.query);
      if (!key) return state;
      // Even if the third-mistake lookup already finished, first show the
      // reason step and wait for the user's recorded reason.
      return { ...state, stage: 'reason', wordKey: key, reasonRecorded: false };
    }
    case 'reason-recorded': {
      if (state.stage !== 'reason') return state;
      const stage = state.wordKey && state.shownDictionaryKeys.includes(state.wordKey)
        ? 'dictionary' : 'reason';
      if (state.reasonRecorded && stage === state.stage) return state;
      return { ...state, stage, reasonRecorded: true };
    }
    case 'dictionary-shown': {
      const key = wordKey(event.frameId, event.query);
      if (!key) return state;
      const keys = state.shownDictionaryKeys;
      const shownDictionaryKeys = keys.at(-1) === key ? keys
        : [...keys.filter(previous => previous !== key), key].slice(-MAX_DICTIONARY_KEYS);
      const stage = state.stage === 'reason' && state.reasonRecorded && state.wordKey === key
        ? 'dictionary' : state.stage;
      if (stage === state.stage && shownDictionaryKeys === keys) return state;
      return { ...state, stage, shownDictionaryKeys };
    }
  }
}
