import React from 'react';
import { Style, type TagPosition } from './style';

interface Props {
  position: TagPosition;
}

export function TagLineView({ position }: Props) {
  return <Style position={position} />;
}
