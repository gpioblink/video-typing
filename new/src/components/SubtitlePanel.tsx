import React from 'react';

interface Props {
  cueText: string;
  fileName: string;
  nativeCueText?: string;
  nativeFileName?: string;
  hasNativeSubtitles: boolean;
  language: 'native' | 'answer';
  onLanguageChange: (language: 'native' | 'answer') => void;
}

export function SubtitlePanel({ cueText, fileName, nativeCueText, nativeFileName, hasNativeSubtitles, language, onLanguageChange }: Props) {
  return (
    <div style={{ width: '100%', fontFamily: 'system-ui, sans-serif' }}>
      <div role="group" aria-label="字幕の言語" style={{ display: 'flex', gap: 6, marginBottom: 8, flexWrap: 'wrap' }}>
        <button type="button" disabled={!hasNativeSubtitles} aria-pressed={language === 'native'} onClick={() => onLanguageChange('native')} style={languageButton(language === 'native')}>日本語</button>
        <button type="button" aria-pressed={language === 'answer'} onClick={() => onLanguageChange('answer')} style={languageButton(language === 'answer')}>{/[\u3400-\u9fff]/.test(cueText) ? '原文（答え）' : '英語（答え）'}</button>
      </div>
      {!hasNativeSubtitles && <p style={{ fontSize: 11, opacity: 0.7, margin: '0 0 6px' }}>日本語字幕は未読込です。</p>}
      <div data-subtitle-text title={language === 'native' ? nativeFileName : fileName}
        style={{ fontSize: 20, lineHeight: 1.45, fontWeight: 700, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', minHeight: 29 }}>
        {language === 'native' ? nativeCueText || (cueText ? 'この区間の日本語字幕は未読込です。' : '') : cueText}
      </div>
    </div>
  );
}

function languageButton(active: boolean): React.CSSProperties {
  return { border: '1px solid #63766e', borderRadius: 4, background: active ? '#d8efe5' : 'transparent', color: active ? '#17201d' : '#ecf2f1', font: 'inherit', fontSize: 12, padding: '3px 7px', cursor: 'pointer' };
}
