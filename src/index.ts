import { Container, getContainer, switchPort } from "@cloudflare/containers";
import { env } from "cloudflare:workers";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { basicAuth } from "hono/basic-auth";
import { getAdminHTML } from "./admin-ui";

interface Env {
  OPENCODE_CONTAINER: DurableObjectNamespace<OpenCodeContainer>;
  OPENCODE_SERVER_PASSWORD: string;
  OPENCODE_API_KEY: string;
  GIT_TOKEN?: string;
  ADMIN_PASSWORD?: string;
  ADMIN_EMAIL?: string;
  FREELLMAPI_ENCRYPTION_KEY?: string;
  OPENCODE_CONFIG_R2?: R2Bucket;
  R2_ACCOUNT_ID?: string;
  R2_BUCKET_NAME?: string;
  R2_ACCESS_KEY_ID?: string;
  R2_SECRET_ACCESS_KEY?: string;
  CF_API_TOKEN?: string;
  CONTAINER_APP_ID?: string;
}

const SLEEP_AFTER_KEY = "sleepAfter";
const KEEP_WARM_KEY = "keepWarm";
const DEFAULT_SLEEP_AFTER = "24h";

const JSON_HEADERS = { "Content-Type": "application/json" };

function isValidSleepAfter(value: string): boolean {
  return /^\d+(ms|s|m|h|d)?$/.test(value.trim());
}

// Container class with admin endpoints
export class OpenCodeContainer extends Container<Env> {
  defaultPort = 4096;
  sleepAfter = "24h"; // Keep running (essentially always-on)
  enableInternet = true; // Required for LLM API calls

  // Declared as a class field (not set at runtime) so Cloudflare persists
  // these env vars in the container application config and applies them on
  // EVERY instance launch - including restarts triggered by rollouts (e.g.
  // instance-type changes). Runtime `this.envVars` assignments are lost when
  // Cloudflare restarts the container itself.
  envVars: Record<string, string> = {
    // OpenCode server config
    OPENCODE_SERVER_PASSWORD: (env as Env).OPENCODE_SERVER_PASSWORD || "",
    OPENCODE_PERMISSION: '{"edit":"allow","bash":"allow","write":"allow"}',
    OPENCODE_DISABLE_AUTOUPDATE: "true",

    // OpenCode Zen API key
    OPENCODE_API_KEY: (env as Env).OPENCODE_API_KEY || "",

    // Git token for private repo operations
    GIT_TOKEN: (env as Env).GIT_TOKEN || "",

    // Universal dashboard/admin credentials - the SAME login for the OpenCode
    // web UI, the admin panel, and the FreeLLMAPI dashboard. Rotate them from
    // Cloudflare -> Workers -> Settings -> Variables (secrets). startup.sh
    // auto-provisions the FreeLLMAPI account from these on every boot.
    ADMIN_EMAIL: (env as Env).ADMIN_EMAIL || "",
    ADMIN_PASSWORD: (env as Env).ADMIN_PASSWORD || "",

    // Encryption key for FreeLLMAPI at-rest key storage. Persist it once via
    // wrangler secret put; startup.sh reuses it so saved keys stay
    // decryptable across container restarts.
    FREELLMAPI_ENCRYPTION_KEY: (env as Env).FREELLMAPI_ENCRYPTION_KEY || "",

    // R2 persistent storage (FUSE mount)
    R2_ACCOUNT_ID: (env as Env).R2_ACCOUNT_ID || "",
    R2_BUCKET_NAME: (env as Env).R2_BUCKET_NAME || "",
    R2_ACCESS_KEY_ID: (env as Env).R2_ACCESS_KEY_ID || "",
    R2_SECRET_ACCESS_KEY: (env as Env).R2_SECRET_ACCESS_KEY || "",
  };

  private startTime: number | null = null;

  private async loadSleepAfter(): Promise<void> {
    try {
      const stored = await this.ctx.storage.get<string>(SLEEP_AFTER_KEY);
      if (stored && isValidSleepAfter(stored) && stored !== this.sleepAfter) {
        this.sleepAfter = stored;
      }
    } catch {
      // storage unavailable, keep current value
    }
  }

  private async getKeepWarm(): Promise<boolean> {
    try {
      return (await this.ctx.storage.get<boolean>(KEEP_WARM_KEY)) ?? false;
    } catch {
      return false;
    }
  }

  override async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    // Handle internal admin API requests
    if (url.pathname.startsWith("/__admin/")) {
      return this.handleAdminRequest(request, url);
    }

    await this.loadSleepAfter();

    // Set environment variables dynamically before handling request
    this.envVars = {
      // OpenCode server config
      OPENCODE_SERVER_PASSWORD: this.env.OPENCODE_SERVER_PASSWORD || "",
      OPENCODE_PERMISSION: '{"edit":"allow","bash":"allow","write":"allow"}',
      OPENCODE_DISABLE_AUTOUPDATE: "true",

      // OpenCode Zen API key
      OPENCODE_API_KEY: this.env.OPENCODE_API_KEY || "",

      // Git token for private repo operations
      GIT_TOKEN: this.env.GIT_TOKEN || "",

      // Universal dashboard/admin credentials - the SAME login for the OpenCode
      // web UI, the admin panel, and the FreeLLMAPI dashboard. Rotate them from
      // Cloudflare -> Workers -> Settings -> Variables (secrets). startup.sh
      // auto-provisions the FreeLLMAPI account from these on every boot.
      ADMIN_EMAIL: this.env.ADMIN_EMAIL || "",
      ADMIN_PASSWORD: this.env.ADMIN_PASSWORD || "",

      // Encryption key for FreeLLMAPI at-rest key storage. Persist it once via
      // wrangler secret put; startup.sh reuses it so saved keys stay
      // decryptable across container restarts.
      FREELLMAPI_ENCRYPTION_KEY: this.env.FREELLMAPI_ENCRYPTION_KEY || "",

      // R2 persistent storage (FUSE mount)
      R2_ACCOUNT_ID: this.env.R2_ACCOUNT_ID || "",
      R2_BUCKET_NAME: this.env.R2_BUCKET_NAME || "",
      R2_ACCESS_KEY_ID: this.env.R2_ACCESS_KEY_ID || "",
      R2_SECRET_ACCESS_KEY: this.env.R2_SECRET_ACCESS_KEY || "",
    };

