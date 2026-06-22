import {
  isNetflixHostname,
  NETFLIX_SEEK_EVENT_NAME,
  type NetflixSeekEventDetail,
} from './netflixSeek';

const VIDEO_ATTR = 'data-video-typing-target-id';

export function getVideoElement(targetId: string) {
  return document.querySelector<HTMLVideoElement>(`video[${VIDEO_ATTR}="${targetId}"]`);
}

export function seekVideo(targetId: string, nextTime: number) {
  const nextTimeSeconds = Math.max(0, nextTime);

  if (isNetflixHostname(window.location.hostname)) {
    window.dispatchEvent(new CustomEvent<NetflixSeekEventDetail>(NETFLIX_SEEK_EVENT_NAME, {
      detail: {
        targetId,
        nextTimeSeconds,
        nextTimeMs: Math.round(nextTimeSeconds * 1000),
      },
    }));
    return;
  }

  const video = getVideoElement(targetId);
  if (!video) return;
  video.currentTime = nextTimeSeconds;
}
