FROM node:20-bookworm-slim

# Install build/runtime deps:
#  - git, curl, bash, ca-certificates: basics
#  - fuse: R2 mount via tigrisfs
#  - python3, make, g++: compile better-sqlite3 (native module, optional dep)
#    from source at first boot when no prebuilt binary is available
RUN apt-get update && apt-get install -y --no-install-recommends \
    git curl bash fuse ca-certificates python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

# Install tigrisfs (FUSE adapter for R2/S3-compatible storage)
RUN ARCH=$(uname -m) && \
    if [ "$ARCH" = "x86_64" ]; then ARCH="amd64"; fi && \
    if [ "$ARCH" = "aarch64" ]; then ARCH="arm64"; fi && \
    VERSION=$(curl -s https://api.github.com/repos/tigrisdata/tigrisfs/releases/latest | grep -o '"tag_name": "[^"]*' | cut -d'"' -f4) && \
    curl -L "https://github.com/tigrisdata/tigrisfs/releases/download/${VERSION}/tigrisfs_${VERSION#v}_linux_${ARCH}.tar.gz" -o /tmp/tigrisfs.tar.gz && \
    tar -xzf /tmp/tigrisfs.tar.gz -C /usr/local/bin/ && \
    rm /tmp/tigrisfs.tar.gz && \
    chmod +x /usr/local/bin/tigrisfs

# Install OpenCode globally
RUN npm install -g opencode-ai

# Workspace (running as root so the FUSE mount works)
WORKDIR /home/dev
RUN mkdir -p /home/dev/.config/opencode \
             /home/dev/.local/share/opencode

# Copy OpenCode config (uses Zen as provider)
COPY --chown=root:root opencode.json /home/dev/.config/opencode/opencode.json

# Copy startup script (mounts R2, clones+builds+starts freellmapi on boot)
COPY --chown=root:root startup.sh /home/dev/startup.sh
RUN chmod +x /home/dev/startup.sh

# FreeLLMAPI helpers: periodic WAL checkpoint (persists dashboard edits to R2)
# and dashboard account provisioning from the universal admin credentials.
COPY --chown=root:root db-checkpoint.js ensure-user.js /home/dev/

EXPOSE 4096

# Health check stays on OpenCode (4096) so the container is "healthy" the whole
# time freellmapi is building in the background on first boot. A check on 3001
# would roll the deployment back before the build finishes.
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s \
  CMD curl -f http://localhost:4096/global/health || exit 1

ENTRYPOINT ["/home/dev/startup.sh"]