    // Call the parent fetch which handles container lifecycle
    return super.fetch(request);
  }

  private async handleAdminRequest(request: Request, url: URL): Promise<Response> {
    const path = url.pathname.replace("/__admin", "");

    try {
      switch (path) {
        case "/status":
          return this.getStatus();
        case "/start":
          if (request.method !== "POST") {
            return new Response("Method not allowed", { status: 405 });
          }
          return this.doStart();
        case "/stop":
          if (request.method !== "POST") {
            return new Response("Method not allowed", { status: 405 });
          }
          return this.doStop();
        case "/restart":
          if (request.method !== "POST") {
            return new Response("Method not allowed", { status: 405 });
          }
          return this.doRestart();
        case "/config":
          return this.getConfig();
        case "/sleep":
          if (request.method === "GET") return this.getSleepSettings();
          if (request.method === "POST") return this.setSleepSettings(request);
          return new Response("Method not allowed", { status: 405 });
        case "/keepwarm":
          if (request.method === "GET") return this.getKeepWarmSettings();
          if (request.method === "POST") return this.setKeepWarmSettings(request);
          return new Response("Method not allowed", { status: 405 });
        default:
          return new Response("Not found", { status: 404 });
      }
    } catch (error) {
      return new Response(
        JSON.stringify({
          error: error instanceof Error ? error.message : String(error),
        }),
        {
          status: 500,
          headers: { "Content-Type": "application/json" },
        }
      );
    }
  }

  private async getStatus(): Promise<Response> {
    const state = await this.getState();
    const running = this.ctx.container?.running ?? false;

    return new Response(
      JSON.stringify({
        status: state.status,
        running,
        lastChange: state.lastChange,
        lastChangeFormatted: new Date(state.lastChange).toISOString(),
        exitCode: "exitCode" in state ? state.exitCode : null,
        uptime: this.startTime ? Date.now() - this.startTime : null,
        sleepAfter: this.sleepAfter,
        defaultPort: this.defaultPort,
        enableInternet: this.enableInternet,
      }),
      {
        headers: { "Content-Type": "application/json" },
      }
    );
  }

  private async doStart(): Promise<Response> {
    // Set env vars before starting
    this.envVars = {
      OPENCODE_SERVER_PASSWORD: this.env.OPENCODE_SERVER_PASSWORD || "",
      OPENCODE_PERMISSION: '{"edit":"allow","bash":"allow","write":"allow"}',
      OPENCODE_DISABLE_AUTOUPDATE: "true",
      OPENCODE_API_KEY: this.env.OPENCODE_API_KEY || "",
      GIT_TOKEN: this.env.GIT_TOKEN || "",

      // Universal dashboard/admin credentials - the SAME login for the OpenCode
      // web UI, the admin panel, and the FreeLLMAPI dashboard. Rotate them from
      // Cloudflare -> Workers -> Settings -> Variables (secrets). startup.sh
      // auto-provisions the FreeLLMAPI account from these on every boot.
      ADMIN_EMAIL: this.env.ADMIN_EMAIL || "",
      ADMIN_PASSWORD: this.env.ADMIN_PASSWORD || "",

      // Encryption key for FreeLLMAPI at-rest key storage. Persist it once via
      // wrangler secret put; startup.sh reuses it so saved keys stay
      // decryptable across container restarts.
      FREELLMAPI_ENCRYPTION_KEY: this.env.FREELLMAPI_ENCRYPTION_KEY || "",

      // R2 persistent storage (FUSE mount)
      R2_ACCOUNT_ID: this.env.R2_ACCOUNT_ID || "",
      R2_BUCKET_NAME: this.env.R2_BUCKET_NAME || "",
      R2_ACCESS_KEY_ID: this.env.R2_ACCESS_KEY_ID || "",
      R2_SECRET_ACCESS_KEY: this.env.R2_SECRET_ACCESS_KEY || "",
    };

    await this.startAndWaitForPorts({
      ports: [this.defaultPort],
    });

    return new Response(
      JSON.stringify({
        success: true,
        message: "Container started successfully",
      }),
      {
        headers: { "Content-Type": "application/json" },
      }
    );
  }

  private async doStop(): Promise<Response> {
    await this.stop();

    return new Response(
      JSON.stringify({
        success: true,
        message: "Container stop signal sent",
      }),
      {
        headers: { "Content-Type": "application/json" },
      }
    );
  }

  private async doRestart(): Promise<Response> {
    // Stop the container
    try {
      await this.stop();
    } catch (e) {
      // Container might not be running, continue with start
    }

    // Wait for cleanup
    await new Promise((resolve) => setTimeout(resolve, 3000));

    // Set env vars and start
    this.envVars = {
      OPENCODE_SERVER_PASSWORD: this.env.OPENCODE_SERVER_PASSWORD || "",
      OPENCODE_PERMISSION: '{"edit":"allow","bash":"allow","write":"allow"}',
      OPENCODE_DISABLE_AUTOUPDATE: "true",
      OPENCODE_API_KEY: this.env.OPENCODE_API_KEY || "",
      GIT_TOKEN: this.env.GIT_TOKEN || "",

      // Universal dashboard/admin credentials - the SAME login for the OpenCode
      // web UI, the admin panel, and the FreeLLMAPI dashboard. Rotate them from
      // Cloudflare -> Workers -> Settings -> Variables (secrets). startup.sh
      // auto-provisions the FreeLLMAPI account from these on every boot.
      ADMIN_EMAIL: this.env.ADMIN_EMAIL || "",
      ADMIN_PASSWORD: this.env.ADMIN_PASSWORD || "",

      // Encryption key for FreeLLMAPI at-rest key storage. Persist it once via
      // wrangler secret put; startup.sh reuses it so saved keys stay
      // decryptable across container restarts.
      FREELLMAPI_ENCRYPTION_KEY: this.env.FREELLMAPI_ENCRYPTION_KEY || "",

      // R2 persistent storage (FUSE mount)
      R2_ACCOUNT_ID: this.env.R2_ACCOUNT_ID || "",
      R2_BUCKET_NAME: this.env.R2_BUCKET_NAME || "",
      R2_ACCESS_KEY_ID: this.env.R2_ACCESS_KEY_ID || "",
      R2_SECRET_ACCESS_KEY: this.env.R2_SECRET_ACCESS_KEY || "",
    };

    await this.startAndWaitForPorts({
      ports: [this.defaultPort],
    });

    return new Response(
      JSON.stringify({
        success: true,
        message: "Container restarted successfully",
      }),
      {
        headers: { "Content-Type": "application/json" },
      }
    );
  }

  private async getConfig(): Promise<Response> {
    return new Response(
      JSON.stringify({
        envVars: {

          // Don't expose actual secrets, just whether they're set
          hasServerPassword: !!this.env.OPENCODE_SERVER_PASSWORD,
          hasApiKey: !!this.env.OPENCODE_API_KEY,
          hasGitToken: !!this.env.GIT_TOKEN,
          hasAdminPassword: !!this.env.ADMIN_PASSWORD,
          hasAdminEmail: !!this.env.ADMIN_EMAIL,
          hasFreellmapiEncryptionKey: !!this.env.FREELLMAPI_ENCRYPTION_KEY,
        },
        containerConfig: {
          defaultPort: this.defaultPort,
          sleepAfter: this.sleepAfter,
          enableInternet: this.enableInternet,
          model: "opencode/claude-sonnet-4",
        },
      }),
      {
        headers: { "Content-Type": "application/json" },
      }
    );
  }

  private async getSleepSettings(): Promise<Response> {
    return new Response(
      JSON.stringify({ sleepAfter: this.sleepAfter }),
      { headers: JSON_HEADERS }
    );
  }

  private async setSleepSettings(request: Request): Promise<Response> {
    let body: { sleepAfter?: string } = {};
    try {
      body = await request.json();
    } catch {
      return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
        status: 400,
        headers: JSON_HEADERS,
      });
    }

    const value = body.sleepAfter?.trim();
    if (!value || !isValidSleepAfter(value)) {
      return new Response(
        JSON.stringify({ error: "Invalid sleepAfter. Use e.g. 30s, 5m, 1h, 24h or seconds" }),
        { status: 400, headers: JSON_HEADERS }
      );
    }

    await this.ctx.storage.put(SLEEP_AFTER_KEY, value);
    this.sleepAfter = value;
    this.renewActivityTimeout();

    return new Response(
      JSON.stringify({ success: true, sleepAfter: value }),
      { headers: JSON_HEADERS }
    );
  }

  private async getKeepWarmSettings(): Promise<Response> {
    return new Response(
      JSON.stringify({ enabled: await this.getKeepWarm() }),
      { headers: JSON_HEADERS }
    );
  }

  private async setKeepWarmSettings(request: Request): Promise<Response> {
    let body: { enabled?: boolean } = {};
    try {
      body = await request.json();
    } catch {
      return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
        status: 400,
        headers: JSON_HEADERS,
      });
    }

    const enabled = !!body.enabled;
    await this.ctx.storage.put(KEEP_WARM_KEY, enabled);

    return new Response(
      JSON.stringify({ success: true, enabled }),
      { headers: JSON_HEADERS }
    );
  }

  override onStart() {
    this.startTime = Date.now();
    console.log("OpenCode container started");
  }

  override onStop() {
    this.startTime = null;
    console.log("OpenCode container stopped");
  }

  override onError(error: unknown) {
    console.error("OpenCode container error:", error);
    throw error;
  }
}

