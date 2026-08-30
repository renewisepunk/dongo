UPDATE oauthClient
SET name = 'dongo CLI'
WHERE clientId = 'dongo-cli' AND name = 'Don' || 'go CLI';

UPDATE oauthClient
SET name = 'dongo MCP resource server'
WHERE clientId = 'dongo-mcp-resource-dev'
  AND name = 'Don' || 'go MCP resource server';

UPDATE oauthClient
SET name = 'dongo agent API resource server'
WHERE clientId = 'dongo-api-resource-dev'
  AND name = 'Don' || 'go agent API resource server';

UPDATE oauthResource
SET name = 'dongo agent API'
WHERE identifier = 'https://dev.dongo.so/api/agent/v1'
  AND name = 'Don' || 'go agent API';
