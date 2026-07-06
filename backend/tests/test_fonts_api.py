from fastapi.testclient import TestClient

import main


VALID_TTF_BYTES = b"\x00\x01\x00\x00" + b"\x00" * 12


def test_font_upload_rejects_files_over_configured_limit(tmp_path, monkeypatch):
    from routers import fonts as fonts_router

    fonts_dir = tmp_path / "fonts"
    fonts_dir.mkdir()
    monkeypatch.setattr(main, "FONTS_DIR", fonts_dir)
    monkeypatch.setattr(fonts_router, "FONTS_DIR", fonts_dir)
    monkeypatch.setattr(fonts_router, "MAX_FONT_UPLOAD_BYTES", 5, raising=False)

    client = TestClient(main.app)
    response = client.post("/api/fonts", files={"file": ("large.ttf", VALID_TTF_BYTES, "font/ttf")})

    assert response.status_code == 413
    assert list(fonts_dir.iterdir()) == []


def test_font_upload_rejects_spoofed_font_content(tmp_path, monkeypatch):
    from routers import fonts as fonts_router

    fonts_dir = tmp_path / "fonts"
    fonts_dir.mkdir()
    monkeypatch.setattr(main, "FONTS_DIR", fonts_dir)
    monkeypatch.setattr(fonts_router, "FONTS_DIR", fonts_dir)

    client = TestClient(main.app)
    response = client.post("/api/fonts", files={"file": ("spoofed.ttf", b"not a font", "font/ttf")})

    assert response.status_code == 400
    assert response.json()["detail"] == "Invalid font file"
    assert list(fonts_dir.iterdir()) == []


def test_font_upload_list_serve_and_delete_flow(tmp_path, monkeypatch):
    from routers import fonts as fonts_router

    fonts_dir = tmp_path / "fonts"
    fonts_dir.mkdir()
    monkeypatch.setattr(main, "FONTS_DIR", fonts_dir)
    monkeypatch.setattr(fonts_router, "FONTS_DIR", fonts_dir)

    client = TestClient(main.app)
    upload_response = client.post("/api/fonts", files={"file": ("..\\Reader Font.ttf", VALID_TTF_BYTES, "font/ttf")})

    assert upload_response.status_code == 200
    uploaded = upload_response.json()
    assert uploaded["filename"].endswith("-Reader-Font.ttf")
    assert "/" not in uploaded["filename"]
    assert "\\" not in uploaded["filename"]

    list_response = client.get("/api/fonts")
    assert list_response.status_code == 200
    assert [font["id"] for font in list_response.json()] == [uploaded["id"]]

    serve_response = client.get(f"/api/fonts/{uploaded['id']}")
    assert serve_response.status_code == 200
    assert serve_response.content == VALID_TTF_BYTES

    delete_response = client.delete(f"/api/fonts/{uploaded['id']}")
    assert delete_response.status_code == 200
    assert delete_response.json() == {"detail": "Font deleted"}
    assert client.get(f"/api/fonts/{uploaded['id']}").status_code == 404
    assert client.get("/api/fonts").json() == []
