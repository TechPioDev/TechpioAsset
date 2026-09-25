# Staging

A second copy of PioAssets at `staging.pioassets.com`, on the same VPS as
production, holding a **scrubbed** copy of the production database. It exists so
that a change is seen working on real-shaped data before it reaches the machine
52 people use.

Production is unaffected by everything here: a different compose project means
different containers *and different volumes*, so staging cannot open
production's database even by mistake.

| | production | staging |
|---|---|---|
| directory | `/opt/techpioasset` | `/opt/techpioasset-staging` |
| compose project | `techpioasset` | `techpioasset-staging` |
| compose file | `docker-compose.vps.yml` | `docker-compose.staging.yml` |
| env file | `.env.prod` | `.env.staging` |
| ports (localhost) | web 3000, api 3001 | web 3100, api 3101 |
| branch | `prod` | `main` |
| mail / push / AI | live | mock, and unable to be otherwise |

## Why staging cannot email or notify anyone

This is the part worth understanding, because one half of it is not obvious.

**Push** reads only the environment. `PUSH_PROVIDER=mock` in `.env.staging`, and
the Firebase service-account key is not mounted into the staging container at
all. A missing file is a stronger promise than a setting.

**Mail does not work that way.** `RoutingMailProvider` prefers the
`mail_settings` row in the *database* and falls back to `MAIL_PROVIDER` only if
there isn't one. A restored production database therefore carries live SMTP
credentials that override `MAIL_PROVIDER=mock` entirely. So the scrub deletes
that row, and `ai_settings` with it. **Both** the environment and the scrub are
required; neither alone is enough.

## Refreshing staging from production

Run on the server. The order is not adjustable: the staging API is not started
until the scrub has committed, because an API booted against an unscrubbed
restore can mail and notify real people within seconds.

```bash
cd /opt/techpioasset-staging
./deploy/scrub-staging-db.sh /var/backups/techpioasset/latest.dump
```

It drops and recreates the staging database, restores the dump, scrubs it,
starts the stack, and prints one randomly generated password shared by every
account. The password is shown once and stored nowhere.

What the scrub does:

- deletes `mail_settings`, `ai_settings`, `device_tokens`, `refresh_tokens`,
  `verification_tokens`, `scim_tokens`, `agent_enrolment_tokens`,
  `webhook_subscriptions`, `email_logs`, `notifications`
- replaces names, emails, phones, employee numbers, avatars, and company,
  office and vendor contact details
- nulls `ipAddress` / `userAgent` on the audit trail, keeping who-did-what
- **preserves NULL** — a profile with no phone keeps no phone, because filling
  every optional column hides the empty-field bugs staging exists to catch
- fake names are derived from the row id, so the same person is the same fake
  person across refreshes and a bug report stays readable

Two guards refuse rather than proceed:

1. **Not a staging database.** Both the shell script and the SQL refuse a
   database without `staging` in its name.
2. **Schema grew a personal column the scrub doesn't handle.** The SQL asks the
   database what personal-looking text columns exist and stops if one isn't on
   its list. A scrub believed to be complete is more dangerous than no scrub,
   because the box goes on the internet either way. When this fires, add the
   column to `deploy/staging-scrub.sql` and run again.

Uploads are **not** copied. Condition photos are pictures of a real office; the
staging volume starts empty and avatars fall back to initials.

## Deploying

The same script drives both. Staging health-checks the container ports, not the
public URL: staging sits behind basic auth, so nginx would answer 401 for both
checks — and 401 is what the API check expects, so a dead API would pass.

```bash
# staging (branch: main)
cd /opt/techpioasset-staging && \
  APP_DIR=/opt/techpioasset-staging \
  COMPOSE_FILE=docker-compose.staging.yml \
  ENV_FILE=.env.staging \
  SITE=https://staging.pioassets.com \
  BRANCH=main \
  HEALTH_WEB_URL=http://127.0.0.1:3100/login \
  HEALTH_API_URL=http://127.0.0.1:3101/api/v1/auth/me \
  ./deploy/deploy-vps.sh

# production (branch: prod) — unchanged defaults except the branch
cd /opt/techpioasset && BRANCH=prod ./deploy/deploy-vps.sh
```

## Promoting a tested commit to production

`main` is what staging runs. `prod` is what production runs. Promotion is a
fast-forward, so production can only ever run a commit that has been on staging.

```bash
git checkout prod && git merge --ff-only main && git push origin prod
cd /opt/techpioasset && BRANCH=prod ./deploy/deploy-vps.sh
```

## First-time setup

1. DNS: `staging.pioassets.com` A record to the server.
2. `git clone` into `/opt/techpioasset-staging`, checkout `main`.
3. `cp .env.staging.example .env.staging` and fill every `CHANGE_ME` with
   **fresh** secrets — a staging box sharing production's JWT secret is a way
   into production.
4. `htpasswd -c /etc/nginx/.htpasswd-staging pioassets`
5. Install `deploy/nginx/staging.pioassets.com.conf`, then
   `certbot --nginx -d staging.pioassets.com`.
6. Refresh from production with the script above.

Staging is deliberately **not** in the backup rotation. It is a copy of
something already backed up, and including it would double the backup size.
