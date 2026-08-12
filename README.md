# OpenCode on Cloudflare Containers

Run OpenCode as a persistent web server on Cloudflare Containers, powered by **OpenCode Zen**.

## Features

- Always-on OpenCode web server accessible from anywhere
- Web UI for browser-based coding assistant
- **Admin Dashboard** - manage container lifecycle, view status, configuration
- **FreeLLMAPI dashboard + unified API proxy** - a combined gateway for many providers served at `/freellmapi/*`
- **OpenCode Zen** - curated, optimized models for coding
- **Universal credentials** - one email/password for the admin panel, the OpenCode web UI, and the FreeLLMAPI dashboard
- HTTP Basic Auth for security
- Persistent storage via R2 + FUSE mount (config, data, repos, and the FreeLLMAPI DB survive sleep/restarts)
- Full REST API + SSE events support

## Prerequisites

- [Node.js](https://nodejs.org/) 18+
- [Docker](https://www.docker.com/) (for local builds)
- [Cloudflare account](https://dash.cloudflare.com/) with Workers Paid plan
- [Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/)
- [OpenCode Zen API key](https://opencode.ai/auth) - sign up and get your key

## Setup

### 1. Install dependencies

```bash
npm install
```

### 2. Credentials reference

The table below lists every credential this project uses. Set the required ones as **Workers secrets** (step 3). Never commit them to the repo.

| Credential | Required | What it is | How to get it |
|---|---|---|---|
| `OPENCODE_API_KEY` | **Yes** | OpenCode Zen API key — billed for LLM usage | 1. Go to [opencode.ai/auth](https://opencode.ai/auth) <br> 2. Sign in and add billing details <br> 3. Create a key and copy it (starts with `sk-`) |
| `OPENCODE_SERVER_PASSWORD` | **Yes** | Password for the OpenCode web UI | Generate a strong one, e.g. `openssl rand -base64 24` |
| `ADMIN_EMAIL` | No | Universal login email/username — used for the admin panel and the FreeLLMAPI dashboard account (auto-created on boot) | A valid email address |
| `ADMIN_PASSWORD` | No | Universal login password for admin + FreeLLMAPI dashboard. Defaults to `OPENCODE_SERVER_PASSWORD` if unset. FreeLLMAPI requires **≥ 8 characters** | Generate a strong one, e.g. `openssl rand -base64 24` |
| `FREELLMAPI_ENCRYPTION_KEY` | Recommended | 64-char hex key that encrypts FreeLLMAPI provider keys at rest. Must be stable across restarts or saved keys become undecryptable. If unset, startup.sh generates one and persists it to R2 | `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |
| `GIT_TOKEN` | Only for private git operations | GitHub Personal Access Token, passed to the container via `git config` insteadOf rules | 1. Go to [github.com/settings/tokens](https://github.com/settings/tokens) <br> 2. "Generate new token" → "Fine-grained" <br> 3. Grant **Contents: Read** on the repos you use <br> 4. Copy the token (starts with `github_pat_` or `ghp_`) |
| `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` | For persistent storage | R2 API token with **Object Read & Write** on your bucket | Cloudflare dashboard → R2 → Manage API Tokens |

> **Note:** Cloudflare secrets are stored encrypted and only exposed inside the container at runtime — the worker itself never returns their values (`/admin/api/config` only reports whether each is set).

### 3. Configure secrets

Set the required secrets using Wrangler (each command prompts for input):

```bash
# Required: OpenCode Zen API key
wrangler secret put OPENCODE_API_KEY

# Required: Server password (used for OpenCode web UI + admin)
wrangler secret put OPENCODE_SERVER_PASSWORD

# Universal login for admin panel + FreeLLMAPI dashboard (>= 8 chars)
wrangler secret put ADMIN_EMAIL
wrangler secret put ADMIN_PASSWORD

# Strong, stable key for FreeLLMAPI at-rest encryption (reuse the same value forever)
wrangler secret put FREELLMAPI_ENCRYPTION_KEY

# Optional: GitHub token for private git operations
wrangler secret put GIT_TOKEN

# Optional: R2 API credentials (needed for persistent storage)
wrangler secret put R2_ACCESS_KEY_ID
wrangler secret put R2_SECRET_ACCESS_KEY
```

Verify all secrets were stored:

```bash
wrangler secret list
```

### 4. Configure R2 persistent storage (recommended)

The container's disk is ephemeral and is wiped on sleep/restart. To keep your data
(OpenCode config, sessions, and repos), mount an R2 bucket inside the container via
[tigrisfs](https://github.com/tigrisdata/tigrisfs):

1. In the Cloudflare dashboard, go to **R2** and enable it on your account.
2. Create a bucket (e.g. `opencode-persistent`) and set it in `wrangler.toml`:
   ```toml
   [vars]
   R2_BUCKET_NAME = "opencode-persistent"
   ```
3. Create an API token with **Object Read & Write** access to that bucket and set the secrets:
   ```bash
   wrangler secret put R2_ACCOUNT_ID        # your Cloudflare account ID
   wrangler secret put R2_ACCESS_KEY_ID
   wrangler secret put R2_SECRET_ACCESS_KEY
   ```

On boot the container mounts the bucket at `/mnt/r2` and symlinks:
- `~/.config/opencode` → `/mnt/r2/opencode-config`
- `~/.local/share/opencode` → `/mnt/r2/opencode-data`

Repos are stored under `/mnt/r2/repos` and are picked up by OpenCode as projects — add
or update them with a normal `git clone` / `git push` against that path, and they persist.

If R2 is not configured, the container falls back to ephemeral storage.

### 5. Deploy

```bash
npm run deploy
```

Your OpenCode server will be available at:
```
https://opencode-server.<your-subdomain>.workers.dev
```

## Usage

### Access OpenCode Web UI

1. Open `https://opencode-server.<your-subdomain>.workers.dev` in your browser
2. Enter credentials when prompted:
   - Username: `ADMIN_EMAIL` (defaults to `opencode` if unset)
   - Password: Your `OPENCODE_SERVER_PASSWORD`

### Access Admin Dashboard

The Admin Dashboard lets you monitor and control your container:
1. Open `https://opencode-server.<your-subdomain>.workers.dev/admin` in your browser
2. Enter admin credentials (same universal login as everything else):
   - Username: `ADMIN_EMAIL` (defaults to `opencode` if unset)
   - Password: `ADMIN_PASSWORD` (defaults to `OPENCODE_SERVER_PASSWORD` if not set)

**Admin Features:**
- View container status (running, stopped, uptime)
- Start/Stop/Restart container controls
- View configuration and secrets status
- Quick links to OpenCode Web UI, health check, and API docs

### Access FreeLLMAPI Dashboard

[FreeLLMAPI](https://github.com/kingiu/freellmapi) is served inside the container and
proxied at `/freellmapi/*`. It gives you one dashboard + one API key to access many
LLM providers (OpenRouter, Groq, and others), with automatic key rotation and an
OpenAI-compatible `/v1/chat/completions` endpoint.

1. Open `https://opencode-server.<your-subdomain>.workers.dev/freellmapi/` in your browser
2. Log in with your **universal credentials**:
   - Email/Username: `ADMIN_EMAIL`
   - Password: `ADMIN_PASSWORD`
3. On first boot the dashboard account is auto-created from `ADMIN_EMAIL` / `ADMIN_PASSWORD` — no setup code needed.
4. Add your provider API keys in the dashboard and grab your unified API key from the
   **API Keys** page to use with any OpenAI-compatible client.

**Wired into OpenCode automatically:** OpenCode can also use FreeLLMAPI as a model
provider directly (great for testing/prompts through the free auto-routed models).
On every boot, `ensure-opencode-config.js` injects the `freellmapi` provider into
`opencode.json` with the current unified API key, and on first boot sets the default
model to `freellmapi/auto`. If you change the model in the admin panel afterwards, your
choice is preserved. The base URL is `http://127.0.0.1:3001/v1` since both apps share
the container.

> **Note:** FreeLLMAPI requires a valid email and a password **≥ 8 characters** — your
> `ADMIN_PASSWORD` must meet that or dashboard login will fail. Also, changing
> `ADMIN_EMAIL`/`ADMIN_PASSWORD` only takes effect on the next container restart.

### API Access

```bash
# Worker health check (no auth)
curl https://opencode-server.<your-subdomain>.workers.dev/worker-health

# Container health (requires OpenCode auth)
curl -u ADMIN_EMAIL:YOUR_PASSWORD \
  https://opencode-server.<your-subdomain>.workers.dev/global/health

# Admin API - Get status (requires admin auth, username ADMIN_EMAIL)
curl -u ADMIN_EMAIL:YOUR_PASSWORD \
  https://opencode-server.<your-subdomain>.workers.dev/admin/api/status

# Restart the container
curl -X POST -u ADMIN_EMAIL:YOUR_PASSWORD \
  https://opencode-server.<your-subdomain>.workers.dev/admin/api/restart
```

### Admin API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/admin` | GET | Admin dashboard UI |
| `/admin/api/status` | GET | Get container status |
| `/admin/api/start` | POST | Start the container |
| `/admin/api/stop` | POST | Stop the container |
| `/admin/api/restart` | POST | Restart the container |
| `/admin/api/config` | GET | Get configuration (secrets masked) |
| `/admin/api/sleep` | GET | Get current auto-sleep idle timeout |
| `/admin/api/sleep` | POST | Set auto-sleep idle timeout (`{"sleepAfter":"15m"}`) |
| `/admin/api/keepwarm` | GET | Get keep-warm status (`{"enabled":true\|false}`) |
| `/admin/api/keepwarm` | POST | Enable/disable keep-warm (`{"enabled":true}`) |

## Sleep & Power Management

The container auto-sleeps after an idle timeout to stop billing. Both settings are
editable live from the **Sleep & Power Management** card on the admin dashboard and
persist across restarts (stored in the Durable Object).

- **Auto-Sleep Timer** (`sleepAfter`): idle time before the container sleeps. Accepts
  seconds or `m`/`h`/`d` suffixes, e.g. `15m`, `2h`, `1d`. Presets: `10m`, `30m`, `1h`, `6h`, `24h`.
  Default `24h`.
- **Keep Warm**: when ON, a cron pings the container every 10 minutes so it never sleeps.
  When OFF (default), the container sleeps after the idle timeout — this is the cost-saving mode.

> **What counts as "activity"?** Only network requests reaching the container reset the
> idle timer (an active agent streaming a response counts; a merely-open browser tab does
> not). Keep-warm pings also count, so don't enable keep-warm if you want the container
> to sleep.

> **Storage:** data lives in R2 via the FUSE mount. After sleeping, the container
> restarts with a fresh ephemeral disk, but `~/.config/opencode`,
> `~/.local/share/opencode`, repos under `/mnt/r2/repos`, and the FreeLLMAPI DB
> (`/mnt/r2/.freellmapi/freeapi.db`) all persist. FreeLLMAPI writes are periodically
> checkpointed to the main DB file (every 30s + on graceful shutdown) so recent
> dashboard changes survive restarts.

## Configuration

### Instance Types

The default instance type is `standard-2` (1 vCPU, 6GB RAM). Available options:

| Type | vCPU | Memory | Disk |
|------|------|--------|------|
| `lite` | 1/16 | 256 MiB | 2 GB |
| `basic` | 1/4 | 1 GiB | 4 GB |
| `standard-1` | 1/2 | 4 GiB | 8 GB |
| `standard-2` | 1 | 6 GiB | 12 GB |
| `standard-3` | 2 | 8 GiB | 16 GB |
| `standard-4` | 4 | 12 GiB | 20 GB |

### Custom Domain

Add to `wrangler.toml`:

```toml
routes = [
  { pattern = "opencode.yourdomain.com", custom_domain = true }
]
```

### Keep Container Warm

The cron trigger is already configured in `wrangler.toml`:

```toml
[triggers]
crons = ["*/10 * * * *"]
```

It only pings the container when **Keep Warm** is enabled in the admin dashboard —
with it off (default), the scheduled handler skips the ping so the container can sleep.

## Cost Estimate

- Workers Paid plan: ~$5/month base
- Container runtime (`standard-2`, 24/7): ~$14/month
- OpenCode Zen: Pay-as-you-go per 1M tokens (some free models available)
- **Infrastructure Total: ~$20/month** + Zen usage

## Available Models (via Zen)

The default model is `opencode/claude-sonnet-4`. You can edit the full `opencode.json`
live from the admin dashboard: **OpenCode Configuration** card → edit the JSON → **Save**
(or **Save & Restart** to apply immediately). It is persisted to R2
(`opencode-config/opencode.json`) and survives restarts.

```json
{
  "model": "opencode/claude-sonnet-4-5"
}
```

**Popular Models:**
| Model | ID |
|-------|-----|
| Claude Sonnet 4 | `opencode/claude-sonnet-4` |
| Claude Sonnet 4.5 | `opencode/claude-sonnet-4-5` |
| GPT 5.1 Codex | `opencode/gpt-5.1-codex` |
| Gemini 3 Pro | `opencode/gemini-3-pro` |

**Free Models:**
| Model | ID |
|-------|-----|
| GPT 5 Nano | `opencode/gpt-5-nano` |
| Grok Code Fast 1 | `opencode/grok-code` |

## Troubleshooting

### Container not starting

Check the logs:
```bash
wrangler tail
```

### Authentication issues

Ensure secrets are set:
```bash
wrangler secret list
```

Should show:
- `OPENCODE_SERVER_PASSWORD`
- `OPENCODE_API_KEY`
- `ADMIN_EMAIL` (optional)
- `ADMIN_PASSWORD` (optional)
- `FREELLMAPI_ENCRYPTION_KEY` (optional)

### Model not working

Verify your Zen API key is valid at [opencode.ai/auth](https://opencode.ai/auth) and has sufficient balance.

### Git operations failing

Repos live on the R2 mount under `/mnt/r2/repos`. For private repos, ensure `GIT_TOKEN`
is set with appropriate permissions. To add a repo, `git clone` it into `/mnt/r2/repos`
from inside the container or push to the mount path from your local machine.

## License

MIT
