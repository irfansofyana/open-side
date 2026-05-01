import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: "dist",
    emptyOutDir: true,
    rollupOptions: {
      input: {
        sidepanel: "src/sidepanel/index.html"
      },
      output: {
        entryFileNames: "assets/[name].js"
      }
    }
  },
  test: {
    environment: "jsdom",
    setupFiles: ["src/test/chromeMock.ts"],
    globals: true
  }
});
