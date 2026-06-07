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
  sendCompleted: () => void;
  requestExplanation: (query: string) => void;
  sendMistake: (reason: TagContent) => void;
}

function initializeGame(frame: CaptionFrame) {
  const gameChars = frame.caption.map((char) => ({
    char,
    input: '_',
    status: 'wait' as TypingStatus,
  }));

  const firstTypeable = gameChars.find((char) => char.char.isTypeable);
  if (firstTypeable) {
    firstTypeable.status = 'available';
  }

  return {
    gameChars,
    tags: [...frame.tags],
  };
}

function charsToString(chars: Char[]) {
  return chars.map((char) => char.char).join('');
}

export function Window({ frame, sendCompleted, requestExplanation, sendMistake }: Props) {
  const [game, setGame] = useState(() => initializeGame(frame));
  const [keyboardLog, setKeyboardLog] = useState<Array<{ currentCharId: ID; isCorrect: boolean }>>([]);
  const keyboardRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setGame(initializeGame(frame));
    setKeyboardLog([]);
  }, [frame.id]);

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

  const addTag = (tag: Tag) => {
    setGame((state) => ({
      ...state,
      tags: [...state.tags, tag],
    }));
  };

  const judgeTag = (currentCharId: ID) => {
    const charIndex = frame.caption.findIndex((char) => char.id === currentCharId);
    if (charIndex === -1) return;

    const targetCharIds: string[] = [];
    let wordHeadIndex = 0;

    for (wordHeadIndex = charIndex; wordHeadIndex >= 0; wordHeadIndex -= 1) {
      if (!frame.caption[wordHeadIndex].isTypeable) break;
      targetCharIds.push(frame.caption[wordHeadIndex].id);
    }

    const targetLogs = keyboardLog.filter((log) => targetCharIds.includes(log.currentCharId));
    const missCount = targetLogs.filter((log) => !log.isCorrect).length;

    if (missCount === 0) return;

    requestExplanation(charsToString(frame.caption.slice(wordHeadIndex + 1)));

    const content: TagContent =
      missCount <= 2 ? 'spelling' : targetLogs.some((log) => !log.isCorrect) ? 'ignorance' : 'others';

    addTag({
      id: crypto.randomUUID(),
      pastedCharIds: targetCharIds,
      content,
    });
    sendMistake(content);
  };

  return (
    <Style
      tabIndex={0}
      ref={keyboardRef}
      onClick={() => keyboardRef.current?.focus()}
      onKeyDown={(event) => {
        event.stopPropagation();

        setGame((state) => {
          const nextChars = [...state.gameChars];
          const inputIndex = nextChars.findIndex((char) => (
            char.char.isTypeable && (char.status === 'available' || char.status === 'mistaken')
          ));

          if (inputIndex === -1) {
            return state;
          }

          nextChars[inputIndex] = {
            ...nextChars[inputIndex],
            input: event.key,
          };

          const isCorrect = event.key.toLowerCase() === nextChars[inputIndex].char.char.toLowerCase();

          setKeyboardLog((logs) => [
            ...logs,
            { currentCharId: nextChars[inputIndex].char.id, isCorrect },
          ]);

          if (isCorrect) {
            nextChars[inputIndex] = {
              ...nextChars[inputIndex],
              status: 'finished',
            };

            const nextWaitIndex = nextChars.findIndex((char) => char.char.isTypeable && char.status === 'wait');

            if (nextWaitIndex === -1 || inputIndex + 1 !== nextWaitIndex) {
              judgeTag(nextChars[inputIndex].char.id);
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
            nextChars[inputIndex] = {
              ...nextChars[inputIndex],
              status: 'mistaken',
            };
          }

          return {
            ...state,
            gameChars: nextChars,
          };
        });
      }}
    >
      {splitCharsByNewLine.map((chars, index) => (
        <Line key={chars[0]?.char.id || `line-${index}`} chars={chars} tags={game.tags} />
      ))}
    </Style>
  );
}