// Hono app for Worker routing
const app = new Hono<{ Bindings: Env }>();

const SHARED_CONTAINER_ID = "opencode-main";

// Worker-level health check (no auth)
app.get("/worker-health", (c) => {
  return c.json({
    status: "ok",
    service: "opencode-worker",
    timestamp: new Date().toISOString(),
  });
});

// CORS for admin API
app.use("/admin/*", cors());

// Basic auth for admin routes - use the SAME credentials as OpenCode so the
// browser caches one credential for the realm "Secure Area" instead of
// re-prompting on every navigation between admin and web UI.
app.use("/admin/*", async (c, next) => {
  const username = c.env.ADMIN_EMAIL || "opencode";
  const password = c.env.ADMIN_PASSWORD || c.env.OPENCODE_SERVER_PASSWORD;
  if (!password) {
    return c.text("Admin password not configured", 500);
  }

  const auth = basicAuth({
    username,
    password,
    realm: "Secure Area",
  });
  return auth(c, next);
});

// Serve admin UI
app.get("/admin", (c) => {
  return c.html(getAdminHTML());
});

// Admin API routes - proxy to container's internal admin endpoints
app.get("/admin/api/status", async (c) => {
  try {
    const container = getContainer(c.env.OPENCODE_CONTAINER, SHARED_CONTAINER_ID);
    return container.fetch(new Request("http://localhost/__admin/status"));
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : "Unknown error" }, 500);
  }
});

// Admin API - services health: probes each service inside the running
// container and reports up/degraded/down with HTTP status + latency.
const SERVICE_PROBES = [
  { id: "opencode-server", name: "OpenCode Server", port: 4096, path: "/config" },
  { id: "opencode-webui", name: "OpenCode Web UI", port: 4096, path: "/" },
  { id: "freellmapi-server", name: "FreeLLMAPI Server", port: 3001, path: "/api/auth/status" },
  { id: "freellmapi-webui", name: "FreeLLMAPI Web UI", port: 3001, path: "/" },
] as const;

