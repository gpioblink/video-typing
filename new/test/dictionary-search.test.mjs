import assert from 'node:assert/strict';
import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import { test } from 'node:test';

import {
  createEnglishDirectLookupCandidates,
  createEnglishLookupCandidateGroups,
  normalizeDictionaryHeadword,
  searchDictionaryWithLookup,
} from '../src/lib/dictionary.ts';
import { createTypedHintContextText } from '../src/lib/hintContext.ts';

const DICTIONARY_TSV_PATH = new URL('../../test/EIJIRO144-10.tsv', import.meta.url);

const WINDOWS = {
  takeCare: 'but you have to take care of yourself',
  keepUpThePace: 'Keep up the pace and it\'s totally doable.',
  checkItOut: 'Check it out!',
  gotCarriedAway: 'Sorry I got carried away.',
  workOut: 'It\'s all going to work out,',
  wantYouToThinkThat: 'I want you to think That I\'m the cutest girl',
  followOurTaleToTheEnd: 'I sincerely hope you\'ll follow our tale to the very end.',
  bustMyHumpAwfulChick: 'to bust my hump dealing with that awful chick all day long.',
};

const SEARCH_CASES = [
  {
    label: 'take care of yourself / take',
    contextText: WINDOWS.takeCare,
    query: 'take',
    expectedHeadwordsInOrder: ['take', 'take care of yourself'],
  },
  {
    label: 'take care of yourself / care',
    contextText: WINDOWS.takeCare,
    query: 'care',
    expectedHeadwordsInOrder: ['care', 'take care of yourself'],
  },
  {
    label: 'keep up the pace / keep',
    contextText: WINDOWS.keepUpThePace,
    query: 'Keep',
    expectedHeadwordsInOrder: ['keep', 'keep up the pace'],
  },
  {
    label: 'keep up the pace / pace',
    contextText: WINDOWS.keepUpThePace,
    query: 'pace',
    expectedHeadwordsInOrder: ['pace', 'keep up the pace'],
  },
  {
    label: 'check it out / check',
    contextText: WINDOWS.checkItOut,
    query: 'Check',
    expectedHeadwordsInOrder: ['check', 'check it out'],
  },
  {
    label: 'check it out / out',
    contextText: WINDOWS.checkItOut,
    query: 'out',
    expectedHeadwordsInOrder: ['out', 'check it out'],
  },
  {
    label: 'got carried away / got',
    contextText: WINDOWS.gotCarriedAway,
    query: 'got',
    expectedHeadwordsInOrder: ['get', 'get carried away'],
  },
  {
    label: 'got carried away / carried',
    contextText: WINDOWS.gotCarriedAway,
    query: 'carried',
    expectedHeadwordsInOrder: ['carry', 'get carried away'],
  },
  {
    label: 'got carried away / away',
    contextText: WINDOWS.gotCarriedAway,
    query: 'away',
    expectedHeadwordsInOrder: ['away', 'get carried away'],
  },
  {
    label: 'work out / work',
    contextText: WINDOWS.workOut,
    query: 'work',
    expectedHeadwordsInOrder: ['work', 'work out'],
  },
  {
    label: 'work out / out',
    contextText: WINDOWS.workOut,
    query: 'out',
    expectedHeadwordsInOrder: ['out', 'work out'],
  },
  {
    label: 'want someone to think that / I',
    contextText: WINDOWS.wantYouToThinkThat,
    query: 'I',
    expectedHeadwordsInOrder: ['I'],
  },
  {
    label: 'want someone to think that / want',
    contextText: WINDOWS.wantYouToThinkThat,
    query: 'want',
    expectedHeadwordsInOrder: ['want', 'want someone to think that'],
  },
  {
    label: 'want someone to think that / you',
    contextText: WINDOWS.wantYouToThinkThat,
    query: 'you',
    expectedHeadwordsInOrder: ['you'],
  },
  {
    label: 'want someone to think that / to',
    contextText: WINDOWS.wantYouToThinkThat,
    query: 'to',
    expectedHeadwordsInOrder: ['to', 'want someone to think that'],
  },
  {
    label: 'want someone to think that / think',
    contextText: WINDOWS.wantYouToThinkThat,
    query: 'think',
    expectedHeadwordsInOrder: ['think', 'want someone to think that'],
  },
  {
    label: 'want someone to think that / That',
    contextText: WINDOWS.wantYouToThinkThat,
    query: 'That',
    expectedHeadwordsInOrder: ['that', 'want someone to think that'],
  },
  {
    label: 'want someone to think that / I\'m',
    contextText: WINDOWS.wantYouToThinkThat,
    query: 'I\'m',
    expectedHeadwordsInOrder: ['I\'m'],
  },
  {
    label: 'want someone to think that / the',
    contextText: WINDOWS.wantYouToThinkThat,
    query: 'the',
    expectedHeadwordsInOrder: ['the'],
  },
  {
    label: 'want someone to think that / cutest',
    contextText: WINDOWS.wantYouToThinkThat,
    query: 'cutest',
    expectedHeadwordsInOrder: ['cute'],
  },
  {
    label: 'want someone to think that / girl',
    contextText: WINDOWS.wantYouToThinkThat,
    query: 'girl',
    expectedHeadwordsInOrder: ['girl'],
  },
  {
    label: 'follow someone to and to the very end / I',
    contextText: WINDOWS.followOurTaleToTheEnd,
    query: 'I',
    expectedHeadwordsInOrder: ['I'],
  },
  {
    label: 'follow someone to and to the very end / sincerely',
    contextText: WINDOWS.followOurTaleToTheEnd,
    query: 'sincerely',
    expectedHeadwordsInOrder: ['sincerely'],
  },
  {
    label: 'follow someone to and to the very end / hope',
    contextText: WINDOWS.followOurTaleToTheEnd,
    query: 'hope',
    expectedHeadwordsInOrder: ['hope'],
  },
  {
    label: 'follow someone to and to the very end / you\'ll',
    contextText: WINDOWS.followOurTaleToTheEnd,
    query: 'you\'ll',
    expectedHeadwordsInOrder: ['you\'ll'],
  },
  {
    label: 'follow someone to and to the very end / follow',
    contextText: WINDOWS.followOurTaleToTheEnd,
    query: 'follow',
    expectedHeadwordsInOrder: ['follow', 'follow someone to'],
  },
  {
    label: 'follow someone to and to the very end / our',
    contextText: WINDOWS.followOurTaleToTheEnd,
    query: 'our',
    expectedHeadwordsInOrder: ['our'],
  },
  {
    label: 'follow someone to and to the very end / tale',
    contextText: WINDOWS.followOurTaleToTheEnd,
    query: 'tale',
    expectedHeadwordsInOrder: ['tale'],
  },
  {
    label: 'follow someone to and to the very end / to',
    contextText: WINDOWS.followOurTaleToTheEnd,
    query: 'to',
    expectedHeadwordsInOrder: ['to', 'to the very end', 'follow someone to'],
  },
  {
    label: 'follow someone to and to the very end / the',
    contextText: WINDOWS.followOurTaleToTheEnd,
    query: 'the',
    expectedHeadwordsInOrder: ['the', 'to the very end'],
  },
  {
    label: 'follow someone to and to the very end / very',
    contextText: WINDOWS.followOurTaleToTheEnd,
    query: 'very',
    expectedHeadwordsInOrder: ['very', 'to the very end', 'very end'],
  },
  {
    label: 'follow someone to and to the very end / end',
    contextText: WINDOWS.followOurTaleToTheEnd,
    query: 'end',
    expectedHeadwordsInOrder: ['end', 'to the very end', 'very end'],
  },
  {
    label: 'typed context excludes future words / something',
    contextText: createContextThroughWord(
      'We\'ll find something\nfor you to play. Cool?',
      'something',
    ),
    expectedContextText: 'We\'ll find something',
    forbiddenHeadwords: ['play cool'],
    query: 'something',
    expectedHeadwordsInOrder: ['something'],
  },
  {
    label: 'typed context excludes future words / play',
    contextText: createContextThroughWord(
      'We\'ll find something\nfor you to play. Cool?',
      'play',
    ),
    expectedContextText: 'We\'ll find something\nfor you to play',
    forbiddenHeadwords: ['play cool'],
    query: 'play',
    expectedHeadwordsInOrder: ['play'],
  },
  {
    label: 'typed context includes completed sentence-crossing phrase / Cool',
    contextText: createContextThroughWord(
      'We\'ll find something\nfor you to play. Cool?',
      'Cool',
    ),
    expectedContextText: 'We\'ll find something\nfor you to play. Cool',
    query: 'Cool',
    expectedHeadwordsInOrder: ['cool', 'play cool'],
  },
  {
    label: 'bust my hump dealing with that awful chick / awful',
    contextText: createContextThroughWord(WINDOWS.bustMyHumpAwfulChick, 'awful'),
    expectedContextText: 'to bust my hump dealing with that awful',
    forbiddenHeadwords: ['all day long'],
    query: 'awful',
    expectedHeadwordsInOrder: ['awful'],
  },
  {
    label: 'bust my hump dealing with that awful chick / chick',
    contextText: createContextThroughWord(WINDOWS.bustMyHumpAwfulChick, 'chick'),
    expectedContextText: 'to bust my hump dealing with that awful chick',
    forbiddenHeadwords: ['all day long'],
    query: 'chick',
    expectedHeadwordsInOrder: ['chick'],
  },
  {
    label: 'bust my hump dealing with that awful chick / long',
    contextText: createContextThroughWord(WINDOWS.bustMyHumpAwfulChick, 'long'),
    expectedContextText: 'to bust my hump dealing with that awful chick all day long',
    query: 'long',
    expectedHeadwordsInOrder: ['long', 'all day long'],
  },
];

