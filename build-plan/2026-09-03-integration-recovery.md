# Integration recovery audit — 2026-09-03

Scope: dong060, with companion completion correction dong059. Baseline shared
`origin/main` was `20b7db0`. The initial inventory contained 29 clean worktrees;
there was no uncommitted work to recover. Fresh remote-head inspection found no
additional remote-only capability branches. Old branches are preserved.

## Missing capabilities recovered

| Work | Original local commits | Recovery commits | Original release evidence |
| --- | --- | --- | --- |
| dong047 | `b8b7171`, `cd007ce` | `d667187`, `fac5429` | Outcome explicitly said locally committed, not pushed, deployment left to coordinator. No shared-main or live evidence. |
| dong048 | `8e0dce4` (outcome referred to earlier `e3f4e01`) | `e0428e5` | Owner-curated changelog was tested locally, not pushed, deployment left to coordinator. |
| dong049 | `82af151` | `7e96daa` | Agent marks were tested locally and not pushed. No release evidence. |
| dong059 | `350a2b5` | `b7484fd` | New completion correction; deliberately kept Working during integration and release. |

Each original Done item received a truthful comment that its label was premature
and that recovery is pending under dong060. The original outcomes and history
were not erased. Cherry-picks retain source provenance (`-x`); whole stale branch
histories were not merged. The marketing conflict preserved the already-accepted
newer navigation instead of restoring obsolete links.

## Every pre-existing branch classified

`claude/dong047-admin-org-ownership`, `claude/dong048-changelog`, and
`claude/dong049-agent-icons` contained the missing deltas above.

These branch tips were already ancestors of main: `claude/dong051-website-refresh`,
`codex/dong035-ui-release`, `codex/dong040-wave2-release`,
`codex/dong041-admin-release`, `codex/dong042-cli-release`, and
`codex/dong043-live-agent-release-notice`.

These branches contained only patch-equivalent changes already on main:
`codex/dong031-subtle-cursor`, `codex/dong032-status-redundancy`,
`codex/dong034-ci-identity`, `codex/dong036-work-subtasks`,
`codex/dong037-upgrade-plan`, `codex/dong038-simple-idea-capture`,
`codex/dong044-organization-slugs`, `codex/dong045-logo-weight`,
`codex/dong046-admin-search`, `codex/dong050-agent-owner-attention`,
`codex/dong050-owner-attention-notifications`, `codex/dong051-marketing-refresh`,
`codex/dong052-mobile-header`, `codex/dong053-auto-inbox-runner`,
`codex/dong054-needs-you-alerts`, and `codex/dong056-parallel-guidance`.

Three apparent `git cherry` exceptions were independently range-diff reviewed:

| Branch | Original → integrated | Classification |
| --- | --- | --- |
| `codex/dong033-responsive-controls` | `df75e17` → `4112a10` | Only adjacent test context differs. Mobile positioning was later intentionally superseded by dong052/`0516d06`; focus/truncation coverage remains. |
| `codex/dong039-admin-limits` | `f4d8162` → `07dda60` | Decision numbering/newer-base context and the retained `MAX_CHILD_WORK_ITEMS` import explain the difference. Other branch commits are patch-equivalent. |
| `codex/dong055-human-close` | `b778780` → `7f68d0e` | Only runner-job kind narrowing required by dong053 differs. |

These exceptions were not replayed. `main` remained the baseline shared checkout;
new dong059/dong060 worktrees are this recovery, not pre-existing stranded work.

## Acceptance fixes, not blind replay

`adb0029` adds changelog revision/idempotency guards, response-loss replay and
stale-resurrection coverage, exact bounded publication lookup, feature adapter
separation, truthful failure states, environment-specific site bindings, and
duplicate-link removal. `10a8626` adds 50-row owner pagination so older public
entries remain editable and removable from the public page through the supported UI.

The admin membership query now selects owners before truncation, including
later-added owners. Per organization it reads at most 26 memberships per role
and 25 profiles; pages contain at most 25 organizations. This does add bounded
profile reads, contrary to the original outcome's no-query-fanout wording.

Changelog publication is explicit owner-authored disclosure only. Deployment
does not publish any private Work. The release must test only synthetic wording
in the development test project. The agent marks remain original geometric
stand-ins, not vendor logos. Unrelated idle-agent color Intake is out of scope.

## Release status at candidate preparation

Implementation is ready for full gates; integration/release is pending. Focused
checks passed: 18 changelog/admin domain tests, 74 web unit tests, web typechecks,
48 affected browser tests across Chromium/Firefox/WebKit, and 3 additional older
publication pagination journeys. These checks are not production acceptance.

Record the exact final revision, full gates, shared-main proof, deployment Worker
versions, live acceptance, CLI integrity, and production post-cutover outcome as
artifacts on dong060. Do not mark this audit or the companion Work Done merely
because this report is committed. The Git helper proves integration, not live
behavior; the production runbook still governs promotion and rollback.
