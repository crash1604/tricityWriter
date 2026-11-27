# Deploying TriCity Writer on a GoDaddy VPS

TriCity Writer runs as one Docker Compose stack on a single Linux server:

```
            ┌──────────────── GoDaddy VPS (Ubuntu) ────────────────┐
internet ──►│ Caddy :80/:443 ─┬─► web (Next.js dashboard)           │
            │  (auto HTTPS)   └─► api (REST, auth, MCP) ─┬─► Postgres│
            │                      worker (AI jobs) ─────┴─► Redis   │
            └───────────────────────────────┬──────────────────────┘
                                            ▼ HTTPS + connection token
                              WordPress sites with the Connector plugin
                              (GoDaddy Managed WordPress, cPanel, anywhere)
```

**Why a VPS:** GoDaddy's Web Hosting, cPanel and Managed WordPress plans can host the WordPress sites that install our plugin, but they can't run the app itself. Neither can GoDaddy's Node.js Hosting add-on, which allows only MySQL, no Redis, and one app per upload. A VPS gives the root access the stack needs.

## 1. Get the server

Buy a **GoDaddy VPS** (self-managed is fine):

- **OS:** Ubuntu 24.04 LTS.
- **Size:** at least 2 vCPU / 4 GB RAM. 4 vCPU / 8 GB builds faster and leaves room to grow. The first build needs about 3 GB of memory; the bootstrap script adds swap on smaller servers.
- **Disk:** 40 GB or more.

During setup GoDaddy asks for an admin username and password. When the server is ready, note its **IP address**, then give the deploy scripts root access over SSH:

1. In GoDaddy, open the VPS → **Manage → Settings → Access → Admin Access → Enable Admin Access**, then **Save**.
2. On your computer, create an SSH key if you don't have one (`ls ~/.ssh/id_ed25519.pub`; otherwise `ssh-keygen -t ed25519`), and copy it to your admin user:
   ```sh
   ssh-copy-id YOUR_ADMIN_USER@YOUR_SERVER_IP
   ```
3. Let the same key log in as root:
   ```sh
   ssh -t YOUR_ADMIN_USER@YOUR_SERVER_IP 'sudo install -d -m 700 /root/.ssh && sudo install -m 600 ~/.ssh/authorized_keys /root/.ssh/authorized_keys'
   ```
4. Check that it works without a password prompt:
   ```sh
   ssh root@YOUR_SERVER_IP
   ```

Ubuntu allows root to log in with a key but not with a password, so this doesn't open password logins.

## 2. Prepare the server (once)

From the repository on your computer:

```sh
ssh root@YOUR_SERVER_IP 'bash -s' < deploy/bootstrap-vps.sh
```

The script:

- installs Docker from Docker's own apt repository;
- allows only SSH, HTTP and HTTPS through the firewall;
- adds swap if the server has less than 8 GB of RAM;
- turns on automatic security updates;
- schedules a nightly database backup to `/var/backups/tricity`.

## 3. Deploy

```sh
deploy/deploy.sh root@YOUR_SERVER_IP
```

The script:

1. Copies the code to `/opt/tricity`.
2. Creates `/opt/tricity/deploy/.env` with fresh random secrets (first deploy only).
3. Builds the images and starts everything. The first build takes 5–15 minutes.

When it finishes, check that the API is up:

```sh
curl http://YOUR_SERVER_IP/health    # {"ok":true,"version":"1.0.0"}
```

Then open `http://YOUR_SERVER_IP` and:

1. **Create your account** at `/sign-up`, straight away. New servers start invite-only (`SIGNUP_MODE=invite`): the very first account can always sign up, and after that only people who open an invitation link from **Settings → Workspace**. Every account gets its own workspace.
2. **Add AI keys:** in your workspace under **Settings → AI keys** (your own account, no limits), and/or server-wide in `deploy/.env` (section 6). Server-wide keys serve every workspace that has none of its own, up to `PLATFORM_MONTHLY_BUDGET_USD` per month ($5 by default) for each account, shared by all the workspaces it owns. A workspace that reaches it is asked to add its own keys.
3. **Connect a WordPress site:** see section 4.

> Until you add a domain (section 5) the dashboard is plain HTTP, so passwords cross the network unencrypted. Add a domain before you invite anyone. MCP sign-in from Claude.ai or ChatGPT also requires HTTPS; MCP keys work either way.

