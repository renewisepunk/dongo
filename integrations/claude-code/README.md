# Claude Code remote MCP setup

Preferred interactive setup after substituting the trusted project values:

```sh
claude mcp add --transport http --scope project dongo-{{shortProjectRef}} {{origin}}/p/{{publicProjectRef}}/mcp
claude mcp login dongo-{{shortProjectRef}}
```

For SSH/headless use, add `--no-browser` to `claude mcp login`. The alternative checked-in `mcp.json` template must be merged as `.mcp.json` and explicitly approved by the user when Claude shows the project trust prompt. It contains no authorization header; Claude owns and refreshes a separate OAuth grant.

`claude mcp logout dongo-{{shortProjectRef}}` clears host-local OAuth material. `claude mcp remove --scope project dongo-{{shortProjectRef}}` removes the project configuration. Revoke the Dongo installation separately when access must be invalidated server-side.