test('English dictionary search keeps single-word hints and context idiom hints', async (t) => {
  const lookup = await createTsvLookup(SEARCH_CASES);
  const originalConsoleLog = console.log;
  console.log = () => {};
  t.after(() => {
    console.log = originalConsoleLog;
  });

  for (const searchCase of SEARCH_CASES) {
    await t.test(searchCase.label, async () => {
      const entries = await searchDictionaryWithLookup(
        searchCase.query,
        'english',
        searchCase.contextText,
        lookup,
        searchCase.label,
      );
      const uniqueHeadwords = createUniqueHeadwords(entries);
      const matchedExpectedHeadwords = uniqueHeadwords.filter((headword) => (
        searchCase.expectedHeadwordsInOrder.includes(headword)
      ));

      if (searchCase.expectedContextText) {
        assert.equal(searchCase.contextText, searchCase.expectedContextText);
      }

      assert.deepEqual(
        matchedExpectedHeadwords,
        searchCase.expectedHeadwordsInOrder,
        [
          `query: ${searchCase.query}`,
          `context: ${searchCase.contextText}`,
          `actual headwords: ${uniqueHeadwords.join(', ')}`,
        ].join('\n'),
      );

      for (const forbiddenHeadword of searchCase.forbiddenHeadwords || []) {
        assert.equal(
          uniqueHeadwords.includes(forbiddenHeadword),
          false,
          [
            `query: ${searchCase.query}`,
            `context: ${searchCase.contextText}`,
            `forbidden headword: ${forbiddenHeadword}`,
            `actual headwords: ${uniqueHeadwords.join(', ')}`,
          ].join('\n'),
        );
      }
    });
  }
});

