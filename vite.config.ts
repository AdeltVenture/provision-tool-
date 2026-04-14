import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: { port: 5174 },
  optimizeDeps: {
    // pdfjs-dist manages its own worker — Vite must not pre-bundle it
    exclude: ["pdfjs-dist"],
  },
});
