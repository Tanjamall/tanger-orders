import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.tanjamall.tangerorders',
  appName: 'Tanger Orders',
  webDir: 'dist',
  plugins: {
    CapacitorUpdater: {
      autoUpdate: 'atBackground',
      updateUrl: 'https://tanger-orders.pages.dev/api/app-update',
      statsUrl: '',
    },
    PushNotifications: {
      presentationOptions: ['sound', 'alert'],
    },
  },
};

export default config;
