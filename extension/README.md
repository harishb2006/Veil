# VEIL browser extension

A small Chrome (Manifest V3) extension that sends the page you are looking at to VEIL running on your own machine
and shows what it found: hidden or plain-sight instructions aimed at AI agents, whether a rule or Gemma found them,
and what an agent would read after VEIL cleaned the page.

It is the outer door of VEIL, in your browser. It does not block anything by itself; it shows you what an agent
browsing this page would have been told to do.

## What it needs

- The VEIL backend running on `http://localhost:8000` (see the main README, or `scripts\start.ps1`).
- Chrome, Edge or another Chromium browser.

The page's HTML goes only to `localhost:8000`. The extension asks for `activeTab` and `scripting` so it can read the
current tab when you click the button, and for access to `localhost:8000`. It has no background script and stores
nothing.

## Install (unpacked)

1. Open `chrome://extensions` (or `edge://extensions`).
2. Turn on **Developer mode**.
3. Click **Load unpacked** and pick this `extension` folder.
4. Pin **VEIL: scan this page** to the toolbar.

## Use it

1. Start VEIL. With Gemma on, wait until the backend window says Gemma is loaded.
2. Open a page, for example the demo page served by the web console:
   `http://localhost:3000/demo/aurora-x2.html` (a normal-looking product page with a hidden order for AI agents).
3. Click the VEIL icon, then **Scan this page**.

You get a verdict (clean, instructions removed, or quarantined), each finding with its severity, whether it was
hidden from you, and whether a rule or Gemma found it, plus the cleaned text an agent would read. The toolbar badge
shows `OK` or the number of findings for that tab.

## Limits

- Browser pages such as `chrome://` and the Web Store cannot be scanned.
- Very long pages are cut at 190,000 characters before scanning.
- It reads the page's HTML, so text hidden only by an external stylesheet is treated as visible.
- With Gemma on, a scan takes a few seconds on a laptop with integrated graphics; repeated scans of the same page
  come from VEIL's answer cache.