app.get("/admin/api/services", async (c) => {
  const container = getContainer(c.env.OPENCODE_CONTAINER, SHARED_CONTAINER_ID);

  // Don't probe if the container isn't running (probing a stopped container
  // would trigger a start). Check state first.
  let running = false;
  try {
    const statusRes = await container.fetch(
      new Request("http://localhost/__admin/status")
    );
    const status = (await statusRes.json()) as { running?: boolean };
    running = status.running === true;
  } catch {
    running = false;
  }

  const withTimeout = <T>(p: Promise<T>, ms: number): Promise<T> =>
    Promise.race([
      p,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error(`timed out after ${ms}ms`)), ms)
      ),
    ]);

  const services = [];
  for (const svc of SERVICE_PROBES) {
    if (!running) {
      services.push({
        ...svc,
        status: "down",
        statusCode: null,
        responseTimeMs: null,
        note: "container not running",
      });
      continue;
    }

    const start = Date.now();
    let result: {
      status: string;
      statusCode: number | null;
      responseTimeMs: number;
      note: string | null;
    };
    try {
      // switchPort sets the cf-container-target-port header that the container
      // binding uses to pick the target port (the URL port alone is ignored).
      const request = new Request(`http://localhost${svc.path}`);
      // The OpenCode web server requires password auth; the universal admin
      // creds work for it, so the check reports "up" instead of a 401.
      const needsAuth = svc.port === 4096;
      if (needsAuth && (c.env.ADMIN_EMAIL || c.env.ADMIN_PASSWORD)) {
        const creds = btoa(
          `${c.env.ADMIN_EMAIL}:${c.env.ADMIN_PASSWORD}`
        );
        request.headers.set("Authorization", `Basic ${creds}`);
      }
      const res = await withTimeout(
        container.fetch(switchPort(request, svc.port)),
        5000
      );
      if (res.status >= 200 && res.status < 400) {
        result = { status: "up", statusCode: res.status, responseTimeMs: Date.now() - start, note: null };
      } else if (res.status >= 400 && res.status < 500) {
        result = { status: "degraded", statusCode: res.status, responseTimeMs: Date.now() - start, note: `HTTP ${res.status}` };
      } else {
        result = { status: "down", statusCode: res.status, responseTimeMs: Date.now() - start, note: `HTTP ${res.status}` };
      }
    } catch (error) {
      result = {
        status: "down",
        statusCode: null,
        responseTimeMs: Date.now() - start,
        note: error instanceof Error ? error.message : String(error),
      };
    }
    services.push({ ...svc, ...result });
  }

  return c.json({
    running,
    checkedAt: Date.now(),
    services,
  });
});

app.post("/admin/api/start", async (c) => {
  try {
    const container = getContainer(c.env.OPENCODE_CONTAINER, SHARED_CONTAINER_ID);
    return container.fetch(
      new Request("http://localhost/__admin/start", { method: "POST" })
    );
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : "Unknown error" }, 500);
  }
});

app.post("/admin/api/stop", async (c) => {
  try {
    const container = getContainer(c.env.OPENCODE_CONTAINER, SHARED_CONTAINER_ID);
    return container.fetch(
      new Request("http://localhost/__admin/stop", { method: "POST" })
    );
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : "Unknown error" }, 500);
  }
});

app.post("/admin/api/restart", async (c) => {
  try {
    const container = getContainer(c.env.OPENCODE_CONTAINER, SHARED_CONTAINER_ID);
    return container.fetch(
      new Request("http://localhost/__admin/restart", { method: "POST" })
    );
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : "Unknown error" }, 500);
  }
});

app.get("/admin/api/config", async (c) => {
  try {
    const container = getContainer(c.env.OPENCODE_CONTAINER, SHARED_CONTAINER_ID);
    return container.fetch(new Request("http://localhost/__admin/config"));
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : "Unknown error" }, 500);
  }
});

app.get("/admin/api/sleep", async (c) => {
  try {
    const container = getContainer(c.env.OPENCODE_CONTAINER, SHARED_CONTAINER_ID);
    return container.fetch(new Request("http://localhost/__admin/sleep"));
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : "Unknown error" }, 500);
  }
});

app.post("/admin/api/sleep", async (c) => {
  try {
    const body = await c.req.json().catch(() => ({}));
    const container = getContainer(c.env.OPENCODE_CONTAINER, SHARED_CONTAINER_ID);
    return container.fetch(
      new Request("http://localhost/__admin/sleep", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
    );
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : "Unknown error" }, 500);
  }
});

app.get("/admin/api/keepwarm", async (c) => {
  try {
    const container = getContainer(c.env.OPENCODE_CONTAINER, SHARED_CONTAINER_ID);
    return container.fetch(new Request("http://localhost/__admin/keepwarm"));
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : "Unknown error" }, 500);
  }
});

app.post("/admin/api/keepwarm", async (c) => {
  try {
    const body = await c.req.json().catch(() => ({}));
    const container = getContainer(c.env.OPENCODE_CONTAINER, SHARED_CONTAINER_ID);
    return container.fetch(
      new Request("http://localhost/__admin/keepwarm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
    );
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : "Unknown error" }, 500);
  }
});

const OPENCODE_CONFIG_KEY = "opencode-config/opencode.json";
const CONTAINER_METRICS_KEY = ".container-metrics.json";

const DEFAULT_OPENCODE_CONFIG = `{
  "$schema": "https://opencode.ai/config.json",
  "model": "opencode/claude-sonnet-4",
  "autoupdate": false,
  "share": "disabled"
}`;

async function readOpenCodeConfig(env: Env): Promise<{ content: string; persisted: boolean }> {
  const bucket = env.OPENCODE_CONFIG_R2;
  if (bucket) {
    const obj = await bucket.get(OPENCODE_CONFIG_KEY);
    if (obj) {
      return { content: await obj.text(), persisted: true };
    }
  }
  return { content: DEFAULT_OPENCODE_CONFIG, persisted: false };
}

app.get("/admin/api/opencode-config", async (c) => {
  try {
    const { content, persisted } = await readOpenCodeConfig(c.env);
    return c.json({ content, persisted, writable: !!c.env.OPENCODE_CONFIG_R2 });
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : "Unknown error" }, 500);
  }
});

