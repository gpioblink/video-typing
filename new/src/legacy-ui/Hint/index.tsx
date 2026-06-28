import React, { useEffect, useRef } from 'react';
import { Layout } from './style';
import type { DictionaryWord } from '../../types';

interface Props {
  words: DictionaryWord[];
  selectable?: boolean;
  onWordSelect?: (word: DictionaryWord, index: number) => void;
}

export function Hint({ words, selectable = false, onWordSelect }: Props) {
  const layoutRef = useRef<HTMLDivElement>(null);
  const newestWordKey = words[0]
    ? `${words[0].dictionaryEntryKey || words[0].title}\u0000${words[0].content}`
    : '';

  useEffect(() => {
    const scrollContainer = layoutRef.current?.parentElement;

    if (scrollContainer) {
      scrollContainer.scrollTop = 0;
    }
  }, [newestWordKey]);

  return (
    <Layout ref={layoutRef}>
      {words.map((word, index) => {
        const isNumberSelectable = selectable && index < 9;

        return (
          <div
            className={`item${isNumberSelectable ? ' selectable' : ''}`}
            key={`${word.title}-${word.content}`}
            onClick={() => {
              if (isNumberSelectable) {
                onWordSelect?.(word, index);
              }
            }}
          >
            <div className="title">
              {isNumberSelectable ? <span className="hintNumber">{index + 1}</span> : null}
              {word.title}
            </div>
            <div className="content">{word.content}</div>
          </div>
        );
      })}
    </Layout>
  );
}
