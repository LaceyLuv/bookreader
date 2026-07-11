"""Uvicorn entry-point for the BookReader backend."""

import argparse
import socket
import sys
import uvicorn

from main import app


PORT_IN_USE_EXIT_CODE = 98


def parse_args():
    parser = argparse.ArgumentParser(description="BookReader backend launcher")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", default=8000, type=int)
    parser.add_argument("--nonce")
    return parser.parse_args()


def is_port_available(host: str, port: int) -> bool:
    """Return True when the backend can bind host:port before uvicorn starts."""
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        try:
            sock.bind((host, port))
        except OSError:
            return False
    return True


def run_backend(host: str, port: int, nonce: str | None = None) -> int:
    if nonce:
        import main
        main.SIDECAR_NONCE = nonce
    if not is_port_available(host, port):
        print(
            f"BookReader backend cannot start because {host}:{port} is already in use.",
            file=sys.stderr,
        )
        return PORT_IN_USE_EXIT_CODE

    uvicorn.run("main:app", host=host, port=port)
    return 0


if __name__ == "__main__":
    args = parse_args()
    raise SystemExit(run_backend(args.host, args.port, args.nonce))
