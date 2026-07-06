import socket

from fastapi.testclient import TestClient

import main
from run_server import is_port_available


def test_health_endpoint_reports_ready():
    client = TestClient(main.app)

    response = client.get("/api/health")

    assert response.status_code == 200
    assert response.json() == {"ok": True}


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