async function createTsvLookup(searchCases) {
  const wantedHeadwords = collectWantedHeadwords(searchCases);
  const entriesByHeadword = await loadWantedDictionaryEntries(wantedHeadwords);

  return {
    async getExact(normalizedHeadword, limit) {
      return (entriesByHeadword.get(normalizedHeadword) || []).slice(0, limit);
    },
    async getPrefix(prefix, limit) {
      const results = [];

      for (const key of [...entriesByHeadword.keys()].sort()) {
        if (!key.startsWith(prefix)) {
          continue;
        }

        results.push(...entriesByHeadword.get(key));

        if (results.length >= limit) {
          return results.slice(0, limit);
        }
      }

      return results;
    },
  };
}

function collectWantedHeadwords(searchCases) {
  const wanted = new Set();

  for (const {
    forbiddenHeadwords = [],
    query,
    contextText,
  } of searchCases) {
    for (const candidate of createEnglishDirectLookupCandidates(query)) {
      wanted.add(candidate);
    }

    for (const group of createEnglishLookupCandidateGroups(query, contextText)) {
      for (const candidate of group) {
        wanted.add(candidate);
      }
    }

    for (const forbiddenHeadword of forbiddenHeadwords) {
      wanted.add(normalizeDictionaryHeadword(forbiddenHeadword, 'english'));
    }
  }

  return wanted;
}

function createContextThroughWord(text, word) {
  const frame = {
    caption: Array.from(text, (char, index) => ({
      char,
      id: String(index),
      isTypeable: /[A-Za-z0-9]/.test(char),
    })),
    id: 'test-frame',
    tags: [],
  };
  const wordStartIndex = text.indexOf(word);

  assert.notEqual(wordStartIndex, -1, `test word was not found: ${word}`);

  const targetCharIds = Array.from(
    { length: word.length },
    (_value, index) => String(wordStartIndex + index),
  );

  return createTypedHintContextText(frame, targetCharIds);
}

async function loadWantedDictionaryEntries(wantedHeadwords) {
  const entriesByHeadword = new Map();
  const lines = createInterface({
    crlfDelay: Infinity,
    input: createReadStream(DICTIONARY_TSV_PATH, { encoding: 'utf8' }),
  });

  for await (const line of lines) {
    const tabIndex = line.indexOf('\t');

    if (tabIndex === -1) {
      continue;
    }

    const headword = line.slice(0, tabIndex).trim();
    const body = line.slice(tabIndex + 1).trim();
    const normalizedHeadword = normalizeDictionaryHeadword(headword, 'english');

    if (!headword || !body || !wantedHeadwords.has(normalizedHeadword)) {
      continue;
    }

    const entries = entriesByHeadword.get(normalizedHeadword) || [];
    entries.push({
      body,
      headword,
      importedAt: 0,
      key: `${normalizedHeadword}\u0000${body}`,
      normalizedHeadword,
      sourceName: 'EIJIRO144-10.tsv',
    });
    entriesByHeadword.set(normalizedHeadword, entries);
  }

  return entriesByHeadword;
}

function createUniqueHeadwords(entries) {
  const seen = new Set();
  const headwords = [];

  for (const entry of entries) {
    if (seen.has(entry.headword)) {
      continue;
    }

    seen.add(entry.headword);
    headwords.push(entry.headword);
  }

  return headwords;
}
