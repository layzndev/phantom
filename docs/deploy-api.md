# Phantom API Deployment

This guide deploys `apps/api` behind systemd and Nginx on an EC2 instance in the same VPC as Aurora PostgreSQL.

## 1. Build API

Recommended production path:

```bash
sudo useradd --system --create-home --shell /usr/sbin/nologin phantom
sudo mkdir -p /opt/phantom /etc/phantom
sudo chown -R ec2-user:ec2-user /opt/phantom
git clone https://github.com/layzndev/phantom.git /opt/phantom
cd /opt/phantom
npm install --include=dev
npm run db:generate --workspace @phantom/api
npm run build --workspace @phantom/api
sudo chown -R phantom:phantom /opt/phantom
```

## 2. Environment

Create `/etc/phantom/phantom-api.env`:

```bash
sudo nano /etc/phantom/phantom-api.env
```

Example:

```env
NODE_ENV=production
HOST=127.0.0.1
PORT=4200
WEB_ORIGIN=https://admin.phantom.example.com
CORS_ORIGINS=https://admin.phantom.example.com
TRUST_PROXY=loopback
COOKIE_SAMESITE=none
DATABASE_URL=postgresql://postgres:<password>@phantom.cluster-cdi4s00e0l6y.eu-west-3.rds.amazonaws.com:5432/postgres?schema=public&sslmode=require
SESSION_SECRET=<long-random-secret>
ADMIN_BOOTSTRAP_EMAIL=admin@company.local
ADMIN_BOOTSTRAP_PASSWORD=<temporary-bootstrap-password>
HOSTING_API_BASE_URL=
HOSTING_API_TOKEN=
HOSTING_API_NODES_PATH=/admin/nodes
HOSTING_API_TIMEOUT_MS=7000
HOSTING_API_RETRY_ATTEMPTS=1
```

Lock permissions:

```bash
sudo chown root:phantom /etc/phantom/phantom-api.env
sudo chmod 640 /etc/phantom/phantom-api.env
```

## 3. Prisma Migrations

```bash
cd /opt/phantom
npm run db:migrate:deploy --workspace @phantom/api
npm run admin:bootstrap --workspace @phantom/api
```

## 4. systemd

Install the unit:

```bash
sudo cp /opt/phantom/deploy/systemd/phantom-api.service /etc/systemd/system/phantom-api.service
sudo systemctl daemon-reload
sudo systemctl enable phantom-api
sudo systemctl start phantom-api
sudo systemctl status phantom-api
```

Logs:

```bash
sudo journalctl -u phantom-api -f
sudo journalctl -u phantom-api --since "10 minutes ago"
```

Healthcheck:

```bash
curl http://127.0.0.1:4200/health
```

## 5. Nginx Reverse Proxy

Install Nginx:

```bash
sudo dnf install -y nginx
sudo systemctl enable nginx
```

Install the site:

```bash
sudo cp /opt/phantom/deploy/nginx/phantom-api.conf /etc/nginx/conf.d/phantom-api.conf
sudo nano /etc/nginx/conf.d/phantom-api.conf
```

Replace:

```nginx
server_name api.phantom.example.com;
```

with the real API domain.

Test and reload:

```bash
sudo nginx -t
sudo systemctl reload nginx
sudo systemctl status nginx
```

Minecraft console WebSocket:

- the API process must be started from `apps/api/src/server.ts`, which attaches `server.on("upgrade")` on the same HTTP server used by Express
- Nginx must forward `Upgrade` and `Connection` headers to `/runtime/minecraft/servers/:id/console`
- a successful browser handshake must show `101 Switching Protocols`
- if the request hits Express over plain HTTP instead of Node's `upgrade` event, the API now returns `426 Upgrade Required` instead of a generic `404`

Healthcheck through Nginx:

```bash
curl http://api.phantom.example.com/health
```

Preflight `OPTIONS` requests are proxied to Express. CORS stays centralized in the API through `CORS_ORIGINS`, so Nginx does not duplicate or weaken origin validation.

## 6. HTTPS

The Nginx config is HTTP-ready. Add TLS with ACM/ALB in front of EC2, or install Certbot on the EC2.

For production cookies:

- `NODE_ENV=production`
- `COOKIE_SAMESITE=none` if frontend and API are on different subdomains.
- `COOKIE_SAMESITE=lax` or `strict` if frontend and API are served under the same site/domain and flows allow it.
- Always use HTTPS when `COOKIE_SAMESITE=none`, because browsers require `Secure`.

## 7. CORS Strategy

Same domain strategy:

```env
WEB_ORIGIN=https://admin.phantom.example.com
CORS_ORIGINS=https://admin.phantom.example.com
COOKIE_SAMESITE=lax
```

Different subdomains strategy:

```env
WEB_ORIGIN=https://admin.phantom.example.com
CORS_ORIGINS=https://admin.phantom.example.com
COOKIE_SAMESITE=none
```

Multiple allowed origins:

```env
CORS_ORIGINS=https://admin.phantom.example.com,https://ops.phantom.example.com
```

## 8. Debug Commands

```bash
sudo systemctl status phantom-api
sudo journalctl -u phantom-api -f
sudo journalctl -u phantom-api --since "1 hour ago"
sudo nginx -t
sudo systemctl status nginx
curl http://127.0.0.1:4200/health
curl http://api.phantom.example.com/health
```
