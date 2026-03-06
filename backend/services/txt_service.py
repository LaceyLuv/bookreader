import chardet


_SAMPLE_SIZE = 64 * 1024  # 64KB is sufficient for encoding detection


def read_txt_file(file_path: str) -> dict:
    """Read a TXT file with automatic encoding detection."""
    with open(file_path, "rb") as f:
        sample = f.read(_SAMPLE_SIZE)
        detection = chardet.detect(sample)
        detected_encoding = detection.get("encoding", "utf-8")
        f.seek(0)
        raw_data = f.read()

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
