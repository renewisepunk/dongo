# Authenticated workspace performance audit — 2026-08-31

## Scope

This is a measured laboratory audit of the signed-in development workspace at `https://dev.dongo.so/app/test-40098de8wj/dongo-e2e`. It covers a clean authenticated load of the desktop master–detail surface and the real keyboard path from the overview into work detail.

The human signed a fresh Chrome for Testing 151 profile into the disposable `test@paul9.com` account. The audit then connected to that exact browser over the Chrome DevTools Protocol. Each run used a 1440×960 desktop viewport, 4× CPU slowdown, 150 ms network latency, 1.6 Mbps download, and 750 Kbps upload. The browser was restored to normal CPU, network, and viewport settings after every run.

The authenticated application keeps its real-time Convex connection open, so `networkidle` is not a meaningful completion signal. Measurements use the document navigation and paint entries plus a fixed three-second post-`DOMContentLoaded` observation window. A `PerformanceObserver` recorded largest-contentful-paint, layout-shift, long-task, and event entries.

## Measured result

Three cold authenticated navigations produced the following repeatability evidence:

| Run | TTFB | FCP | LCP | CLS | Long tasks | `J` selection | `Enter` open | Longest key event |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | 58 ms | 552 ms | 2,400 ms | 0.00 | 0 | 57 ms | 138 ms | 120 ms |
| 2 | 41 ms | 464 ms | 2,348 ms | 0.00 | 0 | 30 ms | 84 ms | 56 ms |
| 3 | 33 ms | 480 ms | 2,112 ms | 0.00 | 0 | 24 ms | 74 ms | 48 ms |
| Median | 41 ms | 480 ms | 2,348 ms | 0.00 | 0 | 30 ms | 84 ms | 56 ms |

The final run reached `DOMContentLoaded` at 226 ms and the load event at 452 ms. It loaded 18 subresources with 114,918 encoded bytes, rendered two work rows, moved visible keyboard focus with `J`, and opened `Prove the Codex MCP human loop` with `Enter`. The resulting route carried the selected `work` query and the detail rendered its title plus the `Golden journey progress 🧪` and `Human loop complete ✅` activity headings.

## Verdict

- Largest Contentful Paint remained within the current 2,500 ms “good” laboratory threshold in all three 4× CPU/Slow-4G-style runs.
- Cumulative Layout Shift was zero in all three runs.
- No task exceeded the 50 ms long-task threshold.
- The worst measured keyboard-open path was 138 ms and the worst observed key event duration was 120 ms, both within the current 200 ms “good” interaction target.
- The keyboard result is a controlled laboratory proxy, not field INP. Development has no CrUX population or production field percentile.

The authenticated-workspace throttling and real-interaction release gate is therefore proven for the desktop web workflow. This audit does not replace the automated responsive matrix, a manual screen-reader pass, mobile field data, or production monitoring.
