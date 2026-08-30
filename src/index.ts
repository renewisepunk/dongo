const page = String.raw`<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="theme-color" content="#0b0b0c">
    <meta name="color-scheme" content="dark">
    <meta name="description" content="Dongo is an agent-first work tracker where humans provide intent and judgment, and local coding agents provide structure and execution.">
    <meta property="og:title" content="Dongo — agent-first work tracking">
    <meta property="og:description" content="A quiet shared workspace for humans and local coding agents. Coming soon.">
    <meta property="og:type" content="website">
    <meta property="og:url" content="https://dongo.so/">
    <link rel="preconnect" href="https://api.fontshare.com">
    <link rel="preconnect" href="https://cdn.fontshare.com" crossorigin>
    <link href="https://api.fontshare.com/v2/css?f[]=switzer@400,500,600&amp;display=swap" rel="stylesheet">
    <link rel="icon" href="/favicon.svg" type="image/svg+xml">
    <link rel="canonical" href="https://dongo.so/">
    <title>Dongo — agent-first work tracking</title>
    <style>
      :root {
        color-scheme: dark;
        --background: #0b0b0c;
        --foreground: #e8e8e3;
        --muted: #858582;
        --quiet: #5d5d5b;
        --line: #262627;
        --font: "Switzer", sans-serif;
      }

      * {
        box-sizing: border-box;
      }

      html {
        min-width: 320px;
        background: var(--background);
      }

      body {
        min-height: 100vh;
        margin: 0;
        background: var(--background);
        color: var(--foreground);
        font-family: var(--font);
        font-size: 13px;
        font-synthesis: none;
        line-height: 1.5;
        -webkit-font-smoothing: antialiased;
        text-rendering: optimizeLegibility;
      }

      .screen {
        display: grid;
        grid-template-rows: auto 1fr auto;
        min-height: 100svh;
        padding: 20px 24px;
      }

      .topbar,
      .footer {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 24px;
        color: var(--muted);
        font-size: 11px;
        letter-spacing: 0.01em;
      }

      .identity {
        display: flex;
        align-items: center;
        gap: 10px;
        color: var(--foreground);
        font-weight: 500;
      }

      .mark {
        width: 6px;
        height: 6px;
        border-radius: 50%;
        background: var(--foreground);
        box-shadow: 0 0 0 3px #1d1d1e;
      }

      .release {
        display: flex;
        align-items: center;
        gap: 8px;
      }

      .release::before {
        width: 5px;
        height: 5px;
        border-radius: 50%;
        background: var(--quiet);
        content: "";
      }

      main {
        width: min(760px, 100%);
        margin: clamp(84px, 16vh, 168px) auto 96px;
      }

      .path {
        margin: 0 0 32px;
        color: var(--quiet);
        font-size: 11px;
      }

      .path span {
        color: var(--muted);
      }

      h1 {
        max-width: 19ch;
        margin: 0;
        font-size: clamp(26px, 3.2vw, 36px);
        font-weight: 500;
        letter-spacing: -0.035em;
        line-height: 1.08;
        text-wrap: balance;
      }

      .lede {
        max-width: 57ch;
        margin: 24px 0 0;
        color: var(--muted);
        font-size: 13px;
        line-height: 1.65;
      }

      .session {
        margin-top: 64px;
        border-top: 1px solid var(--line);
        border-bottom: 1px solid var(--line);
      }

      .session-head {
        display: grid;
        grid-template-columns: 18px 1fr auto;
        gap: 8px;
        align-items: center;
        min-height: 48px;
        border-bottom: 1px solid var(--line);
        color: var(--foreground);
        font-size: 12px;
      }

      .chevron {
        color: var(--muted);
      }

      .session-meta {
        color: var(--quiet);
        font-size: 10px;
      }

      .flow {
        margin: 0;
        padding: 10px 0;
      }

      .flow-row {
        display: grid;
        grid-template-columns: 36px minmax(84px, 0.34fr) 1fr;
        gap: 12px;
        align-items: baseline;
        min-height: 34px;
        padding: 8px 0;
      }

      .flow-row dt,
      .flow-row dd {
        margin: 0;
      }

      .index {
        color: var(--quiet);
        font-size: 10px;
        font-variant-numeric: tabular-nums;
      }

      .state {
        color: var(--foreground);
        font-size: 12px;
        font-weight: 500;
      }

      .detail {
        color: var(--muted);
        font-size: 12px;
      }

      .waiting {
        display: flex;
        align-items: center;
        gap: 8px;
        margin-top: 22px;
        color: var(--muted);
        font-size: 11px;
      }

      .cursor {
        width: 6px;
        height: 13px;
        background: var(--foreground);
        animation: blink 1.15s steps(1, end) infinite;
      }

      .footer {
        padding-top: 16px;
        border-top: 1px solid var(--line);
      }

      .footer-primary {
        color: var(--foreground);
      }

      @keyframes blink {
        0%, 52% { opacity: 1; }
        53%, 100% { opacity: 0; }
      }

      @media (max-width: 560px) {
        .screen {
          padding: 18px;
        }

        .topbar {
          align-items: flex-start;
        }

        .release {
          max-width: 120px;
          justify-content: flex-end;
          text-align: right;
        }

        main {
          margin-top: 88px;
          margin-bottom: 72px;
        }

        h1 {
          max-width: 16ch;
          font-size: 28px;
        }

        .session {
          margin-top: 52px;
        }

        .flow-row {
          grid-template-columns: 28px 82px 1fr;
          gap: 8px;
        }

        .footer {
          align-items: flex-start;
          flex-direction: column;
          gap: 4px;
        }
      }

      @media (prefers-reduced-motion: reduce) {
        .cursor {
          animation: none;
        }
      }
    </style>
  </head>
  <body>
    <div class="screen">
      <header class="topbar">
        <div class="identity" aria-label="Dongo">
          <span class="mark" aria-hidden="true"></span>
          <span>dongo</span>
        </div>
        <div class="release">private beta · 0.1</div>
      </header>

      <main>
        <p class="path"><span>~</span> / dongo / overview</p>
        <h1>Work moves.<br>Dongo keeps the thread.</h1>
        <p class="lede">
          A quiet shared workspace where humans leave intent, local coding agents shape it into work, and everyone can see what needs attention.
        </p>

        <section class="session" aria-label="Dongo workflow">
          <div class="session-head">
            <span class="chevron" aria-hidden="true">›</span>
            <span>dongo status</span>
            <span class="session-meta">coming soon</span>
          </div>
          <dl class="flow">
            <div class="flow-row">
              <span class="index">01</span>
              <dt class="state">inbox</dt>
              <dd class="detail">human intent lands</dd>
            </div>
            <div class="flow-row">
              <span class="index">02</span>
              <dt class="state">ready</dt>
              <dd class="detail">context clicks into place</dd>
            </div>
            <div class="flow-row">
              <span class="index">03</span>
              <dt class="state">working</dt>
              <dd class="detail">local agents move</dd>
            </div>
            <div class="flow-row">
              <span class="index">04</span>
              <dt class="state">needs you</dt>
              <dd class="detail">human judgment matters</dd>
            </div>
            <div class="flow-row">
              <span class="index">05</span>
              <dt class="state">done</dt>
              <dd class="detail">the outcome stays legible</dd>
            </div>
          </dl>
        </section>

        <div class="waiting" aria-label="Waiting for local agent">
          <span class="cursor" aria-hidden="true"></span>
          <span>waiting for local agent</span>
        </div>
      </main>

      <footer class="footer">
        <span class="footer-primary">dongo.so</span>
        <span>humans provide intent · agents provide execution</span>
      </footer>
    </div>
  </body>
</html>`;

