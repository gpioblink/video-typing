import type { Page } from '@playwright/test';
const API_URL = 'https://www.youtube.com/iframe_api';
export async function mockYouTube(page: Page) {
  await page.route(API_URL, route => route.fulfill({
    contentType: 'application/javascript',
    body: `
      window.testPlayers = window.testPlayers || [];
      window.YT = { Player: class {
        constructor(node, options) {
          this.options = options; this.time = 0; this.rate = 1; this.state = 2;
          this.seeks = []; this.destroyed = false;
          this.iframe = document.createElement('iframe');
          node.replaceWith(this.iframe);
          window.testPlayer = this; window.testPlayers.push(this);
          setTimeout(() => options.events.onReady({ target: this }), 0);
        }
        cueVideoById(data) { this.cue = data; this.time = data.startSeconds; this.state = 5; queueMicrotask(() => this.options.events.onStateChange({ data: 5 })); }
        playVideo() {
          clearInterval(this.timer); this.state = 1;
          this.options.events.onStateChange({ data: 1 });
          this.timer = setInterval(() => { this.time += 0.1 * this.rate; }, 100);
        }
        pauseVideo() { clearInterval(this.timer); this.state = 2; this.options.events.onStateChange({ data: 2 }); }
        seekTo(time) { this.seeks.push(time); this.time = time; }
        getCurrentTime() { return this.time; }
        getDuration() { return 1200; }
        getPlayerState() { return this.state; }
        isPaused() { return this.state !== 1; }
        getPlaybackRate() { return this.rate; }
        setPlaybackRate(rate) { this.rate = rate; }
        getIframe() { return this.iframe; }
        destroy() { this.destroyed = true; clearInterval(this.timer); this.iframe.remove(); }
      }};
      window.onYouTubeIframeAPIReady();
    `,
  }));
}