app.post("/admin/api/opencode-config", async (c) => {
  try {
    if (!c.env.OPENCODE_CONFIG_R2) {
      return c.json({ error: "R2 storage not configured" }, 400);
    }
    const body = await c.req.json().catch(() => ({}));
    const content = typeof body.content === "string" ? body.content : "";
    if (!content.trim()) {
      return c.json({ error: "Content is empty" }, 400);
    }
    // Validate it's parseable JSON before saving
    try {
      JSON.parse(content);
    } catch {
      return c.json({ error: "Invalid JSON" }, 400);
    }
    await c.env.OPENCODE_CONFIG_R2.put(OPENCODE_CONFIG_KEY, content);
    return c.json({ success: true, message: "Configuration saved. Restart the container to apply changes." });
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : "Unknown error" }, 500);
  }
});

// OpenCode config JSON schema, proxied same-origin because opencode.ai sends
// no Access-Control-Allow-Origin header (browsers cannot fetch it directly).
// Cached in R2 for 24h to avoid hammering the upstream host.
const OPENCODE_SCHEMA_KEY = "opencode-schema.json";
const OPENCODE_SCHEMA_TTL_MS = 24 * 60 * 60 * 1000;

app.get("/admin/api/opencode-schema", async (c) => {
  try {
    const bucket = c.env.OPENCODE_CONFIG_R2;
    const fetchFresh = async () => {
      const res = await fetch("https://opencode.ai/config.json");
      if (!res.ok) {
        throw new Error(`Schema fetch failed: ${res.status} ${res.statusText}`);
      }
      const schema = await res.text();
      if (bucket) {
        await bucket.put(OPENCODE_SCHEMA_KEY, schema, {
          httpMetadata: { contentType: "application/json" },
        });
      }
      return c.json(JSON.parse(schema));
    };

    if (bucket) {
      const obj = await bucket.get(OPENCODE_SCHEMA_KEY);
      if (obj) {
        const uploaded = obj.uploaded ?? new Date(0);
        const age = Date.now() - uploaded.getTime();
        if (age < OPENCODE_SCHEMA_TTL_MS) {
          return c.json(JSON.parse(await obj.text()));
        }
      }
    }
    return await fetchFresh();
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : "Unknown error" }, 500);
  }
});

// Container instance size (vCPU/RAM/disk). Changing it triggers a rolling
// rollout via the Cloudflare Containers API - workers do not need a redeploy.
const CF_API_BASE = "https://api.cloudflare.com/client/v4";

const INSTANCE_TYPES = [
  { name: "lite",        vcpu: "1/16", memory: "256 MiB", disk: "2 GB" },
  { name: "basic",       vcpu: "1/4",  memory: "1 GiB",   disk: "4 GB" },
  { name: "standard-1",  vcpu: "1/2",  memory: "4 GiB",   disk: "8 GB" },
  { name: "standard-2",  vcpu: "1",    memory: "6 GiB",   disk: "12 GB" },
  { name: "standard-3",  vcpu: "2",    memory: "8 GiB",   disk: "16 GB" },
  { name: "standard-4",  vcpu: "4",    memory: "12 GiB",  disk: "20 GB" },
];

// Container application ID (lives in your Cloudflare account). This is what
// we PATCH to change the instance_type and POST to rollouts endpoint. Set it
// via the CONTAINER_APP_ID var in wrangler.toml (or as a secret).
function containerAppId(env: Env): string {
  return env.CONTAINER_APP_ID || "";
}

async function fetchCurrentContainerConfig(env: Env): Promise<{
  vcpu: number;
  memory_mib: number;
  disk_mb: number;
  memory: string;
  disk: string;
} | null> {
  const token = env.CF_API_TOKEN;
  const accountId = env.R2_ACCOUNT_ID;
  const appId = containerAppId(env);
  if (!token || !accountId || !appId) return null;
  try {
    const res = await fetch(
      `${CF_API_BASE}/accounts/${accountId}/containers/applications/${appId}`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    const data = (await res.json()) as any;
    if (!res.ok || !data.success) return null;
    const c = data.result?.configuration || {};
    return {
      vcpu: c.vcpu,
      memory_mib: c.memory_mib,
      disk_mb: c.disk?.size_mb,
      memory: c.memory,
      disk: c.disk?.size,
    };
  } catch {
    return null;
  }
}

function inferInstanceType(vcpu: number, memory_mib: number, disk_mb?: number): string {
  for (const t of INSTANCE_TYPES) {
    if (t.name === "lite" && vcpu < 0.1) return "lite";
    if (t.name === "basic" && vcpu <= 0.25 && memory_mib <= 1024) return "basic";
    if (t.name === "standard-1" && vcpu <= 0.5 && memory_mib <= 4096) return "standard-1";
    if (t.name === "standard-2" && vcpu <= 1 && memory_mib <= 6144) return "standard-2";
    if (t.name === "standard-3" && vcpu <= 2 && memory_mib <= 8192) return "standard-3";
    if (t.name === "standard-4" && vcpu <= 4 && memory_mib <= 12288) return "standard-4";
  }
  return "standard-2";
}

app.get("/admin/api/instance-type", async (c) => {
  const token = c.env.CF_API_TOKEN;
  const accountId = c.env.R2_ACCOUNT_ID;
  if (!token || !accountId) {
    return c.json({ error: "CF_API_TOKEN or R2_ACCOUNT_ID not configured" }, 400);
  }
  const current = await fetchCurrentContainerConfig(c.env);
  return c.json({
    instanceTypes: INSTANCE_TYPES,
    current: current
      ? {
          instanceType: inferInstanceType(current.vcpu, current.memory_mib, current.disk_mb),
          vcpu: current.vcpu,
          memory: current.memory,
          memoryMib: current.memory_mib,
          disk: current.disk,
          diskMb: current.disk_mb,
        }
      : null,
  });
});

app.post("/admin/api/instance-type", async (c) => {
  const token = c.env.CF_API_TOKEN;
  const accountId = c.env.R2_ACCOUNT_ID;
  if (!token || !accountId) {
    return c.json({ error: "CF_API_TOKEN or R2_ACCOUNT_ID not configured" }, 400);
  }
  const appId = containerAppId(c.env);
  if (!appId) {
    return c.json({ error: "Container app id not available (set CONTAINER_APP_ID)" }, 500);
  }

  const body = await c.req.json().catch(() => ({}));
  const requested = typeof body.instanceType === "string" ? body.instanceType.trim() : "";
  const valid = INSTANCE_TYPES.find((t) => t.name === requested);
  if (!valid) {
    return c.json(
      { error: `Invalid instance type. Choose one of: ${INSTANCE_TYPES.map((t) => t.name).join(", ")}` },
      400
    );
  }

  // 1) Update the target configuration on the application
  const patchRes = await fetch(
    `${CF_API_BASE}/accounts/${accountId}/containers/applications/${appId}`,
    {
      method: "PATCH",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ configuration: { instance_type: valid.name } }),
    }
  );
  const patchData = (await patchRes.json()) as any;
  if (!patchRes.ok || !patchData.success) {
    return c.json(
      {
        error: `Failed to update configuration: ${
          patchData?.errors?.[0]?.message || patchRes.statusText
        }`,
      },
      502
    );
  }

  // 2) Trigger a rolling rollout to actually apply the change
  const rolloutRes = await fetch(
    `${CF_API_BASE}/accounts/${accountId}/containers/applications/${appId}/rollouts`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        description: `Switch to ${valid.name}`,
        strategy: "rolling",
        target_configuration: { instance_type: valid.name },
        kind: "full_auto",
        step_percentage: 100,
      }),
    }
  );
  const rolloutData = (await rolloutRes.json()) as any;
  if (!rolloutRes.ok || !rolloutData.success) {
    return c.json(
      {
        error: `Configuration updated but rollout failed: ${
          rolloutData?.errors?.[0]?.message || rolloutRes.statusText
        }. The new size will apply on the next deploy.`,
        partial: true,
      },
      502
    );
  }

  return c.json({
    success: true,
    message: `Instance size changing to ${valid.name} (${valid.vcpu} vCPU, ${valid.memory} RAM, ${valid.disk} disk). Rollout in progress.`,
    rolloutId: rolloutData.result?.id,
    instanceType: valid.name,
  });
});

