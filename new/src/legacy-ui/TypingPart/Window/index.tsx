import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Style } from './style';
import { Line } from '../Line';
import { createTypedHintContextText } from '../../../lib/hintContext';
import { isNetflixHostname } from '../../../lib/netflixSeek';
import type { CaptionFrame, Char, ChineseTypingWord, ID, Tag, TagContent } from '../../../types';

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
  requestExplanation: (query: string, options?: ExplanationRequestOptions) => Promise<void>;
  onMistakeInput?: () => void;
  onMistakeReasonPromptOpen?: () => void;
  onMistakeReasonPromptClose?: () => void;
  onFrameInteracted: () => void;
  onFinishedCharIdsChange: (finishedCharIds: ID[]) => void;
  onTagsChange: (tags: Tag[]) => void;
}

interface ExplanationRequestOptions {
  contextText?: string;
  priority?: boolean;
  silentIfMissing?: boolean;
  sourceText?: string;
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

const DEFAULT_COLUMNS_PER_LINE = 50;
const CHAR_CELL_WIDTH = 12;
const WINDOW_HORIZONTAL_PADDING = 24;
const MISTAKE_REASON_KEYS: Record<string, TagContent> = {
  j: 'ignorance',
  k: 'unaudible',
  l: 'spelling',
};

interface WordInfo {
  targetCharIds: ID[];
  query: string;
}

interface PendingMistake extends WordInfo {
  sourceText?: string;
  shouldCompleteAfterSelection: boolean;
}

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

function getWordInfo(frame: CaptionFrame, currentCharId: ID): WordInfo | null {
  const charIndex = frame.caption.findIndex((char) => char.id === currentCharId);

  if (charIndex === -1 || !frame.caption[charIndex]?.isTypeable) {
    return null;
  }

  let wordStartIndex = charIndex;
  while (wordStartIndex > 0 && isEnglishWordPart(frame.caption, wordStartIndex - 1)) {
    wordStartIndex -= 1;
  }

  let wordEndIndex = charIndex;
  while (
    wordEndIndex + 1 < frame.caption.length &&
    isEnglishWordPart(frame.caption, wordEndIndex + 1)
  ) {
    wordEndIndex += 1;
  }

  const wordChars = frame.caption.slice(wordStartIndex, wordEndIndex + 1);

  return {
    targetCharIds: wordChars.filter((char) => char.isTypeable).map((char) => char.id),
    query: charsToString(wordChars).replace(/’/g, "'"),
  };
}

function isEnglishWordPart(caption: Char[], index: number) {
  const char = caption[index];

  if (char?.isTypeable) {
    return true;
  }

  if (!char || !/['’-]/.test(char.char)) {
    return false;
  }

  return Boolean(caption[index - 1]?.isTypeable && caption[index + 1]?.isTypeable);
}

function getChineseSourceTextForWordInfo(
  frame: CaptionFrame,
  wordInfo: { targetCharIds: ID[] },
) {
  const words = (frame as CaptionFrame & { words?: ChineseTypingWord[] }).words;

  if (!words?.length) {
    return undefined;
  }

  const targetCharIds = new Set(wordInfo.targetCharIds);

  for (const word of words) {
    const startIndex = frame.caption.findIndex((char) => char.id === word.startCharId);
    const endIndex = frame.caption.findIndex((char) => char.id === word.endCharId);

    if (startIndex === -1 || endIndex === -1) {
      continue;
    }

    const wordCharIds = frame.caption
      .slice(startIndex, endIndex + 1)
      .filter((char) => char.isTypeable)
      .map((char) => char.id);

    if (wordCharIds.some((charId) => targetCharIds.has(charId))) {
      return word.sourceText;
    }
  }

  return undefined;
}

function shouldRequestAutoHint(query: string) {
  const normalized = query.trim().toLowerCase();

  if (!normalized || normalized.length <= 2) {
    return false;
  }

  return !AUTO_HINT_EXCLUDED_WORDS.has(normalized);
}

function splitGameCharsIntoRows(gameChars: GameChar[], columnsPerLine: number) {
  const rows: GameChar[][] = [[]];

  for (const char of gameChars) {
    let currentRow = rows[rows.length - 1];

    if (char.char.char !== '\n' && currentRow.length >= columnsPerLine) {
      currentRow = [];
      rows.push(currentRow);
    }

    currentRow.push(char);

    if (char.char.char === '\n') {
      rows.push([]);
    }
  }

  return rows;
}

function hasMistakeInWord(
  keyboardLog: Array<{ currentCharId: ID; isCorrect: boolean }>,
  targetCharIds: ID[],
) {
  return keyboardLog.some((log) => !log.isCorrect && targetCharIds.includes(log.currentCharId));
}

function getNextTagContent(content: TagContent): TagContent | null {
  switch (content) {
    case 'ignorance':
      return 'unaudible';
    case 'unaudible':
      return 'spelling';
    case 'spelling':
      return null;
    case 'others':
      return 'ignorance';
    default:
      return 'ignorance';
  }
}

function stopKeyboardEventPropagation(event: React.KeyboardEvent) {
  event.stopPropagation();
  event.nativeEvent.stopImmediatePropagation();
}

export function Window({
  frame,
  initialFinishedCharIds,
  sendCompleted,
  requestExplanation,
  onMistakeInput,
  onMistakeReasonPromptOpen,
  onMistakeReasonPromptClose,
  onFrameInteracted,
  onFinishedCharIdsChange,
  onTagsChange,
}: Props) {
  const [game, setGame] = useState(() => initializeGame(frame, initialFinishedCharIds));
  const [keyboardLog, setKeyboardLog] = useState<Array<{ currentCharId: ID; isCorrect: boolean }>>([]);
  const [pendingMistake, setPendingMistake] = useState<PendingMistake | null>(null);
  const gameRef = useRef(game);
  const keyboardLogRef = useRef(keyboardLog);
  const keyboardRef = useRef<HTMLDivElement>(null);
  const hintedWordKeysRef = useRef<Set<string>>(new Set());
  const [columnsPerLine, setColumnsPerLine] = useState(DEFAULT_COLUMNS_PER_LINE);
  const isNetflixPage = useMemo(() => isNetflixHostname(window.location.hostname), []);

  useEffect(() => {
    const nextGame = initializeGame(frame, initialFinishedCharIds);
    gameRef.current = nextGame;
    setGame(nextGame);
    keyboardLogRef.current = [];
    setKeyboardLog([]);
    hintedWordKeysRef.current = new Set();
    setPendingMistake(null);
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

  useEffect(() => {
    const element = keyboardRef.current;

    if (!element) {
      return;
    }

    const updateColumns = () => {
      const contentWidth = Math.max(CHAR_CELL_WIDTH, element.clientWidth - WINDOW_HORIZONTAL_PADDING);
      setColumnsPerLine(Math.max(1, Math.floor(contentWidth / CHAR_CELL_WIDTH)));
    };

    updateColumns();

    const observer = new ResizeObserver(updateColumns);
    observer.observe(element);

    return () => {
      observer.disconnect();
    };
  }, []);

  const splitCharsByRows = useMemo(() => {
    return splitGameCharsIntoRows(game.gameChars, columnsPerLine);
  }, [columnsPerLine, game.gameChars]);

  const selectMistakeReason = async (content: TagContent) => {
    if (!pendingMistake) {
      return;
    }

    const nextTag: Tag = {
      id: crypto.randomUUID(),
      pastedCharIds: pendingMistake.targetCharIds,
      content,
    };

    setGame((state) => {
      const nextGame = {
        ...state,
        tags: [...state.tags, nextTag],
      };
      gameRef.current = nextGame;
      return nextGame;
    });

    console.log('[video-typing][hint][typing-request]', {
      frameId: frame.id,
      trigger: 'mistake-reason-selected',
      query: pendingMistake.query,
      reason: content,
      shouldCompleteAfterSelection: pendingMistake.shouldCompleteAfterSelection,
    });
    const explanationPromise = requestExplanation(
      pendingMistake.query,
      {
        contextText: pendingMistake.sourceText
          ? undefined
          : createTypedHintContextText(frame, pendingMistake.targetCharIds),
        sourceText: pendingMistake.sourceText,
      },
    );
    hintedWordKeysRef.current.add(pendingMistake.targetCharIds.join(','));
    setPendingMistake(null);
    onMistakeReasonPromptClose?.();

    if (pendingMistake.shouldCompleteAfterSelection) {
      await explanationPromise;
      sendCompleted();
      return;
    }

    window.setTimeout(() => {
      keyboardRef.current?.focus();
    }, 0);
  };

  const handleTaggedWordClick = (charId: ID) => {
    if (pendingMistake) {
      return;
    }

    const wordInfo = getWordInfo(frame, charId);

    if (!wordInfo) {
      return;
    }

    const targetTag = gameRef.current.tags.find((tag) => (
      tag.pastedCharIds.length === wordInfo.targetCharIds.length &&
      tag.pastedCharIds.every((tagCharId, index) => tagCharId === wordInfo.targetCharIds[index])
    ));

    onFrameInteracted();

    setGame((state) => {
      const nextTags = !targetTag
        ? [...state.tags, {
          id: crypto.randomUUID(),
          pastedCharIds: wordInfo.targetCharIds,
          content: 'ignorance' as TagContent,
        }]
        : (() => {
          const nextContent = getNextTagContent(targetTag.content);
          return nextContent == null
            ? state.tags.filter((tag) => tag.id !== targetTag.id)
            : state.tags.map((tag) => (
              tag.id === targetTag.id
                ? { ...tag, content: nextContent }
                : tag
            ));
        })();
      const nextGame = {
        ...state,
        tags: nextTags,
      };
      gameRef.current = nextGame;
      return nextGame;
    });
  };

  const restoreFocusIfNetflixTakesIt = (event: React.FocusEvent<HTMLDivElement>) => {
    if (!isNetflixPage) {
      return;
    }

    const nextFocusedElement = event.relatedTarget;

    if (nextFocusedElement instanceof Node && event.currentTarget.contains(nextFocusedElement)) {
      return;
    }

    window.setTimeout(() => {
      const keyboardElement = keyboardRef.current;

      if (!keyboardElement) {
        return;
      }

      const rootNode = keyboardElement.getRootNode();
      const activeElement = rootNode instanceof ShadowRoot
        ? rootNode.activeElement
        : document.activeElement;

      if (activeElement instanceof Node && keyboardElement.contains(activeElement)) {
        return;
      }

      if (rootNode instanceof ShadowRoot && activeElement) {
        return;
      }

      if (
        !(rootNode instanceof ShadowRoot) &&
        activeElement &&
        activeElement !== document.body &&
        activeElement !== document.documentElement
      ) {
        return;
      }

      keyboardElement.focus();
    }, 0);
  };

  return (
    <Style
      tabIndex={0}
      ref={keyboardRef}
      onClick={() => keyboardRef.current?.focus()}
      onBlur={restoreFocusIfNetflixTakesIt}
      onKeyUp={stopKeyboardEventPropagation}
      onKeyPress={stopKeyboardEventPropagation}
      onKeyDown={(event) => {
        stopKeyboardEventPropagation(event);
        if (pendingMistake) {
          event.preventDefault();
          const nextReason = MISTAKE_REASON_KEYS[event.key.toLowerCase()];

          if (nextReason) {
            selectMistakeReason(nextReason);
          }
          return;
        }

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
          let explanationPromise: Promise<void> | null = null;
          const wordInfo = getWordInfo(frame, nextChars[inputIndex].char.id);
          nextChars[inputIndex] = {
            ...nextChars[inputIndex],
            status: 'finished',
          };

          const nextWaitIndex = nextChars.findIndex((char) => char.char.isTypeable && char.status === 'wait');

          if (nextWaitIndex === -1 || inputIndex + 1 !== nextWaitIndex) {
            const wordKey = wordInfo?.targetCharIds.join(',');
            const sourceText = wordInfo ? getChineseSourceTextForWordInfo(frame, wordInfo) : undefined;
            const contextText = wordInfo && !sourceText
              ? createTypedHintContextText(frame, wordInfo.targetCharIds)
              : undefined;
            const hadMistake = Boolean(
              wordInfo && hasMistakeInWord(nextKeyboardLog, wordInfo.targetCharIds),
            );

            console.log('[video-typing][hint][word-completed]', {
              frameId: frame.id,
              query: wordInfo?.query,
              wordKey,
              isLastWord: nextWaitIndex === -1,
              hadMistake,
              autoHintEligible: wordInfo ? shouldRequestAutoHint(wordInfo.query) : false,
              alreadyRequested: Boolean(wordKey && hintedWordKeysRef.current.has(wordKey)),
            });

            if (wordInfo && hadMistake) {
              setPendingMistake({
                ...wordInfo,
                sourceText,
                shouldCompleteAfterSelection: nextWaitIndex === -1,
              });
              onMistakeReasonPromptOpen?.();
            } else if (
              wordInfo &&
              wordKey &&
              shouldRequestAutoHint(wordInfo.query) &&
              !hintedWordKeysRef.current.has(wordKey)
            ) {
              hintedWordKeysRef.current.add(wordKey);
              console.log('[video-typing][hint][typing-request]', {
                frameId: frame.id,
                trigger: 'word-completed',
                query: wordInfo.query,
                isLastWord: nextWaitIndex === -1,
                priority: false,
                silentIfMissing: false,
              });
              explanationPromise = requestExplanation(
                wordInfo.query,
                {
                  contextText,
                  priority: false,
                  silentIfMissing: false,
                  sourceText,
                },
              );
            }
          }

          if (nextWaitIndex !== -1) {
            nextChars[nextWaitIndex] = {
              ...nextChars[nextWaitIndex],
              status: 'available',
            };
          } else if (!(wordInfo && hasMistakeInWord(nextKeyboardLog, wordInfo.targetCharIds))) {
            if (explanationPromise) {
              void explanationPromise.finally(sendCompleted);
            } else {
              sendCompleted();
            }
          }
        } else {
          onMistakeInput?.();
          const wordInfo = getWordInfo(frame, nextChars[inputIndex].char.id);

          if (wordInfo) {
            const missCount = nextKeyboardLog.filter((log) => (
              !log.isCorrect && wordInfo.targetCharIds.includes(log.currentCharId)
            )).length;
            const wordKey = wordInfo.targetCharIds.join(',');

            if (missCount >= 3 && !hintedWordKeysRef.current.has(wordKey)) {
              const sourceText = getChineseSourceTextForWordInfo(frame, wordInfo);
              hintedWordKeysRef.current.add(wordKey);
              console.log('[video-typing][hint][typing-request]', {
                frameId: frame.id,
                trigger: 'third-mistake',
                query: wordInfo.query,
                missCount,
                silentIfMissing: false,
              });
              void requestExplanation(wordInfo.query, {
                contextText: sourceText
                  ? undefined
                  : createTypedHintContextText(frame, wordInfo.targetCharIds),
                sourceText,
              });
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
      {splitCharsByRows.map((chars, index) => (
        <Line
          key={chars[0]?.char.id || `line-${index}`}
          chars={chars}
          tags={game.tags}
          onTaggedCharClick={handleTaggedWordClick}
        />
      ))}
      {pendingMistake ? (
        <div style={mistakePromptOverlayStyle}>
          <div style={mistakePromptStyle} onClick={(event) => event.stopPropagation()}>
            <div style={mistakePromptTitleStyle}>誤答理由を選んでください</div>
            <button type="button" style={mistakePromptButtonStyle} onClick={() => selectMistakeReason('ignorance')}>
              J...単語を知らなかった
            </button>
            <button type="button" style={mistakePromptButtonStyle} onClick={() => selectMistakeReason('unaudible')}>
              K...聞き取れなかった
            </button>
            <button type="button" style={mistakePromptButtonStyle} onClick={() => selectMistakeReason('spelling')}>
              L...スペルミス/タイポ
            </button>
          </div>
        </div>
      ) : null}
    </Style>
  );
}

const mistakePromptOverlayStyle: React.CSSProperties = {
  position: 'absolute',
  inset: 0,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  background: 'rgba(9, 14, 18, 0.72)',
  zIndex: 1,
};

const mistakePromptStyle: React.CSSProperties = {
  width: 'min(360px, calc(100% - 32px))',
  padding: '16px',
  borderRadius: '12px',
  background: '#162229',
  boxShadow: '0 16px 40px rgba(0, 0, 0, 0.35)',
  display: 'flex',
  flexDirection: 'column',
  gap: '8px',
};

const mistakePromptTitleStyle: React.CSSProperties = {
  fontSize: '14px',
  fontWeight: 700,
  color: '#ecf2f1',
  marginBottom: '4px',
};

const mistakePromptButtonStyle: React.CSSProperties = {
  appearance: 'none',
  border: '1px solid rgba(236, 242, 241, 0.16)',
  borderRadius: '8px',
  padding: '10px 12px',
  background: '#24353d',
  color: '#ecf2f1',
  fontSize: '14px',
  textAlign: 'left',
  cursor: 'pointer',
};
