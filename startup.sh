#!/bin/bash
set -e

export HOME=/home/dev
cd /home/dev

# Configure git for private repos if token is provided
if [ -n "$GIT_TOKEN" ]; then
  git config --global url."https://${GIT_TOKEN}@github.com/".insteadOf "https://github.com/"
fi

# --- Persistent storage via R2 + FUSE (tigrisfs) ----------------------------
R2_MOUNT=/mnt/r2

if [ -n "$R2_ACCOUNT_ID" ] && [ -n "$R2_BUCKET_NAME" ] \
   && [ -n "$R2_ACCESS_KEY_ID" ] && [ -n "$R2_SECRET_ACCESS_KEY" ]; then
  echo "Mounting R2 bucket ${R2_BUCKET_NAME} with tigrisfs..."
  mkdir -p "$R2_MOUNT"
  R2_ENDPOINT="https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com"
  # tigrisfs speaks the S3 protocol and expects AWS_* env vars. Scope them to
  # this process only (via exec in a subshell) so opencode never sees them and
  # doesn't falsely report Amazon Bedrock as configured.
  (
    export AWS_ACCESS_KEY_ID="$R2_ACCESS_KEY_ID"
    export AWS_SECRET_ACCESS_KEY="$R2_SECRET_ACCESS_KEY"
    exec tigrisfs --endpoint "$R2_ENDPOINT" -f "$R2_BUCKET_NAME" "$R2_MOUNT"
  ) &
  sleep 3

  # Verify the mount is actually up
  MOUNTED=0
  for i in 1 2 3 4 5 6 7 8 9 10; do
    if ls "$R2_MOUNT" >/dev/null 2>&1; then
      MOUNTED=1
      break
    fi
    echo "Waiting for R2 mount... ($i/10)"
    sleep 2
  done

  if [ "$MOUNTED" = "1" ]; then
    echo "R2 bucket mounted successfully"
    mkdir -p "$R2_MOUNT/opencode-data" \
             "$R2_MOUNT/opencode-config" \
             "$R2_MOUNT/.freellmapi"

    # First boot: seed the config dir from the baked-in image config
    if [ ! -f "$R2_MOUNT/opencode-config/opencode.json" ]; then
      cp /home/dev/.config/opencode/opencode.json "$R2_MOUNT/opencode-config/opencode.json"
    fi

    # Replace the baked-in real directories with symlinks to the persistent
    # mount. These are REAL dirs baked into the image (with the default config),
    # so they MUST be removed first: `ln -sfn` alone would create a NESTED
    # symlink inside the existing dir, leaving opencode reading the stale baked
    # config instead of the R2 one.
    rm -rf /home/dev/.config/opencode /home/dev/.local/share/opencode
    ln -sfn "$R2_MOUNT/opencode-data"   /home/dev/.local/share/opencode
    ln -sfn "$R2_MOUNT/opencode-config" /home/dev/.config/opencode

    # Background metrics collector
    if [ -d "$R2_MOUNT" ]; then
      (
        sleep 10
        PREV_TOTAL=0
        PREV_IDLE=0
        METRICS_FILE="$R2_MOUNT/.container-metrics.json"
        while true; do
          MEM_TOTAL_KB=$(awk '/^MemTotal:/ {print $2}' /proc/meminfo 2>/dev/null || echo 0)
          MEM_AVAIL_KB=$(awk '/^MemAvailable:/ {print $2}' /proc/meminfo 2>/dev/null || echo 0)
          MEM_USED_KB=$((MEM_TOTAL_KB - MEM_AVAIL_KB))
          MEM_TOTAL_MB=$((MEM_TOTAL_KB / 1024))
          MEM_USED_MB=$((MEM_USED_KB / 1024))
          MEM_PCT=0
          if [ "$MEM_TOTAL_KB" -gt 0 ]; then
            MEM_PCT=$(awk "BEGIN {printf \"%.1f\", ($MEM_USED_KB*100.0)/$MEM_TOTAL_KB}")
          fi
          CPU_LINE=$(head -n1 /proc/stat 2>/dev/null || echo "")
          CPU_PCT=0
          if [ -n "$CPU_LINE" ]; then
            TOT=$(echo "$CPU_LINE" | awk '{for(i=2;i<=NF;i++) s+=$i; print s}')
            IDLE=$(echo "$CPU_LINE" | awk '{print $5}')
            if [ "$PREV_TOTAL" -gt 0 ]; then
              D_TOT=$((TOT - PREV_TOTAL))
              D_IDLE=$((IDLE - PREV_IDLE))
              if [ "$D_TOT" -gt 0 ]; then
                CPU_PCT=$(awk "BEGIN {printf \"%.1f\", (($D_TOT-$D_IDLE)*100.0)/$D_TOT}")
              fi
            fi
            PREV_TOTAL=$TOT
            PREV_IDLE=$IDLE
          fi
          DISK_INFO=$(df -PB1 / 2>/dev/null | tail -n1)
          DISK_TOTAL=$(echo "$DISK_INFO" | awk '{print $2}')
          DISK_USED=$(echo "$DISK_INFO" | awk '{print $3}')
          DISK_PCT=0
          if [ "$DISK_TOTAL" -gt 0 ]; then
            DISK_PCT=$(awk "BEGIN {printf \"%.1f\", ($DISK_USED*100.0)/$DISK_TOTAL}")
          fi
          LOAD=$(cat /proc/loadavg 2>/dev/null | awk '{print $1, $2, $3}')
          PROC_COUNT=$(ls /proc 2>/dev/null | grep -c '^[0-9]')
          UPTIME_S=$(awk '{print int($1)}' /proc/uptime 2>/dev/null || echo 0)
          TS=$(date +%s)
          cat > "$METRICS_FILE" <<JSON
{"timestamp":$TS,"cpu":{"percent":$CPU_PCT},"memory":{"totalMB":$MEM_TOTAL_MB,"usedMB":$MEM_USED_MB,"percent":$MEM_PCT},"disk":{"totalBytes":$DISK_TOTAL,"usedBytes":$DISK_USED,"percent":$DISK_PCT},"load":"$LOAD","processCount":$PROC_COUNT,"uptimeSeconds":$UPTIME_S}
JSON
          sleep 5
        done
      ) &
    fi

    # --- FreeLLMAPI: baked in the image, .env + run on boot ------------------
    # Server listens on 3001. Worker proxies /freellmapi/* -> 3001.
    #
    # The app code + build outputs are baked into the image (see Dockerfile), so
    # on boot we only need to restore the .env (ENCRYPTION_KEY) and start the
    # server - no clone/install/build. The steps below remain as a fallback in
    # case the bake is ever missing from an image.
    #
    # The app's CONFIG persists in R2: it lives in the SQLite DB (freeapi.db).
    # To keep provider keys decryptable across restarts, ENCRYPTION_KEY is
    # persisted too (next to the DB in R2) and reused on every boot.
    #
    # Boot runs in a background subshell so the container (opencode on 4096)
    # stays healthy during first boot. ALL boot output (clone/install/build/
    # server) goes to the R2 log file so it's visible via /debug/freellmapi-log.
    (
      FREEL=/home/dev/freellmapi
      LOG_FILE=/mnt/r2/.freellmapi/freellmapi.log
      DB_PATH=/mnt/r2/.freellmapi/freeapi.db
      KEY_FILE=/mnt/r2/.freellmapi/encryption_key
      mkdir -p /mnt/r2/.freellmapi
      # Tee output to both the R2 log file (persisted, per-boot record read by
      # /debug/freellmapi-log) AND the container's stdout so wrangler tail shows
      # boot output in real time without waiting for the FUSE->R2 sync.
      exec > >(tee -a "$LOG_FILE") 2>&1

      echo "=== freellmapi boot $(date -u +%FT%TZ) ==="
      if [ ! -f "$FREEL/server/dist/index.js" ]; then
        echo "[1/5] freellmapi build not present in image, cloning + installing (fallback)"
        rm -rf "$FREEL"
        git clone https://github.com/tashfeenahmed/freellmapi.git "$FREEL" || { echo "git clone FAILED"; exit 1; }
      else
        echo "[1/5] freellmapi baked in image, skipping clone"
      fi

      cd "$FREEL"

      if [ ! -d node_modules ]; then
        echo "[2/5] node_modules missing, npm install (can take several minutes)"
        npm install 2>&1 || { echo "npm install FAILED"; exit 1; }
      else
        echo "[2/5] node_modules present, skipping install"
      fi

      echo "[3/5] ENCRYPTION_KEY + write .env"
      # Reuse a persisted key if present so previously-saved provider keys stay
      # decryptable across restarts; otherwise generate + persist it in R2.
      if [ -n "$FREELLMAPI_ENCRYPTION_KEY" ]; then
        ENCRYPTION_KEY="$FREELLMAPI_ENCRYPTION_KEY"
      elif [ -f "$KEY_FILE" ]; then
        ENCRYPTION_KEY=$(cat "$KEY_FILE")
      else
        ENCRYPTION_KEY=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")
        echo "$ENCRYPTION_KEY" > "$KEY_FILE"
      fi
      printf 'ENCRYPTION_KEY=%s\nPORT=3001\n' "$ENCRYPTION_KEY" > .env
      echo ".env written (key length: ${#ENCRYPTION_KEY})"

      if [ ! -f server/dist/index.js ] || [ ! -d client/dist ]; then
        echo "[4/5] build outputs missing, npm run build (VITE_BASE=/freellmapi/, fallback)"
        # VITE_BASE makes the dashboard's assets + API calls root at
        # /freellmapi/... so they route through the worker's /freellmapi/* proxy
        # instead of resolving to the domain root (blank page).
        export VITE_BASE=/freellmapi/
        npm run build 2>&1 || { echo "npm run build FAILED"; exit 1; }
      else
        echo "[4/5] build outputs present, skipping build"
      fi

      echo "[5/5] starting node server/dist/index.js on port 3001"
      # Config (providers, keys, settings) is the SQLite DB - persist just it.
      # server/data/* stays ephemeral; only freeapi.db is written to R2.
      export PORT=3001
      export HOST=0.0.0.0
      export NODE_ENV=production
      export FREEAPI_DB_PATH="$DB_PATH"
      # shellcheck disable=SC1091
      set -a; . ./.env; set +a
      echo "--- server output ---"
      node server/dist/index.js &
      SERVER_PID=$!

      # Wait for the API to come up (needed before provisioning the account).
      for i in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15; do
        if curl -fsS http://127.0.0.1:3001/api/auth/status >/dev/null 2>&1; then
          break
        fi
        echo "waiting for freellmapi API... ($i/15)"
        sleep 2
      done

      # Auto-provision/refresh the dashboard account from the universal creds
      # (ADMIN_EMAIL / ADMIN_PASSWORD). Idempotent - create or update.
      if [ -n "$ADMIN_EMAIL" ] && [ -n "$ADMIN_PASSWORD" ]; then
        node /home/dev/ensure-user.js || echo "[ensure-user] failed (non-fatal)"
      else
        echo "[ensure-user] ADMIN_EMAIL/ADMIN_PASSWORD not set, leaving dashboard unclaimed"
      fi

      # Wire FreeLLMAPI into OpenCode automatically (provider + default model).
      # Needs the unified API key, so it runs only after the server is up.
      node /home/dev/ensure-opencode-config.js || echo "[ensure-opencode-config] failed (non-fatal)"
      # Signal opencode that the config is synced. opencode reads its config
      # once at startup and does not reload, so it must NOT boot before this
      # marker exists or it will serve the stale baked-in default config.
      touch /tmp/opencode-config-synced

      # Periodic WAL checkpoint so dashboard edits land in the main DB file
      # (which tigrisfs syncs to R2) instead of the volatile -wal sidecar.
      (
        while true; do
          sleep 30
          node /home/dev/db-checkpoint.js "$DB_PATH" || true
        done
      ) &
      CHECKPOINT_PID=$!

      # On container stop (rollout), run one final checkpoint so nothing newer
      # than the last interval is lost, then let the server exit.
      trap 'node /home/dev/db-checkpoint.js "$DB_PATH" || true; kill "$SERVER_PID" 2>/dev/null || true' TERM INT
      wait "$SERVER_PID"
      kill "$CHECKPOINT_PID" 2>/dev/null || true
      exit 0
    ) &
  else
    echo "WARNING: R2 mount failed, continuing with ephemeral storage"
  fi
