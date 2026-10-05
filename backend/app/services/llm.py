"""Local LLM access through Ollama (which runs llama.cpp underneath).

Every call names a `task` so prompts are traceable in logs and so tests can
substitute deterministic responders (see `register_fake`)."""
import base64
import json
import logging
import re
import time
from collections.abc import Callable
from typing import Any

import httpx

from app.config import settings

log = logging.getLogger(__name__)


class LLMError(Exception):
    pass


_fakes: dict[str, Callable[[list[dict], dict | None], Any]] = {}


def register_fake(task: str, fn: Callable[[list[dict], dict | None], Any]) -> None:
    """Test hook: answer `task` with `fn(messages, schema)` instead of calling Ollama."""
    _fakes[task] = fn


def clear_fakes() -> None:
    _fakes.clear()


_THINK = re.compile(r"<think>.*?</think>", re.S | re.I)


def strip_thinking(text: str) -> str:
    """Reasoning models (DeepSeek-R1, QwQ…) write their working inside <think>…</think> before the
    answer; only the answer is used. An unterminated block (cut off by the token limit) is dropped too."""
    text = _THINK.sub("", text)
    if "<think>" in text.lower():
        text = text[: text.lower().index("<think>")]
    return text.strip()


def options_for(model: str, temperature: float, max_tokens: int | None) -> dict:
    # Ollama's default context window (2–4k tokens) silently cuts off long prompts: the instructions
    # and early excerpts fall out, and answers stop following the sources. Ask for a window that fits
    # our prompts (several excerpts + history) while still fitting an 8 GB GPU with a 7–8B model.
    opts: dict[str, Any] = {"temperature": temperature, "num_ctx": settings.llm_num_ctx}
    if max_tokens:
        opts["num_predict"] = max_tokens
    return opts


def _extract_json(text: str) -> Any:
    text = strip_thinking(text)
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        pass
    m = re.search(r"```(?:json)?\s*(.+?)```", text, re.S)
    if m:
        try:
            return json.loads(m.group(1))
        except json.JSONDecodeError:
            pass
    for open_c, close_c in (("{", "}"), ("[", "]")):
        a, b = text.find(open_c), text.rfind(close_c)
        if a != -1 and b > a:
            try:
                return json.loads(text[a : b + 1])
            except json.JSONDecodeError:
                continue
    raise LLMError("Model did not return valid JSON")


def chat(
    messages: list[dict],
    *,
    task: str,
    schema: dict | None = None,
    model: str | None = None,
    temperature: float = 0.2,
    images: list[bytes] | None = None,
    max_tokens: int | None = None,
) -> Any:
    """Returns parsed JSON when `schema` is given (a JSON schema dict), else text."""
    if task in _fakes:
        return _fakes[task](messages, schema)

    msgs = [dict(m) for m in messages]
    if images:
        msgs[-1]["images"] = [base64.b64encode(i).decode() for i in images]
    body: dict[str, Any] = {
        "model": model or settings.llm_model,
        "messages": msgs,
        "stream": False,
        "options": options_for(model or settings.llm_model, temperature, max_tokens),
        # Keep the model loaded between questions so a student doesn't wait for it to reload each time.
        "keep_alive": settings.llm_keep_alive,
    }
    if schema is not None:
        body["format"] = schema

    last_err: Exception | None = None
    for attempt in range(2):
        t0 = time.time()
        try:
            with httpx.Client(timeout=settings.llm_timeout_s) as c:
                r = c.post(f"{settings.ollama_url}/api/chat", json=body)
            if r.status_code == 404 and "not found" in r.text:
                raise LLMError(
                    f"Model '{body['model']}' is not pulled. Run: docker compose exec ollama ollama pull {body['model']}"
                )
            r.raise_for_status()
            content = r.json()["message"]["content"]
            log.info("llm task=%s model=%s %.1fs", task, body["model"], time.time() - t0)
            return _extract_json(content) if schema is not None else strip_thinking(content)
        except LLMError as e:
            last_err = e
            if "not pulled" in str(e):
                break
        except (httpx.HTTPError, KeyError) as e:
            last_err = LLMError(f"LLM unavailable: {e}")
        time.sleep(1.5 * (attempt + 1))
    raise last_err or LLMError("LLM call failed")


def available() -> bool:
    if _fakes:
        return True
    try:
        with httpx.Client(timeout=3) as c:
            r = c.get(f"{settings.ollama_url}/api/tags")
        return r.status_code == 200
    except httpx.HTTPError:
        return False


def obj(properties: dict[str, Any], required: list[str] | None = None) -> dict:
    return {"type": "object", "properties": properties, "required": required or list(properties)}


def arr(items: dict) -> dict:
    return {"type": "array", "items": items}


S = {"type": "string"}
N = {"type": "number"}
INT = {"type": "integer"}
B = {"type": "boolean"}
