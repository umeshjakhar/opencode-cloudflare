#!/bin/bash
set -e

export HOME=/home/dev
cd /home/dev

# Configure git for private repos if token is provided
if [ -n "$GIT_TOKEN" ]; then
  git config --global url."https://${GIT_TOKEN}@github.com/".insteadOf "https://github.com/"
fi

# --- Persistent storage via R2 + FUSE (tigrisfs) ----------------------------
# When R2 credentials are configured, mount the bucket and symlink the
# ephemeral container paths to it so data survives sleep/restarts.
R2_MOUNT=/mnt/r2

if [ -n "$R2_ACCOUNT_ID" ] && [ -n "$R2_BUCKET_NAME" ] \
   && [ -n "$R2_ACCESS_KEY_ID" ] && [ -n "$R2_SECRET_ACCESS_KEY" ]; then
  echo "Mounting R2 bucket ${R2_BUCKET_NAME} with tigrisfs..."
  mkdir -p "$R2_MOUNT"
  R2_ENDPOINT="https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com"
  tigrisfs --endpoint "$R2_ENDPOINT" -f "$R2_BUCKET_NAME" "$R2_MOUNT" &
  sleep 3

  # Verify the mount is actually up (list the bucket)
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
             "$R2_MOUNT/repos"

    # First boot: seed the config dir from the baked-in image config
    if [ ! -f "$R2_MOUNT/opencode-config/opencode.json" ]; then
      cp /home/dev/.config/opencode/opencode.json "$R2_MOUNT/opencode-config/opencode.json"
    fi

    # Symlink ephemeral paths to the persistent mount
    ln -sfn "$R2_MOUNT/opencode-data"   /home/dev/.local/share/opencode
    ln -sfn "$R2_MOUNT/opencode-config" /home/dev/.config/opencode

    # Background metrics collector — writes container CPU/RAM/disk usage to R2
    # every 5s so the admin dashboard can show realtime workload without exec.
    if [ -d "$R2_MOUNT" ]; then
      (
        # Wait for OpenCode to start
        sleep 10
        # Baseline CPU sample
        PREV_TOTAL=0
        PREV_IDLE=0
        METRICS_FILE="$R2_MOUNT/.container-metrics.json"
        while true; do
          # Memory (in MB)
          MEM_TOTAL_KB=$(awk '/^MemTotal:/ {print $2}' /proc/meminfo 2>/dev/null || echo 0)
          MEM_AVAIL_KB=$(awk '/^MemAvailable:/ {print $2}' /proc/meminfo 2>/dev/null || echo 0)
          MEM_USED_KB=$((MEM_TOTAL_KB - MEM_AVAIL_KB))
          MEM_TOTAL_MB=$((MEM_TOTAL_KB / 1024))
          MEM_USED_MB=$((MEM_USED_KB / 1024))
          MEM_PCT=0
          if [ "$MEM_TOTAL_KB" -gt 0 ]; then
            MEM_PCT=$(awk "BEGIN {printf \"%.1f\", ($MEM_USED_KB*100.0)/$MEM_TOTAL_KB}")
          fi
          # CPU percent from /proc/stat
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
          # Disk (rootfs only - R2 mount is FUSE and shows weird stats)
          DISK_INFO=$(df -PB1 / 2>/dev/null | tail -n1)
          DISK_TOTAL=$(echo "$DISK_INFO" | awk '{print $2}')
          DISK_USED=$(echo "$DISK_INFO" | awk '{print $3}')
          DISK_PCT=0
          if [ "$DISK_TOTAL" -gt 0 ]; then
            DISK_PCT=$(awk "BEGIN {printf \"%.1f\", ($DISK_USED*100.0)/$DISK_TOTAL}")
          fi
          # Load average
          LOAD=$(cat /proc/loadavg 2>/dev/null | awk '{print $1, $2, $3}')
          # Process count + top CPU consumers (brief)
          PROC_COUNT=$(ls /proc 2>/dev/null | grep -c '^[0-9]')
          # Uptime
          UPTIME_S=$(awk '{print int($1)}' /proc/uptime 2>/dev/null || echo 0)
          TS=$(date +%s)
          cat > "$METRICS_FILE" <<JSON
{"timestamp":$TS,"cpu":{"percent":$CPU_PCT},"memory":{"totalMB":$MEM_TOTAL_MB,"usedMB":$MEM_USED_MB,"percent":$MEM_PCT},"disk":{"totalBytes":$DISK_TOTAL,"usedBytes":$DISK_USED,"percent":$DISK_PCT},"load":"$LOAD","processCount":$PROC_COUNT,"uptimeSeconds":$UPTIME_S}
JSON
          sleep 5
        done
      ) &
    fi
  else
    echo "WARNING: R2 mount failed, continuing with ephemeral storage"
  fi
fi

echo "Starting OpenCode web server..."
# Start OpenCode web server
exec opencode web --port 4096 --hostname 0.0.0.0
