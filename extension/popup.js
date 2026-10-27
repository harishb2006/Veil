// VEIL popup: send the current page to the local VEIL backend (POST /firewall/scan) and show what it found.
// Everything stays on this machine: the only network call is to localhost. Page text is only ever written with
// textContent, never as HTML, because it is untrusted.

const API = "http://localhost:8000";
const MAX_CHARS = 190000; // the backend accepts up to 200,000 characters per scan

const $ = (id) => document.getElementById(id);

function show(id, visible) {
  $(id).hidden = !visible;
}

function setStatus(text, tone) {
  const pill = $("status");
  pill.textContent = text;
  pill.className = `pill pill-${tone}`;
}

async function checkHealth() {
  try {
    const res = await fetch(`${API}/health`, { cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const health = await res.json();
    if (health.firewall && health.firewall.gemma_injection) setStatus("Gemma on, local", "ok");
    else if (health.gemma_status === "loading") setStatus("Gemma loading…", "warn");
    else setStatus("rules only", "warn");
    return true;
  } catch {
    setStatus("backend offline", "bad");
    return false;
  }
}

async function readPage(tabId) {
  const [injection] = await chrome.scripting.executeScript({
    target: { tabId },
    func: () => document.documentElement.outerHTML,
  });
  return injection && typeof injection.result === "string" ? injection.result : "";
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function render(result, seconds) {
  const verdict = $("verdict");
  const serious = result.findings.filter((f) => f.severity !== "low");
  // Low findings are notes (ordinary hidden UI text, a sentence Gemma was unsure about): VEIL reports them but does
  // not act on them, so a page with only low findings reads as clean.
  const shown = result.verdict !== "QUARANTINED" && serious.length === 0 ? "ALLOW" : result.verdict;
  const labels = {
    ALLOW: "Looks clean: nothing aimed at an AI agent",
    SANITIZED: "Instructions aimed at AI found and removed",
    QUARANTINED: "Quarantined: an agent should not read this page",
  };
  verdict.textContent = labels[shown] || shown;
  verdict.className = `verdict ${String(shown).toLowerCase()}`;

  const timings = result.timings_ms || {};
  const byGemma = serious.filter((f) => f.tier === "gemma").length;
  const notes = result.findings.length - serious.length;
  $("meta").textContent =
    `${serious.length} finding(s), ${byGemma} by Gemma${notes ? `, ${notes} low-risk note(s)` : ""} · ` +
    `${result.gemma_used ? `Gemma ${((timings.gemma || 0) / 1000).toFixed(1)} s` : "Gemma not used"} · ` +
    `total ${seconds.toFixed(1)} s`;

  const list = $("findings");
  list.replaceChildren();
  const ordered = [...serious, ...result.findings.filter((f) => f.severity === "low")];
  for (const f of ordered) {
    const item = el("li");
    const top = el("div", "top");
    top.append(
      el("span", `tag ${f.severity}`, f.severity),
      el("span", "tag", f.kind),
      el("span", `tag ${f.tier === "gemma" ? "gemma" : ""}`, f.tier === "gemma" ? "found by Gemma" : "found by a rule"),
      el("span", "tag", f.hidden ? "hidden from you" : "in plain sight"),
    );
    item.append(top, el("div", "txt", f.text.length > 220 ? `${f.text.slice(0, 220)}…` : f.text));
    if (f.reason) item.append(el("div", "why", f.reason));
    list.append(item);
  }

  $("seenText").textContent = (result.content_for_model || "").slice(0, 3000);
  show("result", true);
}

async function setBadge(tabId, result) {
  const count = result.findings.filter((f) => f.severity !== "low").length;
  const clean = result.verdict !== "QUARANTINED" && count === 0;
  const text = clean ? "OK" : String(count);
  const color = clean ? "#15803d" : result.verdict === "QUARANTINED" ? "#b91c1c" : "#b45309";
  try {
    await chrome.action.setBadgeText({ tabId, text });
    await chrome.action.setBadgeBackgroundColor({ tabId, color });
  } catch {
    // The badge is a convenience; the popup already shows the result.
  }
}

async function scan() {
  const button = $("scan");
  button.disabled = true;
  show("error", false);
  show("result", false);
  show("progress", true);
  $("progressText").textContent = "Reading the page…";

  try {
    if (!(await checkHealth())) {
      throw new Error("VEIL is not running on this machine. Start the backend (port 8000) and try again.");
    }
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || !tab.id || !/^https?:|^file:/.test(tab.url || "")) {
      throw new Error("This page can't be scanned. Open a normal web page and try again.");
    }
    let html = await readPage(tab.id);
    if (!html) throw new Error("Could not read this page.");
    const truncated = html.length > MAX_CHARS;
    if (truncated) html = html.slice(0, MAX_CHARS);

    $("progressText").textContent = "Scanning locally: rules, then Gemma on suspicious sentences…";
    const started = performance.now();
    const res = await fetch(`${API}/firewall/scan`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: html, content_type: "html", tool: "fetch_page" }),
    });
    if (!res.ok) {
      const detail = await res.text();
      throw new Error(`VEIL refused the scan (HTTP ${res.status}): ${detail.slice(0, 200)}`);
    }
    const result = await res.json();
    render(result, (performance.now() - started) / 1000);
    if (truncated) $("meta").textContent += " · page was long, only the first part was scanned";
    await setBadge(tab.id, result);
  } catch (err) {
    $("error").textContent = err instanceof Error ? err.message : String(err);
    show("error", true);
  } finally {
    show("progress", false);
    button.disabled = false;
  }
}

