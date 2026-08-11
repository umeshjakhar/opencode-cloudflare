import { Container, getContainer } from "@cloudflare/containers";
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
  OPENCODE_CONFIG_R2?: R2Bucket;
  R2_ACCOUNT_ID?: string;
  R2_BUCKET_NAME?: string;
  R2_ACCESS_KEY_ID?: string;
  R2_SECRET_ACCESS_KEY?: string;
  CF_API_TOKEN?: string;
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

      // R2 persistent storage (FUSE mount)
      R2_ACCOUNT_ID: this.env.R2_ACCOUNT_ID || "",
      R2_BUCKET_NAME: this.env.R2_BUCKET_NAME || "",
      R2_ACCESS_KEY_ID: this.env.R2_ACCESS_KEY_ID || "",
      R2_SECRET_ACCESS_KEY: this.env.R2_SECRET_ACCESS_KEY || "",
      AWS_ACCESS_KEY_ID: this.env.R2_ACCESS_KEY_ID || "",
      AWS_SECRET_ACCESS_KEY: this.env.R2_SECRET_ACCESS_KEY || "",
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

      // R2 persistent storage (FUSE mount)
      R2_ACCOUNT_ID: this.env.R2_ACCOUNT_ID || "",
      R2_BUCKET_NAME: this.env.R2_BUCKET_NAME || "",
      R2_ACCESS_KEY_ID: this.env.R2_ACCESS_KEY_ID || "",
      R2_SECRET_ACCESS_KEY: this.env.R2_SECRET_ACCESS_KEY || "",
      AWS_ACCESS_KEY_ID: this.env.R2_ACCESS_KEY_ID || "",
      AWS_SECRET_ACCESS_KEY: this.env.R2_SECRET_ACCESS_KEY || "",
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

      // R2 persistent storage (FUSE mount)
      R2_ACCOUNT_ID: this.env.R2_ACCOUNT_ID || "",
      R2_BUCKET_NAME: this.env.R2_BUCKET_NAME || "",
      R2_ACCESS_KEY_ID: this.env.R2_ACCESS_KEY_ID || "",
      R2_SECRET_ACCESS_KEY: this.env.R2_SECRET_ACCESS_KEY || "",
      AWS_ACCESS_KEY_ID: this.env.R2_ACCESS_KEY_ID || "",
      AWS_SECRET_ACCESS_KEY: this.env.R2_SECRET_ACCESS_KEY || "",
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

// Basic auth for admin routes
app.use("/admin/*", async (c, next) => {
  const password = c.env.ADMIN_PASSWORD || c.env.OPENCODE_SERVER_PASSWORD;
  if (!password) {
    return c.text("Admin password not configured", 500);
  }

  const auth = basicAuth({
    username: "admin",
    password: password,
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

// Billing & usage insights (uses CF_API_TOKEN secret, requires Billing Read)
const CF_API_BASE = "https://api.cloudflare.com/client/v4";

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

  const services = [...byService.values()]
    .map((s) => {
      const tier = FREE_TIERS.find((t) => t.match.test(s.name));
      const limit = tier?.limit ?? 0;
      const displayLimit = tier?.displayLimit ?? limit;
      const displayUnit = tier?.displayUnit ?? s.unit;
      const factor = limit && displayLimit ? limit / displayLimit : 1;

      const withinFree = limit ? Math.min(s.consumed, limit) : s.consumed;
      const overFree = limit ? Math.max(0, s.consumed - limit) : 0;
      
      const displayConsumed = s.consumed / factor;
      const displayOver = overFree / factor;

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
      ? {
          payloadSizeBytes: Number(r2Usage.payloadSize) || 0,
          payloadSizeFormatted: fmtBytes(Number(r2Usage.payloadSize) || 0),
          objectCount: Number(r2Usage.objectCount) || 0,
          uploadCount: Number(r2Usage.uploadCount) || 0,
        }
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
