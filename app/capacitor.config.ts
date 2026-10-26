import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.bluefin605.rokuremote',
  appName: 'Roku Remote',
  webDir: 'dist/roku-remote/browser',
  server: { androidScheme: 'http', cleartext: true },
  android: { allowMixedContent: true },
  plugins: { CapacitorUpdater: { autoUpdate: false } },
};

export default config;
