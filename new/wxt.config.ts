import { defineConfig } from 'wxt';

const manifestVersion = process.env.VIDEO_TYPING_MANIFEST_VERSION || '0.0.1';
const releaseVersion = process.env.VIDEO_TYPING_RELEASE_VERSION;
const buildId = process.env.VIDEO_TYPING_BUILD_ID || releaseVersion || 'local-dev';
const buildTime = process.env.VIDEO_TYPING_BUILD_TIME || new Date().toISOString();

export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  manifestVersion: 3,
  vite: () => ({
    define: {
      __VIDEO_TYPING_BUILD_ID__: JSON.stringify(buildId),
      __VIDEO_TYPING_BUILD_TIME__: JSON.stringify(buildTime),
    },
  }),
  manifest: {
    name: 'video-typing prototype',
    description: 'Overlay typing and hint UI on the first video element in the page.',
    version: manifestVersion,
    version_name: releaseVersion,
    permissions: ['activeTab', 'scripting', 'storage'],
    action: {
      default_title: 'video-typing',
      default_popup: 'popup.html',
    },
  },
});
