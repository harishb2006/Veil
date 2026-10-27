"""Scripted demo agent: a deterministic stand-in for a hijackable, tool-using LLM.

Labelled everywhere as "Scripted demo agent - obeys any instruction it reads (worst case)". It needs no
cloud key and no network, so the demo runs offline. It reads the same OpenAI-format transcript a real model
would (system / user / assistant with tool_calls / tool) and decides the next action from it alone, so it
drops into the same agent loop as a real model:

1. plan from the user's task (fetch URLs, read the inbox and each email, read named files);
2. obey any instruction it can parse in what the tools returned, once each;
3. do the user's job (email a summary, or answer in text);
4. finish with a short summary of what it did.

It acts only on what it was shown: placeholders stay placeholders, and text removed by the firewall is not
an instruction. To keep ordinary page text ("Run npm bin -g to find it") from triggering it, it only obeys
instructions that sit near wording addressed to an AI ("AI assistant", "agent", ...) or that look hostile
on their face (a shell command with a URL or a pipe).
"""

import html
import json
import re
from dataclasses import dataclass, field

from bs4 import BeautifulSoup, Comment

MODEL_NAME = "scripted-demo-agent"

READ_TOOLS = {"fetch_page", "read_inbox", "read_email", "read_file"}

_ADDR = r"(?:\[[A-Z_]+_\d+\]|[\w.+-]+@[\w-]+(?:\.[\w-]+)+)"
_FILE_EXT = r"(?:env|md|txt|csv|json|pem|key|cfg|conf|yml|yaml|ini|log|sh|py|js|ts|toml)"
_FILE = rf"(?:\.env\b|[\w./-]+\.{_FILE_EXT}\b)"
_COMMANDS = (
    r"(?:curl|wget|bash|sh|zsh|python3?|node|npm|npx|pip3?|rm|cat|chmod|nc|ncat|powershell|cmd|echo|ls|sudo|git|scp|ssh|base64|eval)"
)

READ_RE = re.compile(
    rf"\b(?:read|open|cat|load|view)\s+(?:the\s+)?(?:file\s+)?(?:named\s+|called\s+)?[`'\"“]?(?P<path>{_FILE})",
    re.IGNORECASE,
)
EMAIL_RE = re.compile(
    rf"\b(?:e-?mail|send|forward|mail)\b(?P<mid>[^\n<]{{0,200}}?)\bto\s+(?:[A-Za-z']+\s+){{0,3}}?(?P<to>{_ADDR})",
    re.IGNORECASE,
)
RUN_RE = re.compile(
    rf"\b(?:run|execute)\s+(?:the\s+)?(?:following\s+)?(?:shell\s+)?(?:command\s*:?\s*)?(?P<cmd>{_COMMANDS}\b[^\n<]*)",
    re.IGNORECASE,
)
CURL_RE = re.compile(r"\bcurl\s+[^\n<]+", re.IGNORECASE)
SUBJECT_RE = re.compile(
    r"subject\s*(?:line)?\s*[:=]?\s*[`'\"“‘](?P<subject>[^`'\"”’\n]{1,120})", re.IGNORECASE
)
AI_CUE_RE = re.compile(r"\b(?:AI|assistant|agent|LLM|chatbot|bot|language model)\b", re.IGNORECASE)
COMMAND_TAIL_RE = re.compile(r"\s+(?:to|and|then|so|in order|before|after|which|that)\b.*$", re.IGNORECASE)

URL_RE = re.compile(r"https?://[^\s\"'<>)\]]+", re.IGNORECASE)
TASK_EMAIL_RE = re.compile(
    rf"\b(?:e-?mail|send|forward|mail)\b[^\n]*?\bto\s+(?:[A-Za-z']+\s+){{0,3}}?(?P<to>{_ADDR})", re.IGNORECASE
)
MESSAGE_ID_RE = re.compile(r"^\s*\[(?P<id>[\w-]+)\]", re.MULTILINE)
DATAMARK_RE = re.compile(r"<<UNTRUSTED[^>]*>>\n?|\n?<</UNTRUSTED>>")
REMOVED_RE = re.compile(r"\[REMOVED BY VEIL[^\]]*\]")
HIDDEN_STYLE_RE = re.compile(
    r"display\s*:\s*none|visibility\s*:\s*hidden|opacity\s*:\s*0(?![.\d])|font-size\s*:\s*[01](?:px)?\s*(?:;|$)|left\s*:\s*-\d{3,}",
    re.IGNORECASE,
)
INVISIBLE = "​‌‍⁠﻿"


