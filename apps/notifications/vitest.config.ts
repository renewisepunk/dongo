import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./wrangler.jsonc" },
      miniflare: {
        bindings: {
          DONGO_NOTIFICATION_DISPATCH_SECRET:
            "test-dispatch-secret-with-at-least-32-characters",
          DONGO_RESEND_CONFIG: "disabled",
          DONGO_APNS_CONFIG: "disabled",
          DONGO_FCM_CONFIG: "disabled",
        },
      },
    }),
  ],
});
