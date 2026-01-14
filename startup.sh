#!/bin/bash
set -e

cd /home/dev

# Configure git for private repos if token is provided
if [ -n "$GIT_TOKEN" ]; then
  git config --global url."https://${GIT_TOKEN}@github.com/".insteadOf "https://github.com/"
fi

# Clone configured git repos (passed via GIT_REPOS env var)
# Format: "repo1_url,repo2_url,repo3_url"
if [ -n "$GIT_REPOS" ]; then
  IFS=',' read -ra REPOS <<< "$GIT_REPOS"
  for repo in "${REPOS[@]}"; do
    repo_name=$(basename "$repo" .git)
    if [ ! -d "$repo_name" ]; then
      echo "Cloning $repo..."
      git clone "$repo" || echo "Failed to clone $repo"
    else
      echo "Directory $repo_name already exists, skipping clone"
    fi
  done
fi

echo "Starting OpenCode web server..."
# Start OpenCode web server
exec opencode web --port 4096 --hostname 0.0.0.0
