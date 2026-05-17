import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.metrack.habitbuilder",
  appName: "MeTrack: Habit Builder",
  webDir: "dist",
  bundledWebRuntime: false,
  android: {
    backgroundColor: "#f8f3e8",
    allowMixedContent: false,
    captureInput: true,
    webContentsDebuggingEnabled: false
  },
  plugins: {
    SplashScreen: {
      launchAutoHide: true,
      launchShowDuration: 1200,
      backgroundColor: "#f8f3e8",
      androidSplashResourceName: "splash",
      showSpinner: false
    },
    StatusBar: {
      style: "dark",
      backgroundColor: "#f8f3e8",
      overlaysWebView: false
    },
    Keyboard: {
      resize: "body"
    }
  }
};

export default config;
