/**
 * OmniBridge Firebase RTDB SSE Realtime Sync
 * Target: https://omni-bridge-8297b-default-rtdb.firebaseio.com/projects/letspang/logs.json
 */

const https = require('https');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

const FIREBASE_URL = 'https://omni-bridge-8297b-default-rtdb.firebaseio.com/projects/letspang/logs.json';
const SHARED_CONTEXT_FILE = path.join(__dirname, 'SHARED_CONTEXT.md');

// Set of processed keys/ids to prevent duplicates
const processedKeys = new Set();

// Ensure SHARED_CONTEXT.md exists
if (!fs.existsSync(SHARED_CONTEXT_FILE)) {
  fs.writeFileSync(SHARED_CONTEXT_FILE, '', 'utf8');
} else {
  // Pre-seed seen entries from existing file if any
  try {
    const existingContent = fs.readFileSync(SHARED_CONTEXT_FILE, 'utf8');
    const matches = existingContent.matchAll(/\[(.*?)\] \((.*?)\):/g);
    for (const match of matches) {
      processedKeys.add(`${match[1]}_${match[2]}`);
    }
  } catch (err) {
    console.error('[OmniBridge] Error reading existing SHARED_CONTEXT.md:', err.message);
  }
}

/**
 * Format timestamp
 */
function formatTime(ts) {
  if (!ts) return new Date().toISOString();
  if (typeof ts === 'number') return new Date(ts).toISOString();
  return String(ts);
}

/**
 * Append message to SHARED_CONTEXT.md
 */
function appendMessage(key, item) {
  if (!item) return;

  const time = formatTime(item.timestamp || item.time || item.createdAt);
  const role = item.role || item.sender || item.author || 'unknown';
  let content = '';

  if (typeof item.content === 'string') {
    content = item.content;
  } else if (typeof item.text === 'string') {
    content = item.text;
  } else if (item.content !== undefined) {
    content = JSON.stringify(item.content);
  } else if (item.text !== undefined) {
    content = JSON.stringify(item.text);
  } else {
    content = JSON.stringify(item);
  }

  // Deduplication check by key and by timestamp_role
  const compositeKey = `${time}_${role}`;
  if (processedKeys.has(key) || processedKeys.has(compositeKey)) {
    return;
  }

  if (key) processedKeys.add(key);
  processedKeys.add(compositeKey);

  const entry = `[${time}] (${role}): ${content}\n\n`;

  try {
    let prefix = '';
    if (fs.existsSync(SHARED_CONTEXT_FILE)) {
      const current = fs.readFileSync(SHARED_CONTEXT_FILE, 'utf8');
      if (current.length > 0 && !current.endsWith('\n\n')) {
        prefix = current.endsWith('\n') ? '\n' : '\n\n';
      }
    }
    fs.appendFileSync(SHARED_CONTEXT_FILE, prefix + entry, 'utf8');
    console.log(`[OmniBridge] [${new Date().toISOString()}] Synced message from (${role})`);
  } catch (err) {
    console.error('[OmniBridge] Failed to write to SHARED_CONTEXT.md:', err.message);
  }
}

/**
 * Process incoming SSE payload
 */
function processEvent(eventType, payload) {
  if (!payload || payload.data === undefined || payload.data === null) {
    return;
  }

  const { path: eventPath, data } = payload;

  if (eventPath === '/') {
    if (typeof data === 'object') {
      // Check if it's a single message object with role & content
      if (data.role && (data.content !== undefined || data.text !== undefined)) {
        appendMessage('root', data);
      } else {
        // Map of { [id]: messageObj }
        // Keys in Firebase RTDB are chronologically push-sorted
        const keys = Object.keys(data).sort();
        for (const key of keys) {
          const item = data[key];
          if (item && typeof item === 'object') {
            appendMessage(key, item);
          }
        }
      }
    }
  } else {
    // Child path like "/-P2gp_..."
    const segments = eventPath.split('/').filter(Boolean);
    const rootKey = segments[0];

    if (segments.length === 1) {
      if (data && typeof data === 'object') {
        appendMessage(rootKey, data);
      }
    } else {
      // Deep path, e.g. "/-P.../content"
      // If full object is not present, ignore or handle if needed
      console.log(`[OmniBridge] Partial update on ${eventPath}`);
    }
  }
}

