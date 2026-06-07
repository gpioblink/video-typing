import React from 'react';
import { Style } from './style';
import { CharView } from '../CharView';
import { TagContentView } from '../TagContentView';
import { TagLineView } from '../TagLineView';
import type { Tag } from '../../../types';
import type { GameChar } from '../Window';

interface Props {
  chars: GameChar[];
  tags: Tag[];
}

export function Line({ chars, tags }: Props) {
  const calcTagPosition = (tag: Tag) => {
    const indexes: number[] = [];

    chars.forEach((char, index) => {
      if (tag.pastedCharIds.includes(char.char.id)) {
        indexes.push(index);
      }
    });

    if (indexes.length === 0) {
      return { startPosition: -1, lastPosition: -1 };
    }

    return {
      startPosition: Math.min(...indexes),
      lastPosition: Math.max(...indexes),
    };
  };

  return (
    <Style>
      {chars.map((char) => <CharView key={char.char.id} char={char} />)}
      {tags.map((tag) => {
        const position = calcTagPosition(tag);
        if (position.startPosition === -1) return null;
        return <TagLineView key={`${tag.id}-line`} position={position} />;
      })}
      {tags.map((tag) => {
        const position = calcTagPosition(tag);
        if (position.startPosition === -1) return null;
        return <TagContentView key={`${tag.id}-content`} tag={tag} position={position} />;
      })}
    </Style>
  );
}
