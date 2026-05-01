import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: "dist",
    emptyOutDir: true,
    rollupOptions: {
      input: {
        "background/serviceWorker": "src/background/serviceWorker.ts",
        sidepanel: "src/sidepanel/index.html"
      },
      output: {
        entryFileNames: "[name].js"
      }
    }
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["src/test/chromeMock.ts"]
  }
});
