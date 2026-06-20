import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Style } from './style';
import { Line } from '../Line';
import type { CaptionFrame, Char, ID, Tag, TagContent } from '../../../types';

export type TypingStatus = 'wait' | 'available' | 'mistaken' | 'finished';

export interface GameChar {
  char: Char;
  input: string;
  status: TypingStatus;
}

interface Props {
  frame: CaptionFrame;
  initialFinishedCharIds: ID[];
  sendCompleted: () => void;
  requestExplanation: (query: string, options?: { silentIfMissing?: boolean }) => void;
  sendMistake: (reason: TagContent) => void;
  onFrameInteracted: () => void;
  onFinishedCharIdsChange: (finishedCharIds: ID[]) => void;
  onTagsChange: (tags: Tag[]) => void;
}

const AUTO_HINT_EXCLUDED_WORDS = new Set([
  'a', 'an', 'the',
  'i', 'me', 'my', 'mine', 'myself',
  'you', 'your', 'yours', 'yourself', 'yourselves',
  'he', 'him', 'his', 'himself',
  'she', 'her', 'hers', 'herself',
  'it', 'its', 'itself',
  'we', 'us', 'our', 'ours', 'ourselves',
  'they', 'them', 'their', 'theirs', 'themselves',
  'this', 'that', 'these', 'those',
  'who', 'whom', 'whose', 'what', 'which', 'when', 'where', 'why', 'how',
]);

function initializeGame(frame: CaptionFrame, initialFinishedCharIds: ID[]) {
  const finishedCharIds = new Set(initialFinishedCharIds);
  const gameChars = frame.caption.map((char) => ({
    char,
    input: '_',
    status: (
      char.isTypeable && finishedCharIds.has(char.id)
        ? 'finished'
        : 'wait'
    ) as TypingStatus,
  }));

  const firstWaitingTypeable = gameChars.find((char) => char.char.isTypeable && char.status === 'wait');
  if (firstWaitingTypeable) {
    firstWaitingTypeable.status = 'available';
  }

  return {
    gameChars,
    tags: [...frame.tags],
  };
}

function charsToString(chars: Char[]) {
  return chars.map((char) => char.char).join('');
}

function getWordInfo(frame: CaptionFrame, currentCharId: ID) {
  const charIndex = frame.caption.findIndex((char) => char.id === currentCharId);

  if (charIndex === -1 || !frame.caption[charIndex]?.isTypeable) {
    return null;
  }

  let wordStartIndex = charIndex;
  while (wordStartIndex > 0 && frame.caption[wordStartIndex - 1]?.isTypeable) {
    wordStartIndex -= 1;
  }

  let wordEndIndex = charIndex;
  while (wordEndIndex + 1 < frame.caption.length && frame.caption[wordEndIndex + 1]?.isTypeable) {
    wordEndIndex += 1;
  }

  return {
    targetCharIds: frame.caption.slice(wordStartIndex, wordEndIndex + 1).map((char) => char.id),
    query: charsToString(frame.caption.slice(wordStartIndex, wordEndIndex + 1)),
  };
}

function shouldRequestAutoHint(query: string) {
  const normalized = query.trim().toLowerCase();

  if (!normalized || normalized.length <= 2) {
    return false;
  }

  return !AUTO_HINT_EXCLUDED_WORDS.has(normalized);
}

function createMistakeTag(
  frame: CaptionFrame,
  keyboardLog: Array<{ currentCharId: ID; isCorrect: boolean }>,
  currentCharId: ID,
) {
  const wordInfo = getWordInfo(frame, currentCharId);
  if (!wordInfo) return null;

  const targetLogs = keyboardLog.filter((log) => wordInfo.targetCharIds.includes(log.currentCharId));
  const missCount = targetLogs.filter((log) => !log.isCorrect).length;

  if (missCount === 0) return null;

  const content: TagContent =
    missCount <= 2 ? 'spelling' : targetLogs.some((log) => !log.isCorrect) ? 'ignorance' : 'others';

  return {
    content,
    query: wordInfo.query,
    tag: {
      id: crypto.randomUUID(),
      pastedCharIds: wordInfo.targetCharIds,
      content,
    } satisfies Tag,
  };
}

