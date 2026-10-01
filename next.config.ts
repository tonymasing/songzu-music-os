import type { NextConfig } from "next";

const generatedAndSourceExcludes = [
  "./dist-electron/**/*",
  "./dist-mobile/**/*",
  "./android/**/*",
  "./ios/**/*",
  "./mobile-shell/**/*",
  "./native/**/*",
  "./output/**/*",
  "./src/**/*",
  "./uploads/**/*",
  "./exports/**/*",
  "./public/**/*",
  "./scripts/**/*",
  "./electron/**/*",
  "./build/**/*",
  "./docs/**/*",
  "./.cache/**/*",
  "./.local-ssl/**/*",
  "./.desktop-app/**/*",
  "./.electron-app/**/*",
  "./.electron-package/**/*",
  "./prisma/**/*",
  "./*.md",
  "./*.mjs",
  "./*.ts",
  "./*.yml",
  "./package-lock.json"
];

const nextConfig: NextConfig = {
  output: "standalone",
  outputFileTracingExcludes: {
    "/**": generatedAndSourceExcludes,
    "/api/storage": generatedAndSourceExcludes,
    "/settings": generatedAndSourceExcludes
  },
  reactStrictMode: true,
  devIndicators: false,
  experimental: {
    // Recording stems and lossless masters routinely exceed Next's 10 MB proxy default.
    proxyClientMaxBodySize: "512mb"
  },
  allowedDevOrigins: ["127.0.0.1", "localhost"]
};

export default nextConfig;
