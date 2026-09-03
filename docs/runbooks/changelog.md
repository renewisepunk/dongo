# Owner-curated changelog

Completed Work is private by default. An organization owner can use **Public
changelog** in project settings to review completed items in bounded 50-row pages,
edit a public headline and summary, and deliberately publish, update, or
unpublish an entry. **Load older completed Work** keeps older public entries
manageable. The public query returns only the reviewed title, summary, date, and
entry ID; it never returns Work identifiers, goals, outcomes, comments, or files.
The owner editor displays canonical Work identifiers through the shared Work
formatter, including for older records that retain legacy lookup aliases.

The marketing `/changelog` page selects the environment's own project through
`VITE_DONGO_SITE_PROJECT_REF`. The production default is `en8dgh2y-dongo`; the
development default is `p58de816-dongo`. A deliberately empty override displays
the empty state. An unavailable backend displays an error, not a claim that no
entries exist. Deploying the feature never publishes entries.

Publication uses an independent `changelogRevision` on the Work document so
editing public wording does not change the Work execution revision. Publish and
unpublish require the displayed revision and a caller-generated idempotency key.
Retries of the exact operation reuse its key; changed operations use a fresh
key. The revision survives unpublishing, preventing a stale draft from silently
resurrecting an entry. Errors preserve the owner's draft; reload and review the
latest entry before saving a conflicting edit. Every successful change records
an attributed event without copying the public or private text into that event.

Acceptance must prove owner-only access, cross-project denial, private empty
state, explicit synthetic publication/update/unpublish, response-loss replay,
stale writes, and narrow-screen rendering. Never publish real Work as a test.
