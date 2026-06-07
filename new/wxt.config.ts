import { defineConfig } from 'wxt';

export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  manifestVersion: 3,
  manifest: {
    name: 'video-typing prototype',
    description: 'Overlay typing and hint UI on the first video element in the page.',
    permissions: ['activeTab', 'scripting', 'storage'],
    action: {
      default_title: 'video-typing',
    },
  },
});
