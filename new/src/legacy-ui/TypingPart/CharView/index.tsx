import React from 'react';
import { Layout } from './style';
import type { GameChar } from '../Window';

interface Props {
  char: GameChar;
}

export function CharView({ char }: Props) {
  if (char.char.isTypeable) {
    switch (char.status) {
      case 'wait':
        return <Layout><div className="wait">_</div></Layout>;
      case 'available':
        return <Layout><div className="available">_</div></Layout>;
      case 'mistaken':
        return <Layout><div className="mistaken">{char.input}</div></Layout>;
      case 'finished':
        return <Layout><div className="finished">{char.char.char}</div></Layout>;
    }
  }

  return <Layout><div className="wait">{char.char.char}</div></Layout>;
}