// Live container workload (CPU / RAM / disk). The container's startup.sh
// writes a small JSON to R2 (.container-metrics.json) every 5s.
app.get("/admin/api/container-metrics", async (c) => {
  const bucket = c.env.OPENCODE_CONFIG_R2;
  if (!bucket) {
    return c.json({ error: "R2 storage not configured" }, 400);
  }
  try {
    const obj = await bucket.get(CONTAINER_METRICS_KEY);
    if (!obj) {
      return c.json({
        available: false,
        reason: "Metrics file not found in R2. Container metrics collector may not be running yet (waits 10s after boot).",
      });
    }
    const text = await obj.text();
    const parsed = JSON.parse(text);
    return c.json({ available: true, ...parsed });
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : "Unknown error" }, 500);
  }
});

// Billing & usage insights (uses CF_API_TOKEN secret, requires Billing Read)
interface BillingRow {
  ServiceName: string;
  ServiceFamilyName: string;
  ChargeCategory: string;
  ConsumedUnit: string;
  ConsumedQuantity: number;
  PricingUnit: string;
  PricingQuantity: number;
  BilledCost: number;
  BillingCurrency: string;
}

function fmtQty(value: number): string {
  if (Math.abs(value) >= 1_000_000) {
    return (value / 1_000_000).toFixed(2) + "M";
  }
  if (Math.abs(value) >= 1_000) {
    return (value / 1_000).toFixed(2) + "k";
  }
  if (value === 0) return "0";
  if (value < 0.01) return value.toFixed(4);
  return value.toFixed(2);
}

function fmtBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return (bytes / Math.pow(1024, i)).toFixed(2) + " " + units[i];
}