const favicon = String.raw`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <rect width="64" height="64" rx="14" fill="#0b0b0c"/>
  <circle cx="32" cy="32" r="8" fill="#e8e8e3"/>
</svg>`;

const securityHeaders = {
  "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline' https://api.fontshare.com; font-src https://cdn.fontshare.com; img-src data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; upgrade-insecure-requests",
  "Cross-Origin-Opener-Policy": "same-origin",
  "Permissions-Policy": "camera=(), geolocation=(), microphone=()",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
} as const;

function response(body: BodyInit | null, contentType: string, status = 200): Response {
  return new Response(body, {
    status,
    headers: {
      ...securityHeaders,
      "Cache-Control": status === 200
        ? "public, max-age=300, s-maxage=3600, stale-while-revalidate=86400"
        : "no-store",
      "Content-Language": "en",
      "Content-Type": contentType,
    },
  });
}

export default {
  fetch(request: Request): Response {
    try {
      const url = new URL(request.url);

      if (url.hostname === "www.dongo.so") {
        url.hostname = "dongo.so";
        url.protocol = "https:";
        return Response.redirect(url.toString(), 308);
      }

      if (request.method !== "GET" && request.method !== "HEAD") {
        return new Response(null, {
          status: 405,
          headers: { ...securityHeaders, Allow: "GET, HEAD" },
        });
      }

      let result: Response;

      switch (url.pathname) {
        case "/":
        case "/index.html":
          result = response(page, "text/html; charset=utf-8");
          break;
        case "/favicon.svg":
          result = response(favicon, "image/svg+xml; charset=utf-8");
          break;
        case "/robots.txt":
          result = response("User-agent: *\nAllow: /\n", "text/plain; charset=utf-8");
          break;
        case "/healthz":
          result = Response.json(
            { service: "dongo-coming-soon", status: "ok" },
            { headers: { ...securityHeaders, "Cache-Control": "no-store" } },
          );
          break;
        default:
          result = response("Not found\n", "text/plain; charset=utf-8", 404);
      }

      if (request.method === "HEAD") {
        return new Response(null, result);
      }

      return result;
    } catch (error) {
      console.error(JSON.stringify({
        message: "request failed",
        error: error instanceof Error ? error.message : String(error),
      }));

      return Response.json(
        { error: "Internal server error" },
        { status: 500, headers: { ...securityHeaders, "Cache-Control": "no-store" } },
      );
    }
  },
} satisfies ExportedHandler<Env>;