// ------------------------------------------------------------------ chat sites: protect the prompt in the box
//
// Opening the popup on ChatGPT, Claude or Gemini reads the chat box, scans it with POST /scan (rules + local Gemma)
// and replaces the box content with the placeholder version straight away. This runs from the toolbar click
// (activeTab + scripting), so it works even when the paste-time content script did not attach to the page.

const CHAT_SITE = /^https:\/\/(chatgpt\.com|chat\.openai\.com|claude\.ai|gemini\.google\.com)\//;
let chatTabId = null;
let chatOriginal = null;

// Runs inside the chat page. Finds the prompt box, marks it, and returns its text.
function pageReadPrompt() {
  const visible = (el) => {
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };
  const editable = (el) => el && (el.tagName === "TEXTAREA" || el.isContentEditable);
  let box = editable(document.activeElement) && visible(document.activeElement) ? document.activeElement : null;
  const selectors = [
    'div.ProseMirror[contenteditable="true"]',
    "#prompt-textarea",
    "rich-textarea .ql-editor",
    '.ql-editor[contenteditable="true"]',
    "textarea",
    '[contenteditable="true"]',
  ];
  for (const selector of selectors) {
    if (box) break;
    box = Array.from(document.querySelectorAll(selector)).find((el) => editable(el) && visible(el)) || null;
  }
  if (!box) return { found: false };
  document.querySelectorAll("[data-veil-box]").forEach((el) => el.removeAttribute("data-veil-box"));
  box.setAttribute("data-veil-box", "1");
  return { found: true, text: box.tagName === "TEXTAREA" ? box.value : box.innerText };
}

// Runs inside the chat page. Replaces the marked box's content with `text` through the editor's own input handling.
function pageWritePrompt(text) {
  const box = document.querySelector('[data-veil-box="1"]');
  if (!box) return { ok: false, reason: "The chat box is gone. Click into it and open VEIL again." };
  const squash = (s) => s.replace(/\s+/g, " ").trim();
  box.focus();
  if (box.tagName === "TEXTAREA") {
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set;
    setter.call(box, text);
    box.dispatchEvent(new Event("input", { bubbles: true }));
    return { ok: box.value === text };
  }
  const selectAll = () => {
    const range = document.createRange();
    range.selectNodeContents(box);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
  };
  selectAll();
  document.execCommand("insertText", false, text);
  if (squash(box.innerText) !== squash(text)) {
    // Some editors ignore insertText; they all handle a paste.
    selectAll();
    const data = new DataTransfer();
    data.setData("text/plain", text);
    box.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }));
  }
  return { ok: squash(box.innerText) === squash(text) };
}

async function runInTab(func, args = []) {
  const [injection] = await chrome.scripting.executeScript({ target: { tabId: chatTabId }, func, args });
  return injection ? injection.result : null;
}

async function chatKey() {
  const tab = await chrome.tabs.get(chatTabId);
  const url = new URL(tab.url);
  return url.origin + url.pathname;
}

// Same storage as the content script, so placeholders stay the same across the whole conversation.
async function loadScanId(key) {
  try {
    const store = await chrome.storage.session.get({ scanIds: {} });
    return store.scanIds[key] || null;
  } catch {
    return null;
  }
}

async function saveScanId(key, scanId) {
  try {
    const store = await chrome.storage.session.get({ scanIds: {} });
    store.scanIds[key] = scanId;
    await chrome.storage.session.set({ scanIds: store.scanIds });
  } catch {
    // Without storage the next scan simply starts new placeholders.
  }
}

async function scanApi(text, scanId) {
  const res = await fetch(`${API}/scan`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(scanId ? { text, scan_id: scanId } : { text }),
  });
  if (res.status === 404 && scanId) return scanApi(text, null); // the backend restarted and forgot this chat
  if (res.status === 503) throw new Error("Gemma is still loading in the VEIL backend. Try again in a few seconds.");
  if (res.status === 413) throw new Error("This prompt is longer than VEIL scans at once (20,000 characters).");
  if (!res.ok) throw new Error(`VEIL could not scan the prompt (HTTP ${res.status}).`);
  return res.json();
}

