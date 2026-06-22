import { defineContentScript } from 'wxt/utils/define-content-script';
import {
  NETFLIX_SEEK_BRIDGE_INSTALLED_KEY,
  NETFLIX_SEEK_EVENT_NAME,
  type NetflixSeekEventDetail,
} from '../src/lib/netflixSeek';

interface NetflixPlayer {
  seek?: (timeMs: number) => void;
}

interface NetflixVideoPlayerApi {
  getAllPlayerSessionIds?: () => string[];
  getVideoPlayerBySessionId?: (sessionId: string) => NetflixPlayer | undefined;
}

interface NetflixPlayerApi {
  videoPlayer?: NetflixVideoPlayerApi;
}

interface NetflixGlobal {
  appContext?: {
    state?: {
      playerApp?: {
        getAPI?: () => NetflixPlayerApi | undefined;
      };
    };
  };
}

type NetflixBridgeWindow = Window & {
  [NETFLIX_SEEK_BRIDGE_INSTALLED_KEY]?: boolean;
  netflix?: NetflixGlobal;
};

export default defineContentScript({
  registration: 'runtime',
  world: 'MAIN',
  main() {
    const bridgeWindow = window as NetflixBridgeWindow;

    if (bridgeWindow[NETFLIX_SEEK_BRIDGE_INSTALLED_KEY]) {
      return;
    }

    bridgeWindow[NETFLIX_SEEK_BRIDGE_INSTALLED_KEY] = true;
    window.addEventListener(NETFLIX_SEEK_EVENT_NAME, handleNetflixSeek);
  },
});

function handleNetflixSeek(event: Event) {
  const detail = (event as CustomEvent<NetflixSeekEventDetail>).detail;

  if (!detail || !Number.isFinite(detail.nextTimeMs)) {
    return;
  }

  const player = getActiveNetflixPlayer();

  if (!player?.seek) {
    console.warn('[video-typing] Netflix player seek API is not available.');
    return;
  }

  try {
    player.seek(Math.max(0, detail.nextTimeMs));
  } catch (error) {
    console.warn('[video-typing] Netflix seek failed.', error);
  }
}

function getActiveNetflixPlayer() {
  const bridgeWindow = window as NetflixBridgeWindow;
  const videoPlayer = bridgeWindow.netflix?.appContext?.state?.playerApp?.getAPI?.()?.videoPlayer;
  const sessionIds = videoPlayer?.getAllPlayerSessionIds?.();
  const sessionId = sessionIds?.[0];

  if (!sessionId) {
    return undefined;
  }

  return videoPlayer?.getVideoPlayerBySessionId?.(sessionId);
}
