import socket

import pytest

from fastapi.testclient import TestClient

import main
import run_server
from run_server import is_port_available


def test_health_endpoint_reports_ready():
    client = TestClient(main.app)

    response = client.get("/api/health")

    assert response.status_code == 200
    assert response.json() == {"ok": True, "authenticated": False}


def test_sidecar_nonce_authenticates_health_and_api_requests(monkeypatch):
    monkeypatch.setattr(main, "SIDECAR_NONCE", "launch-secret")
    client = TestClient(main.app)

    assert client.get("/api/health").status_code == 401
    assert client.get("/api/health", headers={"X-BookReader-Nonce": "wrong"}).status_code == 401
    response = client.get("/api/health", headers={"X-BookReader-Nonce": "launch-secret"})
    assert response.status_code == 200
    assert response.json() == {"ok": True, "authenticated": True}


def test_asset_token_is_limited_to_get_asset_routes(monkeypatch):
    monkeypatch.setattr(main, "SIDECAR_NONCE", "launch-secret")
    monkeypatch.setattr(main, "SIDECAR_ASSET_TOKEN", "asset-secret")
    client = TestClient(main.app)

    # It passes authentication and reaches the asset handler (which returns
    # not-found for this synthetic book) rather than being rejected as 401.
    asset = client.get("/api/books/missing/asset/cover.png?asset_token=asset-secret")
    assert asset.status_code != 401
    assert client.get("/api/health?asset_token=asset-secret").status_code == 401


def test_port_available_returns_false_when_port_is_bound():
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as listener:
        listener.bind(("127.0.0.1", 0))
        listener.listen(1)
        port = listener.getsockname()[1]

        assert is_port_available("127.0.0.1", port) is False


def test_port_available_returns_true_for_free_loopback_port():
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as listener:
        listener.bind(("127.0.0.1", 0))
        port = listener.getsockname()[1]

    assert is_port_available("127.0.0.1", port) is True


def test_packaged_sidecar_disables_access_logs_that_can_contain_asset_tokens(monkeypatch):
    captured = {}
    monkeypatch.setenv("BOOKREADER_SIDECAR_NONCE", "launch-secret")
    monkeypatch.delenv("BOOKREADER_PARENT_PID", raising=False)
    monkeypatch.setattr(run_server, "is_port_available", lambda _host, _port: True)
    monkeypatch.setattr(run_server.uvicorn, "run", lambda *args, **kwargs: captured.update(kwargs))

    assert run_server.run_backend("127.0.0.1", 8765) == 0
    assert captured["access_log"] is False


def test_parent_watchdog_is_optional_for_standalone_development(monkeypatch):
    monkeypatch.delenv("BOOKREADER_PARENT_PID", raising=False)

    assert run_server.start_parent_watchdog() is None


@pytest.mark.parametrize("value", ["not-a-pid", "0", "-1"])
def test_parent_watchdog_rejects_invalid_owner_pid(value):
    with pytest.raises(RuntimeError):
        run_server.start_parent_watchdog(value)
