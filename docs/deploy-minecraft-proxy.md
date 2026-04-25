# Deploy Minecraft Proxy

Environment:

```env
PHANTOM_API_URL=https://api-admin.nptnz.com
PHANTOM_NODE_TOKEN=replace-me
PROXY_LISTEN_HOST=0.0.0.0
PROXY_LISTEN_PORT=25565
PROXY_ROUTING_CACHE_TTL_MS=5000
PROXY_CONNECT_TIMEOUT_MS=5000
```

Build:

```bash
npm run build --workspace @phantom/minecraft-proxy
```

Run:

```bash
npm run start --workspace @phantom/minecraft-proxy
```

Systemd example:

- [deploy/systemd/phantom-minecraft-proxy.service](/Users/naylow/Documents/phantom-main/deploy/systemd/phantom-minecraft-proxy.service)

Behavior:

- listens publicly on `0.0.0.0:25565`
- reads the Minecraft Java handshake hostname
- resolves routing through `GET /runtime/minecraft/routing?hostname=...`
- proxies raw TCP to the assigned backend host/port when the server is running
- returns a clean Minecraft message for unknown, sleeping, starting, or unavailable servers

Wildcard DNS:

```text
A      @      -> NOVA_PUBLIC_IP    (DNS only)
CNAME  *      -> nptnz.co.uk       (DNS only)
```

All Minecraft hostnames like `anthony.nptnz.co.uk` and `skyblock.nptnz.co.uk` should resolve to the proxy. Phantom then extracts the requested subdomain and routes traffic to the correct backend workload.
