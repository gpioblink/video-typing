import React from 'react';

interface Props {
  cueText: string;
  fileName: string;
}

export function SubtitlePanel({ cueText, fileName }: Props) {
  return (
    <div
      style={{
        width: 520,
        minHeight: 72,
        fontFamily: 'system-ui, sans-serif',
      }}
    >
      <div
        style={{
          fontSize: 11,
          opacity: 0.65,
          marginBottom: 8,
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
        }}
      >
        {fileName || 'No subtitle loaded'}
      </div>
      <div
        style={{
          fontSize: 24,
          lineHeight: 1.5,
          fontWeight: 700,
          whiteSpace: 'pre-wrap',
          minHeight: 36,
        }}
      >
        {cueText}
      </div>
    </div>
  );
}
