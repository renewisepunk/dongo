import { cloudflare } from "@cloudflare/vite-plugin";
import { solidStart } from "@solidjs/start/config";
import { defineConfig, type Plugin } from "vite";

const productionBuild = process.env.CLOUDFLARE_ENV === "production";
const publicDefaults = productionBuild
  ? {
      convexUrl: "https://brainy-camel-172.convex.cloud",
      convexSiteUrl: "https://brainy-camel-172.convex.site",
      environment: "production",
      googleAuthConfigured: "true",
      publicOrigin: "https://dongo.so",
      siteProjectRef: "en8dgh2y-dongo",
    }
  : {
      convexUrl: "https://wandering-camel-662.convex.cloud",
      convexSiteUrl: "https://wandering-camel-662.convex.site",
      environment: "development",
      googleAuthConfigured: "true",
      publicOrigin: "https://dev.dongo.so",
      siteProjectRef: "p58de816-dongo",
    };

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
  define: {
    "import.meta.env.VITE_CONVEX_URL": JSON.stringify(process.env.VITE_CONVEX_URL ?? publicDefaults.convexUrl),
    "import.meta.env.VITE_CONVEX_SITE_URL": JSON.stringify(process.env.VITE_CONVEX_SITE_URL ?? publicDefaults.convexSiteUrl),
    "import.meta.env.VITE_DONGO_ENVIRONMENT": JSON.stringify(process.env.VITE_DONGO_ENVIRONMENT ?? publicDefaults.environment),
    "import.meta.env.VITE_DONGO_GOOGLE_AUTH_CONFIGURED": JSON.stringify(process.env.VITE_DONGO_GOOGLE_AUTH_CONFIGURED ?? publicDefaults.googleAuthConfigured),
    "import.meta.env.VITE_DONGO_PUBLIC_ORIGIN": JSON.stringify(process.env.VITE_DONGO_PUBLIC_ORIGIN ?? publicDefaults.publicOrigin),
    "import.meta.env.VITE_DONGO_SITE_PROJECT_REF": JSON.stringify(process.env.VITE_DONGO_SITE_PROJECT_REF ?? publicDefaults.siteProjectRef),
  },
  plugins: [
    cloudflare({ viteEnvironment: { name: "ssr" } }),
    stripBuildOnlyDevToolbarCss(),
    solidStart({
      devOverlay: command === "serve",
      serialization: { mode: "json" },
    }),
  ],
}));
