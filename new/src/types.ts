export type TagContent = 'unaudible' | 'ignorance' | 'spelling' | 'others';
export type ID = string;

export interface Tag {
  id: ID;
  pastedCharIds: ID[];
  content: TagContent;
  hint?: DictionaryHintSelection;
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

export interface ChineseTypingWord {
  sourceText: string;
  pinyin: string;
  startCharId: ID;
  endCharId: ID;
  dictionaryFound: boolean;
}

export interface TimedCaptionFrame extends CaptionFrame {
  start: number;
  end: number;
  words?: ChineseTypingWord[];
}

export interface ChineseTypingJson {
  format: 'video-typing-chinese-v1';
  sourceFileName: string;
  typingFrames: TimedCaptionFrame[];
  sourceCues: SubtitleCue[];
}

export interface DictionaryWord {
  title: string;
  content: string;
  dictionaryEntryKey?: string;
}

export interface DictionaryHintSelection {
  headword: string;
  meaning: string;
  dictionaryEntryKey?: string;
  selectedText: string;
  selectedAt: number;
}

export interface DictionaryEntry {
  key: string;
  headword: string;
  normalizedHeadword: string;
  body: string;
  sourceName: string;
  importedAt: number;
}

export type PanelKind = 'typing' | 'hint' | 'config' | 'debug' | 'subtitle';

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

export interface OverlayConfig {
  slowPlayback: {
    enabled: boolean;
    mistakeThreshold: number;
  };
  nativeReplay: {
    mistakeReplayEnabled: boolean;
    mistakeThreshold: number;
    mistakeInterval: number;
    completionReplayEnabled: boolean;
  };
}

export interface StoredSubtitleData {
  fileName: string;
  cues: SubtitleCue[];
  typingFrames?: TimedCaptionFrame[];
  displaySubtitleFileName?: string;
  displaySubtitleCues?: SubtitleCue[];
  netflix?: {
    englishSubtitleTrackId: string;
    nativeSubtitleTrackId?: string;
    englishAudioTrackId: string;
    nativeAudioTrackId?: string;
  };
}

export interface StoredFrameProgressData {
  finishedCharIds: ID[];
  tags: Tag[];
  updatedAt?: number;
}

export interface StoredTypingProgressData {
  [frameId: string]: StoredFrameProgressData;
}

export interface StoredPlaybackPositionData {
  currentTime: number;
}

export interface StoredExternalHistoryMeta {
  title: string;
  updatedAt: number;
}

export interface ExternalHistoryItem {
  url: string;
  title: string;
  updatedAt: number;
  subtitle?: StoredSubtitleData;
  typingProgress: StoredTypingProgressData;
  playbackPosition?: StoredPlaybackPositionData;
  meta?: StoredExternalHistoryMeta;
}

export interface StoredLocalPlayerSession {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  mainVideoHandle: FileSystemFileHandle;
  nativeAudioHandle?: FileSystemFileHandle;
  subtitleFileName: string;
  subtitleCues: SubtitleCue[];
  typingFrames?: TimedCaptionFrame[];
  nativeSubtitleFileName?: string;
  nativeSubtitleCues?: SubtitleCue[];
}
