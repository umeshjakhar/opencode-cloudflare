export function getAdminHTML(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>OpenCode Container Admin</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <link rel="stylesheet" data-name="vs/editor/editor.main" href="https://cdn.jsdelivr.net/npm/monaco-editor@0.52.2/min/vs/editor/editor.main.min.css">
  <script src="https://cdn.jsdelivr.net/npm/monaco-editor@0.52.2/min/vs/loader.js"></script>
  <style>
    .status-healthy { color: #4ade80; }
    .status-running { color: #facc15; }
    .status-degraded { color: #facc15; }
    .status-stopped { color: #f87171; }
    .status-stopping { color: #fb923c; }
    .status-unknown { color: #9ca3af; }
    .pulse { animation: pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite; }
    @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: .5; } }
    #opencode-config-editor { height: 360px; }
  </style>
</head>
<body class="bg-gray-900 text-white min-h-screen">
  <div class="container mx-auto px-4 py-8 max-w-5xl">
    <!-- Header -->
    <div class="flex items-center justify-between mb-8">
      <div>
        <h1 class="text-3xl font-bold">OpenCode Container Admin</h1>
        <p class="text-gray-400 mt-1">Manage your OpenCode server instance</p>
      </div>
      <div class="flex items-center gap-2">
        <span id="live-indicator" class="w-3 h-3 rounded-full bg-green-500 pulse"></span>
        <span class="text-sm text-gray-400">Live</span>
      </div>
    </div>
    
    <!-- Status Card -->
    <div class="bg-gray-800 rounded-lg p-6 mb-6 border border-gray-700">
      <div class="flex items-center justify-between mb-4">
        <h2 class="text-xl font-semibold">Container Status</h2>
        <button 
          onclick="refreshStatus()" 
          class="text-sm bg-gray-700 hover:bg-gray-600 px-3 py-1 rounded transition-colors"
        >
          Refresh
        </button>
      </div>
      <div id="status" class="space-y-3">
        <div class="flex items-center gap-2">
          <div class="w-4 h-4 rounded-full bg-gray-600 animate-pulse"></div>
          <span class="text-gray-400">Loading status...</span>
        </div>
</div>
    </div>

    <!-- Services Health -->
    <div class="bg-gray-800 rounded-lg p-6 mb-6 border border-gray-700">
      <div class="flex items-center justify-between mb-4">
        <h2 class="text-xl font-semibold">Services Health</h2>
        <div class="flex items-center gap-3">
          <span id="services-timestamp" class="text-xs text-gray-500">no data</span>
          <button 
            onclick="refreshServices()" 
            class="text-sm bg-gray-700 hover:bg-gray-600 px-3 py-1 rounded transition-colors"
          >
            Refresh
          </button>
        </div>
      </div>
      <div id="services" class="space-y-2">
        <p class="text-gray-400">Loading services health...</p>
      </div>
    </div>

    <!-- Live Workload -->
    <div class="bg-gray-800 rounded-lg p-6 mb-6 border border-gray-700">
      <div class="flex items-center justify-between mb-4">
        <h2 class="text-xl font-semibold">Live Workload</h2>
        <div class="flex items-center gap-3">
          <span id="metrics-timestamp" class="text-xs text-gray-500">no data</span>
          <button onclick="refreshMetrics()" class="text-sm bg-gray-700 hover:bg-gray-600 px-3 py-1 rounded transition-colors">Refresh</button>
        </div>
      </div>
      <div id="metrics" class="space-y-4">
        <p class="text-gray-400">Loading container metrics...</p>
      </div>
    </div>

    <!-- Controls -->
    <div class="bg-gray-800 rounded-lg p-6 mb-6 border border-gray-700">
      <h2 class="text-xl font-semibold mb-4">Container Controls</h2>
      <div class="flex gap-4 flex-wrap">
        <button 
          onclick="startContainer()" 
          id="btn-start"
          class="bg-green-600 hover:bg-green-700 disabled:bg-gray-600 disabled:cursor-not-allowed px-6 py-2.5 rounded font-medium transition-colors flex items-center gap-2"
        >
          <svg class="w-4 h-4" fill="currentColor" viewBox="0 0 20 20"><path d="M6.3 2.841A1.5 1.5 0 004 4.11V15.89a1.5 1.5 0 002.3 1.269l9.344-5.89a1.5 1.5 0 000-2.538L6.3 2.84z"/></svg>
          Start
        </button>
        <button 
          onclick="stopContainer()" 
          id="btn-stop"
          class="bg-yellow-600 hover:bg-yellow-700 disabled:bg-gray-600 disabled:cursor-not-allowed px-6 py-2.5 rounded font-medium transition-colors flex items-center gap-2"
        >
          <svg class="w-4 h-4" fill="currentColor" viewBox="0 0 20 20"><path d="M5.75 3A1.75 1.75 0 004 4.75v10.5c0 .966.784 1.75 1.75 1.75h8.5A1.75 1.75 0 0016 15.25V4.75A1.75 1.75 0 0014.25 3h-8.5z"/></svg>
          Stop
        </button>
        <button 
          onclick="restartContainer()" 
          id="btn-restart"
          class="bg-orange-600 hover:bg-orange-700 disabled:bg-gray-600 disabled:cursor-not-allowed px-6 py-2.5 rounded font-medium transition-colors flex items-center gap-2"
        >
          <svg class="w-4 h-4" fill="currentColor" viewBox="0 0 20 20"><path fill-rule="evenodd" d="M15.312 11.424a5.5 5.5 0 01-9.201 2.466l-.312-.311h2.433a.75.75 0 000-1.5H3.989a.75.75 0 00-.75.75v4.242a.75.75 0 001.5 0v-2.43l.31.31a7 7 0 0011.712-3.138.75.75 0 00-1.449-.39zm1.23-3.723a.75.75 0 00.219-.53V2.929a.75.75 0 00-1.5 0v2.43l-.31-.31A7 7 0 003.239 8.188a.75.75 0 101.448.389 5.5 5.5 0 019.201-2.466l.312.311h-2.433a.75.75 0 000 1.5h4.243a.75.75 0 00.53-.219z" clip-rule="evenodd"/></svg>
          Restart
        </button>
      </div>
      <div id="action-result" class="mt-4 text-sm min-h-[24px]"></div>
    </div>
    
    <!-- Sleep & Power Management -->
    <div class="bg-gray-800 rounded-lg p-6 mb-6 border border-gray-700">
      <h2 class="text-xl font-semibold mb-1">Sleep &amp; Power Management</h2>
      <p class="text-gray-400 text-sm mb-4">Control idle timeout and keep-warm to manage cost. Billing only accrues while the container is actively running.</p>

      <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
        <!-- Auto-sleep -->
        <div class="bg-gray-900/50 rounded-lg p-4">
          <h3 class="font-medium mb-3 text-gray-300">Auto-Sleep Timer</h3>
          <div class="space-y-3">
            <div class="flex justify-between items-center">
              <span class="text-gray-400">Current idle timeout:</span>
              <span id="sleep-after" class="font-mono text-sm bg-gray-800 px-2 py-1 rounded">-</span>
            </div>
            <div>
              <label class="block text-sm text-gray-400 mb-1" for="sleep-input">Custom value</label>
              <div class="flex gap-2">
                <input
                  id="sleep-input"
                  type="text"
                  placeholder="e.g. 15m, 2h, 1d"
                  class="flex-1 bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm focus:outline-none focus:border-blue-500"
                />
                <button
                  onclick="saveSleep()"
                  class="bg-blue-600 hover:bg-blue-700 px-4 py-2 rounded text-sm transition-colors whitespace-nowrap"
                >
                  Save
                </button>
              </div>
              <p class="text-xs text-gray-500 mt-1">Accepts seconds, or suffixes like <code class="text-gray-400">m</code>, <code class="text-gray-400">h</code>, <code class="text-gray-400">d</code>.</p>
            </div>
            <div>
              <span class="block text-sm text-gray-400 mb-2">Presets</span>
              <div class="flex flex-wrap gap-2" id="sleep-presets"></div>
            </div>
          </div>
        </div>

        <!-- Keep warm -->
        <div class="bg-gray-900/50 rounded-lg p-4">
          <h3 class="font-medium mb-3 text-gray-300">Keep Warm</h3>
          <div class="space-y-3">
            <div class="flex items-center justify-between">
              <div>
                <p class="text-sm text-gray-300">Ping every 10 minutes</p>
                <p class="text-xs text-gray-500 mt-1">On: container stays awake. Off: sleeps after idle timeout.</p>
              </div>
              <label class="relative inline-flex items-center cursor-pointer">
                <input type="checkbox" id="keepwarm-toggle" class="sr-only peer" onchange="toggleKeepWarm()">
                <div class="w-11 h-6 bg-gray-600 peer-focus:outline-none rounded-full peer peer-checked:bg-green-600 transition-colors after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:after:translate-x-full"></div>
              </label>
            </div>
            <div id="keepwarm-status" class="text-xs text-gray-400">Loading...</div>
            <div class="text-xs text-gray-500 border-t border-gray-800 pt-3">
              <p class="mb-1"><span class="text-gray-300">Cost note:</span> keep-warm means the container never sleeps, so it is billed 24/7. Leave it off if you want to save cost.</p>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Instance Size -->
    <div class="bg-gray-800 rounded-lg p-6 mb-6 border border-gray-700">
      <div class="flex items-center justify-between mb-4">
        <h2 class="text-xl font-semibold">Instance Size</h2>
        <button
          onclick="refreshInstanceType()"
          class="text-sm bg-gray-700 hover:bg-gray-600 px-3 py-1 rounded transition-colors"
        >
          Refresh
        </button>
      </div>
      <p class="text-gray-400 text-sm mb-4">CPU / RAM / disk allocated to the container. Changing the size triggers a rolling rollout (a few seconds).</p>
      <div id="instance-type" class="space-y-4">
        <p class="text-gray-400">Loading instance types...</p>
      </div>
    </div>

    <!-- Configuration -->
    <div class="bg-gray-800 rounded-lg p-6 mb-6 border border-gray-700">
      <div class="flex items-center justify-between mb-4">
        <h2 class="text-xl font-semibold">Configuration</h2>
        <button 
          onclick="refreshConfig()" 
          class="text-sm bg-gray-700 hover:bg-gray-600 px-3 py-1 rounded transition-colors"
        >
          Refresh
        </button>
      </div>
      <div id="config" class="space-y-4">
        <p class="text-gray-400">Loading configuration...</p>
      </div>
    </div>

    <!-- OpenCode Configuration Editor -->
    <div class="bg-gray-800 rounded-lg p-6 mb-6 border border-gray-700">
      <div class="flex items-center justify-between mb-3">
        <h3 class="font-medium text-gray-300">OpenCode Configuration</h3>
        <button
          onclick="loadOpenCodeConfig()"
          class="text-sm bg-gray-700 hover:bg-gray-600 px-3 py-1 rounded transition-colors"
        >
          Refresh
        </button>
      </div>
      <div class="flex items-center justify-between mb-3">
        <span class="text-gray-400 text-sm">Model:</span>
        <span id="opencode-config-model" class="font-mono text-xs bg-gray-800 px-2 py-1 rounded text-gray-300">opencode/claude-sonnet-4</span>
      </div>
      <div id="opencode-config-editor" class="w-full border border-gray-700 rounded-lg overflow-hidden bg-gray-900/50"></div>
      <div class="flex items-center justify-between mt-3">
        <div id="opencode-config-msg" class="text-xs text-gray-500"></div>
        <div class="flex gap-2">
          <button
            onclick="formatOpenCodeConfig()"
            class="text-sm bg-gray-700 hover:bg-gray-600 px-4 py-2 rounded transition-colors"
          >
            Format
          </button>
          <button
            onclick="saveOpenCodeConfig()"
            class="text-sm bg-blue-600 hover:bg-blue-700 px-4 py-2 rounded transition-colors"
          >
            Save
          </button>
          <button
            onclick="saveOpenCodeConfig(true)"
            class="text-sm bg-green-700 hover:bg-green-600 px-4 py-2 rounded transition-colors"
          >
            Save &amp; Restart
          </button>
        </div>
      </div>
    </div>

    <!-- Billing & Usage -->
    <div class="bg-gray-800 rounded-lg p-6 mb-6 border border-gray-700">
      <div class="flex items-center justify-between mb-4">
        <h2 class="text-xl font-semibold">Billing &amp; Usage</h2>
        <div class="flex items-center gap-2">
          <span class="text-xs text-gray-400">Last 30 days</span>
          <button 
            onclick="refreshBilling()" 
            class="text-sm bg-gray-700 hover:bg-gray-600 px-3 py-1 rounded transition-colors"
          >
            Refresh
          </button>
        </div>
      </div>
      <div id="billing" class="space-y-4">
        <p class="text-gray-400">Loading billing data...</p>
      </div>
    </div>

    <!-- Quick Links -->
    <div class="bg-gray-800 rounded-lg p-6 mb-6 border border-gray-700">
      <h2 class="text-xl font-semibold mb-4">Quick Links</h2>
      <div class="flex gap-4 flex-wrap">
        <a 
          href="/" 
          target="_blank"
          class="bg-blue-600 hover:bg-blue-700 px-4 py-2 rounded transition-colors flex items-center gap-2"
        >
          <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"/></svg>
          Open OpenCode Web UI
        </a>
        <a 
          href="/global/health" 
          target="_blank"
          class="bg-gray-700 hover:bg-gray-600 px-4 py-2 rounded transition-colors flex items-center gap-2"
        >
          <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
          Health Check
        </a>
        <a 
          href="/doc" 
          target="_blank"
          class="bg-gray-700 hover:bg-gray-600 px-4 py-2 rounded transition-colors flex items-center gap-2"
        >
          <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/></svg>
          API Docs
        </a>
      </div>
    </div>
    
    <!-- Footer -->
    <div class="text-center text-gray-500 text-sm mt-8">
      <p>OpenCode on Cloudflare Containers</p>
    </div>
  </div>

  <script>
    const API_BASE = '/admin/api';
    let autoRefreshInterval = null;
    
    async function fetchAPI(endpoint, options = {}) {
      try {
        const response = await fetch(API_BASE + endpoint, {
          ...options,
          headers: {
            'Content-Type': 'application/json',
            ...options.headers,
          },
        });
        if (!response.ok) {
          const text = await response.text();
          throw new Error(text || response.statusText);
        }
        return await response.json();
      } catch (error) {
        console.error('API Error:', error);
        return { error: error.message };
      }
    }
    
    function formatUptime(ms) {
      if (!ms) return 'N/A';
      const seconds = Math.floor(ms / 1000);
      const minutes = Math.floor(seconds / 60);
      const hours = Math.floor(minutes / 60);
      const days = Math.floor(hours / 24);
      
      if (days > 0) return days + 'd ' + (hours % 24) + 'h';
      if (hours > 0) return hours + 'h ' + (minutes % 60) + 'm';
      if (minutes > 0) return minutes + 'm ' + (seconds % 60) + 's';
      return seconds + 's';
    }

    function fmtBytes(bytes) {
      if (!bytes || bytes === 0) return '0 B';
      const units = ['B', 'KB', 'MB', 'GB', 'TB'];
      const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
      return (bytes / Math.pow(1024, i)).toFixed(2) + ' ' + units[i];
    }
    
    async function refreshStatus() {
      const data = await fetchAPI('/status');
      const statusDiv = document.getElementById('status');
      
      if (data.error) {
        statusDiv.innerHTML = \`
          <div class="bg-red-900/30 border border-red-700 rounded p-3">
            <p class="text-red-400 font-medium">Error fetching status</p>
            <p class="text-red-300 text-sm mt-1">\${data.error}</p>
          </div>
        \`;
        updateButtons('unknown');
        return;
      }
      
      const statusClass = 'status-' + (data.status || 'unknown');
      const isRunning = data.status === 'running' || data.status === 'healthy';
      
      statusDiv.innerHTML = \`
        <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div class="bg-gray-900/50 rounded-lg p-4">
            <div class="flex items-center gap-3 mb-3">
              <div class="w-4 h-4 rounded-full \${isRunning ? 'bg-green-500' : 'bg-red-500'}"></div>
              <span class="text-lg font-semibold \${statusClass}">\${(data.status || 'unknown').charAt(0).toUpperCase() + (data.status || 'unknown').slice(1)}</span>
            </div>
            <div class="space-y-2 text-sm">
              <div class="flex justify-between">
                <span class="text-gray-400">Running:</span>
                <span>\${data.running ? 'Yes' : 'No'}</span>
              </div>
              <div class="flex justify-between">
                <span class="text-gray-400">Uptime:</span>
                <span>\${formatUptime(data.uptime)}</span>
              </div>
              \${data.exitCode !== null && data.exitCode !== undefined ? \`
              <div class="flex justify-between">
                <span class="text-gray-400">Exit Code:</span>
                <span class="text-red-400">\${data.exitCode}</span>
              </div>
              \` : ''}
            </div>
          </div>
          
          <div class="bg-gray-900/50 rounded-lg p-4">
            <h3 class="font-medium mb-3 text-gray-300">Container Info</h3>
            <div class="space-y-2 text-sm">
              <div class="flex justify-between">
                <span class="text-gray-400">Port:</span>
                <span>\${data.defaultPort}</span>
              </div>
              <div class="flex justify-between">
                <span class="text-gray-400">Sleep After:</span>
                <span>\${data.sleepAfter}</span>
              </div>
              <div class="flex justify-between">
                <span class="text-gray-400">Internet:</span>
                <span>\${data.enableInternet ? 'Enabled' : 'Disabled'}</span>
              </div>
              <div class="flex justify-between">
                <span class="text-gray-400">Last Change:</span>
                <span class="text-xs">\${data.lastChangeFormatted || 'N/A'}</span>
              </div>
            </div>
          </div>
        </div>
      \`;
      
      updateButtons(data.status, data.running);
    }
    
    function updateButtons(status, running) {
      const btnStart = document.getElementById('btn-start');
      const btnStop = document.getElementById('btn-stop');
      const btnRestart = document.getElementById('btn-restart');
      
      const isRunning = status === 'running' || status === 'healthy';
      const isStopping = status === 'stopping';
      
      btnStart.disabled = isRunning || isStopping;
      btnStop.disabled = !isRunning || isStopping;
      btnRestart.disabled = isStopping;
    }
    
    async function refreshServices() {
      const data = await fetchAPI('/services');
      const div = document.getElementById('services');
      const tsSpan = document.getElementById('services-timestamp');
      
      if (data.error) {
        div.innerHTML = \`
          <div class="bg-red-900/30 border border-red-700 rounded p-3">
            <p class="text-red-400 font-medium">Error fetching services health</p>
            <p class="text-red-300 text-sm mt-1">\${data.error}</p>
          </div>
        \`;
        if (tsSpan) tsSpan.textContent = 'error';
        return;
      }
      
      if (tsSpan) {
        const ago = Math.max(0, Math.floor(Date.now() / 1000) - Math.floor((data.checkedAt || 0) / 1000));
        tsSpan.textContent = ago < 2 ? 'just now' : ago + 's ago';
      }
      
      if (!data.services || !data.services.length) {
        div.innerHTML = '<p class="text-gray-400">No service data</p>';
        return;
      }
      
      const serviceUrls = {
        'opencode-server': '/global/health',
        'opencode-webui': '/',
        'freellmapi-server': '/freellmapi/api/auth/status',
        'freellmapi-webui': '/freellmapi/',
      };
      const rows = data.services.map(s => {
        const status = s.status || 'down';
        const dotClass = status === 'up' ? 'bg-green-500'
          : status === 'degraded' ? 'bg-yellow-500'
          : 'bg-red-500';
        const labelClass = 'status-' + status;
        const note = s.note ? ' <span class="text-xs text-gray-500">(' + s.note + ')</span>' : '';
        const url = serviceUrls[s.id];
        const nameHtml = url
          ? '<a href="' + url + '" target="_blank" class="text-sm font-medium hover:text-blue-400 hover:underline flex items-center gap-1.5 transition-colors" title="Open in new tab">' + s.name + '<svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"/></svg></a>'
          : '<span class="text-sm font-medium">' + s.name + '</span>';
        return \`
          <div class="flex items-center justify-between bg-gray-900/50 rounded-lg px-4 py-3 border border-gray-800">
            <div class="flex items-center gap-3">
              <div class="w-3 h-3 rounded-full \${dotClass}\${status === 'up' ? '' : ' pulse'}"></div>
              \${nameHtml}
            </div>
            <div class="flex items-center gap-4 text-sm">
              <span class="text-xs text-gray-500">\${s.statusCode !== null && s.statusCode !== undefined ? 'HTTP ' + s.statusCode : ''}</span>
              <span class="text-xs text-gray-500">\${s.responseTimeMs !== null && s.responseTimeMs !== undefined ? s.responseTimeMs + 'ms' : ''}</span>
              <span class="font-semibold \${labelClass}">\${status.toUpperCase()}</span>
              \${note}
            </div>
          </div>
        \`;
      }).join('');
      
      div.innerHTML = rows;
    }
    
    async function refreshConfig() {
      const data = await fetchAPI('/config');
      const configDiv = document.getElementById('config');
      
      if (data.error) {
        configDiv.innerHTML = '<p class="text-red-400">Error: ' + data.error + '</p>';
        return;
      }
      configDiv.innerHTML = \`
        <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div class="bg-gray-900/50 rounded-lg p-4">
            <h3 class="font-medium mb-3 text-gray-300">Secrets Status</h3>
            <div class="space-y-2 text-sm">
              <div class="flex justify-between items-center">
                <span class="text-gray-400">Server Password:</span>
                <span class="\${data.envVars?.hasServerPassword ? 'text-green-400' : 'text-red-400'}">\${data.envVars?.hasServerPassword ? '✓ Set' : '✗ Not set'}</span>
              </div>
              <div class="flex justify-between items-center">
                <span class="text-gray-400">OpenCode API Key:</span>
                <span class="\${data.envVars?.hasApiKey ? 'text-green-400' : 'text-red-400'}">\${data.envVars?.hasApiKey ? '✓ Set' : '✗ Not set'}</span>
              </div>
              <div class="flex justify-between items-center">
                <span class="text-gray-400">Git Token:</span>
                <span class="\${data.envVars?.hasGitToken ? 'text-green-400' : 'text-gray-500'}">\${data.envVars?.hasGitToken ? '✓ Set' : '○ Not set'}</span>
              </div>
              <div class="flex justify-between items-center">
                <span class="text-gray-400">Admin Password:</span>
                <span class="\${data.envVars?.hasAdminPassword ? 'text-green-400' : 'text-yellow-400'}">\${data.envVars?.hasAdminPassword ? '✓ Set' : '○ Using server password'}</span>
              </div>
            </div>
          </div>
          
          <div class="bg-gray-900/50 rounded-lg p-4">
            <h3 class="font-medium mb-3 text-gray-300">Persistent Storage</h3>
            <div class="text-sm">
              <div class="flex justify-between items-center">
                <span class="text-gray-400">R2 Bucket:</span>
                <span class="text-blue-400">opencode-persistent</span>
              </div>
              <div class="flex justify-between items-center mt-2">
                <span class="text-gray-400">Repos:</span>
                <span class="text-gray-300">/mnt/r2/repos</span>
              </div>
            </div>
          </div>
        </div>
      \`;
    }
    
    const SLEEP_PRESETS = ['10m', '30m', '1h', '6h', '24h'];

    let openCodeEditor = null;
    let openCodeEditorReady = false;

    function initOpenCodeEditor() {
      const container = document.getElementById('opencode-config-editor');
      const msg = document.getElementById('opencode-config-msg');
      if (!container) return;
      if (typeof require === 'undefined' || typeof require.config !== 'function') {
        container.innerHTML = '<textarea id="opencode-config-editor-textarea" rows="14" spellcheck="false" class="w-full bg-gray-800 p-3 font-mono text-xs text-gray-200 focus:outline-none" placeholder="Editor failed to load. Using basic editor."></textarea>';
        openCodeEditorReady = true;
        return;
      }
      require.config({ paths: { vs: 'https://cdn.jsdelivr.net/npm/monaco-editor@0.52.2/min/vs' } });
      require(['vs/editor/editor.main'], function () {
        openCodeEditor = monaco.editor.create(container, {
          value: '',
          language: 'json',
          theme: 'vs-dark',
          automaticLayout: true,
          minimap: { enabled: false },
          fontSize: 12,
          tabSize: 2,
          scrollBeyondLastLine: false,
          folding: true,
          formatOnPaste: true,
          wordWrap: 'off',
        });
        openCodeEditorReady = true;
        loadOpenCodeSchema();
        loadOpenCodeConfig();
      }, function () {
        container.innerHTML = '<textarea id="opencode-config-editor-textarea" rows="14" spellcheck="false" class="w-full bg-gray-800 p-3 font-mono text-xs text-gray-200 focus:outline-none" placeholder="Editor failed to load. Using basic editor."></textarea>';
        openCodeEditorReady = true;
        loadOpenCodeConfig();
      });
    }

    function openCodeEditorValue() {
      const ta = document.getElementById('opencode-config-editor-textarea');
      if (ta) return ta.value;
      if (openCodeEditor && openCodeEditorReady) return openCodeEditor.getValue();
      return '';
    }

    function openCodeEditorSetValue(value) {
      const ta = document.getElementById('opencode-config-editor-textarea');
      if (ta) { ta.value = value; return; }
      if (openCodeEditor && openCodeEditorReady) openCodeEditor.setValue(value || '');
    }

    function formatOpenCodeConfig() {
      if (!openCodeEditor || !openCodeEditorReady) return;
      const action = openCodeEditor.getAction('editor.action.formatDocument');
      if (action) action.run();
    }

    function loadOpenCodeSchema() {
      if (typeof monaco === 'undefined' || !monaco.languages?.json?.jsonDefaults) return;
      fetch('/admin/api/opencode-schema')
        .then(function (res) { return res.json(); })
        .then(function (schema) {
          if (schema && schema.error) throw new Error(schema.error);
          monaco.languages.json.jsonDefaults.setDiagnosticsOptions({
            validate: true,
            allowComments: true,
            schemas: [{
              uri: 'https://opencode.ai/config.json',
              fileMatch: ['*'],
              schema: schema,
            }],
          });
        })
        .catch(function (err) {
          console.error('Schema load failed:', err);
          monaco.languages.json.jsonDefaults.setDiagnosticsOptions({
            validate: true,
            allowComments: true,
            schemas: [],
          });
        });
    }

    async function loadOpenCodeConfig() {
      const msg = document.getElementById('opencode-config-msg');
      if (msg) msg.textContent = '';
      const data = await fetchAPI('/opencode-config');
      if (data.error) {
        if (msg) {
          msg.textContent = 'Error: ' + data.error;
          msg.className = 'text-xs text-red-400';
        }
        return;
      }
      openCodeEditorSetValue(data.content || '');
      const modelEl = document.getElementById('opencode-config-model');
      if (modelEl && data.content) {
        try {
          const parsed = JSON.parse(data.content);
          modelEl.textContent = parsed.model || 'none set';
          modelEl.className =
            'font-mono text-xs bg-gray-800 px-2 py-1 rounded ' +
            (parsed.model ? 'text-green-400' : 'text-yellow-400');
        } catch {
          modelEl.textContent = 'unparseable';
        }
      }
      if (msg) {
        msg.textContent = data.persisted
          ? 'Editing persisted opencode.json (R2). Changes apply on restart.'
          : 'No persisted config yet - saving will create it.';
        msg.className = 'text-xs text-gray-500';
      }
    }

    async function saveOpenCodeConfig(restart = false) {
      const msg = document.getElementById('opencode-config-msg');
      if (!msg) return;
      const content = openCodeEditorValue();
      if (!content) {
        msg.textContent = 'Invalid JSON: content is empty';
        msg.className = 'text-xs text-red-400';
        return;
      }
      try {
        JSON.parse(content);
      } catch (e) {
        msg.textContent = 'Invalid JSON: ' + e.message;
        msg.className = 'text-xs text-red-400';
        return;
      }
      const data = await fetchAPI('/opencode-config', {
        method: 'POST',
        body: JSON.stringify({ content }),
      });
      if (data.error) {
        msg.textContent = 'Save failed: ' + data.error;
        msg.className = 'text-xs text-red-400';
        return;
      }
      msg.textContent = data.message || 'Configuration saved';
      msg.className = 'text-xs text-green-400';
      if (restart) {
        await restartContainer();
      }
    }

    async function refreshPower() {
      const sleepData = await fetchAPI('/sleep');
      const warmData = await fetchAPI('/keepwarm');

      if (!sleepData.error) {
        document.getElementById('sleep-after').textContent = sleepData.sleepAfter || 'unknown';
        renderSleepPresets(sleepData.sleepAfter || '');
      }
      if (!warmData.error) {
        const enabled = !!warmData.enabled;
        document.getElementById('keepwarm-toggle').checked = enabled;
        document.getElementById('keepwarm-status').textContent = enabled
          ? 'Keep-warm is ON - container stays awake (billed continuously).'
          : 'Keep-warm is OFF - container sleeps after idle timeout.';
      }
    }

    function renderSleepPresets(current) {
      const container = document.getElementById('sleep-presets');
      container.innerHTML = SLEEP_PRESETS.map(preset => {
        const active = current === preset;
        return '<button onclick="setSleepPreset(\\'' + preset + '\\')" class="text-xs px-3 py-1.5 rounded transition-colors ' +
          (active ? 'bg-blue-600 text-white' : 'bg-gray-700 hover:bg-gray-600 text-gray-300') + '">' + preset + '</button>';
      }).join('');
    }

    function setSleepPreset(value) {
      document.getElementById('sleep-input').value = value;
      saveSleep();
    }

    async function saveSleep() {
      const value = document.getElementById('sleep-input').value.trim();
      if (!value) {
        showActionResult('Please enter an idle timeout', 'error');
        return;
      }
      const data = await fetchAPI('/sleep', {
        method: 'POST',
        body: JSON.stringify({ sleepAfter: value }),
      });
      if (data.error) {
        showActionResult('Sleep timer: ' + data.error, 'error');
        return;
      }
      showActionResult('Auto-sleep set to ' + data.sleepAfter, true);
      await refreshPower();
    }

    async function toggleKeepWarm() {
      const enabled = document.getElementById('keepwarm-toggle').checked;
      const data = await fetchAPI('/keepwarm', {
        method: 'POST',
        body: JSON.stringify({ enabled }),
      });
      if (data.error) {
        document.getElementById('keepwarm-toggle').checked = !enabled;
        showActionResult('Keep-warm: ' + data.error, 'error');
        return;
      }
      showActionResult(enabled ? 'Keep-warm enabled' : 'Keep-warm disabled', true);
      await refreshPower();
    }

    async function startContainer() {
      disableAllButtons();
      showActionResult('Starting container...', 'info');
      const data = await fetchAPI('/start', { method: 'POST' });
      showActionResult(data.message || data.error, !data.error);
      setTimeout(refreshStatus, 2000);
    }
    
    async function stopContainer() {
      disableAllButtons();
      showActionResult('Stopping container...', 'info');
      const data = await fetchAPI('/stop', { method: 'POST' });
      showActionResult(data.message || data.error, !data.error);
      setTimeout(refreshStatus, 2000);
    }
    
    async function restartContainer() {
      disableAllButtons();
      showActionResult('Restarting container (this may take a moment)...', 'info');
      const data = await fetchAPI('/restart', { method: 'POST' });
      showActionResult(data.message || data.error, !data.error);
      setTimeout(refreshStatus, 5000);
    }
    
    function disableAllButtons() {
      document.getElementById('btn-start').disabled = true;
      document.getElementById('btn-stop').disabled = true;
      document.getElementById('btn-restart').disabled = true;
    }
    
    function showActionResult(message, successOrType = true) {
      const resultDiv = document.getElementById('action-result');
      let colorClass = 'text-green-400';
      
      if (successOrType === 'info') {
        colorClass = 'text-blue-400';
      } else if (successOrType === false || successOrType === 'error') {
        colorClass = 'text-red-400';
      }
      
      resultDiv.className = 'mt-4 text-sm ' + colorClass;
      resultDiv.textContent = message;
      
      // Clear message after 10 seconds
      setTimeout(() => {
        if (resultDiv.textContent === message) {
          resultDiv.textContent = '';
        }
      }, 10000);
    }
    
    async function refreshBilling() {
      const data = await fetchAPI('/billing');
      const div = document.getElementById('billing');

      if (data.error) {
        div.innerHTML = \`
          <div class="bg-red-900/30 border border-red-700 rounded p-3">
            <p class="text-red-400 font-medium">Error fetching billing data</p>
            <p class="text-red-300 text-sm mt-1">\${data.error}</p>
          </div>
        \`;
        return;
      }

      const currency = data.currency || 'USD';
      const fmtMoney = (n) => \`\${currency} \${Number(n || 0).toFixed(2)}\`;

      const sub = data.subscription || { plan: 'Workers Paid', baseFee: 5 };
      const baseFee = Number(sub.baseFee) || 5;
      const estTotal = Math.round((baseFee + (data.totalBilled || 0)) * 100) / 100;

      const r2Block = data.r2Usage ? \`
        <div class="flex justify-between">
          <span class="text-gray-400">R2 storage:</span>
          <span class="text-gray-300">\${data.r2Usage.payloadSizeFormatted} (\${data.r2Usage.objectCount} objects)</span>
        </div>
      \` : '';

      const workerBlock = data.workerStats ? \`
        <div class="flex justify-between">
          <span class="text-gray-400">Worker requests:</span>
          <span class="text-gray-300">\${data.workerStats.requests.toLocaleString()} (\${data.workerStats.errors} errors, p50 CPU \${data.workerStats.cpuTimeP50Ms}ms)</span>
        </div>
      \` : '';

      let serviceRows = (data.services || []).map(s => {
        const hasFree = !!s.freeTier;
        const billed = s.billedCost > 0;
        
        let barHtml = '';
        let infoHtml = '';
        
        if (hasFree) {
          const limit = s.freeTier.limit;
          const consumed = s.consumed;
          const maxVal = Math.max(limit, consumed, 1);
          
          const greenPct = (s.freeTier.withinFree / maxVal) * 100;
          const purplePct = ((limit - s.freeTier.withinFree) / maxVal) * 100;
          const redPct = (s.freeTier.overFree / maxVal) * 100;
          const limitPct = (limit / maxVal) * 100;
          
          const over = s.freeTier.overFree > 0;
          
          // Free plan tick (orange dashed) - position based on freePlan.limit
          let freePlanTickHtml = '';
          const fp = s.freeTier.freePlan;
          if (fp) {
            if (fp.limit > 0) {
              const fpPct = (fp.limit / maxVal) * 100;
              freePlanTickHtml = \`<div class="absolute h-full w-[2px] bg-orange-400 opacity-90" style="left: calc(\${fpPct}% - 1px)" title="Free plan limit: \${fp.display}"></div>\`;
            } else if (!fp.onFree) {
              // Paid-only feature: show tiny orange marker at left edge
              freePlanTickHtml = \`<div class="absolute h-full w-[2px] bg-orange-400 opacity-90 left-0" title="Not available on Free plan"></div>\`;
            }
          }
          
          barHtml = \`
            <div class="relative h-3.5 rounded-full bg-gray-700/50 overflow-hidden w-full my-1.5 border border-gray-700">
              <!-- Purple: Remaining paid-tier allowance -->
              <div class="absolute h-full bg-purple-500 rounded-full" style="width: \${purplePct}%"></div>
              <!-- Green: Used within allowance -->
              <div class="absolute inset-y-0 left-0 h-full bg-green-500 rounded-full" style="width: \${greenPct}%"></div>
              <!-- Red: Beyond allowance (billed overage) -->
              <div class="absolute inset-y-0 h-full bg-red-500" style="left: \${limitPct}%; width: \${redPct}%"></div>
              <!-- Tick marker for the Paid allowance limit -->
              <div class="absolute h-full w-[2.5px] bg-gray-100 opacity-90" style="left: calc(\${limitPct}% - 1.25px)" title="Paid-tier allowance: \${s.freeTier.display}"></div>
              <!-- Tick marker for the Free plan limit -->
              \${freePlanTickHtml}
            </div>
          \`;
          
          // Build the right-side info: "X left" or "Over by X" or free-plan note
          let rightStatus = '';
          if (fp && fp.needsPaid) {
            rightStatus = \`<span class="text-orange-300 font-medium">Needs Paid plan</span>\`;
          } else if (over) {
            rightStatus = \`<span class="text-red-400 font-medium">Over by \${s.freeTier.displayOver} \${s.freeTier.displayUnit}</span>\`;
          } else {
            rightStatus = \`<span class="text-purple-400 font-medium">\${s.freeTier.displayRemaining} \${s.freeTier.displayUnit} left</span>\`;
          }
          
          let leftStatus = \`Used: <strong class="text-gray-200">\${s.freeTier.displayConsumed} \${s.freeTier.displayUnit}</strong> / \${s.freeTier.display}\`;
          if (fp) {
            leftStatus += \` &middot; Free plan: <strong class="text-gray-300">\${fp.display}</strong>\`;
          }
          
          infoHtml = \`
            <div class="flex justify-between text-xs text-gray-400 mt-1">
              <span>\${leftStatus}</span>
              \${rightStatus}
            </div>
          \`;
        } else {
          const maxVal = Math.max(s.consumed, 1);
          const greenPct = (s.consumed / maxVal) * 100;
          barHtml = \`
            <div class="relative h-3.5 rounded-full bg-gray-700/50 overflow-hidden w-full my-1.5 border border-gray-700">
              <div class="absolute h-full bg-green-500 rounded-full" style="width: 100%"></div>
            </div>
          \`;
          infoHtml = \`
            <div class="flex justify-between text-xs text-gray-400 mt-1">
              <span>Used: <strong class="text-gray-200">\${s.consumedFormatted}</strong></span>
              <span>No allowance data</span>
            </div>
          \`;
        }
        
        return \`
          <div class="bg-gray-900/40 border border-gray-800 rounded-lg p-3.5 mb-2.5">
            <div class="flex justify-between text-sm">
              <span class="text-gray-300 font-medium truncate pr-2" title="\${s.name}">\${s.name}</span>
              <span class="\${billed ? 'text-yellow-400 font-bold' : 'text-gray-500'} whitespace-nowrap">\${fmtMoney(s.billedCost)}</span>
            </div>
            \${barHtml}
            \${infoHtml}
          </div>
        \`;
      }).join('');

      // Add R2 storage as its own bar (R2 isn't in billable-usage)
      if (data.r2Usage) {
        const r2 = data.r2Usage;
        const maxBytes = Math.max(r2.freePlanLimitBytes, r2.payloadSizeBytes, 1);
        const greenPct = (Math.min(r2.payloadSizeBytes, r2.freePlanLimitBytes) / maxBytes) * 100;
        const purplePct = Math.max(0, ((r2.freePlanLimitBytes - r2.payloadSizeBytes) / maxBytes) * 100);
        const fpPct = (r2.freePlanLimitBytes / maxBytes) * 100;
        const needsPaid = r2.needsPaid;
        const leftBytes = fmtBytes(Math.max(0, r2.freePlanLimitBytes - r2.payloadSizeBytes));
        const rightHtml = needsPaid
          ? '<span class="text-red-400 font-medium">Over free plan by ' + r2.overFreePlanFormatted + '</span>'
          : '<span class="text-purple-400 font-medium">' + leftBytes + ' left on free plan</span>';
        serviceRows += '<div class="bg-gray-900/40 border border-gray-800 rounded-lg p-3.5 mb-2.5">'
          + '<div class="flex justify-between text-sm">'
          + '<span class="text-gray-300 font-medium truncate pr-2" title="R2 Storage">R2 Storage</span>'
          + '<span class="text-gray-500 whitespace-nowrap">included</span>'
          + '</div>'
          + '<div class="relative h-3.5 rounded-full bg-gray-700/50 overflow-hidden w-full my-1.5 border border-gray-700">'
          + '<div class="absolute h-full bg-purple-500 rounded-full" style="width: ' + purplePct + '%"></div>'
          + '<div class="absolute inset-y-0 left-0 h-full bg-green-500 rounded-full" style="width: ' + greenPct + '%"></div>'
          + '<div class="absolute h-full w-[2.5px] bg-gray-100 opacity-90" style="left: calc(' + fpPct + '% - 1.25px)" title="Free plan: ' + r2.freePlanLimitFormatted + '"></div>'
          + '</div>'
          + '<div class="flex justify-between text-xs text-gray-400 mt-1">'
          + '<span>Used: <strong class="text-gray-200">' + r2.payloadSizeFormatted + '</strong> / ' + r2.freePlanLimitFormatted + ' (free plan cap)</span>'
          + rightHtml
          + '</div>'
          + '</div>';
      }

      div.innerHTML = \`
        <div class="bg-blue-900/30 border border-blue-700 rounded-lg p-4">
          <div class="flex items-center justify-between flex-wrap gap-3">
            <div>
              <p class="font-medium text-blue-200">\${sub.plan}</p>
              <p class="text-xs text-gray-400 mt-0.5">Base \${fmtMoney(baseFee)}/mo + overage \${fmtMoney(data.totalBilled)}</p>
            </div>
            <div class="text-right">
              <p class="text-2xl font-bold \${data.totalBilled > 0 ? 'text-yellow-400' : 'text-green-400'}">\${fmtMoney(estTotal)}</p>
              <p class="text-xs text-gray-400">estimated / month</p>
            </div>
          </div>
          \${r2Block ? '<div class="mt-3 pt-3 border-t border-blue-800 text-sm">' + r2Block + '</div>' : ''}
          \${workerBlock ? '<div class="mt-2 text-sm">' + workerBlock + '</div>' : ''}
        </div>

        <div class="flex flex-wrap items-center gap-4 text-xs text-gray-400">
          <span class="flex items-center gap-1.5"><span class="w-3 h-3 rounded-full bg-green-500"></span> Used (in allowance)</span>
          <span class="flex items-center gap-1.5"><span class="w-3 h-3 rounded-full bg-purple-500"></span> Remaining paid-tier allowance</span>
          <span class="flex items-center gap-1.5"><span class="w-3 h-3 rounded-full bg-red-500"></span> Billed overage</span>
          <span class="flex items-center gap-1.5"><span class="w-3 h-3 rounded-full bg-orange-400" style="height:2px"></span> Free plan limit</span>
        </div>

        <div class="bg-gray-900/50 rounded-lg p-4">
          <h3 class="font-medium mb-3 text-gray-300">Service Breakdown</h3>
          <div class="space-y-2">
            \${serviceRows}
          </div>
        </div>
      \`;
    }

    // Start auto-refresh
    function startAutoRefresh() {
      if (autoRefreshInterval) clearInterval(autoRefreshInterval);
      autoRefreshInterval = setInterval(() => {
        refreshStatus();
        refreshServices();
      }, 30000); // Every 30 seconds
    }

    function metricsBar(percent, color) {
      const p = Math.max(0, Math.min(100, percent || 0));
      const colorClass = p >= 90 ? 'bg-red-500' : p >= 70 ? 'bg-yellow-500' : color;
      return '<div class="relative h-3 rounded-full bg-gray-700/60 overflow-hidden border border-gray-700">'
        + '<div class="absolute h-full ' + colorClass + ' rounded-full transition-all" style="width:' + p.toFixed(1) + '%"></div>'
        + '</div>'
        + '<div class="text-xs text-gray-400 mt-1 flex justify-between"><span>' + p.toFixed(1) + '%</span><span class="text-gray-500">of limit</span></div>';
    }

    function fmtUptime(sec) {
      sec = Math.floor(sec || 0);
      const days = Math.floor(sec / 86400);
      sec -= days * 86400;
      const h = Math.floor(sec / 3600);
      sec -= h * 3600;
      const m = Math.floor(sec / 60);
      sec -= m * 60;
      if (days > 0) return days + 'd ' + h + 'h';
      if (h > 0) return h + 'h ' + m + 'm';
      if (m > 0) return m + 'm ' + sec + 's';
      return sec + 's';
    }

    async function refreshMetrics() {
      const data = await fetchAPI('/container-metrics');
      const div = document.getElementById('metrics');
      const tsSpan = document.getElementById('metrics-timestamp');
      if (data.error) {
        div.innerHTML = '<p class="text-red-400">' + data.error + '</p>';
        if (tsSpan) tsSpan.textContent = 'error';
        return;
      }
      if (!data.available) {
        div.innerHTML = '<p class="text-gray-400 text-sm">' + (data.reason || 'Metrics not available yet.') + '</p>';
        if (tsSpan) tsSpan.textContent = 'no data';
        return;
      }
      const ago = Math.max(0, Math.floor(Date.now() / 1000) - (data.timestamp || 0));
      if (tsSpan) tsSpan.textContent = ago < 2 ? 'just now' : ago + 's ago';
      const cpu = data.cpu || {};
      const mem = data.memory || {};
      const disk = data.disk || {};
      div.innerHTML = '<div class="grid grid-cols-1 md:grid-cols-3 gap-4">'
        + '<div class="bg-gray-900/50 rounded-lg p-4">'
        + '<div class="flex items-center justify-between mb-2"><h3 class="text-sm font-medium text-gray-300">CPU</h3><span class="text-xs text-gray-500">5s avg</span></div>'
        + metricsBar(cpu.percent, 'bg-blue-500')
        + '</div>'
        + '<div class="bg-gray-900/50 rounded-lg p-4">'
        + '<div class="flex items-center justify-between mb-2"><h3 class="text-sm font-medium text-gray-300">Memory</h3><span class="text-xs text-gray-500">' + (mem.usedMB || 0).toFixed(0) + ' / ' + (mem.totalMB || 0) + ' MB</span></div>'
        + metricsBar(mem.percent, 'bg-green-500')
        + '</div>'
        + '<div class="bg-gray-900/50 rounded-lg p-4">'
        + '<div class="flex items-center justify-between mb-2"><h3 class="text-sm font-medium text-gray-300">Disk (rootfs)</h3><span class="text-xs text-gray-500">' + ((disk.usedBytes / 1073741824) || 0).toFixed(2) + ' / ' + ((disk.totalBytes / 1073741824) || 0).toFixed(2) + ' GB</span></div>'
        + metricsBar(disk.percent, 'bg-purple-500')
        + '</div>'
        + '</div>'
        + '<div class="grid grid-cols-2 md:grid-cols-4 gap-3 mt-3 text-sm">'
        + '<div class="bg-gray-900/50 rounded p-3"><p class="text-gray-400 text-xs">Load avg</p><p class="font-mono text-gray-200">' + (data.load || '-') + '</p></div>'
        + '<div class="bg-gray-900/50 rounded p-3"><p class="text-gray-400 text-xs">Processes</p><p class="font-mono text-gray-200">' + (data.processCount || 0) + '</p></div>'
        + '<div class="bg-gray-900/50 rounded p-3"><p class="text-gray-400 text-xs">Uptime</p><p class="font-mono text-gray-200">' + fmtUptime(data.uptimeSeconds) + '</p></div>'
        + '<div class="bg-gray-900/50 rounded p-3"><p class="text-gray-400 text-xs">Updated</p><p class="font-mono text-gray-200">' + ago + 's ago</p></div>'
        + '</div>';
    }

    // Auto-refresh metrics every 6 seconds (container writes every 5s)
    setInterval(refreshMetrics, 6000);

    async function refreshInstanceType() {
      const div = document.getElementById('instance-type');
      const data = await fetchAPI('/instance-type');

      if (data.error) {
        div.innerHTML = '<div class="bg-red-900/30 border border-red-700 rounded p-3">'
          + '<p class="text-red-400 font-medium">Error fetching instance types</p>'
          + '<p class="text-red-300 text-sm mt-1">' + data.error + '</p>'
          + '</div>';
        return;
      }

      const current = data.current || {};
      const currentName = current.instanceType || '';
      const options = data.instanceTypes || [];

      const optionsHtml = options.map(t => {
        const selected = t.name === currentName;
        return '<option value="' + t.name + '"' + (selected ? ' selected' : '') + '>'
          + t.name + ' - ' + t.vcpu + ' vCPU, ' + t.memory + ' RAM, ' + t.disk + ' disk'
          + '</option>';
      }).join('');

      const currentInfo = current && currentName
        ? '<div class="text-xs text-gray-400 mb-3">'
          + 'Currently running: <strong class="text-gray-200">' + currentName + '</strong>'
          + ' (' + current.vcpu + ' vCPU, ' + current.memory + ', ' + current.disk + ' disk)'
          + '</div>'
        : '';

      div.innerHTML = currentInfo
        + '<div class="flex flex-col sm:flex-row gap-3">'
        + '<select id="instance-type-select" class="flex-1 bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm focus:outline-none focus:border-blue-500">'
        + optionsHtml
        + '</select>'
        + '<button id="apply-instance-type-btn" onclick="applyInstanceType()" class="bg-blue-600 hover:bg-blue-700 px-5 py-2 rounded text-sm font-medium transition-colors whitespace-nowrap">Apply Size</button>'
        + '</div>'
        + '<div id="instance-type-msg" class="text-xs text-gray-500 mt-2"></div>';
    }

    async function applyInstanceType() {
      const select = document.getElementById('instance-type-select');
      const msg = document.getElementById('instance-type-msg');
      const btn = document.getElementById('apply-instance-type-btn');
      const instanceType = select ? select.value : '';
      if (!instanceType) return;
      btn.disabled = true;
      btn.textContent = 'Applying...';
      if (msg) msg.textContent = '';
      const data = await fetchAPI('/instance-type', {
        method: 'POST',
        body: JSON.stringify({ instanceType }),
      });
      btn.disabled = false;
      btn.textContent = 'Apply Size';
      if (data.error) {
        if (msg) {
          msg.textContent = data.error;
          msg.className = 'text-xs text-red-400 mt-2';
        }
        return;
      }
      if (msg) {
        msg.textContent = data.message || 'Instance size updated. Rollout in progress...';
        msg.className = 'text-xs text-green-400 mt-2';
      }
      setTimeout(refreshInstanceType, 4000);
      setTimeout(refreshInstanceType, 12000);
    }

    // Initial load
    refreshStatus();
    refreshServices();
    refreshConfig();
    initOpenCodeEditor();
    refreshPower();
    refreshBilling();
    refreshInstanceType();
    refreshMetrics();
    startAutoRefresh();

    // Refresh on visibility change
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        refreshStatus();
        refreshServices();
        refreshConfig();
        refreshPower();
        refreshBilling();
        refreshInstanceType();
        refreshMetrics();
      }
    });
  </script>
</body>
</html>`;
}
