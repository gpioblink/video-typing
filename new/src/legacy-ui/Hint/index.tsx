import React from 'react';
import { Layout } from './style';
import type { DictionaryWord, TagContent } from '../../types';

interface Props {
  latestMistakeReason?: TagContent | null;
  latestQuery?: string;
  words: DictionaryWord[];
}

const reasonLabels: Record<TagContent, string> = {
  unaudible: 'unaudible',
  ignorance: 'ignorance',
  spelling: 'spelling',
  others: 'others',
};

export function Hint({ latestMistakeReason, latestQuery, words }: Props) {
  return (
    <Layout>
      {(latestMistakeReason || latestQuery) && (
        <div className="status">
          {latestMistakeReason && (
            <div className="statusRow">
              <span className="statusLabel">Last mistake</span>
              <span className="statusValue">{reasonLabels[latestMistakeReason]}</span>
            </div>
          )}
          {latestQuery && (
            <div className="statusRow">
              <span className="statusLabel">Target</span>
              <span className="statusValue">{latestQuery}</span>
            </div>
          )}
        </div>
      )}
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
