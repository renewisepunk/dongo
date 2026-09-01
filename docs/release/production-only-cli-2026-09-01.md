# Production-only public CLI release — 2026-09-01

## Outcome

The public dongo CLI has one service: `https://dongo.so`. Users and agents do not choose an environment, and the installed CLI cannot redirect authentication or credentials to dongo's development infrastructure or a custom origin.

The supported installation is:

```sh
npm install --global @wisepunk/dongo
dongo connect
```

`@wisepunk/dongo@0.1.0` is public on npm and installs the `dongo` executable.

## Enforced boundaries

- `dongo connect` no longer parses or documents `--environment` or `--origin`.
- `dongo ci setup` no longer accepts an environment selector.
- the released service defaults to `https://dongo.so` and rejects programmatic non-production connection options;
- a released CLI rejects an existing development or custom-origin repository marker before sending a credential;
- the executable does not expose dependency injection that could enable the source-only non-production harness;
- Get Started, Help, the repository guide, and the CLI guide describe one live service and no environment choice;
- generated MCP integrations derive their project URL from the production marker written by the CLI.

dongo still maintains isolated development Workers and Convex resources for its own source-level engineering and test harnesses. That separation is an implementation concern, not a product decision presented to users or agents.

## Release proof

The immutable package gate packed and installed the exact three-file npm payload, exercised device authorization through a loopback interception while the executable itself used only `https://dongo.so`, and passed connect, status, doctor, session start, revoke, and logout. It also proved owner-only local credential permissions and the absence of operating-system credential-helper calls.

The accepted canonical package payload SHA-256 is:

```text
07229beb092b610c7f74f5f19ee79a1c8677cc3a1d82e18dbb97a149c65fe022
```

After publication, a fresh anonymous npm install of `@wisepunk/dongo@0.1.0` proved:

- the installed command reports `dongo 0.1.0`;
- help contains no environment, custom-origin, or development-host controls;
- `dongo connect --environment development --json` fails with validation exit code `2`.

The complete repository test suite passed, including the 255-case Chromium, Firefox, and WebKit web matrix. The production web Worker was then deployed, the live Get Started and Help pages exposed the new package and production-only guidance, and the post-deploy production smoke passed 16/16 checks.

## Release identifiers

- npm package: `@wisepunk/dongo@0.1.0`
- npm tarball integrity: `sha512-h4BnGyNqkEKV7UwBY8CEbQpDc5kkzTFdCYUWc+bCtO/gLlxmCMKrg1QpUx4IjhCMTpNerXeW5pF5XYOHZK5YGQ==`
- production-only CLI commit: `9d26693`
- npm distribution commit: `dd3c655`
