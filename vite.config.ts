import { defineConfig } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    svelte(),
    VitePWA({
      registerType: "prompt",
      includeAssets: ["icon.svg", "icon-192.png", "icon-512.png"],
      manifest: {
        name: "Find ord",
        short_name: "Find ord",
        description: "Dansk ordjagt, også når forbindelsen forsvinder",
        lang: "da",
        start_url: "/",
        scope: "/",
        display: "standalone",
        background_color: "#f8f6ef",
        theme_color: "#25423b",
        icons: [
          { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any maskable" },
          { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any maskable" }
        ]
      },
      workbox: {
        navigateFallback: "/index.html",
        globPatterns: ["**/*.{js,css,html,svg,png,woff2}"],
        runtimeCaching: []
      }
    })
  ],
  server: {
    host: "0.0.0.0",
    proxy: { "/api": { target: process.env.API_URL || "http://localhost:3000", changeOrigin: true } }
  },
  build: { outDir: "build" }
});