app.get("/admin/api/billing", async (c) => {
  const token = c.env.CF_API_TOKEN;
  if (!token) {
    return c.json({ error: "CF_API_TOKEN secret not set. See README." }, 400);
  }
  const accountId = c.env.R2_ACCOUNT_ID;
  if (!accountId) {
    return c.json({ error: "R2_ACCOUNT_ID not set" }, 400);
  }

  const now = new Date();
  const to = now.toISOString();
  const from = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();

  const authHeaders = {
    Authorization: `Bearer ${token}`,
  };

  // 1. Billable usage (billed cost + quantities)
  let billableUsage: BillingRow[] = [];
  try {
    const url = `${CF_API_BASE}/accounts/${accountId}/billable-usage?from=${encodeURIComponent(
      from
    )}&to=${encodeURIComponent(to)}`;
    const res = await fetch(url, { headers: authHeaders });
    const data = (await res.json()) as any;
    if (res.ok && data.success && Array.isArray(data.result)) {
      billableUsage = data.result as BillingRow[];
    } else {
      return c.json(
        {
          error: `Billable usage API failed: ${
            data?.errors?.[0]?.message || res.statusText
          }`,
        },
        502
      );
    }
  } catch (e) {
    return c.json({ error: `Billable usage error: ${(e as Error).message}` }, 502);
  }

  // Aggregate rows by service, summing consumed quantity and billed cost
  const byService = new Map<string, {
    name: string;
    family: string;
    unit: string;
    consumed: number;
    billedCost: number;
    currency: string;
  }>();

  for (const row of billableUsage) {
    const key = `${row.ServiceFamilyName}::${row.ServiceName}`;
    const existing = byService.get(key);
    if (existing) {
      existing.consumed += row.ConsumedQuantity || 0;
      existing.billedCost += row.BilledCost || 0;
    } else {
      byService.set(key, {
        name: row.ServiceName,
        family: row.ServiceFamilyName,
        unit: row.ConsumedUnit || "count",
        consumed: row.ConsumedQuantity || 0,
        billedCost: row.BilledCost || 0,
        currency: row.BillingCurrency || "USD",
      });
    }
  }

  // Free-tier limits per service, expressed in both consumed units and display units
  const FREE_TIERS: Array<{ match: RegExp; limit: number; displayLimit: number; displayUnit: string }> = [
    { match: /Container vCPU/, limit: 375 * 60, displayLimit: 375, displayUnit: "vCPU-min" },
    { match: /Container Memory/, limit: 25 * 3600, displayLimit: 25, displayUnit: "GiB-hours" },
    { match: /Container Disk/, limit: 200 * 3600, displayLimit: 200, displayUnit: "GB-hours" },
    { match: /Container Egress/, limit: 1000, displayLimit: 1000, displayUnit: "GB" },
    { match: /Workers CPU ms/, limit: 30_000_000, displayLimit: 30, displayUnit: "M CPU ms" },
    { match: /Workers Standard Requests/, limit: 10_000_000, displayLimit: 10, displayUnit: "M requests" },
    { match: /D1 - Rows Written/, limit: 50_000_000, displayLimit: 50, displayUnit: "M rows" },
    { match: /D1 - Rows Read/, limit: 25_000_000_000, displayLimit: 25, displayUnit: "B rows" },
    { match: /D1 - Storage/, limit: 5, displayLimit: 5, displayUnit: "GB-mo" },
    { match: /Durable Objects Compute Requests/, limit: 1_000_000, displayLimit: 1, displayUnit: "M requests" },
    { match: /Durable Objects Compute Duration/, limit: 400_000, displayLimit: 400, displayUnit: "k GB*S" },
    { match: /Durable Objects Storage Rows Read/, limit: 25_000_000_000, displayLimit: 25, displayUnit: "B rows" },
    { match: /Durable Objects Storage Rows Written/, limit: 50_000_000, displayLimit: 50, displayUnit: "M rows" },
    { match: /Durable Objects SQL Storage/, limit: 5, displayLimit: 5, displayUnit: "GB-month" },
  ];

  // Free plan (no $5/mo base) limits - expressed in the SAME consumed units as FREE_TIERS
  // so they can be plotted on the same bar. onFree=false means feature is Paid-only.
  const FREE_PLAN_TIERS: Array<{
    match: RegExp;
    limit: number;
    displayLimit: number;
    displayUnit: string;
    onFree: boolean;
  }> = [
    // Containers are Paid-only on Cloudflare (no free containers)
    { match: /Container vCPU/, limit: 0, displayLimit: 0, displayUnit: "vCPU-min", onFree: false },
    { match: /Container Memory/, limit: 0, displayLimit: 0, displayUnit: "GiB-hours", onFree: false },
    { match: /Container Disk/, limit: 0, displayLimit: 0, displayUnit: "GB-hours", onFree: false },
    { match: /Container Egress/, limit: 0, displayLimit: 0, displayUnit: "GB", onFree: false },
    // Workers Free: 100k req/day ≈ 3M/month
    { match: /Workers CPU ms/, limit: 3_000_000, displayLimit: 3, displayUnit: "M CPU ms", onFree: true },
    { match: /Workers Standard Requests/, limit: 3_000_000, displayLimit: 3, displayUnit: "M requests", onFree: true },
    // D1 Free: 5 GB storage, 5M rows read/day, 100k rows written/day
    { match: /D1 - Rows Written/, limit: 3_000_000, displayLimit: 3, displayUnit: "M rows/mo", onFree: true },
    { match: /D1 - Rows Read/, limit: 150_000_000, displayLimit: 150, displayUnit: "M rows/mo", onFree: true },
    { match: /D1 - Storage/, limit: 5, displayLimit: 5, displayUnit: "GB-mo", onFree: true },
    // Durable Objects: not on Free
    { match: /Durable Objects/, limit: 0, displayLimit: 0, displayUnit: "", onFree: false },
  ];

  const services = [...byService.values()]
    .map((s) => {
      const tier = FREE_TIERS.find((t) => t.match.test(s.name));
      const free = FREE_PLAN_TIERS.find((t) => t.match.test(s.name));
      const limit = tier?.limit ?? 0;
      const displayLimit = tier?.displayLimit ?? limit;
      const displayUnit = tier?.displayUnit ?? s.unit;
      const factor = limit && displayLimit ? limit / displayLimit : 1;

      const withinFree = limit ? Math.min(s.consumed, limit) : s.consumed;
      const overFree = limit ? Math.max(0, s.consumed - limit) : 0;

      const displayConsumed = s.consumed / factor;
      const displayOver = overFree / factor;

      // Free-plan info
      let freePlan: { limit: number; display: string; onFree: boolean; overFreePlan: number; needsPaid: boolean } | null = null;
      if (free) {
        const fpLimit = free.limit;
        const fpDisplay = free.onFree
          ? `${fmtQty(free.displayLimit)} ${free.displayUnit}`
          : "N/A (Paid only)";
        const overFp = fpLimit ? Math.max(0, s.consumed - fpLimit) : (s.consumed > 0 ? s.consumed : 0);
        const needsPaid = !free.onFree ? s.consumed > 0 : overFp > 0;
        freePlan = {
          limit: fpLimit,
          display: fpDisplay,
          onFree: free.onFree,
          overFreePlan: overFp,
          needsPaid,
        };
      }

      return {
        ...s,
        consumedFormatted: fmtQty(s.consumed),
        billedCost: Math.round(s.billedCost * 10000) / 10000,
        freeTier: tier
          ? {
              limit,
              display: `${fmtQty(displayLimit)} ${displayUnit}`,
              withinFree,
              overFree,
              displayConsumed: fmtQty(displayConsumed),
              displayUnit,
              displayLimit: fmtQty(displayLimit),
              displayRemaining: fmtQty(Math.max(0, displayLimit - displayConsumed)),
              displayOver: displayOver > 0 ? fmtQty(displayOver) : "0",
              freePlan,
            }
          : null,
      };
    })
    .sort(
      (a, b) =>
        b.billedCost - a.billedCost ||
        (b.freeTier?.overFree || 0) - (a.freeTier?.overFree || 0) ||
        b.consumed - a.consumed
    );

  const totalBilled = Math.round(
    services.reduce((sum, s) => sum + s.billedCost, 0) * 10000
  ) / 10000;
  const currency = services[0]?.currency || "USD";

  // 2.5 Subscription plan + base fee
  let subscription: {
    plan: string;
    baseFee: number;
    totalEstimatedMonthly: number;
  } = {
    plan: "Workers Paid",
    baseFee: 5,
    totalEstimatedMonthly: Math.round((5 + totalBilled) * 100) / 100,
  };
  try {
    const url = `${CF_API_BASE}/accounts/${accountId}/subscriptions`;
    const res = await fetch(url, { headers: authHeaders });
    const data = (await res.json()) as any;
    if (res.ok && data.success && Array.isArray(data.result)) {
      const plan = data.result[0]?.rate_plan?.public_name;
      if (typeof plan === "string" && plan) {
        subscription.plan = plan;
      }
    }
  } catch {
    // fall back to defaults
  }

  // 2. R2 bucket usage
  let r2Usage: Record<string, string> | null = null;
  try {
    const bucket = c.env.R2_BUCKET_NAME;
    if (bucket) {
      const url = `${CF_API_BASE}/accounts/${accountId}/r2/buckets/${bucket}/usage`;
      const res = await fetch(url, { headers: authHeaders });
      const data = (await res.json()) as any;
      if (res.ok && data.success && data.result) {
        r2Usage = data.result;
      }
    }
  } catch {
    // r2 usage is optional
  }

  // 3. Workers invocations + errors via GraphQL
  let workerStats: Record<string, unknown> | null = null;
  try {
    const query = `{
      viewer {
        accounts(filter: { accountTag: "${accountId}" }) {
          workersInvocationsAdaptive(
            limit: 1
            filter: { datetimeMinute_geq: "${from}", datetimeMinute_leq: "${to}" }
          ) {
            sum { requests errors subrequests }
            quantiles { cpuTimeP50 }
          }
        }
      }
    }`;
    const res = await fetch(`${CF_API_BASE}/graphql`, {
      method: "POST",
      headers: { ...authHeaders, "Content-Type": "application/json" },
      body: JSON.stringify({ query }),
    });
    const data = (await res.json()) as any;
    const row = data?.data?.viewer?.accounts?.[0]?.workersInvocationsAdaptive?.[0];
    if (row) {
      workerStats = {
        requests: row.sum?.requests ?? 0,
        errors: row.sum?.errors ?? 0,
        subrequests: row.sum?.subrequests ?? 0,
        cpuTimeP50Ms: row.quantiles?.cpuTimeP50 ?? 0,
      };
    }
  } catch {
    // worker stats are optional
  }

  return c.json({
    period: { from, to },
    totalBilled,
    currency,
    subscription,
    services,
    r2Usage: r2Usage
      ? (() => {
          const payloadSize = Number(r2Usage.payloadSize) || 0;
          const freeLimitBytes = 10 * 1024 * 1024 * 1024; // 10 GB
          const over = Math.max(0, payloadSize - freeLimitBytes);
          return {
            payloadSizeBytes: payloadSize,
            payloadSizeFormatted: fmtBytes(payloadSize),
            objectCount: Number(r2Usage.objectCount) || 0,
            uploadCount: Number(r2Usage.uploadCount) || 0,
            freePlanLimitBytes: freeLimitBytes,
            freePlanLimitFormatted: "10 GB",
            overFreePlanBytes: over,
            overFreePlanFormatted: fmtBytes(over),
            needsPaid: over > 0,
          };
        })()
      : null,
    workerStats,
    freeTierNotes: {
      container: "First 375 vCPU-min + 25 GiB-hours memory / month",
      workers: "First 30M CPU ms / month",
      r2: "First 10 GB storage / month",
      d1: "First 5 GB / month",
    },
  });
});

