import { resolve } from "node:path";
import { defineConfig } from "vite";
import solid from "vite-plugin-solid";

export default defineConfig({
  root: resolve(import.meta.dirname, "harness"),
  plugins: [solid()],
  server: {
    host: "127.0.0.1",
    port: 4174,
    strictPort: true,
  },
});
