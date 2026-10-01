import type { Metadata, Viewport } from "next";

import { AppShell } from "@/components/AppShell";
import "./globals.css";
import "./daw-typography.css";

export const metadata: Metadata = {
  title: "頌祖音樂 OS",
  description: "AI 音樂創作、作品資料庫與音樂事業管理工作台。",
  manifest: "/manifest.webmanifest",
  applicationName: "頌祖音樂 OS",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "頌祖音樂 OS"
  },
  formatDetection: {
    telephone: false
  },
  icons: {
    icon: "/icon.svg",
    apple: "/apple-icon"
  }
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#120403"
};

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-Hant">
      <body>
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