// Proxy /freellmapi/* to container's internal port 3001 (FreeLLMAPI).
// The dashboard is built with VITE_BASE=/freellmapi/ so its asset/API URLs
// arrive under this prefix; strip it before forwarding so the container sees
// its native paths (/assets/..., /api/..., /v1/...).
app.all("/freellmapi/*", async (c) => {
  const container = getContainer(c.env.OPENCODE_CONTAINER, SHARED_CONTAINER_ID);
  const url = new URL(c.req.url);
  url.pathname = url.pathname.replace(/^\/freellmapi/, "") || "/";
  const proxied = switchPort(new Request(url, c.req.raw), 3001);
  return container.fetch(proxied);
});

// Debug route to read FreeLLMAPI log from R2
app.get("/debug/freellmapi-log", async (c) => {
  const bucket = c.env.OPENCODE_CONFIG_R2;
  if (!bucket) {
    return c.text("R2 not configured", 404);
  }
  const key = ".freellmapi/freellmapi.log";
  const object = await bucket.get(key);
  if (object === null) {
    return c.text("Log file not found", 404);
  }
  return c.text(await object.text());
});

// Default route - proxy all other requests to container (OpenCode server)
// Default route - proxy all other requests to container (OpenCode server)
app.all("*", async (c) => {
  const container = getContainer(c.env.OPENCODE_CONTAINER, SHARED_CONTAINER_ID);
  return container.fetch(c.req.raw);
});

export default {
  fetch: app.fetch,

  // Optional: Scheduled handler to keep container warm
  async scheduled(controller: ScheduledController, env: Env): Promise<void> {
    const container = getContainer(env.OPENCODE_CONTAINER, SHARED_CONTAINER_ID);
    try {
      // Check keep-warm flag first (handled in the DO, doesn't start the container)
      const warmRes = await container.fetch(
        new Request("http://localhost/__admin/keepwarm")
      );
      const warm = (await warmRes.json()) as { enabled?: boolean };
      if (!warm.enabled) {
        console.log("Keep-warm disabled, skipping ping");
        return;
      }

      const response = await container.fetch(
        new Request("http://localhost/global/health")
      );
      console.log("Keep-alive ping:", response.status);
    } catch (error) {
      console.error("Keep-alive ping failed:", error);
    }
  },
};
