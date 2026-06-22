export const NETFLIX_SEEK_EVENT_NAME = 'video-typing:netflix-seek';
export const NETFLIX_SEEK_BRIDGE_INSTALLED_KEY = '__videoTypingNetflixSeekBridgeInstalled__';

export interface NetflixSeekEventDetail {
  targetId: string;
  nextTimeSeconds: number;
  nextTimeMs: number;
}

export function isNetflixHostname(hostname: string) {
  const normalizedHostname = hostname.toLowerCase();
  return normalizedHostname === 'netflix.com' || normalizedHostname.endsWith('.netflix.com');
}
