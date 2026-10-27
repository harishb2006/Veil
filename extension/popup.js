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
  const labels = {
    ALLOW: "Looks clean: nothing aimed at an AI agent",
    SANITIZED: "Hidden instructions found and removed",
    QUARANTINED: "Quarantined: an agent should not read this page",
  };
  verdict.textContent = labels[result.verdict] || result.verdict;
  verdict.className = `verdict ${String(result.verdict).toLowerCase()}`;

  const timings = result.timings_ms || {};
  const byGemma = result.findings.filter((f) => f.tier === "gemma").length;
  $("meta").textContent =
    `${result.findings.length} finding(s), ${byGemma} by Gemma · ` +
    `${result.gemma_used ? `Gemma ${((timings.gemma || 0) / 1000).toFixed(1)} s` : "Gemma not used"} · ` +
    `total ${seconds.toFixed(1)} s`;

  const list = $("findings");
  list.replaceChildren();
  for (const f of result.findings) {
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
  const count = result.findings.length;
  const text = result.verdict === "ALLOW" ? "OK" : String(count);
  const color = result.verdict === "ALLOW" ? "#15803d" : result.verdict === "QUARANTINED" ? "#b91c1c" : "#b45309";
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

$("scan").addEventListener("click", scan);
checkHealth();
