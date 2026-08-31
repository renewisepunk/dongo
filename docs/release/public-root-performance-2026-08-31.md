# Public root performance audit — 2026-08-31

## Scope

This is a measured laboratory audit of the development public root at `https://dev.dongo.so/`. It does not cover the authenticated workspace, field performance, or user interaction latency.

The page was opened in the isolated Chrome instance owned by the configured Chrome DevTools MCP server. `performance_start_trace` recorded an automatic cold reload with 1× CPU and no network throttling. A second controlled run used a 390×844 mobile/touch viewport, device scale factor 1, 4× CPU slowdown, and Chrome's Slow 4G preset. Each run recorded navigation insight set `NAVIGATION_0`.

## Measured result

| Metric | Result | Current good threshold | Verdict |
| --- | ---: | ---: | --- |
| Largest Contentful Paint | 149 ms | ≤ 2,500 ms | Good |
| Time to First Byte contribution | 31 ms | diagnostic only | No issue found |
| LCP render delay contribution | 118 ms | diagnostic only | No issue found |
| Cumulative Layout Shift | 0.00 | ≤ 0.10 | Good |
| Interaction to Next Paint | Not measured | ≤ 200 ms | Requires an interaction/field run |

The trace exposed `LCPBreakdown`, `CLSCulprits`, `RenderBlocking`, `NetworkDependencyTree`, and `Cache`. The render-blocking and cache insights each estimated **0 ms** FCP and LCP savings, so this audit does not recommend speculative resource work. Chrome User Experience Report field data was not available for this development URL.

## Throttled mobile optimization

The first throttled trace on the system-font candidate measured **1,319 ms LCP** (43 ms TTFB plus 1,275 ms render delay) and **0.00 CLS**. Chrome identified two first-party render-blocking stylesheets, with a 1,219 ms longest critical path and estimated 1,151 ms FCP/LCP savings. The stylesheet contents were the shared application styles, public-home styles, and SolidStart development-toolbar CSS that was unused in the built application.

Candidate `f030907` now:

- imports the shared and public-home CSS as strings and emits them in the server-rendered document;
- excludes build-only SolidStart development-toolbar/UI CSS while retaining the overlay in local `vite dev`;
- uses the native system sans stack, avoiding a third-party font stylesheet and font hop. Switzer is a Fontshare closed-source font whose [official license](https://www.fontshare.com/licenses/itf-ffl) permits API delivery but restricts self-hosted public font serving, so dongo does not copy those files into its own assets;
- enforces these decisions with unit regressions and public/mobile browser coverage.

Development web version `7de8f02a-74f2-42fa-a011-271cb6936bf9` then measured:

| Metric | Before | After | Change |
| --- | ---: | ---: | ---: |
| Largest Contentful Paint | 1,319 ms | 714 ms | 605 ms faster (46%) |
| Time to First Byte contribution | 43 ms | 30 ms | diagnostic |
| LCP render delay contribution | 1,275 ms | 685 ms | 590 ms lower |
| Cumulative Layout Shift | 0.00 | 0.00 | stable |

The final trace exposed only `LCPBreakdown`; `RenderBlocking` and `NetworkDependencyTree` were no longer reported. The exact deployed version also passed 14/14 development smoke checks and 8/8 live environment-boundary checks.

The current thresholds and the distinction between laboratory and field evidence follow [Web Vitals guidance](https://web.dev/articles/vitals). The recording method follows the [Chrome DevTools Performance workflow](https://developer.chrome.com/docs/devtools/performance).

## Evidence boundary

- Proven: the public root is fast and visually stable in both the unthrottled and controlled mobile/Slow-4G/4×-CPU Chrome laboratory traces.
- Not proven: field percentiles, INP, authenticated workspace performance, or manual screen-reader behavior.
- Next performance gate: record the authenticated workspace under representative mobile CPU/network throttling and include one real interaction so INP or its laboratory proxy can be assessed.