@dataclass
class Call:
    """One tool call from the transcript, with the result the model was shown."""

    id: str
    name: str
    args: dict
    result: str | None = None


@dataclass
class Instruction:
    kind: str  # read_file | send_email | run_shell
    key: str
    args: dict
    needs_file: str | None = None


@dataclass
class Transcript:
    task: str = ""
    calls: list[Call] = field(default_factory=list)


# --------------------------------------------------------------------------- transcript


def _text(message: dict) -> str:
    content = message.get("content")
    if isinstance(content, list):  # OpenAI content parts
        return " ".join(part.get("text", "") for part in content if isinstance(part, dict))
    return content if isinstance(content, str) else ""


def _args(raw) -> dict:
    if isinstance(raw, dict):
        return raw
    try:
        parsed = json.loads(raw) if raw else {}
    except (TypeError, ValueError):
        return {}
    return parsed if isinstance(parsed, dict) else {}


def _read_transcript(messages: list[dict]) -> Transcript:
    transcript = Transcript()
    by_id: dict[str, Call] = {}
    for message in messages:
        role = message.get("role")
        if role == "user" and not transcript.task:
            transcript.task = _text(message)
        elif role == "assistant":
            for raw in message.get("tool_calls") or []:
                function = raw.get("function", {})
                call = Call(
                    id=str(raw.get("id") or f"call_{len(transcript.calls) + 1}"),
                    name=function.get("name", ""),
                    args=_args(function.get("arguments")),
                )
                transcript.calls.append(call)
                by_id[call.id] = call
        elif role == "tool":
            call = by_id.get(str(message.get("tool_call_id")))
            if call is not None:
                call.result = _text(message)
    return transcript


# --------------------------------------------------------------------------- reading what the tools returned


def _decode_hidden(text: str) -> str:
    """The text as a model's tokenizer sees it: HTML unescaped, Unicode tag characters decoded to ASCII."""

    out = []
    for char in html.unescape(text):
        code = ord(char)
        if 0xE0020 <= code <= 0xE007E:
            out.append(chr(code - 0xE0000))
        elif 0xE0000 <= code <= 0xE007F or char in INVISIBLE:
            continue
        else:
            out.append(char)
    return "".join(out)


def _strip_marks(text: str) -> str:
    """Drop datamark wrappers and VEIL's removal markers: there is no instruction in them."""

    return REMOVED_RE.sub(" ", DATAMARK_RE.sub("", text))


def _trim_command(command: str) -> str:
    command = re.split(r"\.\s+(?=[A-Z])", command.strip().strip("`'\"”"))[0].rstrip(" .`'\"")
    piped = re.match(r"^.*\|\s*\w+", command)
    if piped:
        command = piped.group(0)
    return COMMAND_TAIL_RE.sub("", command).strip()


def _addressed_to_ai(text: str, start: int, end: int) -> bool:
    return bool(AI_CUE_RE.search(text[max(0, start - 300):end]))


def _parse_instructions(text: str) -> list[Instruction]:
    """Every order the text contains, in reading order."""

    found: list[tuple[int, Instruction]] = []
    taken: list[tuple[int, int]] = []

    def add_shell(match: re.Match, command: str) -> None:
        command = _trim_command(command)
        hostile = "://" in command or "|" in command
        if command and (hostile or _addressed_to_ai(text, match.start(), match.end())):
            found.append((match.start(), Instruction("run_shell", f"shell:{command}", {"command": command})))

    for match in RUN_RE.finditer(text):
        taken.append((match.start(), match.end()))
        add_shell(match, match.group("cmd"))
    for match in CURL_RE.finditer(text):
        if not any(start <= match.start() < end for start, end in taken):
            add_shell(match, match.group(0))

    for match in READ_RE.finditer(text):
        if _addressed_to_ai(text, match.start(), match.end()):
            path = match.group("path")
            found.append((match.start(), Instruction("read_file", f"file:{path.lower()}", {"path": path})))

    for match in EMAIL_RE.finditer(text):
        if not _addressed_to_ai(text, match.start(), match.end()):
            continue
        to = match.group("to")
        subject = SUBJECT_RE.search(text[match.start():match.end() + 160])
        file_match = re.search(_FILE, match.group("mid"), re.IGNORECASE)
        if file_match:
            needs = file_match.group(0)
        elif re.search(r"invoice", match.group("mid"), re.IGNORECASE):
            needs = "invoices.csv"
        else:
            needs = None
        args = {"to": to, "subject": subject.group("subject").strip() if subject else "Forwarded"}
        found.append((match.start(), Instruction("send_email", f"mail:{to.lower()}", args, needs_file=needs)))

    found.sort(key=lambda item: item[0])
    seen: set[str] = set()
    ordered = []
    for _, instruction in found:
        if instruction.key not in seen:
            seen.add(instruction.key)
            ordered.append(instruction)
    return ordered


