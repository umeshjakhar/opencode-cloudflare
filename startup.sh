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
  else
    echo "WARNING: R2 mount failed, continuing with ephemeral storage"
  fi
fi

echo "Starting OpenCode web server..."
# Start OpenCode web server
exec opencode web --port 4096 --hostname 0.0.0.0
