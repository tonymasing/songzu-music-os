import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "local.songzu.music.mobile",
  appName: "頌祖音樂",
  webDir: "mobile-shell",
  server: {
    androidScheme: "https",
    cleartext: true,
    allowNavigation: ["*"]
  },
  ios: {
    scheme: "SongzuMusic",
    backgroundColor: "#f5f4ee"
  },
  android: {
    allowMixedContent: true,
    backgroundColor: "#f5f4ee"
  }
};

export default config;
