# OpenCode on Cloudflare Containers

Run OpenCode as a persistent web server on Cloudflare Containers, powered by **OpenCode Zen**.

## Features

- Always-on OpenCode web server accessible from anywhere
- Web UI for browser-based coding assistant
- **Admin Dashboard** - manage container lifecycle, view status, configuration
- **OpenCode Zen** - curated, optimized models for coding
- HTTP Basic Auth for security
- Git repos auto-cloned on container startup
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

### 2. Get your OpenCode Zen API key

1. Go to [opencode.ai/auth](https://opencode.ai/auth)
2. Sign in and add billing details
3. Create and copy your API key

### 3. Configure secrets

Set the required secrets using Wrangler:

```bash
# Required: Server password for HTTP Basic Auth
wrangler secret put OPENCODE_SERVER_PASSWORD

# Required: OpenCode Zen API key
wrangler secret put OPENCODE_API_KEY

# Optional: GitHub token for private repos
wrangler secret put GIT_TOKEN

# Optional: Separate admin password (defaults to OPENCODE_SERVER_PASSWORD)
wrangler secret put ADMIN_PASSWORD
```

### 4. Configure git repos (optional)

Edit `wrangler.toml` and set the `GIT_REPOS` variable with comma-separated repo URLs:

```toml
[vars]
GIT_REPOS = "https://github.com/your-org/repo1,https://github.com/your-org/repo2"
```

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
   - Username: `opencode`
   - Password: Your `OPENCODE_SERVER_PASSWORD`

### Access Admin Dashboard

The Admin Dashboard lets you monitor and control your container:

1. Open `https://opencode-server.<your-subdomain>.workers.dev/admin` in your browser
2. Enter admin credentials:
   - Username: `admin`
   - Password: Your `ADMIN_PASSWORD` (or `OPENCODE_SERVER_PASSWORD` if not set)

**Admin Features:**
- View container status (running, stopped, uptime)
- Start/Stop/Restart container controls
- View configuration and secrets status
- Quick links to OpenCode Web UI, health check, and API docs

### API Access

```bash
# Worker health check (no auth)
curl https://opencode-server.<your-subdomain>.workers.dev/worker-health

# Container health (requires OpenCode auth)
curl -u opencode:YOUR_PASSWORD \
  https://opencode-server.<your-subdomain>.workers.dev/global/health

# Admin API - Get status (requires admin auth)
curl -u admin:YOUR_ADMIN_PASSWORD \
  https://opencode-server.<your-subdomain>.workers.dev/admin/api/status

# Admin API - Restart container
curl -X POST -u admin:YOUR_ADMIN_PASSWORD \
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

Add a cron trigger to prevent idle timeout:

```toml
[triggers]
crons = ["*/10 * * * *"]
```

## Cost Estimate

- Workers Paid plan: ~$5/month base
- Container runtime (`standard-2`, 24/7): ~$14/month
- OpenCode Zen: Pay-as-you-go per 1M tokens (some free models available)
- **Infrastructure Total: ~$20/month** + Zen usage

## Available Models (via Zen)

The default model is `opencode/claude-sonnet-4`. To change it, edit `opencode.json`:

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
- `ADMIN_PASSWORD` (optional)

### Model not working

Verify your Zen API key is valid at [opencode.ai/auth](https://opencode.ai/auth) and has sufficient balance.

### Git clone failing

For private repos, ensure `GIT_TOKEN` is set with appropriate permissions.

## License

MIT
