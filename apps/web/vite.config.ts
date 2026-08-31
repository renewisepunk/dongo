import { cloudflare } from "@cloudflare/vite-plugin";
import { solidStart } from "@solidjs/start/config";
import { defineConfig, type Plugin } from "vite";

function stripBuildOnlyDevToolbarCss(): Plugin {
  const emptyCssModuleId = "\0dongo:empty-solid-start-dev-toolbar";
  const isSolidStartDevCssPath = (id: string) =>
    id.includes("@solidjs/start/dist/shared/dev-toolbar/") ||
    id.includes("@solidjs/start/dist/shared/ui/");

  return {
    name: "dongo:strip-build-only-dev-toolbar-css",
    apply: "build",
    enforce: "pre",
    resolveId(source, importer) {
      if (importer && isSolidStartDevCssPath(importer) && source.endsWith(".css")) {
        return emptyCssModuleId;
      }
    },
    load(id) {
      if (id === emptyCssModuleId) return 'export default "";';
    },
  };
}

export default defineConfig(({ command }) => ({
  plugins: [
    cloudflare({ viteEnvironment: { name: "ssr" } }),
    stripBuildOnlyDevToolbarCss(),
    solidStart({
      devOverlay: command === "serve",
      serialization: { mode: "json" },
    }),
  ],
}));
