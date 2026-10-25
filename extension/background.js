// Pomo Focus Helper: sends the active tab to the local Pomo app on ws://localhost:8765.
// Only the URL and title of the tab you are on are sent, and only to localhost.
const WS_URL = 'ws://localhost:8765';
let ws = null;
let last = '';

function connect() {
  try { ws = new WebSocket(WS_URL); } catch (e) { setTimeout(connect, 5000); return; }
  ws.onopen = () => { last = ''; report(); };
  ws.onclose = () => { ws = null; setTimeout(connect, 5000); };
  ws.onerror = () => { try { ws.close(); } catch (e) {} };
}

function send(msg) {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  const s = JSON.stringify(msg);
  if (s === last) return; // only send changes
  last = s;
  ws.send(s);
}

async function report() {
  try {
    const win = await chrome.windows.getLastFocused();
    if (!win || !win.focused) { send({ t: 'active', app: 'other' }); return; } // left Chrome
    const [tab] = await chrome.tabs.query({ active: true, windowId: win.id });
    if (tab) send({ t: 'active', url: tab.url || '', title: tab.title || '' });
  } catch (e) { /* window closed mid-query */ }
}

chrome.tabs.onActivated.addListener(report);
chrome.tabs.onUpdated.addListener((id, info, tab) => { if (tab.active && (info.url || info.title)) report(); });
chrome.windows.onFocusChanged.addListener(report);

// MV3 workers sleep after ~30 s; a message every 20 s keeps the socket (and the worker) alive.
setInterval(() => {
  if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ t: 'keepalive' }));
}, 20000);

connect();
