// Wires FreeLLMAPI into OpenCode automatically so first-run users don't have to
// hand-edit opencode.json. Idempotent - safe to run on every boot.
//
// What it does:
//   1. Reads the unified API key FreeLLMAPI generated on first boot (settings
//      table of the SQLite DB - same DB that survives restarts in R2).
//   2. Ensures `provider.freellmapi` exists in opencode.json with that key and
//      baseURL http://127.0.0.1:3001/v1 (FreeLLMAPI runs in the same container).
//   3. On first provisioning only, sets the default model to freellmapi/auto.
//      If the user later changes the model in the admin panel, that choice is
//      respected (we never override an existing model).
//
// Env:
//   FREEAPI_DB_PATH      - freellmapi SQLite DB (default /mnt/r2/.freellmapi/freeapi.db)
//   OPENCODE_CONFIG_PATH - opencode.json (default /mnt/r2/opencode-config/opencode.json)
//   FREELLMAPI_PORT      - internal port (default 3001)

const fs = require("fs");

const DB_PATH = process.env.FREEAPI_DB_PATH || "/mnt/r2/.freellmapi/freeapi.db";
const CONFIG_PATH = process.env.OPENCODE_CONFIG_PATH || "/mnt/r2/opencode-config/opencode.json";
const PORT = process.env.FREELLMAPI_PORT || "3001";

let unifiedKey = null;
try {
  const Database = require("/home/dev/freellmapi/node_modules/better-sqlite3");
  const db = new Database(DB_PATH, { readonly: true });
  const row = db.prepare("SELECT value FROM settings WHERE key = 'unified_api_key'").get();
  db.close();
  unifiedKey = row ? row.value : null;
} catch (err) {
  console.log(`[ensure-opencode-config] could not read unified key: ${err.message}`);
}

if (!unifiedKey) {
  console.log("[ensure-opencode-config] no unified API key yet, skipping");
  process.exit(0);
}

let config = {};
if (fs.existsSync(CONFIG_PATH)) {
  try {
    config = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
  } catch (err) {
    console.log(`[ensure-opencode-config] existing config unparseable (${err.message}), starting fresh`);
    config = {};
  }
}

const hadProvider = !!(config.provider && config.provider.freellmapi);

config.provider = config.provider || {};
config.provider.freellmapi = {
  npm: "@ai-sdk/openai-compatible",
  name: "FreeLLMAPI",
  options: {
    baseURL: `http://127.0.0.1:${PORT}/v1`,
    apiKey: unifiedKey,
  },
  models: {
    auto: { name: "Auto", limit: { context: 128000 } },
  },
};

if (!hadProvider) {
  const prevModel = config.model;
  config.model = "freellmapi/auto";
  console.log(`[ensure-opencode-config] added freellmapi provider, default model set to freellmapi/auto${prevModel ? ` (was ${prevModel})` : ""}`);
} else {
  console.log("[ensure-opencode-config] freellmapi provider already present, refreshed apiKey");
}

fs.mkdirSync(require("path").dirname(CONFIG_PATH), { recursive: true });
fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2) + "\n");
console.log(`[ensure-opencode-config] wrote ${CONFIG_PATH}`);
