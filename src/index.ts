import { Container, getContainer } from "@cloudflare/containers";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { basicAuth } from "hono/basic-auth";
import { getAdminHTML } from "./admin-ui";

interface Env {
  OPENCODE_CONTAINER: DurableObjectNamespace<OpenCodeContainer>;
  OPENCODE_SERVER_PASSWORD: string;
  OPENCODE_API_KEY: string;
  GIT_REPOS: string;
  GIT_TOKEN?: string;
  ADMIN_PASSWORD?: string;
}

// Container class with admin endpoints
export class OpenCodeContainer extends Container<Env> {
  defaultPort = 4096;
  sleepAfter = "24h"; // Keep running (essentially always-on)
  enableInternet = true; // Required for LLM API calls

  private startTime: number | null = null;

  override async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    // Handle internal admin API requests
    if (url.pathname.startsWith("/__admin/")) {
      return this.handleAdminRequest(request, url);
    }

    // Set environment variables dynamically before handling request
    this.envVars = {
      // OpenCode server config
      OPENCODE_SERVER_PASSWORD: this.env.OPENCODE_SERVER_PASSWORD || "",
      OPENCODE_PERMISSION: '{"edit":"allow","bash":"allow","write":"allow"}',
      OPENCODE_DISABLE_AUTOUPDATE: "true",

      // OpenCode Zen API key
      OPENCODE_API_KEY: this.env.OPENCODE_API_KEY || "",

      // Git repos to clone on startup
      GIT_REPOS: this.env.GIT_REPOS || "",
      GIT_TOKEN: this.env.GIT_TOKEN || "",
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
      GIT_REPOS: this.env.GIT_REPOS || "",
      GIT_TOKEN: this.env.GIT_TOKEN || "",
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
      GIT_REPOS: this.env.GIT_REPOS || "",
      GIT_TOKEN: this.env.GIT_TOKEN || "",
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
          GIT_REPOS: this.env.GIT_REPOS || "",
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
      const response = await container.fetch(
        new Request("http://localhost/global/health")
      );
      console.log("Keep-alive ping:", response.status);
    } catch (error) {
      console.error("Keep-alive ping failed:", error);
    }
  },
};
