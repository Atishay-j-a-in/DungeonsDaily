import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

function parseWebPort(): number {
  const raw = process.env.WEB_PORT ?? "5173";
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
    console.warn(`[web] Invalid WEB_PORT=${JSON.stringify(raw)} — falling back to 5173.`);
    return 5173;
  }
  return parsed;
}

export default defineConfig({
  plugins: [react()],
  server: { port: parseWebPort() },
});
