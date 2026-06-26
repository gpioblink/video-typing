import type { CaptionFrame, ID } from '../types';

export function createTypedHintContextText(frame: CaptionFrame, targetCharIds: ID[]) {
  const targetCharIdSet = new Set(targetCharIds);
  let endIndex = -1;

  for (let index = 0; index < frame.caption.length; index += 1) {
    if (targetCharIdSet.has(frame.caption[index].id)) {
      endIndex = index;
    }
  }

  if (endIndex === -1) {
    return '';
  }

  return frame.caption
    .slice(0, endIndex + 1)
    .map((char) => char.char)
    .join('')
    .trim();
}
