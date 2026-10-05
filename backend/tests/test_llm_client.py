"""The real Ollama client (no fakes) against a stub server that speaks Ollama's
/api/chat protocol: request shape, structured-output schema, JSON parsing,
image payloads and the 'model not pulled' error."""
import json
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer

import pytest

from app.config import settings
from app.services import llm

SEEN: list[dict] = []


class Stub(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def do_GET(self):
        self.send_response(200)
        self.end_headers()
        self.wfile.write(b'{"models": []}')

    def do_POST(self):
        body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
        SEEN.append(body)
        if body["model"] == "missing:1b":
            self.send_response(404)
            self.end_headers()
            self.wfile.write(b'{"error": "model \\"missing:1b\\" not found, try pulling it first"}')
            return
        if body.get("format"):
            content = '```json\n{"covered": true, "answer": "V = IR [1]"}\n```'
        else:
            content = "  plain text answer  "
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(json.dumps({"message": {"role": "assistant", "content": content}}).encode())


@pytest.fixture()
def stub(monkeypatch):
    srv = HTTPServer(("127.0.0.1", 0), Stub)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    monkeypatch.setattr(settings, "ollama_url", f"http://127.0.0.1:{srv.server_port}")
    saved = dict(llm._fakes)
    llm.clear_fakes()
    SEEN.clear()
    yield
    llm._fakes.update(saved)
    srv.shutdown()


def test_structured_output(stub):
    schema = llm.obj({"covered": llm.B, "answer": llm.S})
    out = llm.chat([{"role": "user", "content": "q"}], task="t", schema=schema, model="m:1b", images=[b"\x89PNG"])
    assert out == {"covered": True, "answer": "V = IR [1]"}
    req = SEEN[-1]
    assert req["model"] == "m:1b" and req["stream"] is False and req["format"] == schema
    assert req["messages"][-1]["images"] == ["iVBORw=="]


def test_plain_text(stub):
    assert llm.chat([{"role": "user", "content": "q"}], task="t") == "plain text answer"
    assert llm.available()


def test_missing_model_message(stub):
    with pytest.raises(llm.LLMError, match="ollama pull missing:1b"):
        llm.chat([{"role": "user", "content": "q"}], task="t", model="missing:1b")
