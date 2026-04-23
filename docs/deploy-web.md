# Phantom Web Deployment

This guide deploys the Next.js admin frontend behind systemd and Nginx.

## 1. DNS

Create:

```text
A admin.nptnz.com -> 52.47.69.6
```

Wait until:

```bash
dig +short admin.nptnz.com
```

returns the EC2 public IP.

## 2. Environment

Create `/etc/phantom/phantom-web.env`:

```bash
sudo nano /etc/phantom/phantom-web.env
```

Content:

```env
NODE_ENV=production
NEXT_PUBLIC_ADMIN_API_URL=https://api-admin.nptnz.com
```

Permissions:

```bash
sudo chown root:phantom /etc/phantom/phantom-web.env
sudo chmod 640 /etc/phantom/phantom-web.env
```

## 3. Build

```bash
cd /opt/phantom
sudo chown -R ec2-user:ec2-user /opt/phantom
git pull
npm install --include=dev
npm run build --workspace @phantom/web
sudo chown -R phantom:phantom /opt/phantom
```

## 4. systemd

```bash
sudo cp /opt/phantom/deploy/systemd/phantom-web.service /etc/systemd/system/phantom-web.service
sudo systemctl daemon-reload
sudo systemctl enable phantom-web
sudo systemctl start phantom-web
sudo systemctl status phantom-web
```

Local check:

```bash
curl -I http://127.0.0.1:3000/login
```

## 5. Nginx + HTTPS

First install a temporary HTTP-only server if Certbot needs it, or copy the final file after the cert exists.

Generate certificate:

```bash
sudo certbot certonly --nginx -d admin.nptnz.com
```

Install final Nginx config:

```bash
sudo cp /opt/phantom/deploy/nginx/phantom-web.conf /etc/nginx/conf.d/phantom-web.conf
sudo nginx -t
sudo systemctl reload nginx
```

Check:

```bash
curl -I https://admin.nptnz.com/login
sudo journalctl -u phantom-web -f
sudo tail -f /var/log/nginx/phantom-web.access.log
```

## 6. Login/Cookies

API env must include:

```env
NODE_ENV=production
WEB_ORIGIN=https://admin.nptnz.com
CORS_ORIGINS=https://admin.nptnz.com
COOKIE_SAMESITE=none
TRUST_PROXY=loopback
```

In browser devtools, `/auth/login` should set:

```text
phantom.sid; HttpOnly; Secure; SameSite=None
```