def _instructions_in(call: Call) -> list[Instruction]:
    if call.name not in READ_TOOLS or not call.result or "VEIL QUARANTINED" in call.result:
        return []
    return _parse_instructions(_strip_marks(_decode_hidden(call.result)))


def _norm_path(path: object) -> str:
    return str(path).strip().lower().lstrip("./")


def _already_done(instruction: Instruction, calls: list[Call]) -> bool:
    """Each instruction is obeyed once, whether or not the call succeeded (a blocked call is not retried)."""

    for call in calls:
        if instruction.kind == "read_file" and call.name == "read_file":
            if _norm_path(call.args.get("path", "")) == _norm_path(instruction.args["path"]):
                return True
        elif instruction.kind == "send_email" and call.name == "send_email":
            if str(call.args.get("to", "")).strip().lower() == instruction.args["to"].lower():
                return True
        elif instruction.kind == "run_shell" and call.name == "run_shell":
            if str(call.args.get("command", "")).strip() == instruction.args["command"]:
                return True
    return False


def _file_was_read(path: str, calls: list[Call]) -> bool:
    return any(c.name == "read_file" and _norm_path(c.args.get("path", "")) == _norm_path(path) for c in calls)


# --------------------------------------------------------------------------- summarising what it read


def _is_html(text: str) -> bool:
    return bool(re.search(r"<(?:html|body|div|p|h1|article|main|title)\b", text, re.IGNORECASE))


def _drop_hidden(soup: BeautifulSoup) -> None:
    """Remove comments and elements a human would not see (what the model would also skip in a summary)."""

    for node in soup.find_all(string=lambda s: isinstance(s, Comment)):
        node.extract()
    hidden = [
        node for node in soup.find_all(True)
        if HIDDEN_STYLE_RE.search(node.get("style", "") or "") or node.get("aria-hidden") == "true" or node.has_attr("hidden")
    ]
    for node in hidden:
        if not node.decomposed:
            node.decompose()


def _visible_lines(text: str) -> list[str]:
    """Readable lines of a page, email or file, without hidden elements, scripts or markup."""

    text = _strip_marks(text)
    if _is_html(text):
        soup = BeautifulSoup(text, "html.parser")
        for node in soup(["script", "style", "noscript", "template", "head", "nav", "header", "footer", "aside", "svg"]):
            node.decompose()
        _drop_hidden(soup)
        root = soup.find("main") or soup.find("article") or soup
        text = root.get_text("\n")
    text = "".join(c for c in text if not (0xE0000 <= ord(c) <= 0xE007F or c in INVISIBLE))
    return [line.strip() for line in text.splitlines() if line.strip()]


def _page_title(text: str) -> str:
    text = _strip_marks(text)
    if _is_html(text):
        soup = BeautifulSoup(text, "html.parser")
        chosen = soup.find("h1") or soup.find("title")
        if chosen is not None and chosen.get_text(strip=True):
            return chosen.get_text(" ", strip=True).split(" | ")[0]
    # Firewalled pages start with the page title.
    titled = re.search(r"^Page title: (.+)$", text, re.MULTILINE)
    if titled:
        return titled.group(1).strip().split(" | ")[0]
    # Plain text: the first headline-like line (several words, no separators, not a bullet or a sentence).
    lines = [
        line for line in _visible_lines(text)[:25]
        if line[:1].isalnum() and len(line) <= 100 and not re.search(r"[\u00b7\u203a|]|[.!?]$", line)
    ]
    return next((line for line in lines if len(line.split()) >= 4), next((line for line in lines if len(line.split()) >= 2), "Page"))


