import type { CaptionFrame, DictionaryWord } from '../types';

export const mockFrame: CaptionFrame = {
  id: 'frame-1',
  tags: [],
  caption: [
    { id: '0', char: '[', isTypeable: false },
    { id: '1', char: 'L', isTypeable: false },
    { id: '2', char: 'I', isTypeable: false },
    { id: '3', char: 'L', isTypeable: false },
    { id: '4', char: 'I', isTypeable: false },
    { id: '5', char: ']', isTypeable: false },
    { id: '6', char: ' ', isTypeable: false },
    { id: '7', char: 'I', isTypeable: true },
    { id: '8', char: '`', isTypeable: false },
    { id: '9', char: 'm', isTypeable: true },
    { id: '10', char: ' ', isTypeable: false },
    { id: '11', char: 'a', isTypeable: true },
    { id: '12', char: ' ', isTypeable: false },
    { id: '13', char: 'w', isTypeable: true },
    { id: '14', char: 'r', isTypeable: true },
    { id: '15', char: 'e', isTypeable: true },
    { id: '16', char: 't', isTypeable: true },
    { id: '17', char: 'c', isTypeable: true },
    { id: '18', char: 'h', isTypeable: true },
    { id: '19', char: 'e', isTypeable: true },
    { id: '20', char: 'd', isTypeable: true },
    { id: '21', char: ' ', isTypeable: false },
    { id: '22', char: 'l', isTypeable: true },
    { id: '23', char: 'i', isTypeable: true },
    { id: '24', char: 't', isTypeable: true },
    { id: '25', char: 't', isTypeable: true },
    { id: '26', char: 'l', isTypeable: true },
    { id: '27', char: 'e', isTypeable: true },
    { id: '28', char: ' ', isTypeable: false },
    { id: '29', char: 'p', isTypeable: true },
    { id: '30', char: 'r', isTypeable: true },
    { id: '31', char: 'u', isTypeable: true },
    { id: '32', char: 'm', isTypeable: true },
  ],
};

export const mockWords: DictionaryWord[] = [
  {
    title: 'rain cats and dogs',
    content: '雨が激しく降る。土砂降りの意味で使う慣用句。',
  },
  {
    title: 'rain',
    content: '雨。動詞では雨が降る。',
  },
];
