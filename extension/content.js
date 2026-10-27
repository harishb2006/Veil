// VEIL content script for ChatGPT, Claude and Gemini: the "inner door" in the browser.
//
// 1. Automatic: when you paste text into the chat box, the paste is held back,
//    scanned on this machine (rules + Gemma) through the background worker, and the
//    sanitized text (placeholders such as [EMAIL_1]) goes into the box instead. A
//    small panel lists what was hidden and offers "Undo (paste original)". If VEIL
//    cannot scan (backend offline, too long, still loading) the ORIGINAL text is
//    inserted and a warning says so: a paste is never lost.
// 2. Manual: the VEIL button (or Alt+Shift+V) scans the whole prompt currently in
//    the box and offers "Use sanitized prompt".
// 3. When the AI's reply contains placeholders, they are swapped back to the real
//    values on this screen only (the backend never restores secrets such as API keys).
//
// Everything written to the page or to the panel goes through textContent / DOM
// nodes, never innerHTML with page or backend text.

(() => {
  if (window.__veilLoaded) return;
  window.__veilLoaded = true;

  const PLACEHOLDER_RE = /\[[A-Z_]+_\d+\]/;
  const PLACEHOLDER_SPLIT_RE = /(\[[A-Z_]+_\d+\])/g;

  // Input boxes per site, most specific first. All of them are contenteditable
  // except older ChatGPT builds, which used a <textarea>.
  const COMPOSER_SELECTORS = [
    "#prompt-textarea",
    "div.ProseMirror[contenteditable='true']",
    "rich-textarea .ql-editor[contenteditable='true']",
    "div[contenteditable='true'][role='textbox']",
    "div[contenteditable='true']",
    "textarea",
  ];

  // Paths that mean "new chat"; the site moves to a conversation URL after the
  // first message, and the session must follow it there.
  const NEW_CHAT_PATHS = new Set(["/", "/new", "/app", "/chat"]);

  // ------------------------------------------------------------------ settings

  const settings = { scanPastes: true, restoreInPage: true };
  try {
    chrome.storage.local.get(settings, (s) => {
      if (chrome.runtime.lastError || !s) return;
      settings.scanPastes = s.scanPastes !== false;
      settings.restoreInPage = s.restoreInPage !== false;
    });
    chrome.storage.onChanged.addListener((changes) => {
      if (changes.scanPastes) settings.scanPastes = changes.scanPastes.newValue !== false;
      if (changes.restoreInPage) settings.restoreInPage = changes.restoreInPage.newValue !== false;
    });
  } catch {
    // Extension context invalidated (reloaded); defaults stay on.
  }

  // ------------------------------------------------------------------ backend (via the background worker)

  const RELOADED = "VEIL was updated or reloaded. Refresh this page.";

  function send(msg) {
    return new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage(msg, (res) => {
          if (chrome.runtime.lastError || !res) {
            resolve({ ok: false, status: 0, offline: true, detail: RELOADED });
          } else {
            resolve(res);
          }
        });
      } catch {
        resolve({ ok: false, status: 0, offline: true, detail: RELOADED });
      }
    });
  }

  const api = (path, body) => send({ type: "api", path, body });

  // ------------------------------------------------------------------ conversation -> scan_id

  let currentKey = conversationKey();
  let currentScanId = null;

  function conversationKey() {
    return location.origin + location.pathname;
  }

  function isNewChatKey(key) {
    return NEW_CHAT_PATHS.has(new URL(key).pathname);
  }

  async function loadScanId() {
    const res = await send({ type: "getScanId", key: currentKey });
    currentScanId = (res && res.scanId) || null;
  }

  async function saveScanId(scanId) {
    currentScanId = scanId;
    await send({ type: "setScanId", key: currentKey, scanId });
  }

  async function onLocationChange() {
    const key = conversationKey();
    if (key === currentKey) return;
    const previousKey = currentKey;
    const previousScanId = currentScanId;
    currentKey = key;
    await loadScanId();
    // First message of a new chat: the site just moved to the conversation URL.
    if (!currentScanId && previousScanId && isNewChatKey(previousKey)) {
      await saveScanId(previousScanId);
      await send({ type: "setScanId", key: previousKey, scanId: null });
    }
    scheduleRestore();
  }

  setInterval(onLocationChange, 1000);
  loadScanId().then(scheduleRestore);

  // Scan `text` in the current chat's session. Returns the api() result.
  async function scanText(text) {
    await onLocationChange();
    let res = await api("/scan", currentScanId ? { text, scan_id: currentScanId } : { text });
    if (!res.ok && res.status === 404 && currentScanId) {
      // Backend restarted or the session expired: start a fresh one for this chat.
      await saveScanId(null);
      res = await api("/scan", { text });
    }
    if (res.ok && res.data && res.data.scan_id) await saveScanId(res.data.scan_id);
    return res;
  }

  // ------------------------------------------------------------------ the site's input box

  const host = document.createElement("div");
  host.id = "veil-root";
  host.style.all = "initial";

  function isVisible(el) {
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  }

  function isEditableHost(el) {
    if (el.tagName === "TEXTAREA") return true;
    const ce = el.getAttribute("contenteditable");
    return ce !== null && ce !== "false";
  }

  function findComposer() {
    const active = document.activeElement;
    if (active && !host.contains(active) && (active.isContentEditable || active.tagName === "TEXTAREA")) {
      return active.closest("[contenteditable='true']") || active;
    }
    for (const selector of COMPOSER_SELECTORS) {
      const match = [...document.querySelectorAll(selector)].find((el) => isVisible(el) && !host.contains(el));
      if (match) return match;
    }
    return null;
  }

  function readRaw(el) {
    return el.tagName === "TEXTAREA" ? el.value : el.innerText;
  }

  // Whitespace-insensitive form, for checking that a write landed (editors
  // normalise newlines and non-breaking spaces).
  function norm(text) {
    return text.replace(/\s+/g, " ").trim();
  }

  function captureSelection(el) {
    if (el.tagName === "TEXTAREA") return { start: el.selectionStart, end: el.selectionEnd };
    const sel = window.getSelection();
    if (sel && sel.rangeCount && el.contains(sel.anchorNode)) return { range: sel.getRangeAt(0).cloneRange() };
    return null;
  }

  function selectAll(el) {
    return el.tagName === "TEXTAREA"
      ? { start: 0, end: el.value.length }
      : (() => {
          const range = document.createRange();
          range.selectNodeContents(el);
          return { range };
        })();
  }

  function restoreSelection(el, saved) {
    el.focus();
    if (el.tagName === "TEXTAREA") {
      if (saved && saved.start != null) el.setSelectionRange(saved.start, saved.end);
      return;
    }
    const sel = window.getSelection();
    let range = saved && saved.range && saved.range.commonAncestorContainer.isConnected ? saved.range : null;
    if (!range || !el.contains(range.commonAncestorContainer)) {
      range = document.createRange();
      range.selectNodeContents(el);
      range.collapse(false); // caret at the end
    }
    sel.removeAllRanges();
    sel.addRange(range);
  }

  // Replace the saved selection of `el` with `text`. Returns what the box held
  // before and after, and whether the write landed.
  //   <textarea>: setRangeText + an 'input' event (React sees the change).
  //   contenteditable (ProseMirror, Quill): execCommand('insertText') on the
  //   focused editor goes through the editor's own input handling; if it is
  //   refused, a synthetic paste event carrying the text is the fallback.
  function insertText(el, text, saved) {
    const before = readRaw(el);
    restoreSelection(el, saved);
    if (el.tagName === "TEXTAREA") {
      el.setRangeText(text, el.selectionStart, el.selectionEnd, "end");
      el.dispatchEvent(new Event("input", { bubbles: true }));
      const after = readRaw(el);
      return { ok: after !== before || text === "", before, after };
    }
    let done = false;
    try {
      done = document.execCommand("insertText", false, text);
    } catch {
      done = false;
    }
    let after = readRaw(el);
    if (!done && after === before) {
      try {
        const data = new DataTransfer();
        data.setData("text/plain", text);
        el.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }));
      } catch {
        // Not supported; reported as a failed write below.
      }
      after = readRaw(el);
    }
    return { ok: done || after !== before, before, after };
  }

  // Replace the whole content of the box (manual flow, and undo of a paste in a contenteditable).
  function replaceAll(el, text) {
    const result = insertText(el, text, selectAll(el));
    return result.ok && norm(result.after) === norm(text);
  }

  // The part of `after` that is new compared with `before` (common prefix/suffix trimmed).
  function insertedSpan(before, after) {
    const max = Math.min(before.length, after.length);
    let start = 0;
    while (start < max && before[start] === after[start]) start++;
    let tail = 0;
    while (tail < max - start && before[before.length - 1 - tail] === after[after.length - 1 - tail]) tail++;
    return { start, end: after.length - tail };
  }

  // ------------------------------------------------------------------ UI (shadow DOM, isolated from the site's CSS)

  const root = host.attachShadow({ mode: "open" });
  root.innerHTML = `
    <style>
      :host { all: initial; }
      * { box-sizing: border-box; font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif; }
      .fab { position: fixed; right: 20px; bottom: 96px; z-index: 2147483646; display: flex; align-items: center; gap: 6px;
        padding: 7px 12px; border: 0; border-radius: 999px; background: #0f766e; color: #fff; font-size: 12px; font-weight: 600;
        cursor: pointer; box-shadow: 0 4px 14px rgba(15, 118, 110, .45); opacity: .92; }
      .fab:hover { background: #115e59; opacity: 1; }
      .fab:disabled { opacity: .7; cursor: progress; }
      .fab svg { width: 14px; height: 14px; }
      .panel { position: fixed; right: 20px; bottom: 140px; z-index: 2147483647; width: min(400px, calc(100vw - 40px));
        max-height: min(70vh, 640px); overflow: auto; border-radius: 14px; background: #0f172a; color: #e2e8f0;
        border: 1px solid #334155; box-shadow: 0 18px 50px rgba(0,0,0,.45); font-size: 13px; line-height: 1.45; }
      .panel[hidden] { display: none; }
      .head { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 10px 14px; border-bottom: 1px solid #1e293b; }
      .title { font-weight: 700; font-size: 14px; display: flex; align-items: center; gap: 8px; }
      .head-actions { display: flex; align-items: center; gap: 4px; }
      .link { background: none; border: 0; color: #94a3b8; font-size: 12px; cursor: pointer; padding: 2px 6px; }
      .link:hover { color: #e2e8f0; }
      .close { background: none; border: 0; color: #94a3b8; font-size: 18px; cursor: pointer; line-height: 1; }
      .body { padding: 12px 14px; display: grid; gap: 12px; }
      .muted { color: #94a3b8; font-size: 12px; }
      .headline { font-weight: 700; font-size: 14px; color: #fff; }
      .risk { padding: 2px 10px; border-radius: 999px; font-weight: 700; font-size: 12px; }
      .risk-NONE { background: #064e3b; color: #6ee7b7; } .risk-LOW { background: #1e3a8a; color: #93c5fd; }
      .risk-MEDIUM { background: #78350f; color: #fcd34d; } .risk-HIGH { background: #7f1d1d; color: #fca5a5; }
      .stats { display: flex; gap: 12px; flex-wrap: wrap; align-items: center; }
      .stats b { color: #fff; }
      .gemma-note { color: #5eead4; }
      ul { list-style: none; margin: 0; padding: 0; display: grid; gap: 6px; }
      li { display: grid; grid-template-columns: auto 1fr; gap: 2px 8px; padding: 8px; border-radius: 8px; background: #1e293b; }
      .type { font-family: ui-monospace, monospace; font-size: 11px; color: #cbd5e1; }
      .value { overflow-wrap: anywhere; color: #fff; }
      .meta { grid-column: 2; display: flex; gap: 6px; flex-wrap: wrap; align-items: center; }
      .badge { font-size: 11px; padding: 1px 7px; border-radius: 999px; }
      .src-gemma { background: #134e4a; color: #99f6e4; } .src-rule { background: #334155; color: #e2e8f0; }
      .ph { font-family: ui-monospace, monospace; font-size: 11px; padding: 0 4px; border-radius: 4px; background: #0c4a6e; color: #bae6fd; }
      .ph.red { background: #7f1d1d; color: #fecaca; }
      .reason { color: #99f6e4; font-size: 11px; }
      .label { font-size: 11px; font-weight: 700; letter-spacing: .04em; text-transform: uppercase; color: #94a3b8; margin-bottom: 4px; }
      .preview { white-space: pre-wrap; overflow-wrap: anywhere; padding: 10px; border-radius: 8px; background: #020617; border: 1px solid #1e293b; max-height: 180px; overflow: auto; }
      .actions { display: flex; gap: 8px; justify-content: flex-end; flex-wrap: wrap; }
      .btn { border: 0; border-radius: 8px; padding: 8px 12px; font-weight: 600; font-size: 13px; cursor: pointer; }
      .primary { background: #0f766e; color: #fff; } .primary:hover { background: #115e59; }
      .ghost { background: #1e293b; color: #e2e8f0; } .ghost:hover { background: #334155; }
      .error { padding: 10px; border-radius: 8px; background: #450a0a; color: #fecaca; border: 1px solid #7f1d1d; }
      .warn { padding: 10px; border-radius: 8px; background: #451a03; color: #fde68a; border: 1px solid #92400e; }
      .warn b { color: #fff; }
      .ok { padding: 10px; border-radius: 8px; background: #052e16; color: #bbf7d0; border: 1px solid #14532d; }
      .setting { display: flex; align-items: flex-start; gap: 8px; cursor: pointer; }
      .setting input { margin-top: 3px; }
      .spinner { width: 14px; height: 14px; border: 2px solid #5eead4; border-top-color: transparent; border-radius: 50%; animation: spin .8s linear infinite; flex: none; }
      @keyframes spin { to { transform: rotate(360deg); } }
    </style>
    <button class="fab" part="fab" title="Scan the whole prompt locally with VEIL (Alt+Shift+V)">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M12 3l8 3v6c0 4.5-3.4 8.3-8 9-4.6-.7-8-4.5-8-9V6l8-3z"/></svg>
      <span class="fab-label">VEIL</span>
    </button>
    <div class="panel" hidden role="dialog" aria-label="VEIL">
      <div class="head">
        <div class="title">VEIL <span class="head-risk"></span></div>
        <div class="head-actions">
          <button class="link settings-btn" title="VEIL settings">Settings</button>
          <button class="close" title="Close">×</button>
        </div>
      </div>
      <div class="body"></div>
    </div>`;
  document.documentElement.appendChild(host);

  const fab = root.querySelector(".fab");
  const fabLabel = root.querySelector(".fab-label");
  const panel = root.querySelector(".panel");
  const body = root.querySelector(".body");
  const headRisk = root.querySelector(".head-risk");
  root.querySelector(".close").addEventListener("click", hidePanel);
  root.querySelector(".settings-btn").addEventListener("click", showSettings);

  function h(tag, attrs = {}, children = []) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === "class") el.className = v;
      else if (k === "text") el.textContent = v;
      else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v);
    }
    for (const child of [].concat(children)) {
      if (child != null) el.append(child);
    }
    return el;
  }

  let hideTimer = null;

  function hidePanel() {
    clearTimeout(hideTimer);
    panel.hidden = true;
  }

  // Replace the panel content. `hideAfter` (ms) closes it again by itself.
  function show(nodes, hideAfter = 0) {
    clearTimeout(hideTimer);
    body.replaceChildren(...[].concat(nodes).filter(Boolean));
    panel.hidden = false;
    if (hideAfter) hideTimer = setTimeout(hidePanel, hideAfter);
  }

  function showError(message) {
    headRisk.replaceChildren();
    show(h("div", { class: "error", text: message }));
  }

  function showSettings() {
    headRisk.replaceChildren();
    const toggle = (key, label, hint) => {
      const input = h("input", { type: "checkbox" });
      input.checked = settings[key];
      input.addEventListener("change", () => {
        settings[key] = input.checked;
        try {
          chrome.storage.local.set({ [key]: input.checked });
        } catch {
          // Extension reloaded; the in-memory value still applies on this page.
        }
      });
      return h("label", { class: "setting" }, [
        input,
        h("span", {}, [h("b", { text: label }), h("div", { class: "muted", text: hint })]),
      ]);
    };
    show([
      toggle("scanPastes", "Scan what I paste", "Pastes into the chat box are scanned locally and sanitized before they appear."),
      toggle("restoreInPage", "Restore real values in AI replies", "Placeholders in replies are swapped back to the real values on this screen only."),
      h("div", { class: "actions" }, [h("button", { class: "btn ghost", text: "Done", onclick: hidePanel })]),
    ]);
  }

  function renderSanitized(text, redactedPlaceholders) {
    return text.split(PLACEHOLDER_SPLIT_RE).map((part) =>
      PLACEHOLDER_RE.test(part) ? h("span", { class: "ph" + (redactedPlaceholders.has(part) ? " red" : ""), text: part }) : part,
    );
  }

  function sourceBadge(e) {
    return h("span", { class: `badge src-${e.source}`, text: e.source === "gemma" ? "Gemma" : "Rule" });
  }

  // ------------------------------------------------------------------ automatic: scan on paste

  const SKIPPED = Symbol("skipped");
  let queue = Promise.resolve(); // pastes are processed one at a time so scan_id and order stay consistent
  let bypassText = null; // a sanitized text the user was told to paste by hand; let that one through

  function copyToClipboard(text) {
    return navigator.clipboard ? navigator.clipboard.writeText(text).then(() => true, () => false) : Promise.resolve(false);
  }

  function showScanning(job) {
    headRisk.replaceChildren();
    show([
      h("div", { class: "stats muted" }, [h("span", { class: "spinner" }), "VEIL is scanning your paste locally…"]),
      h("div", { class: "muted", text: "Rules are instant; Gemma can take 5-10 seconds. Your text goes only to this machine." }),
      h("div", { class: "actions" }, [h("button", { class: "btn ghost", text: "Paste original instead", onclick: job.skip })]),
    ]);
  }

  // Put `text` in the job's box. Falls back to the clipboard (and says so) if the box is gone or refuses.
  async function placeInBox(job, text, what) {
    let el = job.el;
    let saved = job.saved;
    if (!el.isConnected) {
      el = findComposer();
      saved = null;
    }
    if (el) {
      const result = insertText(el, text, saved);
      if (result.ok) return { ok: true, el, ...result, span: insertedSpan(result.before, result.after) };
    }
    const copied = await copyToClipboard(text);
    if (copied) bypassText = text;
    return { ok: false, copied, what };
  }

  function placeFailedMessage(failed) {
    return failed.copied
      ? `VEIL couldn't put the ${failed.what} text into this site's input box. It is on your clipboard: press Ctrl+V to paste it.`
      : `VEIL couldn't put the ${failed.what} text into this site's input box and couldn't copy it either. Copy it from the original source again.`;
  }

  function filesNote(job) {
    return job.hadFiles
      ? h("div", { class: "muted", text: "A file or image in this paste was not inserted: VEIL cannot scan files." })
      : null;
  }

  function showOfflineWarning(job, reason) {
    headRisk.replaceChildren();
    show(
      [
        h("div", { class: "warn" }, [h("b", { text: "VEIL is offline: pasted without scanning. " }), reason]),
        h("div", { class: "muted", text: "The text above went into the box exactly as you copied it. Check it before you send." }),
        filesNote(job),
        h("div", { class: "actions" }, [h("button", { class: "btn ghost", text: "Dismiss", onclick: hidePanel })]),
      ],
      15000,
    );
  }

  function offlineReason(res) {
    if (res.status === 413) return "The paste is too long for VEIL to scan.";
    if (res.status === 503) return "VEIL is still loading Gemma. Try again in a minute.";
    if (res.status === 400) return "";
    return res.detail || "The VEIL backend did not answer.";
  }

  function undoPaste(job, placed) {
    const el = placed.el;
    let ok = false;
    if (el.isConnected) {
      const current = readRaw(el);
      const inserted = placed.after.slice(placed.span.start, placed.span.end);
      let start = -1;
      if (current === placed.after) start = placed.span.start;
      else if (inserted) start = current.indexOf(inserted);
      if (start >= 0) {
        const end = start + inserted.length;
        if (el.tagName === "TEXTAREA") {
          el.focus();
          el.setRangeText(job.text, start, end, "end");
          el.dispatchEvent(new Event("input", { bubbles: true }));
          ok = true;
        } else {
          ok = replaceAll(el, current.slice(0, start) + job.text + current.slice(end));
        }
      }
    }
    headRisk.replaceChildren();
    if (ok) {
      show(
        [
          h("div", { class: "warn" }, [h("b", { text: "Original pasted. " }), "The private values are back in the box and will reach the AI if you send it."]),
          h("div", { class: "actions" }, [h("button", { class: "btn ghost", text: "Dismiss", onclick: hidePanel })]),
        ],
        8000,
      );
    } else {
      copyToClipboard(job.text).then((copied) => {
        if (copied) bypassText = job.text;
        showError(
          copied
            ? "VEIL couldn't undo automatically (the box changed). The original text is on your clipboard: select the sanitized text and press Ctrl+V."
            : "VEIL couldn't undo automatically (the box changed). Copy the original from its source again.",
        );
      });
    }
  }

  function showHidden(job, scan, placed) {
    const entities = scan.entities;
    const redacted = new Set(entities.filter((e) => e.redacted).map((e) => e.replacement));
    headRisk.replaceChildren(h("span", { class: `risk risk-${scan.risk}`, text: scan.risk }));
    const count = entities.length;
    const list = h(
      "ul",
      {},
      entities.map((e) =>
        h("li", {}, [
          h("span", { class: "type", text: e.type }),
          h("span", { class: "value" }, [h("span", { class: "ph" + (e.redacted ? " red" : ""), text: e.replacement })]),
          h("span", { class: "meta" }, [
            sourceBadge(e),
            e.count > 1 ? h("span", { class: "muted", text: `${e.count} times` }) : null,
            e.redacted ? h("span", { class: "muted", text: "never restored" }) : null,
            e.reason ? h("span", { class: "reason", text: e.reason }) : null,
          ]),
        ]),
      ),
    );
    const notes = [];
    if (!scan.gemma_used) notes.push(h("div", { class: "muted", text: "Gemma wasn't used for this scan, so only rule-based findings are shown." }));
    show(
      [
        h("div", { class: "headline", text: `VEIL hid ${count} private value${count === 1 ? "" : "s"}` }),
        h("div", { class: "muted", text: `The box now holds the placeholder version (${scan.timings_ms.total} ms on this device).` }),
        list,
        ...notes,
        filesNote(job),
        h("div", { class: "actions" }, [
          h("button", { class: "btn ghost", text: "Undo (paste original)", onclick: () => undoPaste(job, placed) }),
          h("button", { class: "btn primary", text: "OK", onclick: hidePanel }),
        ]),
      ],
      30000,
    );
  }

  async function processPaste(job) {
    showScanning(job);
    const scanPromise = scanText(job.text);
    const outcome = await Promise.race([scanPromise, job.skipped]);

    if (outcome === SKIPPED) {
      const placed = await placeInBox(job, job.text, "original");
      if (placed.ok) {
        show(
          [
            h("div", { class: "warn" }, [h("b", { text: "Pasted without scanning. " }), "You chose to paste the original text."]),
            h("div", { class: "actions" }, [h("button", { class: "btn ghost", text: "Dismiss", onclick: hidePanel })]),
          ],
          6000,
        );
      } else {
        showError(placeFailedMessage(placed));
      }
      return; // the late scan result still updates the chat's scan_id inside scanText
    }

    if (!outcome.ok) {
      const placed = await placeInBox(job, job.text, "original");
      if (!placed.ok) {
        showError(placeFailedMessage(placed));
      } else if (outcome.status === 400) {
        hidePanel(); // blank after trimming: nothing to scan
      } else {
        showOfflineWarning(job, offlineReason(outcome));
      }
      return;
    }

    const scan = outcome.data;
    if (!scan.entities || scan.entities.length === 0 || scan.sanitized_text === job.text) {
      const placed = await placeInBox(job, job.text, "original");
      if (!placed.ok) {
        showError(placeFailedMessage(placed));
        return;
      }
      headRisk.replaceChildren();
      show([h("div", { class: "ok", text: "VEIL: nothing private found in this paste." }), filesNote(job)], 3000);
      return;
    }

    // Private values found: only the sanitized text may go into the box. If that
    // fails, the original must not be inserted instead.
    const placed = await placeInBox(job, scan.sanitized_text, "sanitized");
    if (!placed.ok) {
      showError(placeFailedMessage(placed));
      return;
    }
    showHidden(job, scan, placed);
  }

  function onPaste(event) {
    if (!event.isTrusted || !settings.scanPastes) return;
    const path = event.composedPath();
    if (path.includes(host)) return;
    const el = path.find((n) => n instanceof Element && isEditableHost(n));
    const data = event.clipboardData;
    if (!el || !data) return;

    const text = data.getData("text/plain");
    const hadFiles = (data.files && data.files.length > 0) || [...(data.items || [])].some((i) => i.kind === "file");
    if (!text || !text.trim()) {
      if (hadFiles) {
        headRisk.replaceChildren();
        show(h("div", { class: "warn", text: "VEIL does not scan files or images. This paste went through unscanned." }), 6000);
      }
      return; // let the site handle it
    }
    if (bypassText !== null && text === bypassText) {
      bypassText = null;
      return; // the user pasted the sanitized/original text VEIL put on the clipboard
    }

    // Hold the paste back: the site's own paste handlers must not see the raw text.
    event.preventDefault();
    event.stopImmediatePropagation();

    let skip;
    const skipped = new Promise((resolve) => (skip = () => resolve(SKIPPED)));
    const job = { el, text, saved: captureSelection(el), hadFiles, skip, skipped };
    queue = queue
      .then(() => processPaste(job))
      .catch(async () => {
        // Whatever went wrong, the user's paste must not be lost.
        const placed = await placeInBox(job, job.text, "original");
        if (placed.ok) showOfflineWarning(job, "Something went wrong while scanning.");
        else showError(placeFailedMessage(placed));
      });
  }

  // Capture phase on window: runs before the site's own paste handlers.
  window.addEventListener("paste", onPaste, true);

  // ------------------------------------------------------------------ manual: scan the whole prompt

  let scanning = false;

  function renderResult(scan, composer) {
    const entities = scan.entities;
    const gemmaOnly = entities.filter((e) => e.source === "gemma").length;
    const redacted = new Set(entities.filter((e) => e.redacted).map((e) => e.replacement));
    headRisk.replaceChildren(h("span", { class: `risk risk-${scan.risk}`, text: scan.risk }));

    const stats = h("div", { class: "stats muted" }, [
      h("span", {}, [h("b", { text: String(entities.length) }), " private"]),
      h("span", {}, [h("b", { text: String(entities.length - gemmaOnly) }), " by rules"]),
      h("span", { class: "gemma-note" }, [h("b", { text: String(gemmaOnly) }), " only Gemma understood"]),
      h("span", { text: `${scan.timings_ms.total} ms on this device` }),
    ]);

    const notes = [];
    if (!scan.gemma_used) {
      notes.push(h("div", { class: "muted", text: "Gemma wasn't used for this scan, so only rule-based findings are shown." }));
    }

    const list = entities.length
      ? h("ul", {}, entities.map((e) =>
          h("li", {}, [
            h("span", { class: "type", text: e.type }),
            h("span", { class: "value", text: e.redacted ? "(secret, hidden)" : e.text }),
            h("span", { class: "meta" }, [
              h("span", { class: "ph" + (e.redacted ? " red" : ""), text: e.replacement }),
              sourceBadge(e),
              e.redacted ? h("span", { class: "muted", text: "never restored" }) : null,
              e.reason ? h("span", { class: "reason", text: e.reason }) : null,
            ]),
          ]),
        ))
      : h("div", { class: "ok", text: "Nothing private found. You can send this prompt as is." });

    const preview = h("div", {}, [
      h("div", { class: "label", text: "What the AI will see" }),
      h("div", { class: "preview" }, renderSanitized(scan.sanitized_text, redacted)),
    ]);

    const useButton = h("button", {
      class: "btn primary",
      text: "Use sanitized prompt",
      onclick: async () => {
        const target = composer && composer.isConnected ? composer : findComposer();
        if (!target || !replaceAll(target, scan.sanitized_text)) {
          const copied = await copyToClipboard(scan.sanitized_text);
          if (copied) bypassText = scan.sanitized_text;
          showError(
            copied
              ? "Couldn't replace the text in this site's input box. The sanitized prompt was copied; select all in the box and paste it in."
              : "Couldn't replace the text in this site's input box, and couldn't copy it either.",
          );
          return;
        }
        headRisk.replaceChildren();
        show(h("div", { class: "ok", text: "Sanitized prompt is in the box. Press Send as usual; private values in the reply are restored on your screen." }), 3000);
      },
    });
    const cancel = h("button", { class: "btn ghost", text: "Cancel", onclick: hidePanel });

    show([stats, ...notes, list, entities.length ? preview : null, h("div", { class: "actions" }, [cancel, entities.length ? useButton : null])]);
  }

  async function runScan() {
    if (scanning) return;
    const composer = findComposer();
    const text = composer ? readRaw(composer).replace(/\u00a0/g, " ").trim() : "";
    if (!text) {
      showError("Type or paste your prompt in the chat box first, then click VEIL.");
      return;
    }

    scanning = true;
    fab.disabled = true;
    fabLabel.textContent = "Scanning…";
    headRisk.replaceChildren();
    show(h("div", { class: "stats muted" }, [h("span", { class: "spinner" }), "Scanning this prompt locally with VEIL…"]));

    try {
      const res = await scanText(text);
      if (!res.ok) {
        showError(res.status === 503 ? `VEIL is starting: ${res.detail}` : res.detail);
        return;
      }
      renderResult(res.data, composer);
    } finally {
      scanning = false;
      fab.disabled = false;
      fabLabel.textContent = "VEIL";
    }
  }

  fab.addEventListener("click", runScan);
  document.addEventListener("keydown", (e) => {
    if (e.altKey && e.shiftKey && e.code === "KeyV") {
      e.preventDefault();
      runScan();
    }
  }, true);

  // ------------------------------------------------------------------ restore real values in replies (on this screen only)

  const restoredText = new WeakMap(); // text node -> the text VEIL wrote into it
  let restoreTimer = null;

  function isInsideEditable(node) {
    const el = node.parentElement;
    return !el || !!el.closest("[contenteditable='true'], textarea, input, script, style");
  }

  function candidateNodes() {
    const nodes = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
      acceptNode: (node) =>
        PLACEHOLDER_RE.test(node.nodeValue) && restoredText.get(node) !== node.nodeValue && !isInsideEditable(node)
          ? NodeFilter.FILTER_ACCEPT
          : NodeFilter.FILTER_SKIP,
    });
    while (walker.nextNode()) nodes.push(walker.currentNode);
    return nodes;
  }

  async function restoreNames() {
    restoreTimer = null;
    if (!settings.restoreInPage || !currentScanId || !document.body) return;
    const scanId = currentScanId;
    for (const node of candidateNodes().slice(0, 200)) {
      const original = node.nodeValue;
      const res = await api("/rehydrate", { scan_id: scanId, text: original });
      if (!res.ok) {
        if (res.status === 404) await saveScanId(null);
        return;
      }
      // Skip if the site re-rendered the node while we were waiting.
      if (node.isConnected && node.nodeValue === original) {
        node.nodeValue = res.data.text;
        restoredText.set(node, res.data.text);
      }
    }
  }

  function scheduleRestore() {
    if (!restoreTimer) restoreTimer = setTimeout(restoreNames, 300);
  }

  new MutationObserver(scheduleRestore).observe(document.documentElement, {
    childList: true,
    subtree: true,
    characterData: true,
  });
})();
