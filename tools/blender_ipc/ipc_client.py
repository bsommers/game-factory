#!/usr/bin/env python3
"""
Sandbox-friendly file-based IPC client for the Blender Live GUI Bridge.

Works from inside macOS Seatbelt / container sandboxes as long as the shared
IPC directory is readable/writable by both the agent and the live Blender process.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
from pathlib import Path
from typing import Any


def default_ipc_dir(root: str | Path | None = None) -> Path:
    if os.environ.get("BLENDER_IPC_DIR"):
        return Path(os.environ["BLENDER_IPC_DIR"]).expanduser().resolve()
    base = Path(root or os.environ.get("BLENDER_IPC_ROOT") or os.getcwd()).expanduser().resolve()
    return base / "work" / "blender_ipc"


class BlenderIPCClient:
    """Atomic inbox/outbox client for driving a live Blender GUI session."""

    def __init__(self, ipc_dir: str | Path | None = None, root: str | Path | None = None):
        self.ipc_dir = Path(ipc_dir).expanduser().resolve() if ipc_dir else default_ipc_dir(root)
        self.inbox = self.ipc_dir / "inbox"
        self.outbox = self.ipc_dir / "outbox"

    def wait_ready(self, timeout: float = 45.0, poll_interval: float = 0.25) -> dict[str, Any]:
        ready = self.outbox / "bridge_ready.json"
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            if ready.exists():
                try:
                    return json.loads(ready.read_text(encoding="utf-8"))
                except json.JSONDecodeError:
                    pass
            time.sleep(poll_interval)
        raise TimeoutError(f"Timed out waiting for Blender Live Bridge beacon at {ready}")

    def send(self, payload: dict[str, Any], timeout: float = 120.0, poll_interval: float = 0.2) -> dict[str, Any]:
        self.inbox.mkdir(parents=True, exist_ok=True)
        self.outbox.mkdir(parents=True, exist_ok=True)
        cmd_id = f"{time.time_ns()}_{os.getpid()}"
        in_file = self.inbox / f"{cmd_id}.json"
        tmp = in_file.with_suffix(".tmp")
        tmp.write_text(json.dumps(payload, indent=2), encoding="utf-8")
        os.replace(tmp, in_file)

        out_file = self.outbox / f"{cmd_id}.json"
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            if out_file.exists():
                data = json.loads(out_file.read_text(encoding="utf-8"))
                out_file.unlink(missing_ok=True)
                if not data.get("ok"):
                    raise RuntimeError(f"Blender Live Bridge command failed:\n{data.get('error')}")
                return data
            time.sleep(poll_interval)
        raise TimeoutError(f"Timed out waiting for Blender IPC response for {cmd_id}")

    def ping(self, timeout: float = 15.0) -> dict[str, Any]:
        return self.send({"action": "ping"}, timeout=timeout)

    def status(self, timeout: float = 15.0) -> dict[str, Any]:
        return self.send({"action": "status"}, timeout=timeout)

    def exec_file(self, script: str | Path, timeout: float = 120.0) -> dict[str, Any]:
        return self.send({"action": "exec_file", "script": str(Path(script).expanduser().resolve())}, timeout=timeout)

    def exec_code(self, code: str, timeout: float = 120.0) -> dict[str, Any]:
        return self.send({"action": "exec_code", "code": code}, timeout=timeout)

    def snapshot(
        self,
        filename: str,
        label: str = "Live Capture",
        angle_deg: float = -20.0,
        elev_deg: float = 12.0,
        dist: float = 0.36,
        target: tuple[float, float, float] = (0.0, 0.0, 0.09),
        timeout: float = 120.0,
    ) -> dict[str, Any]:
        return self.send(
            {
                "action": "snapshot",
                "filename": filename,
                "label": label,
                "angle_deg": angle_deg,
                "elev_deg": elev_deg,
                "dist": dist,
                "target": list(target),
            },
            timeout=timeout,
        )

    def set_orbit(self, enabled: bool, speed_deg: float | None = None, timeout: float = 15.0) -> dict[str, Any]:
        payload: dict[str, Any] = {"action": "orbit", "enabled": bool(enabled)}
        if speed_deg is not None:
            payload["speed_deg"] = float(speed_deg)
        return self.send(payload, timeout=timeout)


def wait_for_bridge(timeout: float = 45.0, ipc_dir: str | Path | None = None) -> dict[str, Any]:
    return BlenderIPCClient(ipc_dir=ipc_dir).wait_ready(timeout=timeout)


def send_cmd(payload: dict[str, Any], timeout: float = 120.0, ipc_dir: str | Path | None = None) -> dict[str, Any]:
    return BlenderIPCClient(ipc_dir=ipc_dir).send(payload, timeout=timeout)


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description="Drive an interactive Blender Live GUI session over file IPC.")
    p.add_argument("--ipc-dir", help="IPC directory (default: $BLENDER_IPC_DIR or <cwd>/work/blender_ipc)")
    p.add_argument("--timeout", type=float, default=120.0, help="Command timeout in seconds")
    g = p.add_mutually_exclusive_group(required=True)
    g.add_argument("--wait", action="store_true", help="Wait for bridge_ready.json beacon")
    g.add_argument("--ping", action="store_true", help="Send ping health check")
    g.add_argument("--status", action="store_true", help="Query scene and bridge status")
    g.add_argument("--exec-code", help="Execute inline Python snippet inside Blender")
    g.add_argument("--orbit", choices=("on", "off"), help="Enable or disable viewport turntable orbit")
    g.add_argument("--snapshot", metavar="FILENAME", help="Render live studio snapshot PNG")
    g.add_argument("script", nargs="?", help="Python script file to execute inside Blender")
    p.add_argument("--label", default="Live Capture", help="Label for --snapshot")
    args = p.parse_args(argv)

    client = BlenderIPCClient(ipc_dir=args.ipc_dir)
    if args.wait:
        res = client.wait_ready(timeout=args.timeout)
    elif args.ping:
        res = client.ping(timeout=args.timeout)
    elif args.status:
        res = client.status(timeout=args.timeout)
    elif args.exec_code:
        res = client.exec_code(args.exec_code, timeout=args.timeout)
    elif args.orbit:
        res = client.set_orbit(args.orbit == "on", timeout=args.timeout)
    elif args.snapshot:
        res = client.snapshot(args.snapshot, label=args.label, timeout=args.timeout)
    else:
        res = client.exec_file(args.script, timeout=args.timeout)
    print(json.dumps(res, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