else
  echo "R2 credentials not configured, using ephemeral storage"
fi

# Start OpenCode web server
# Universal creds: username comes from OPENCODE_SERVER_USERNAME (defaults to
# "opencode"), password from OPENCODE_SERVER_PASSWORD. Align the username with
# the universal ADMIN_EMAIL so one login works everywhere.
echo "Starting OpenCode web server..."
if [ -n "$ADMIN_EMAIL" ]; then
  export OPENCODE_SERVER_USERNAME="$ADMIN_EMAIL"
fi

# opencode reads its config once at startup and does NOT reload on change. Wait
# for the freellmapi boot subshell to write the synced config (it sets
# /tmp/opencode-config-synced after wiring the freellmapi provider + model) so
# opencode boots with the correct model/provider instead of the stale baked-in
# default. Bounded wait so opencode still starts if the sync never happens.
# Only applies when R2 is mounted (the symlink exists); on warm boots the R2
# config already contains freellmapi, so the wait is skipped.
if [ -n "$R2_ACCOUNT_ID" ] && [ -L /home/dev/.config/opencode ] && [ ! -f /tmp/opencode-config-synced ]; then
  if grep -q '"freellmapi"' /home/dev/.config/opencode/opencode.json 2>/dev/null; then
    echo "opencode config already synced (freellmapi present)"
  else
    echo "Waiting for opencode config sync before starting opencode..."
    for i in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20 21 22 23 24 25 26 27 28 29 30; do
      if [ -f /tmp/opencode-config-synced ]; then
        echo "opencode config synced (freellmapi provider + model wired)"
        break
      fi
      sleep 2
    done
    if [ ! -f /tmp/opencode-config-synced ]; then
      echo "WARNING: opencode config sync did not complete; starting opencode anyway"
    fi
  fi
fi

exec opencode web --port 4096 --hostname 0.0.0.0
