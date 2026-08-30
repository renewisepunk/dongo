# Agent 08 — iOS

## Mission

Build the SwiftUI native client after the human API and notification contracts are frozen. Match web semantics rather than inventing iOS-specific backend behavior.

## Exclusive ownership

- `apps/ios/**`
- iOS-specific project/build/signing configuration
- iOS unit/UI tests

Shared API contracts belong to Agent 01; backend/auth/media/notification changes are requested through Agent 00.

## Start conditions

- Web Beta gate passes.
- Human-facing API, authentication, upload, Attention response, and device-registration contracts are frozen.
- APNs environments and secret-management plan exist.
- UX states and deep-link routes are documented.

## Tasks

### IOS-01 — Foundation and authentication

- Create the SwiftUI app, environment configuration, typed contract client, secure token/session handling, Google/email OTP flow, organization/project context, offline/reconnect state, and navigation/deep-link router.

Acceptance:

- Dev/staging/prod cannot mix credentials.
- Session expiry is recoverable and exposes no stale protected content.
- No auth secret is written to logs or insecure storage.

### IOS-02 — Core product surfaces

- Implement Overview, permanent capture, Work detail, comments, Attention response, artifacts, and Recently Done with native accessibility/dynamic type.

Acceptance:

- Information hierarchy and Needs You precedence match web.
- Optimistic mutations reconcile once.
- VoiceOver, Dynamic Type, reduced motion, keyboard where applicable, and dark/light appearance pass.

### IOS-03 — Media

- Implement image/video/file selection, local preview, direct/multipart R2 transfer, progress, cancel, resume/retry, quota, and secure download/open.

Acceptance:

- Large upload never transits the app backend.
- Background/interrupted transfer resumes safely without duplicate metadata.
- Final Intake references finalized attachments only.

### IOS-04 — APNs and deep links

- Register/rotate/disable device tokens, receive minimal-ID payloads, and deep-link to the correct organization/project/WorkItem after cold or warm start.

Acceptance:

- Logged-out or unauthorized deep links fail safely.
- Private work text is absent from payloads.
- Token rotation/removal stops delivery to stale devices.

## Handoff

Provide build/test commands, supported iOS versions/devices, signing requirements, accessibility evidence, push test evidence, known platform limitations, and exact contract version.