**Updating** is the same command; `deploy/.env` is never overwritten:

```sh
deploy/deploy.sh root@YOUR_SERVER_IP
```

## 4. Connect your WordPress sites

This works the same on GoDaddy Managed WordPress, cPanel WordPress or any other host. The VPS calls the site, never the other way round, so the site must be reachable from the internet. A WordPress install on your own computer can't be paired with the VPS.

1. In the dashboard, open **Sites → Connect a site → Download the TriCity Writer Connector plugin**.
2. In WordPress admin, go to **Plugins → Add New → Upload Plugin**, upload the zip and activate it.
3. Open **TriCity Writer** in the WordPress admin menu, name the connection, and click **Generate pairing code**. Use an account that can publish.
4. Back in the dashboard, paste the site address and the code (it expires after 10 minutes).

**If pairing fails with "No WordPress site answered":**

- Make sure the address matches the site exactly, including `www` and `https`.
- In WordPress, re-save **Settings → Permalinks**.
- If the site uses a firewall or security plugin (Wordfence, Sucuri, GoDaddy's WAF), allow requests from your VPS IP address to `/wp-json/*` and `/?rest_route=*`. Our requests identify themselves as `TriCityWriter/<version> (+https://your-dashboard-address)`.

**"…points to a private or reserved network address":** the address resolves to a private IP (192.168.x.x, 10.x.x.x, localhost…). The server refuses those so nobody can point it at its own internal services. Use the site's public address.

**Plugin updates:** connected sites learn about new connector versions from your dashboard. After you deploy a new version, it appears under **Dashboard → Updates** in each site's WP admin (WordPress checks twice a day; **Check again** forces it). The dashboard's site pages also say when a site runs an older connector.

## 5. Add a domain (HTTPS)

1. Buy or use a domain, for example `example.com`.
2. In GoDaddy, open **My Products → the domain → DNS → Add record**:
   - Type **A**
   - Name `app`
   - Value `YOUR_SERVER_IP`
   - TTL 1 hour
3. Wait until `ping app.example.com` answers with your server's IP. This usually takes minutes, but can take up to an hour.
4. On the server, edit `/opt/tricity/deploy/.env`:
   ```
   SITE_ADDRESS=app.example.com
   WEB_ORIGIN=https://app.example.com
   ```
5. Apply the change:
   ```sh
   ssh root@YOUR_SERVER_IP 'cd /opt/tricity && docker compose -f deploy/docker-compose.yml up -d'
   ```

Caddy then gets a free Let's Encrypt certificate and renews it automatically. Open `https://app.example.com`.

Accounts and sites carry over, but sessions are tied to the address, so sign in again.

**For a first deploy straight onto a domain** (DNS already pointing at the server), run:

```sh
deploy/deploy.sh root@YOUR_SERVER_IP app.example.com
```

**MCP sign-in turns on automatically with HTTPS.** In Claude.ai or ChatGPT, add a custom connector with the URL `https://app.example.com/mcp` and sign in. Other clients (Claude Code, Cursor) can use an MCP key from **Settings → AI assistants**.

## 6. Configuration (`/opt/tricity/deploy/.env`)

| Variable | What it does |
|---|---|
| `SITE_ADDRESS`, `WEB_ORIGIN` | Public address (section 5). |
| `SIGNUP_MODE` | `invite` (new servers): only the first account and invited people can sign up. `open`: anyone who finds the site can. |
| `ANTHROPIC_API_KEY`, `OPENAI_API_KEY` | Server-wide AI keys, used by workspaces without their own. OpenAI also powers images. |
| `ALLOW_PLATFORM_KEYS` | `false` makes every workspace bring its own keys. |
| `PLATFORM_MONTHLY_BUDGET_USD` | What each account may spend per month (UTC) through the server-wide keys, in USD, shared by all the workspaces it owns (so a new workspace isn't a new budget). Empty = no cap. Workspaces using their own keys are never capped. Settings → Usage shows the meter. |
| `MAX_ACTIVE_GENERATIONS` | Articles one workspace may have queued or being written at once (default 20), so one workspace can't hold up everyone else's. |
| `AI_FAKE` | `true` returns placeholder articles with no AI cost. Useful for a dry run. |
| `EMAIL_PROVIDER` | `none` (default): password-reset links and invitations go to the API log, and invitations can also be copied from **Settings → Workspace**. `resend`: sends real email (needs `RESEND_API_KEY` and a verified `EMAIL_FROM` domain). |
| `REQUIRE_EMAIL_VERIFICATION` | `true` (default): with `EMAIL_PROVIDER=resend`, new accounts confirm their email before signing in, and invitations can only be accepted by confirmed addresses. Has no effect without an email provider. When you turn email on later, existing accounts confirm their address at their next sign-in: the link is sent automatically. |
| `POSTGRES_PASSWORD`, `BETTER_AUTH_SECRET`, `ENCRYPTION_KEY` | Generated once. **Never change them on a live server.** The auth secret protects the OAuth signing keys, and the encryption key protects stored site tokens and AI keys. |

After editing, run `docker compose -f deploy/docker-compose.yml up -d` in `/opt/tricity`.

A `deploy/.env` created before version 1.0.0 lacks `SIGNUP_MODE`, `PLATFORM_MONTHLY_BUDGET_USD`, `MAX_ACTIVE_GENERATIONS` and `REQUIRE_EMAIL_VERIFICATION`; without them sign-ups are open and server-wide keys are uncapped. Copy those lines from `deploy/init-env.sh`.

## Before you open it to the public

- **HTTPS:** a domain (section 5). Without it, passwords cross the network unencrypted.
- **Email:** `EMAIL_PROVIDER=resend`, so invitations, password resets and email confirmation reach people.
- **Budget:** decide what each account may spend on your keys (`PLATFORM_MONTHLY_BUDGET_USD`), or set `ALLOW_PLATFORM_KEYS=false` so everyone brings their own. There is no billing yet.
- **Sign-ups:** switch `SIGNUP_MODE=open` only once the above are in place.
- **Your terms and privacy policy:** you operate the service, so publish your own and link them from your site.
- **Off-server backups** (section 7).

## 7. Day-to-day operations

All commands below run on the server, in `/opt/tricity`.

| Task | Command |
|---|---|
| Status | `docker compose -f deploy/docker-compose.yml ps` |
| Health (for an uptime monitor) | `curl -fsS https://app.example.com/health`: 200 while the API can reach its database, 503 otherwise |
| Logs | `docker compose -f deploy/docker-compose.yml logs -f api worker` (each container keeps at most 50 MB of logs) |
| A password-reset link (no email provider) | `docker compose -f deploy/docker-compose.yml logs api \| grep "Reset your"` |
| Back up now | `deploy/backup.sh` |
| Restore a backup | `gunzip -c /var/backups/tricity/FILE.sql.gz \| docker compose -f deploy/docker-compose.yml exec -T postgres psql -U tricity tricity` |
| Restart everything | `docker compose -f deploy/docker-compose.yml restart` |

**Off-server copies:** GoDaddy's VPS snapshots and your own copies of `/var/backups/tricity` (for example with `rsync` to your computer) protect against losing the whole server.

## 8. Troubleshooting

- **The build is killed or very slow:** the server ran out of memory. Make sure swap is on (`swapon --show`) or use a bigger plan.
- **No HTTPS certificate:** the domain's A record must point at the server, and ports 80 and 443 must be open. `docker compose -f deploy/docker-compose.yml logs caddy` shows the Let's Encrypt error.
- **The dashboard loads but sign-in fails:** `WEB_ORIGIN` must exactly match the address in the browser, including `http`/`https` and without a trailing slash.
- **Articles stay "Queued":** the worker isn't running. Check `docker compose -f deploy/docker-compose.yml logs worker`.
- **An article was stuck "Writing…" or "Publishing…" and then failed:** the worker restarted mid-job (a deploy or a crash). The worker marks such articles failed after 45 minutes (6 hours for ones still queued) so they can be generated or published again.
- **"This workspace's included AI usage for the month is used up":** the workspace's owner reached `PLATFORM_MONTHLY_BUDGET_USD`. It can add its own keys, or you can raise the budget. Scheduled auto-blogging pauses without using up queued topics.
- **Sign-ups say "by invitation only":** `SIGNUP_MODE=invite`. Invite people from **Settings → Workspace**, or set `SIGNUP_MODE=open`.