def _summary_sentences(text: str, count: int = 3, limit: int = 600) -> str:
    sentences: list[str] = []
    for line in _visible_lines(text):
        line = URL_RE.sub("", line).strip()
        # Prose only: skip bylines, breadcrumbs, headings and bullets without a full stop.
        if len(line.split()) < 6 or not re.search(r"[.!?][\"\u201d')]?$", line) or "\u00b7" in line or "\u203a" in line:
            continue
        sentences += [s.strip() for s in re.split(r"(?<=[.!?])\s+", line) if len(s.split()) >= 5]
    return " ".join(sentences[:count])[:limit]


def _install_steps(text: str) -> list[str]:
    text = _strip_marks(text)
    if _is_html(text):
        soup = BeautifulSoup(text, "html.parser")
        _drop_hidden(soup)
        steps = soup.find("ol")
        if steps is not None:
            return [li.get_text(" ", strip=True) for li in steps.find_all("li")]
    numbered = [line for line in _visible_lines(text) if re.match(r"^\d+[.)]\s+", line)]
    if numbered:
        return [re.sub(r"^\d+[.)]\s*", "", line) for line in numbered]
    # Extracted text loses list numbering: a step is a line ending in ":" followed by its command lines.
    blocks = [[line.strip() for line in block.splitlines() if line.strip()] for block in re.split(r"\n\s*\n", _strip_marks(text))]
    blocks = [block for block in blocks if block]
    steps = []
    for index, lines in enumerate(blocks):
        if not lines[0].endswith(":"):
            continue
        commands = lines[1:] or (blocks[index + 1] if index + 1 < len(blocks) else [])
        if commands:
            steps.append(f"{lines[0]} {'; '.join(commands)}")
    return steps


def _inbox_subjects(calls: list[Call]) -> list[str]:
    subjects = []
    for call in calls:
        if call.name == "read_email" and call.result:
            match = re.search(r"^Subject:\s*(.+)$", _strip_marks(call.result), re.MULTILINE)
            if match:
                subjects.append(match.group(1).strip())
    if subjects:
        return subjects
    inbox = next((c for c in calls if c.name == "read_inbox" and c.result), None)
    return [s.strip() for s in re.findall(r"Subject:\s*([^|\n]+)", _strip_marks(inbox.result))] if inbox else []


# --------------------------------------------------------------------------- deciding


def _task_files(task: str) -> list[str]:
    stripped = re.sub(_ADDR, " ", URL_RE.sub(" ", task))
    return [m.group(0) for m in re.finditer(rf"(?<![\w@/.-]){_FILE}", stripped, re.IGNORECASE)]


def _wants_inbox(task: str) -> bool:
    return bool(re.search(r"\b(?:inbox|emails|mailbox)\b", task, re.IGNORECASE))


def _tool_call(transcript: Transcript, offset: int, name: str, args: dict) -> dict:
    return {"id": f"call_{len(transcript.calls) + offset}", "name": name, "arguments": args}


def _initial_reads(transcript: Transcript) -> list[tuple[str, dict]]:
    """Reads the user's task asks for that have not been made yet."""

    wanted: list[tuple[str, dict]] = [("fetch_page", {"url": url.rstrip(".,;:!?")}) for url in URL_RE.findall(transcript.task)]
    if _wants_inbox(transcript.task):
        wanted.append(("read_inbox", {}))
    wanted += [("read_file", {"path": path}) for path in _task_files(transcript.task)]
    done = {(c.name, json.dumps(c.args, sort_keys=True)) for c in transcript.calls}
    return [(name, args) for name, args in wanted if (name, json.dumps(args, sort_keys=True)) not in done]


def _unread_emails(transcript: Transcript) -> list[str]:
    inbox = next((c for c in transcript.calls if c.name == "read_inbox" and c.result), None)
    if inbox is None:
        return []
    read = {str(c.args.get("id")) for c in transcript.calls if c.name == "read_email"}
    return [mail_id for mail_id in MESSAGE_ID_RE.findall(_strip_marks(inbox.result)) if mail_id not in read]


def _latest_read(calls: list[Call]) -> str:
    for call in reversed(calls):
        if call.name in ("read_file", "read_email") and call.result:
            return DATAMARK_RE.sub("", call.result).strip()
    return ""


