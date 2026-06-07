import React from 'react';
import { Layout } from './style';
import type { DictionaryWord } from '../../types';

interface Props {
  words: DictionaryWord[];
}

export function Hint({ words }: Props) {
  return (
    <Layout>
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
