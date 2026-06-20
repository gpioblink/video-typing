export type TagContent = 'unaudible' | 'ignorance' | 'spelling' | 'others';
export type ID = string;

export interface Tag {
  id: ID;
  pastedCharIds: ID[];
  content: TagContent;
}

export interface Char {
  id: ID;
  char: string;
  isTypeable: boolean;
}

export interface CaptionFrame {
  id: ID;
  caption: Char[];
  tags: Tag[];
}

export interface DictionaryWord {
  title: string;
  content: string;
}

export interface DictionaryEntry {
  key: string;
  headword: string;
  normalizedHeadword: string;
  body: string;
  sourceName: string;
  importedAt: number;
}

export type PanelKind = 'typing' | 'hint' | 'debug' | 'subtitle';

export interface PanelPosition {
  x: number;
  y: number;
}

export type StoredPanelPositions = Record<string, Partial<Record<PanelKind, PanelPosition>>>;

export interface PanelSize {
  width: number;
  height: number;
}

export type StoredPanelSizes = Record<string, Partial<Record<PanelKind, PanelSize>>>;

export type SubtitleFormat = 'srt' | 'ttml' | 'vtt';

export interface SubtitleCue {
  start: number;
  end: number;
  text: string;
}

export interface StoredSubtitleData {
  fileName: string;
  cues: SubtitleCue[];
}

export interface StoredFrameProgressData {
  finishedCharIds: ID[];
  tags: Tag[];
}

export interface StoredTypingProgressData {
  [frameId: string]: StoredFrameProgressData;
}

export interface StoredPlaybackPositionData {
  currentTime: number;
}
