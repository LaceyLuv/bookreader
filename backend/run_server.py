"""Uvicorn entry-point for the BookReader backend."""

import argparse
import ctypes
import os
import socket
import sys
import threading
import time
import uvicorn

from main import app


PORT_IN_USE_EXIT_CODE = 98
PARENT_WATCHDOG_FAILURE_EXIT_CODE = 99
SYNCHRONIZE = 0x00100000
WAIT_OBJECT_0 = 0x00000000
WAIT_FAILED = 0xFFFFFFFF
INFINITE = 0xFFFFFFFF


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


def start_parent_watchdog(parent_pid_value: str | None = None):
    """Exit the sidecar when its owning desktop process is gone."""
    raw_value = parent_pid_value if parent_pid_value is not None else os.environ.get("BOOKREADER_PARENT_PID")
    if not raw_value:
        return None
    try:
        parent_pid = int(raw_value)
    except (TypeError, ValueError) as exc:
        raise RuntimeError("BOOKREADER_PARENT_PID must be a positive integer.") from exc
    if parent_pid <= 0 or parent_pid == os.getpid():
        raise RuntimeError("BOOKREADER_PARENT_PID must identify a different live process.")

    if os.name == "nt":
        kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
        kernel32.OpenProcess.argtypes = [ctypes.c_uint32, ctypes.c_int, ctypes.c_uint32]
        kernel32.OpenProcess.restype = ctypes.c_void_p
        kernel32.WaitForSingleObject.argtypes = [ctypes.c_void_p, ctypes.c_uint32]
        kernel32.WaitForSingleObject.restype = ctypes.c_uint32
        kernel32.CloseHandle.argtypes = [ctypes.c_void_p]
        kernel32.CloseHandle.restype = ctypes.c_int
        parent_handle = kernel32.OpenProcess(SYNCHRONIZE, False, parent_pid)
        if not parent_handle:
            error = ctypes.get_last_error()
            raise RuntimeError(f"Cannot watch BookReader parent process {parent_pid} (Windows error {error}).")

        def watch_windows_parent():
            result = kernel32.WaitForSingleObject(parent_handle, INFINITE)
            kernel32.CloseHandle(parent_handle)
            os._exit(0 if result == WAIT_OBJECT_0 else PARENT_WATCHDOG_FAILURE_EXIT_CODE)

        thread = threading.Thread(target=watch_windows_parent, name="bookreader-parent-watchdog", daemon=True)
        thread.start()
        return thread

    def watch_posix_parent():
        while True:
            try:
                os.kill(parent_pid, 0)
            except ProcessLookupError:
                os._exit(0)
            except PermissionError:
                os._exit(PARENT_WATCHDOG_FAILURE_EXIT_CODE)
            time.sleep(0.5)

    thread = threading.Thread(target=watch_posix_parent, name="bookreader-parent-watchdog", daemon=True)
    thread.start()
    return thread


def run_backend(host: str, port: int, nonce: str | None = None) -> int:
    start_parent_watchdog()
    if nonce:
        import main
        main.SIDECAR_NONCE = nonce
    if not is_port_available(host, port):
        print(
            f"BookReader backend cannot start because {host}:{port} is already in use.",
            file=sys.stderr,
        )
        return PORT_IN_USE_EXIT_CODE

    # Packaged asset URLs carry a per-launch token. Do not emit access lines
    # containing those query strings into the parent desktop process output.
    packaged_sidecar = bool(os.environ.get("BOOKREADER_SIDECAR_NONCE"))
    uvicorn.run("main:app", host=host, port=port, access_log=not packaged_sidecar)
    return 0


if __name__ == "__main__":
    args = parse_args()
    raise SystemExit(run_backend(args.host, args.port, args.nonce))
