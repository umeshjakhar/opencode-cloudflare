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
  tigrisfs --endpoint "$R2_ENDPOINT" -f "$R2_BUCKET_NAME" "$R2_MOUNT" &
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

    # Symlink ephemeral paths to the persistent mount
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

    # --- FreeLLMAPI: clone, install, persistent key, .env, build, run -------
    # Server listens on 3001. Worker proxies /freellmapi/* -> 3001.
    #
    # The app's CONFIG persists in R2: it lives in the SQLite DB (freeapi.db).
    # To keep provider keys decryptable across restarts, ENCRYPTION_KEY is
    # persisted too (next to the DB in R2) and reused on every boot.
    # The code itself is ephemeral - re-cloned and rebuilt on each boot.
    #
    # Boot runs in a background subshell so the container (opencode on 4096)
    # stays healthy during the first boot. ALL boot output (clone/install/
    # build/server) goes to the R2 log file so it's visible via
    # /debug/freellmapi-log.
    (
      FREEL=/home/dev/freellmapi
      LOG_FILE=/mnt/r2/.freellmapi/freellmapi.log
      DB_PATH=/mnt/r2/.freellmapi/freeapi.db
      KEY_FILE=/mnt/r2/.freellmapi/encryption_key
      mkdir -p /mnt/r2/.freellmapi
      exec >> "$LOG_FILE" 2>&1

      echo "=== freellmapi boot $(date -u +%FT%TZ) ==="
      if [ ! -d "$FREEL/.git" ]; then
        echo "[1/5] git clone https://github.com/tashfeenahmed/freellmapi.git"
        git clone https://github.com/tashfeenahmed/freellmapi.git "$FREEL" || { echo "git clone FAILED"; exit 1; }
      else
        echo "[1/5] freellmapi already cloned, skipping"
      fi

      cd "$FREEL"

      if [ ! -d node_modules ]; then
        echo "[2/5] npm install (this can take several minutes)"
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
        echo "[4/5] npm run build (VITE_BASE=/freellmapi/)"
        # VITE_BASE makes the dashboard's assets + API calls root at
        # /freellmapi/... so they route through the worker's /freellmapi/* proxy
        # instead of resolving to the domain root (blank page).
        export VITE_BASE=/freellmapi/
        npm run build 2>&1 || { echo "npm run build FAILED"; exit 1; }
      else
        echo "[4/5] server/dist exists, skipping build"
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
echo "Starting OpenCode web server..."
exec opencode web --port 4096 --hostname 0.0.0.0
