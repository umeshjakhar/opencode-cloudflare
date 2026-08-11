FROM node:20-alpine

# Install dependencies: git for cloning, curl for health checks,
# fuse + tigrisfs for mounting an R2 bucket for persistent storage
RUN apk add --no-cache git curl bash fuse ca-certificates

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

# Copy startup script (mounts R2 and starts server)
COPY --chown=root:root startup.sh /home/dev/startup.sh
RUN chmod +x /home/dev/startup.sh

EXPOSE 4096

HEALTHCHECK --interval=30s --timeout=10s --start-period=30s \
  CMD curl -f http://localhost:4096/global/health || exit 1

ENTRYPOINT ["/home/dev/startup.sh"]
