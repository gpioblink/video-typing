import React from 'react';
import { Style, type TagPosition } from './style';
import type { Tag } from '../../../types';

interface Props {
  tag: Tag;
  position: TagPosition;
}

export function TagContentView({ tag, position }: Props) {
  return <Style position={position}>{tag.content}</Style>;
}
