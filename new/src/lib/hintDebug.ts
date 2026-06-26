declare const __VIDEO_TYPING_BUILD_TIME__: string;

export const HINT_DEBUG_BUILD_ID = 'hint-debug-2026-06-25-1';
export const HINT_DEBUG_BUILD_TIME = typeof __VIDEO_TYPING_BUILD_TIME__ === 'string'
  ? __VIDEO_TYPING_BUILD_TIME__
  : 'test';
