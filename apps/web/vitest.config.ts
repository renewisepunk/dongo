import { defineConfig } from "vitest/config";

export default defineConfig({
  define: {
    "import.meta.env.VITE_CONVEX_URL": JSON.stringify("https://wandering-camel-662.convex.cloud"),
    "import.meta.env.VITE_CONVEX_SITE_URL": JSON.stringify("https://wandering-camel-662.convex.site"),
    "import.meta.env.VITE_DONGO_ENVIRONMENT": JSON.stringify("development"),
    "import.meta.env.VITE_DONGO_GOOGLE_AUTH_CONFIGURED": JSON.stringify("true"),
    "import.meta.env.VITE_DONGO_PUBLIC_ORIGIN": JSON.stringify("https://dev.dongo.so"),
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
