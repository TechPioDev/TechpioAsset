# Deploying TechpioAsset to a VPS (piotask.com)

The whole stack — Next.js web, NestJS API, PostgreSQL, Redis — runs in Docker
containers on one VPS, behind a Caddy reverse proxy that terminates HTTPS
automatically.

```
piotask.com ──▶ Caddy (auto TLS)
                 ├── /api/*, /health/*  ──▶ api   (NestJS)
                 └── everything else     ──▶ web   (Next.js)
                              api ──▶ postgres + redis  (private containers)
```

## Requirements

- A VPS with **root/SSH** access (Ubuntu 22.04/24.04 recommended).
- **At least 2 GB RAM** for the build (4 GB comfortable). On a 1–2 GB box, add
  swap first (see step 5 note) or the Next.js/Nest build can be killed (OOM).
- Ports **80** and **443** open to the internet.
- The `piotask.com` DNS **A record** pointing at the VPS's public IP. (For `www`,
  add a second A record and see the note at the end.)

---

## 1. Point DNS at the server

In your domain's DNS, set an **A record**: `@` (piotask.com) → your VPS IP.
Wait for it to resolve before step 6 (Caddy needs it to issue the certificate):

```bash
dig +short piotask.com   # should print your VPS IP
```

## 2. Install Docker on the VPS

```bash
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER   # then log out and back in
docker --version && docker compose version
```

## 3. Get the code

```bash
git clone https://github.com/TechPioDev/TechpioAsset.git
cd TechpioAsset
```

## 4. Create the production environment file

```bash
cp .env.prod.example .env.prod
nano .env.prod
```

Fill in every `CHANGE_ME`:

- `POSTGRES_PASSWORD` and the matching password inside `DATABASE_URL`.
- `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `MFA_ENCRYPTION_KEY` — generate each:
  ```bash
  openssl rand -base64 48
  ```
- `SEED_ADMIN_EMAIL` and `SEED_ADMIN_PASSWORD` — your first login.

Leave `DOMAIN=piotask.com` / `PUBLIC_URL=https://piotask.com` as-is (change only
if the domain differs). Email stays off (`MAIL_PROVIDER=mock`) until you add SMTP.

## 5. Build and start the stack

```bash
docker compose -f docker-compose.prod.yml --env-file .env.prod up -d --build
```

> Low-RAM VPS: if the build is killed, add swap once and retry:
> ```bash
> sudo fallocate -l 4G /swapfile && sudo chmod 600 /swapfile && sudo mkswap /swapfile && sudo swapon /swapfile
> ```

The API applies database migrations automatically on start. Watch it come up:

```bash
docker compose -f docker-compose.prod.yml logs -f api
```

## 6. Seed reference data + create your admin (first deploy only)

```bash
# Roles, permissions, categories, workflows (NODE_ENV=production skips demo users):
docker compose -f docker-compose.prod.yml exec api pnpm seed

# Create the single super-admin from SEED_ADMIN_* in .env.prod:
docker compose -f docker-compose.prod.yml exec api pnpm seed:admin
```

## 7. Verify

- Visit **https://piotask.com** — the login page loads over HTTPS.
- Log in with `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD`, then change the password
  in the app.
- API health: `curl https://piotask.com/health/ready` → `ok`.

---

## Everyday operations

**Deploy new code:**
```bash
bash deploy/preflight.sh          # refuses the deploy if it cannot prove the state is safe
git pull
docker compose -f docker-compose.prod.yml --env-file .env.prod up -d --build
# migrations run automatically on api start
```

**Two steps that are NOT automatic**, and are needed only when a release says so:

```bash
# 1. Re-run the seed when a release adds permission keys. Existing roles do not
#    gain a new permission on their own, so the feature is invisible - and its
#    endpoints return 403 - until this runs. The seed is idempotent.
docker compose -f docker-compose.prod.yml exec api pnpm seed

# 2. Rebuild the APK when the mobile app changed. An old APK keeps calling the
#    old request shapes; when an API contract tightened in the same release,
#    that is a 4xx on a phone somebody is holding at a loading dock.
```

Which releases needed them so far: **v2.6** (seed), **v2.9** (seed **and** APK —
two new permission keys, and mobile receiving gained the category picker and
serial capture). Every release's requirements are stated in its QA scorecard
under *Deploy notes*.

**Logs / restart / stop:**
```bash
docker compose -f docker-compose.prod.yml logs -f
docker compose -f docker-compose.prod.yml restart api
docker compose -f docker-compose.prod.yml down          # stop (keeps data volumes)
```

**Back up the database:**
```bash
docker compose -f docker-compose.prod.yml exec postgres \
  pg_dump -U techpioasset techpioasset > backup-$(date +%F).sql
```

## Turning on email later

Edit `.env.prod`: set `MAIL_PROVIDER=smtp` and fill `SMTP_HOST`, `SMTP_PORT`,
`SMTP_USER`, `SMTP_PASSWORD`, `SMTP_SECURE`. Then:
```bash
docker compose -f docker-compose.prod.yml --env-file .env.prod up -d
```

## Turning on real AI extraction later

Edit `.env.prod`: `AI_PROVIDER=anthropic`, `AI_ENABLED=true`, `ANTHROPIC_API_KEY=...`,
then re-up. It stays inert (`mock`) until you do.

## Deploying behind an existing nginx (piotask.com, shared VPS)

When the VPS already runs **nginx on 80/443** for another site (e.g. PioDeploy),
do **not** use the Caddy stack — it would collide on those ports. Use
`docker-compose.vps.yml` instead: it drops Caddy and binds web/api to
**localhost only**, and the host nginx reverse-proxies piotask.com to them.

```bash
# 1. Install Docker, clone, and create .env.prod (steps 2–4 above).
# 2. Bring up the containers (localhost-bound; no 80/443 used):
docker compose -f docker-compose.vps.yml --env-file .env.prod up -d --build

# 3. Seed reference data + create the admin (first deploy only):
docker compose -f docker-compose.vps.yml exec api pnpm seed
docker compose -f docker-compose.vps.yml exec api pnpm seed:admin

# 4. Add the nginx site (does not touch the existing site):
cp deploy/nginx/piotask.com.conf /etc/nginx/sites-available/piotask.com
ln -sf /etc/nginx/sites-available/piotask.com /etc/nginx/sites-enabled/piotask.com
nginx -t && systemctl reload nginx

# 5. Point piotask.com DNS (A record) at this server, then get TLS:
certbot --nginx -d piotask.com
```

Verify: `curl -I http://127.0.0.1:3000` (web) and
`curl http://127.0.0.1:3001/health/ready` (api) on the server, then
`https://piotask.com` in a browser once DNS + certbot are done. PioDeploy is
untouched throughout — its own DB (MariaDB) and nginx site stay as they are;
TechpioAsset runs its own Postgres + Redis inside Docker.

## Adding www

Add a `www.piotask.com` A record, then change the site line in `Caddyfile` to
`piotask.com, www.piotask.com {` and re-up. Caddy will issue a certificate for both.
