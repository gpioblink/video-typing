import React, { useEffect, useRef } from 'react';
import { Layout } from './style';
import type { DictionaryWord } from '../../types';

interface Props {
  words: DictionaryWord[];
}

export function Hint({ words }: Props) {
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
      {words.map((word) => {
        return (
          <div className="item" key={`${word.title}-${word.content}`}>
            <div className="title">{word.title}</div>
            <div className="content">{word.content}</div>
          </div>
        );
      })}
    </Layout>
  );
}
