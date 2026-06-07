const VIDEO_ATTR = 'data-video-typing-target-id';

export function getVideoElement(targetId: string) {
  return document.querySelector<HTMLVideoElement>(`video[${VIDEO_ATTR}="${targetId}"]`);
}

export function seekVideo(targetId: string, nextTime: number) {
  const video = getVideoElement(targetId);
  if (!video) return;
  video.currentTime = Math.max(0, nextTime);
}