function chatError(message) {
  $("chatError").textContent = message;
  show("chatError", true);
}

async function protectPrompt() {
  show("chatError", false);
  show("chatResult", false);
  show("undo", false);
  show("chatProgress", true);
  try {
    if (!(await checkHealth())) {
      throw new Error("VEIL is not running on this machine. Start the backend (scripts\\start.ps1 -BackendOnly) and open VEIL again.");
    }
    const read = await runInTab(pageReadPrompt);
    if (!read || !read.found) throw new Error("Couldn't find the chat box. Click into it, then open VEIL again.");
    const text = read.text || "";
    if (!text.trim()) throw new Error("The chat box is empty. Paste or type your prompt, then open VEIL again.");

    const key = await chatKey();
    const started = performance.now();
    const result = await scanApi(text, await loadScanId(key));
    await saveScanId(key, result.scan_id);
    const seconds = (performance.now() - started) / 1000;

    const entities = result.entities || [];
    const changed = entities.length > 0 && result.sanitized_text !== text;
    if (changed) {
      const written = await runInTab(pageWritePrompt, [result.sanitized_text]);
      if (!written || !written.ok) {
        await navigator.clipboard.writeText(result.sanitized_text).catch(() => {});
        throw new Error(
          (written && written.reason) ||
            "VEIL couldn't edit this chat box, so the protected prompt is on your clipboard: select all in the box and press Ctrl+V.",
        );
      }
      chatOriginal = text;
      show("undo", true);
    }
    renderChat(result, entities, changed, seconds);
  } catch (err) {
    chatError(err instanceof Error ? err.message : String(err));
  } finally {
    show("chatProgress", false);
  }
}

function renderChat(result, entities, changed, seconds) {
  const verdict = $("chatVerdict");
  if (changed) {
    verdict.textContent = `Replaced ${entities.length} private value${entities.length === 1 ? "" : "s"} in your prompt`;
    verdict.className = "verdict sanitized";
  } else {
    verdict.textContent = "Nothing private found: your prompt is unchanged";
    verdict.className = "verdict allow";
  }
  const byGemma = entities.filter((e) => e.source === "gemma").length;
  const timings = result.timings_ms || {};
  $("chatMeta").textContent =
    `${entities.length} found, ${byGemma} by Gemma · ` +
    `${result.gemma_used ? `Gemma ${((timings.gemma || 0) / 1000).toFixed(1)} s` : "Gemma not used"} · total ${seconds.toFixed(1)} s` +
    (changed ? " · the AI will only see the placeholders" : "");

  const list = $("chatFindings");
  list.replaceChildren();
  for (const e of entities) {
    const item = el("li");
    const top = el("div", "top");
    top.append(
      el("span", `tag ${e.redacted ? "high" : "medium"}`, e.redacted ? "secret, never restored" : "restored in replies"),
      el("span", "tag", e.type),
      el("span", `tag ${e.source === "gemma" ? "gemma" : ""}`, e.source === "gemma" ? "found by Gemma" : "found by a rule"),
    );
    const line = el("div", "txt");
    line.append(el("span", "", `${e.text} → `), el("span", "ph", e.replacement));
    item.append(top, line);
    if (e.reason) item.append(el("div", "why", e.reason));
    list.append(item);
  }
  show("chatResult", true);
}

async function undoProtect() {
  if (chatOriginal === null) return;
  const written = await runInTab(pageWritePrompt, [chatOriginal]);
  if (written && written.ok) {
    $("chatVerdict").textContent = "Your original text is back in the chat box (not protected)";
    $("chatVerdict").className = "verdict quarantined";
    show("undo", false);
    chatOriginal = null;
  } else {
    await navigator.clipboard.writeText(chatOriginal).catch(() => {});
    chatError("Couldn't put the text back; your original is on the clipboard.");
  }
}

async function init() {
  $("scan").addEventListener("click", scan);
  $("undo").addEventListener("click", undoProtect);
  $("rescan").addEventListener("click", protectPrompt);
  $("toPage").addEventListener("click", () => {
    show("chat", false);
    show("page", true);
    $("modeLabel").textContent = "outer door";
  });

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab && tab.id && CHAT_SITE.test(tab.url || "")) {
    chatTabId = tab.id;
    $("modeLabel").textContent = "prompt protection";
    show("page", false);
    show("chat", true);
    await protectPrompt();
  } else {
    checkHealth();
  }
}

init();
