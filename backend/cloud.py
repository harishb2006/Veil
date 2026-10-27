"""Cloud model client (OpenAI-compatible chat/completions). Only ever sent sanitized text."""

import json
import logging
import os

import httpx

logger = logging.getLogger("veil.cloud")

# Tells the cloud model how to treat the placeholders the inner door puts in its input.
CLOUD_SYSTEM_PROMPT = (
    "Some values in the user's message were replaced with placeholders like "
    "[PERSON_1], [EMAIL_1] or [API_KEY_1] to protect privacy. Treat each placeholder "
    "as the real value it stands for, reuse placeholders exactly as written when you "
    "refer to them, and never guess or invent the original values."
)

SCRIPTED_MODEL = "scripted-demo-agent"


class CloudError(RuntimeError):
    """Raised when the cloud provider is unconfigured or returns an error."""


def _config() -> tuple[str, str, str]:
    base_url = os.getenv("CLOUD_BASE_URL", "https://api.openai.com/v1").rstrip("/")
    api_key = os.getenv("CLOUD_API_KEY", "")
    model = os.getenv("CLOUD_MODEL", "")
    return base_url, api_key, model


def is_configured() -> bool:
    _, api_key, model = _config()
    return bool(api_key and model)


def _post(base_url: str, api_key: str, payload: dict) -> httpx.Response:
    return httpx.post(
        f"{base_url}/chat/completions",
        headers={"Authorization": f"Bearer {api_key}"},
        json=payload,
        timeout=60,
    )


def chat(messages: list[dict]) -> tuple[str, str]:
    """Send sanitized chat messages; return (answer_text, model_name)."""

    base_url, api_key, model = _config()
    if not (api_key and model):
        raise CloudError("Cloud model is not configured (set CLOUD_API_KEY and CLOUD_MODEL).")

    payload = {"model": model, "messages": messages, "temperature": 0.3}
    try:
        response = _post(base_url, api_key, payload)
        # Some models only accept the default temperature.
        if response.status_code == 400 and "temperature" in response.text:
            payload.pop("temperature")
            response = _post(base_url, api_key, payload)
    except httpx.HTTPError as error:
        raise CloudError(f"Cloud request failed: {type(error).__name__}: {error}") from error

    if response.status_code != 200:
        raise CloudError(f"Cloud model returned HTTP {response.status_code}: {response.text[:300]}")

    try:
        data = response.json()
        answer = data["choices"][0]["message"]["content"] or ""
    except (ValueError, KeyError, IndexError, TypeError) as error:
        raise CloudError("Cloud model returned an unexpected response shape.") from error

    return answer, data.get("model", model)


def agent_provider() -> str:
    """"openai" when a cloud key + model are set (and not overridden), else the scripted demo agent."""

    if os.getenv("AGENT_PROVIDER", "").strip().lower() == "scripted":
        return "scripted"
    return "openai" if is_configured() else "scripted"


def agent_model() -> str:
    return _config()[2] if agent_provider() == "openai" else SCRIPTED_MODEL


def _parse_arguments(raw, tool_name: str) -> dict:
    """Tool-call arguments arrive as a JSON string; anything unparseable becomes {}."""

    if isinstance(raw, dict):
        return raw
    try:
        parsed = json.loads(raw) if raw else {}
    except (TypeError, ValueError):
        logger.error("Could not parse arguments of tool call %r: %r", tool_name, str(raw)[:300])
        return {}
    if not isinstance(parsed, dict):
        logger.error("Arguments of tool call %r are not a JSON object: %r", tool_name, str(raw)[:300])
        return {}
    return parsed


def chat_tools(messages: list[dict], tools: list[dict]) -> dict:
    """One agent turn: send the transcript + tool schemas, return the model's text and tool calls.

    Returns {"content": str, "tool_calls": [{"id", "name", "arguments": dict}], "model": str}.
    """

    base_url, api_key, model = _config()
    if not (api_key and model):
        raise CloudError("Cloud model is not configured (set CLOUD_API_KEY and CLOUD_MODEL).")

    payload = {"model": model, "messages": messages, "temperature": 0.3}
    if tools:
        payload["tools"] = tools
        payload["tool_choice"] = "auto"
    try:
        response = _post(base_url, api_key, payload)
        # Some models only accept the default temperature.
        if response.status_code == 400 and "temperature" in response.text:
            payload.pop("temperature")
            response = _post(base_url, api_key, payload)
    except httpx.HTTPError as error:
        raise CloudError(f"Cloud request failed: {type(error).__name__}: {error}") from error

    if response.status_code != 200:
        raise CloudError(f"Cloud model returned HTTP {response.status_code}: {response.text[:300]}")

    try:
        data = response.json()
        message = data["choices"][0]["message"]
        content = message.get("content") or ""
        raw_calls = message.get("tool_calls") or []
        tool_calls = [
            {
                "id": call.get("id") or f"call_{index + 1}",
                "name": call["function"]["name"],
                "arguments": _parse_arguments(call["function"].get("arguments"), call["function"]["name"]),
            }
            for index, call in enumerate(raw_calls)
        ]
    except (ValueError, KeyError, IndexError, TypeError, AttributeError) as error:
        raise CloudError("Cloud model returned an unexpected response shape.") from error

    return {"content": content, "tool_calls": tool_calls, "model": data.get("model", model)}