export function Window({
  frame,
  initialFinishedCharIds,
  sendCompleted,
  requestExplanation,
  sendMistake,
  onFrameInteracted,
  onFinishedCharIdsChange,
  onTagsChange,
}: Props) {
  const [game, setGame] = useState(() => initializeGame(frame, initialFinishedCharIds));
  const [keyboardLog, setKeyboardLog] = useState<Array<{ currentCharId: ID; isCorrect: boolean }>>([]);
  const gameRef = useRef(game);
  const keyboardLogRef = useRef(keyboardLog);
  const keyboardRef = useRef<HTMLDivElement>(null);
  const hintedWordKeysRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    const nextGame = initializeGame(frame, initialFinishedCharIds);
    gameRef.current = nextGame;
    setGame(nextGame);
    keyboardLogRef.current = [];
    setKeyboardLog([]);
    hintedWordKeysRef.current = new Set();
  }, [frame.id]);

  useEffect(() => {
    gameRef.current = game;
  }, [game]);

  useEffect(() => {
    keyboardLogRef.current = keyboardLog;
  }, [keyboardLog]);

  const finishedCharIds = useMemo(() => (
    game.gameChars
      .filter((char) => char.status === 'finished' && char.char.isTypeable)
      .map((char) => char.char.id)
  ), [game.gameChars]);

  useEffect(() => {
    onFinishedCharIdsChange(finishedCharIds);
  }, [finishedCharIds, onFinishedCharIdsChange]);

  useEffect(() => {
    onTagsChange(game.tags);
  }, [game.tags, onTagsChange]);

  const splitCharsByNewLine = useMemo(() => {
    const rows: GameChar[][] = [[]];
    game.gameChars.forEach((char) => {
      rows[rows.length - 1].push(char);
      if (char.char.char === '\n') {
        rows.push([]);
      }
    });
    return rows;
  }, [game.gameChars]);

  return (
    <Style
      tabIndex={0}
      ref={keyboardRef}
      onClick={() => keyboardRef.current?.focus()}
      onKeyDown={(event) => {
        event.stopPropagation();
        const state = gameRef.current;
        const nextChars = [...state.gameChars];
        const inputIndex = nextChars.findIndex((char) => (
          char.char.isTypeable && (char.status === 'available' || char.status === 'mistaken')
        ));

        if (inputIndex === -1) {
          return;
        }

        onFrameInteracted();

        nextChars[inputIndex] = {
          ...nextChars[inputIndex],
          input: event.key,
        };

        const isCorrect = event.key.toLowerCase() === nextChars[inputIndex].char.char.toLowerCase();
        const nextKeyboardLog = [
          ...keyboardLogRef.current,
          { currentCharId: nextChars[inputIndex].char.id, isCorrect },
        ];
        keyboardLogRef.current = nextKeyboardLog;
        setKeyboardLog(nextKeyboardLog);

        let nextTags = state.tags;

        if (isCorrect) {
          const wordInfo = getWordInfo(frame, nextChars[inputIndex].char.id);
          nextChars[inputIndex] = {
            ...nextChars[inputIndex],
            status: 'finished',
          };

          const nextWaitIndex = nextChars.findIndex((char) => char.char.isTypeable && char.status === 'wait');

          if (nextWaitIndex === -1 || inputIndex + 1 !== nextWaitIndex) {
            const mistake = createMistakeTag(frame, nextKeyboardLog, nextChars[inputIndex].char.id);
            const wordKey = wordInfo?.targetCharIds.join(',');

            if (mistake) {
              nextTags = [...state.tags, mistake.tag];
              requestExplanation(mistake.query);
              sendMistake(mistake.content);
              if (wordKey) {
                hintedWordKeysRef.current.add(wordKey);
              }
            } else if (
              wordInfo &&
              wordKey &&
              shouldRequestAutoHint(wordInfo.query) &&
              !hintedWordKeysRef.current.has(wordKey)
            ) {
              hintedWordKeysRef.current.add(wordKey);
              requestExplanation(wordInfo.query, { silentIfMissing: true });
            }
          }

          if (nextWaitIndex !== -1) {
            nextChars[nextWaitIndex] = {
              ...nextChars[nextWaitIndex],
              status: 'available',
            };
          } else {
            sendCompleted();
          }
        } else {
          const wordInfo = getWordInfo(frame, nextChars[inputIndex].char.id);

          if (wordInfo) {
            const missCount = nextKeyboardLog.filter((log) => (
              !log.isCorrect && wordInfo.targetCharIds.includes(log.currentCharId)
            )).length;
            const wordKey = wordInfo.targetCharIds.join(',');

            if (missCount >= 3 && !hintedWordKeysRef.current.has(wordKey)) {
              hintedWordKeysRef.current.add(wordKey);
              requestExplanation(wordInfo.query);
            }
          }

          nextChars[inputIndex] = {
            ...nextChars[inputIndex],
            status: 'mistaken',
          };
        }

        const nextGame = {
          ...state,
          gameChars: nextChars,
          tags: nextTags,
        };
        gameRef.current = nextGame;
        setGame(nextGame);
      }}
    >
      {splitCharsByNewLine.map((chars, index) => (
        <Line key={chars[0]?.char.id || `line-${index}`} chars={chars} tags={game.tags} />
      ))}
    </Style>
  );
}
