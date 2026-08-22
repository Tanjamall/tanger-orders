import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.tanjamall.tangerorders',
  appName: 'Tanger Orders',
  webDir: 'dist',
  plugins: {
    PushNotifications: {
      presentationOptions: ['sound', 'alert'],
    },
  },
};

export default config;
