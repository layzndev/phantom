# Minecraft Console WebSocket

Endpoint browser:

- `WS /runtime/minecraft/servers/:id/console`

Expected handshake:

- browser request must be upgraded to WebSocket
- API response must be `101 Switching Protocols`
- if the request reaches Express as plain HTTP, Phantom returns `426 Upgrade Required`, which indicates a proxy/misconfigured upgrade path upstream

Authentication:

- reuses the Phantom admin session cookie
- no public RCON port is exposed

Messages sent by server:

```json
{ "type": "log", "line": "[12:00:00 INFO]: Done (3.21s)!" }
{ "type": "status", "status": "running" }
{ "type": "command_result", "id": "cmd-123", "output": "There are 2 of a max of 20 players online" }
{ "type": "error", "message": "Minecraft server is not running." }
```

Messages sent by client:

```json
{ "type": "command", "id": "cmd-123", "command": "list" }
{ "type": "action", "action": "save-all" }
{ "type": "action", "action": "stop" }
```

Internal runtime flow:

1. Browser opens the WebSocket on Phantom API.
2. API registers the console session in the in-memory Minecraft console gateway.
3. Agent polls active console streams for its node.
4. Agent tails Docker logs for active Minecraft containers and pushes lines back to API.
5. API broadcasts log lines and command results to every WebSocket subscriber for that server.

Current V1 transport:

- live logs: `docker logs --timestamps --tail 40 --follow`
- commands: `docker exec <container> rcon-cli <command>`
- save: `docker exec <container> rcon-cli save-all flush`
- graceful stop: `docker exec <container> rcon-cli stop`

Secrets:

- RCON password stays only inside the server record / workload env
- it is never returned to the browser