let activeRequest = null;
let reconnectTimer = null;

function connect(targetUrl) {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }

  console.log(`[OmniBridge] Connecting to SSE stream: ${targetUrl}`);

  const parsedUrl = new URL(targetUrl);
  const options = {
    hostname: parsedUrl.hostname,
    port: parsedUrl.port || 443,
    path: parsedUrl.pathname + parsedUrl.search,
    method: 'GET',
    headers: {
      'Accept': 'text/event-stream',
      'Cache-Control': 'no-cache'
    }
  };

  let buffer = '';
  let isEnded = false;

  const scheduleReconnect = (delayMs = 3000) => {
    if (isEnded) return;
    isEnded = true;

    if (activeRequest) {
      try {
        activeRequest.destroy();
      } catch (_) {}
      activeRequest = null;
    }

    if (!reconnectTimer) {
      console.log(`[OmniBridge] Scheduling reconnect in ${delayMs / 1000}s...`);
      reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        connect(FIREBASE_URL);
      }, delayMs);
    }
  };

  const req = https.request(options, (res) => {
    // Handle HTTP Redirects (307, 301, 302)
    if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
      console.log(`[OmniBridge] Redirecting (${res.statusCode}) to ${res.headers.location}`);
      isEnded = true;
      req.destroy();
      connect(res.headers.location);
      return;
    }

    if (res.statusCode !== 200) {
      console.error(`[OmniBridge] Unexpected status code: ${res.statusCode}`);
      scheduleReconnect(5000);
      return;
    }

    console.log('[OmniBridge] SSE Stream connected successfully (HTTP 200 OK)');

    res.on('data', (chunk) => {
      buffer += chunk.toString('utf8');
      const parts = buffer.split(/\r?\n\r?\n/);
      buffer = parts.pop();

      for (const part of parts) {
        if (!part.trim()) continue;

        const lines = part.split(/\r?\n/);
        let eventType = 'message';
        const dataLines = [];

        for (const line of lines) {
          if (line.startsWith('event:')) {
            eventType = line.slice(6).trim();
          } else if (line.startsWith('data:')) {
            dataLines.push(line.slice(5).trim());
          }
        }

        if (dataLines.length === 0) continue;
        if (eventType === 'keep-alive') continue;

        const rawData = dataLines.join('\n');
        try {
          const payload = JSON.parse(rawData);
          processEvent(eventType, payload);
        } catch (err) {
          console.error('[OmniBridge] JSON parse error:', err.message, rawData);
        }
      }
    });

    res.on('end', () => {
      console.log('[OmniBridge] SSE Stream ended by server');
      scheduleReconnect(3000);
    });

    res.on('close', () => {
      console.log('[OmniBridge] SSE Stream connection closed');
      scheduleReconnect(3000);
    });

    res.on('error', (err) => {
      console.error('[OmniBridge] Response error:', err.message);
      scheduleReconnect(3000);
    });
  });

  req.on('error', (err) => {
    console.error('[OmniBridge] Request error:', err.message);
    scheduleReconnect(5000);
  });

  req.end();
  activeRequest = req;
}

// Start synchronization
connect(FIREBASE_URL);

// Keep process alive and handle graceful exit
process.on('SIGINT', () => {
  console.log('[OmniBridge] Stopping sync process...');
  if (activeRequest) activeRequest.destroy();
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('[OmniBridge] Stopping sync process...');
  if (activeRequest) activeRequest.destroy();
  process.exit(0);
});
