import React from 'react';
import { Layout } from './style';
import type { GameChar } from '../Window';

interface Props {
  char: GameChar;
  clickable?: boolean;
  onClick?: () => void;
}

export function CharView({ char, clickable = false, onClick }: Props) {
  if (char.char.isTypeable) {
    switch (char.status) {
      case 'wait':
        return <Layout clickable={clickable} onClick={onClick}><div className="wait">_</div></Layout>;
      case 'available':
        return <Layout clickable={clickable} onClick={onClick}><div className="available">_</div></Layout>;
      case 'mistaken':
        return <Layout clickable={clickable} onClick={onClick}><div className="mistaken">{char.input}</div></Layout>;
      case 'finished':
        return <Layout clickable={clickable} onClick={onClick}><div className="finished">{char.char.char}</div></Layout>;
    }
  }

  return <Layout clickable={clickable} onClick={onClick}><div className="wait">{char.char.char}</div></Layout>;
}
