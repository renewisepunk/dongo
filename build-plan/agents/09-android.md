# Agent 09 — Android

## Mission

Build the Kotlin/Jetpack Compose native client after the human API and notification contracts are frozen. Maintain semantic parity with web and iOS without platform-specific backend forks.

## Exclusive ownership

- `apps/android/**`
- Android-specific Gradle/build/signing configuration
- Android unit/instrumentation/UI tests

Shared API contracts belong to Agent 01; backend/auth/media/notification changes are requested through Agent 00.

## Start conditions

- Web Beta gate passes.
- Human-facing API, authentication, upload, Attention response, and device-registration contracts are frozen.
- FCM environments and secret-management plan exist.
- UX states and deep-link routes are documented.

## Tasks

### AND-01 — Foundation and authentication

- Create the Compose app, environment configuration, typed contract client, encrypted token/session handling, Google/email OTP flow, organization/project context, offline/reconnect state, and navigation/deep-link router.

Acceptance:

- Dev/staging/prod cannot mix credentials.
- Session expiry is recoverable and exposes no stale protected content.
- No auth secret is written to logs, backups, or insecure preferences.

### AND-02 — Core product surfaces

- Implement Overview, permanent capture, Work detail, comments, Attention response, artifacts, and Recently Done with TalkBack and adaptive layouts.

Acceptance:

- Information hierarchy and Needs You precedence match web.
- Optimistic mutations reconcile once.
- TalkBack, font scaling, reduced motion, keyboard, and phone/tablet layouts pass.

### AND-03 — Media

- Implement image/video/file picker integration, URI permission handling, local preview, direct/multipart R2 transfer, progress, cancel, resume/retry, quota, and secure download/open.

Acceptance:

- Large upload never transits the app backend.
- Process death/interrupted transfer recovers safely without duplicate metadata.
- Content URIs and downloaded files cannot escape intended storage/access rules.

### AND-04 — FCM and deep links

- Register/rotate/disable device tokens, receive minimal-ID payloads, and deep-link to the correct organization/project/WorkItem after cold or warm start.

Acceptance:

- Logged-out or unauthorized deep links fail safely.
- Private work text is absent from payloads.
- Token rotation/removal stops delivery to stale devices.

## Handoff

Provide build/test commands, supported Android/API versions, signing requirements, accessibility evidence, push test evidence, known OEM/background limitations, and exact contract version.

