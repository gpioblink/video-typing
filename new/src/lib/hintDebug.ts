declare const __VIDEO_TYPING_BUILD_ID__: string;
declare const __VIDEO_TYPING_BUILD_TIME__: string;

export const HINT_DEBUG_BUILD_ID = typeof __VIDEO_TYPING_BUILD_ID__ === 'string'
  ? __VIDEO_TYPING_BUILD_ID__
  : 'hint-debug-dev';
export const HINT_DEBUG_BUILD_TIME = typeof __VIDEO_TYPING_BUILD_TIME__ === 'string'
  ? __VIDEO_TYPING_BUILD_TIME__
  : 'test';
