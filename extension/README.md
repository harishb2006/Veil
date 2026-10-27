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
current tab when you click the button, and for access to `localhost:8000` and `127.0.0.1:8000`. Page scanning stores
nothing. The chat-site feature (below) adds a small background service worker, the `storage` permission and a content
script that runs only on `chatgpt.com`, `chat.openai.com`, `claude.ai` and `gemini.google.com`.

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

## On ChatGPT, Claude and Gemini

This is the inner door of VEIL: it keeps private values out of what you send to an AI chat. It works on
`chatgpt.com`, `chat.openai.com`, `claude.ai` and `gemini.google.com`. Reload tabs that were open before you installed
or updated the extension.

### What happens when you paste

1. You paste text into the chat box. VEIL holds the paste back, so the site never sees the raw text.
2. A panel says **VEIL is scanning your paste locally...** while the rules and Gemma run on your machine (Gemma can
   take 5 to 10 seconds on a laptop; rules are instant). **Paste original instead** skips the scan.
3. If something private is found, the box receives the sanitized text with placeholders such as `[EMAIL_1]` or
   `[PERSON_1]`, and the panel says **VEIL hid N private value(s)**. Each finding lists its type, its placeholder and
   whether a **Rule** or **Gemma** found it. Real values are not shown in this panel.
4. **Undo (paste original)** swaps the placeholders back for what you copied, if you change your mind.
5. If nothing private is found, the original text is inserted and a short "nothing private" note appears.

Placeholders are kept per chat: `[PERSON_1]` is the same person for the whole conversation, because the extension
reuses the backend's `scan_id` for that chat.

### If VEIL is offline

If the backend is not running, still loading Gemma, answers with an error, or the paste is longer than the backend
accepts (20,000 characters), the **original** text is inserted and the panel says **VEIL is offline: pasted without
scanning**, with the reason. Your paste is never lost, but it is also not protected in that case: check it before
you send.

### Scan the whole prompt by hand

Click the small **VEIL** button (bottom right) or press **Alt+Shift+V**. The whole prompt in the box is scanned, the
panel shows the findings and what the AI will see, and **Use sanitized prompt** replaces the box content. Use this for
text you typed yourself or pasted before VEIL was running.

### Real values in the AI's reply

When a reply contains placeholders, VEIL asks the backend to restore them and shows the real values **on your screen
only**. Secrets (API keys, passwords, card numbers, IDs) are never restored by the backend and stay masked. The same
happens for your own sanitized message in the chat history.

### Settings

Click **Settings** in the VEIL panel (open it with the VEIL button): **Scan what I paste** and **Restore real values
in AI replies** can each be turned off. They are saved in the browser.

### Limits

- **Only text pastes are scanned automatically.** Typing, drag and drop, and dictation are not; use the manual scan for
  those. A paste that is only a file or an image goes through unscanned (the panel says so). If a paste carries both
  text and a file or image, the text is scanned and inserted and the file part is dropped.
- **File uploads on the AI sites are not scanned.**
- **Sending is not blocked.** If you send without pasting through VEIL or clicking the VEIL button, the prompt goes out
  unscanned.
- **The sites change their markup often.** Paste detection works on any `<textarea>` or `contenteditable` box and the
  insertion goes through the editor's own input handling, but a site update can break it. If VEIL cannot put the text in
  the box it copies it to your clipboard and tells you to press Ctrl+V.
- **Restored values live in the site's page.** A real name shown in a reply is visible to that site's own scripts on
  your screen, although VEIL never sent it in a request. Turn off **Restore real values in AI replies** to keep replies
  as placeholders.
- **Undo replaces the box content as text**, so formatting and anything you added after the paste may be affected.
- **Not tested on the live sites yet.** The code was syntax-checked but has not been run in Chrome against ChatGPT,
  Claude or Gemini.

## Limits (page scan)

- Browser pages such as `chrome://` and the Web Store cannot be scanned.
- Very long pages are cut at 190,000 characters before scanning.
- It reads the page's HTML, so text hidden only by an external stylesheet is treated as visible.
- With Gemma on, a scan takes a few seconds on a laptop with integrated graphics; repeated scans of the same page
  come from VEIL's answer cache.
