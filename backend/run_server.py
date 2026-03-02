"""Uvicorn entry-point for the BookReader backend."""

import argparse
import uvicorn

from main import app


def parse_args():
    parser = argparse.ArgumentParser(description="BookReader backend launcher")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", default=8000, type=int)
    return parser.parse_args()


if __name__ == "__main__":
    args = parse_args()
    uvicorn.run("main:app", host=args.host, port=args.port, reload=True)