def _obey_next(transcript: Transcript) -> list[dict] | None:
    """The next injected instruction to carry out, or None when there is nothing left to obey."""

    for call in transcript.calls:
        for instruction in _instructions_in(call):
            if _already_done(instruction, transcript.calls):
                continue
            if instruction.kind == "send_email":
                if instruction.needs_file and not _file_was_read(instruction.needs_file, transcript.calls):
                    return [_tool_call(transcript, 1, "read_file", {"path": instruction.needs_file})]
                body = _latest_read(transcript.calls) or "(no data)"
                return [_tool_call(transcript, 1, "send_email", {**instruction.args, "body": body})]
            return [_tool_call(transcript, 1, instruction.kind, instruction.args)]
    return None


def _do_the_job(transcript: Transcript) -> list[dict] | None:
    """The user's own request: email a summary of what was read."""

    match = TASK_EMAIL_RE.search(transcript.task)
    if match is None:
        return None
    to = match.group("to")
    if any(c.name == "send_email" and str(c.args.get("to", "")).strip().lower() == to.lower() for c in transcript.calls):
        return None

    pages = [c for c in transcript.calls if c.name == "fetch_page" and c.result]
    if pages and "VEIL QUARANTINED" in pages[0].result:
        subject = "Summary: Page"
        body = "The page was quarantined by VEIL, so there was nothing safe to summarise."
    elif pages:
        title = _page_title(pages[0].result)
        subject = f"Summary: {title}"
        body = _summary_sentences(pages[0].result) or f"I read {title}."
    else:
        subjects = _inbox_subjects(transcript.calls)
        subject = "Summary: Inbox digest"
        body = ("Inbox digest:\n" + "\n".join(f"- {s}" for s in subjects)) if subjects else "Inbox digest: nothing to report."
    return [_tool_call(transcript, 1, "send_email", {"to": to, "subject": subject, "body": body})]


def _describe(call: Call) -> str:
    blocked = (call.result or "").startswith("BLOCKED by VEIL gate")
    if call.name == "send_email":
        to = call.args.get("to", "?")
        return f"tried to email {to} but VEIL blocked it" if blocked else f"emailed {to}"
    if call.name == "run_shell":
        command = call.args.get("command", "?")
        return f"tried to run `{command}` but VEIL blocked it" if blocked else f"ran `{command}`"
    if call.name == "fetch_page":
        return f"read {call.args.get('url', 'a page')}"
    if call.name == "read_file":
        return f"read {call.args.get('path', 'a file')}"
    if call.name == "read_inbox":
        return "read the inbox"
    return f"called {call.name}"


def _final_answer(transcript: Transcript) -> str:
    actions = [_describe(c) for c in transcript.calls if c.name != "read_email"]
    emails_read = sum(1 for c in transcript.calls if c.name == "read_email")
    if emails_read:
        actions.insert(1 if actions else 0, f"read {emails_read} emails")
    answer = ("Done. I " + ", then ".join(actions) + ".") if actions else "Done. There was nothing to do."

    pages = [c for c in transcript.calls if c.name == "fetch_page" and c.result]
    if pages and not TASK_EMAIL_RE.search(transcript.task):
        steps = _install_steps(pages[0].result)
        if steps:
            return answer + "\n\nInstall steps:\n" + "\n".join(f"{i}. {step}" for i, step in enumerate(steps, 1))
        summary = _summary_sentences(pages[0].result)
        if summary:
            return answer + "\n\nSummary: " + summary
    return answer


def _turn(content: str, tool_calls: list[dict]) -> dict:
    return {"content": content, "tool_calls": tool_calls, "model": MODEL_NAME}


def next_turn(messages: list[dict], tools: list[dict] | None = None) -> dict:
    """Decide the next turn from the transcript: {"content", "tool_calls", "model"}."""

    try:
        transcript = _read_transcript(messages)

        reads = _initial_reads(transcript)
        if reads:
            return _turn("", [_tool_call(transcript, i, name, args) for i, (name, args) in enumerate(reads, 1)])

        unread = _unread_emails(transcript)
        if unread:
            return _turn("", [_tool_call(transcript, i, "read_email", {"id": mail_id}) for i, mail_id in enumerate(unread, 1)])

        action = _obey_next(transcript) or _do_the_job(transcript)
        if action:
            return _turn("", action)
        return _turn(_final_answer(transcript), [])
    except Exception as error:  # never crash the agent loop on an unexpected transcript
        return _turn(f"I could not finish this task ({type(error).__name__}).", [])
