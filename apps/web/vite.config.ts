import { cloudflare } from "@cloudflare/vite-plugin";
import { solidStart } from "@solidjs/start/config";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [
    cloudflare({ viteEnvironment: { name: "ssr" } }),
    solidStart({ serialization: { mode: "json" } }),
  ],
});
