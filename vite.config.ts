import { defineConfig } from "vite";

export default defineConfig({
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    watch: { ignored: ["**/src-tauri/**", "**/target/**"] },
  },
  build: {
    target: "es2022",
    sourcemap: false,
    rollupOptions: {
      // The snow overlay and the Settings window.
      input: { main: "index.html", settings: "settings.html" },
    },
  },
});
