/// <reference types="vitest" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  envDir: path.resolve(__dirname, "../.."),
  plugins: [react(), tailwindcss()],
  server: { port: 5173 },
  test: { environment: "node" },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
