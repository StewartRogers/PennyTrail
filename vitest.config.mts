import path from "path";
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "./src"),
    },
  },
  test: {
    environment: "node",
    setupFiles: ["./tests/setup.ts"],
    globals: true,
    // Component tests run several times slower on the Raspberry Pi dev box
    // than on a desktop; the 5s default timed out tests that pass there.
    testTimeout: 20_000,
  },
});
