import chardet


def read_txt_file(file_path: str) -> dict:
    """Read a TXT file with automatic encoding detection."""
    with open(file_path, "rb") as f:
        raw_data = f.read()

    detection = chardet.detect(raw_data)
    detected_encoding = detection.get("encoding", "utf-8")

    # Try detected encoding first, then fallback chain
    for encoding in [detected_encoding, "utf-8", "euc-kr", "latin-1"]:
        if encoding is None:
            continue
        try:
            text = raw_data.decode(encoding)
            return {"text": text, "encoding": encoding}
        except (UnicodeDecodeError, LookupError):
            continue

    # Last resort
    text = raw_data.decode("utf-8", errors="replace")
    return {"text": text, "encoding": "utf-8 (fallback)"}
