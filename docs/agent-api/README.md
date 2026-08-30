# dongo agent API artifacts

`v1/openapi.json` and `v1/agent-api.schema.json` are generated from the
transport-neutral operation registry in `@dongo/contracts`. They are the
machine-readable contract for HTTPS clients and non-TypeScript SDK generation;
the MCP gateway maps the same registry to tools.

Regenerate after an intentional contract change:

```sh
npm run generate:contracts
```

CI runs `npm run verify:contracts` and fails when the checked-in artifacts drift
from the registry. Do not edit the generated JSON by hand.
