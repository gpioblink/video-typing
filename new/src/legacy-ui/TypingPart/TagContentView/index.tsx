import React from 'react';
import { Style, type TagPosition } from './style';
import type { Tag } from '../../../types';

interface Props {
  tag: Tag;
  position: TagPosition;
}

function getTagLabel(content: Tag['content']) {
  switch (content) {
    case 'ignorance':
      return 'ignorance';
    case 'unaudible':
      return 'unaudible';
    case 'spelling':
      return 'spelling';
    default:
      return 'others';
  }
}

export function TagContentView({ tag, position }: Props) {
  return <Style position={position}>{getTagLabel(tag.content)}</Style>;
}
