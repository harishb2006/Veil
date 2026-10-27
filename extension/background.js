// VEIL background service worker.
//
// Every call to the local backend made on behalf of an AI chat site goes through
// here. A request from the content script would carry the chat site's origin,
// which the backend's CORS refuses on purpose (it only allows chrome-extension://
// origins and the local web console). A request from this worker carries the
// extension's origin and is allowed through host_permissions.

// "localhost" first; on Windows it can resolve to ::1 while uvicorn listens only
// on 127.0.0.1, so a connection failure retries on the numeric address.
const BACKENDS = ["http://localhost:8000", "http://127.0.0.1:8000"];
const TIMEOUT_MS = { "/scan": 90_000, "/rehydrate": 20_000 };
const DEFAULT_TIMEOUT_MS = 20_000;
const ALLOWED_PATHS = new Set(["/scan", "/rehydrate"]);

let preferred = 0; // index into BACKENDS of the last base that answered

async function request(base, path, body) {
  const res = await fetch(base + path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(TIMEOUT_MS[path] || DEFAULT_TIMEOUT_MS),
  });
  let data = null;
  try {
    data = await res.json();
  } catch {
    // Non-JSON body; the status code is enough.
  }
  if (!res.ok) {
    const detail = data && typeof data.detail === "string" ? data.detail : `Backend error ${res.status}`;
    return { ok: false, status: res.status, detail };
  }
  return { ok: true, status: res.status, data };
}

async function callApi(path, body) {
  if (!ALLOWED_PATHS.has(path)) return { ok: false, status: 0, detail: "Unsupported request." };
  let lastError = null;
  for (let i = 0; i < BACKENDS.length; i++) {
    const index = (preferred + i) % BACKENDS.length;
    try {
      const result = await request(BACKENDS[index], path, body);
      preferred = index;
      return result; // an HTTP error from a reachable backend is a real answer; do not retry
    } catch (err) {
      if (err && err.name === "TimeoutError") {
        return { ok: false, status: 0, offline: true, detail: "The VEIL backend took too long to answer." };
      }
      lastError = err;
    }
  }
  return {
    ok: false,
    status: 0,
    offline: true,
    detail: `Can't reach the VEIL backend on localhost:8000. Is it running? (${lastError ? lastError.message : "no answer"})`,
  };
}

// Chat -> scan_id, so placeholders stay stable across messages in one conversation.
// storage.session is memory-only and is cleared when the browser closes.
async function getScanId(key) {
  const store = await chrome.storage.session.get({ scanIds: {} });
  return store.scanIds[key] || null;
}

async function setScanId(key, scanId) {
  const store = await chrome.storage.session.get({ scanIds: {} });
  if (scanId) store.scanIds[key] = scanId;
  else delete store.scanIds[key];
  await chrome.storage.session.set({ scanIds: store.scanIds });
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  // Only this extension's own content scripts and pages may use the bridge.
  if (sender.id !== chrome.runtime.id) return false;
  (async () => {
    switch (msg && msg.type) {
      case "api":
        return callApi(msg.path, msg.body);
      case "getScanId":
        return { scanId: await getScanId(msg.key) };
      case "setScanId":
        await setScanId(msg.key, msg.scanId);
        return { ok: true };
      default:
        return { ok: false, status: 0, detail: "Unknown message" };
    }
  })()
    .catch((err) => ({ ok: false, status: 0, detail: String((err && err.message) || err) }))
    .then(sendResponse);
  return true; // keep the channel open for the async response
});
