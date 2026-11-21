"""Envelope, errors, transport and SSE. Generated from templates; capability methods are in capabilities.py."""
from __future__ import annotations

import json
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass, field
from typing import Any, Iterator

from .capabilities import Capabilities

DEFAULT_BASE_URL = "http://127.0.0.1:4790"
DEFAULT_TIMEOUT = 30.0
API_VERSION = "1.0.0"


class codes:
    """Stable error.code values. TRANSPORT and BAD_RESPONSE are produced by this client, never by the server."""

    BAD_CONFIG = "BAD_CONFIG"
    BAD_INPUT = "BAD_INPUT"
    BAD_LOCK = "BAD_LOCK"
    BAD_RESPONSE = "BAD_RESPONSE"
    CONFIRM_REQUIRED = "CONFIRM_REQUIRED"
    CONFLICT = "CONFLICT"
    EXISTS = "EXISTS"
    FAILED = "FAILED"
    FORBIDDEN = "FORBIDDEN"
    GH_FAILED = "GH_FAILED"
    GIT_FAILED = "GIT_FAILED"
    IMPORT_FAILED = "IMPORT_FAILED"
    INTEGRITY = "INTEGRITY"
    INTERNAL = "INTERNAL"
    INVALID = "INVALID"
    INVALID_THEME = "INVALID_THEME"
    MISSING_TEMPLATE = "MISSING_TEMPLATE"
    NOT_FETCHED = "NOT_FETCHED"
    NOT_FOUND = "NOT_FOUND"
    NO_LOCK = "NO_LOCK"
    NO_PROJECT = "NO_PROJECT"
    REGISTRY_ERROR = "REGISTRY_ERROR"
    SECRETS_FOUND = "SECRETS_FOUND"
    STALE_INDEX = "STALE_INDEX"
    TAMPERED = "TAMPERED"
    TASK_FAILED = "TASK_FAILED"
    TRANSPORT = "TRANSPORT"
    UNKNOWN_CAPABILITY = "UNKNOWN_CAPABILITY"
    UNSAFE = "UNSAFE"


@dataclass
class Envelope:
    ok: bool
    data: Any
    error: dict | None
    next: list[str] = field(default_factory=list)


class FactoryError(Exception):
    """ok=false from the factory (code is one of codes.*) or a failed call (TRANSPORT / BAD_RESPONSE)."""

    def __init__(self, code: str, message: str, status: int = 0, details: Any = None, next: list[str] | None = None):
        super().__init__(f"{code}: {message}")
        self.code, self.message, self.status, self.details, self.next = code, message, status, details, next or []


@dataclass
class Event:
    name: str
    data: Any


def _envelope(status: int, raw: bytes) -> Envelope:
    try:
        v = json.loads(raw)
        env = Envelope(bool(v["ok"]), v.get("data"), v.get("error"), list(v.get("next") or []))
    except (ValueError, KeyError, TypeError, AttributeError) as e:
        raise FactoryError(codes.BAD_RESPONSE, f"HTTP {status}: not an envelope ({e})", status) from None
    if not env.ok:
        err = env.error or {}
        raise FactoryError(err.get("code", codes.FAILED), err.get("message", ""), status, err.get("details"), env.next)
    return env


class Client(Capabilities):
    def __init__(self, base_url: str | None = None, timeout: float = DEFAULT_TIMEOUT):
        self.base_url = (base_url or DEFAULT_BASE_URL).rstrip("/")
        self.timeout = timeout

    def _open(self, req: urllib.request.Request):
        try:
            return urllib.request.urlopen(req, timeout=self.timeout)
        except urllib.error.HTTPError as e:  # non-2xx still carries an envelope
            return e
        except (urllib.error.URLError, OSError) as e:
            raise FactoryError(codes.TRANSPORT, str(e)) from None

    def _request(self, method: str, path: str, body: Any = None) -> tuple[int, bytes]:
        data = None if body is None else json.dumps(body).encode()
        req = urllib.request.Request(self.base_url + path, data=data, method=method)
        req.add_header("Accept", "application/json")
        if data is not None:
            req.add_header("Content-Type", "application/json")
        resp = self._open(req)
        try:
            return resp.status, resp.read(64 << 20)
        except OSError as e:
            raise FactoryError(codes.TRANSPORT, str(e)) from None
        finally:
            resp.close()

    def call(self, name: str, input: dict | None = None) -> Envelope:
        """POST /api/<name>. None values in input are dropped. Raises FactoryError when ok is false."""
        payload = {k: v for k, v in (input or {}).items() if v is not None}
        return _envelope(*self._request("POST", f"/api/{name}", payload))

    def capabilities(self) -> Envelope:
        return _envelope(*self._request("GET", "/capabilities"))

    def openapi(self) -> dict:
        return json.loads(self._request("GET", "/openapi.json")[1])

    def events(self, project: str, since: str | None = None) -> Iterator[Event]:
        """GET /events?project=<dir>[&since=ISO] as a generator of progress events. Close it to disconnect."""
        q = {"project": project, **({"since": since} if since else {})}
        req = urllib.request.Request(f"{self.base_url}/events?{urllib.parse.urlencode(q)}")
        req.add_header("Accept", "text/event-stream")
        resp = self._open(req)
        if resp.status != 200:
            resp.close()
            raise FactoryError(codes.TRANSPORT, f"events: HTTP {resp.status}", resp.status)
        try:
            name, data = "", []
            for raw in resp:
                line = raw.decode("utf-8").rstrip("\r\n")
                if line == "":
                    if data:
                        try:
                            yield Event(name, json.loads("\n".join(data)))
                        except ValueError as e:
                            raise FactoryError(codes.BAD_RESPONSE, str(e)) from None
                    name, data = "", []
                elif line.startswith("event:"):
                    name = line[6:].strip()
                elif line.startswith("data:"):
                    data.append(line[5:].removeprefix(" "))
        except OSError as e:
            raise FactoryError(codes.TRANSPORT, str(e)) from None
        finally:
            resp.close()
