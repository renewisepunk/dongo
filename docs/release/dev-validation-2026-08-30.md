# Development validation — 2026-08-30

This is a living evidence ledger for the development stack. It is not a production release approval.

## Fixed boundaries

- Development origin: `https://dev.dongo.so`
- Convex development deployment: `wandering-camel-662`
- MCP resource: `https://dev.dongo.so/p/p58de816-dongo/mcp`
- Repository: `https://github.com/renewisepunk/dongo`
- Original PRD SHA-256: `b6a97c39aaf056dd6380e451b89fd76ff8883ac968ede5a1b0fab48eceb0f70a`
- Production `dongo.so` Worker and data were not deployed or mutated by this validation.

## Proven now

| Gate | Evidence |
|---|---|
| Local unit/integration suite | `npm test`: 230 tests passed across Workers, CLI, local storage, web, MCP, contracts, and Convex on the current candidate. |
| Web browser matrix | Playwright: 183/183 passed across Chromium, Firefox, and WebKit, including auth states, onboarding, first-project device approval, MCP consent, paste image, full-page drop, upload retry/cancel, overview, detail, responsive, and settings. |
| Static/type/build checks | `npm run check`, contract generation, lowercase brand verification, six-Worker development isolation, the 347-file secret scan, and the 171-file safe-runtime-log scan passed on the current candidate. Both production-only and full dependency audits reported zero vulnerabilities. |
| Development runtime | Auth Worker version `9f57a137-c0e1-4f59-a3d9-2be6b153627f` and web version `ade5db0d-464c-49e7-af4a-72609c1ef4c3` are deployed only to development. `npm run smoke:dev -- --project-ref p58de816-dongo`: 14/14 passed after deployment. Notification readiness explicitly requires dispatch plus Resend for Web Beta and still reports APNs/FCM as disabled. |
| Packaged CLI in this repository | Packed `@dongo/cli@0.1.0` (SHA-256 `6716a8acfa1b0dd6d700d8182eef58dfc7d070191b8bc590b108320473f78b00`), installed that tarball into a clean temporary prefix, and ran the exact binary from this repository. `doctor`, `session-start`, `overview`, and deterministic `sync` succeeded against the live project. A second `sync` made no changes. |
| Repository metadata | Live `doctor` returned repository URL `https://github.com/renewisepunk/dongo`, project ref `p58de816-dongo`, and matching server installation context. |
| CLI credential policy | Live CLI uses the owner-only dongo credential file and produces no Keychain/helper prompt. Tests cover file ownership, mode, symlink, repository escape, corruption, refresh rotation, and failed-revocation retention. |
| Codex MCP read/write | Codex used installation actor `j57dzgkqcxwcg50mdj190jxq2s8df0vs`, called `dongo_session_start`, and created comment `js71qh34zk468c29801ga58ye98dfq18` on work `mh7e9y0dvv4m5y73fx5m0412y18dfwgb`. Retrying the same body and idempotency key returned the same comment ID and created no duplicate. CLI actor `j579dtxvpx9f9zjkd5fekahm198dea1w` is distinct. |
| Cross-surface repository proof | A subsequent packaged-CLI sync exported the Codex-created comment into `.agent-work` and updated the deterministic manifest hash. |
| Google redirect configuration | The live Google start reached Google's normal account identifier screen instead of `redirect_uri_mismatch`. Its callback target was exactly the development Convex auth callback. No Google credentials were entered during this probe. |
| Fresh-account agent-first CLI | A new disposable `test@paul9.com` identity completed email OTP with no existing project. The packed CLI proposed `dongo e2e`, `https://github.com/renewisepunk/dongo`, and manual execution in one complete device link; the browser showed the fixed proposal with the same comparison code and no project picker. `Create & approve` provisioned project `hn8dewzz-dongo-e2e`. A cross-account browser-session mismatch surfaced during the first grant attempt, was fixed with exact Convex-profile binding, covered by focused tests, deployed, and then retested successfully. The browser showed `Approved — you can close this window`; the waiting packed CLI stored an owner-only local credential, wrote the repository marker, and passed `auth status`, `doctor`, `overview`, and `session-start` against the new empty project. Both files were mode `0600`; no Keychain/helper prompt appeared. |
| OAuth callback safety | MCP consent uses `window.location.assign` for a top-level host-owned loopback redirect. dongo does not frame, fetch, probe, or proxy localhost. Live Claude Code authorization returned directly to the host-owned loopback completion page in Chrome without triggering the private-network/device-access prompt. |
| Claude Code MCP compatibility | The deployed authorization Worker accepts only Claude Code's exact CIMD client and exact port-bearing localhost callback shape after verifying the official metadata's base callback. The callback remains bound through both consent and continuation POSTs and is revalidated before use. Auth tests cover the positive path and rejected host, scheme, path, query, client, duplicate, malformed, and oversized inputs. Live consent identified `Claude Code` exactly; the grant appears as `Claude Code remote MCP`, and Claude Code reported the server connected. A distinct Claude Code installation called `dongo_session_start` and `dongo_get_overview`, then created Ready work item `DONGO-2` once. Repeating the same `dongo_create_work` request with the same idempotency key returned the same item without a duplicate. The item remains unclaimed and unstarted in manual mode. |
| Lowercase product name | Static copy verifier now covers root source, JS/TS strings, prose, HTML, JSON/JSONC, SQL, SVG, and XML. Legacy CLI system labels were migrated idempotently in Convex and auth D1; user-created project names remain verbatim. |
| Important Attention delivery | Live request `jn7126d0h40h05fb0cr3etdbtn8dfg8p` created delayed outbox item `ks7dka8784aha3ps7ynv8hhj0n8de289`. It dispatched once at the real one-hour boundary with no error or retry. Convex recorded provider message `b266c07d-0769-41dd-8723-93fb1a967ec0`; the Wisepunk Resend account reported that same message delivered from `dongo <notifications@dev.dongo.so>` with subject `Attention still needed for DONGO-1`. |

## Still required

- Complete a current generic MCP Inspector OAuth login, strict tool list, read call, idempotent write retry, refresh, and independent revocation evidence.
- Complete live Google sign-in with the intended Wisepunk Google account and verify the resulting Convex identity; the redirect-only probe is not full authentication proof.
- Verify CLI logout/revocation behavior against a disposable grant without disturbing the retained fresh-account evidence grant.
- After any further code change, rerun the complete suite and repeat secret, runtime-log, contract, environment, browser, and live smoke gates on the exact candidate commit.
- Native APNs/FCM, native clients, production isolation/promotion, clean-machine package provenance, performance/accessibility audits beyond the current automated matrix, rollback rehearsal, and product-owner sign-off remain separate V1 gates.
