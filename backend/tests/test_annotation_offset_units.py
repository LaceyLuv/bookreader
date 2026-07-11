from models import AnnotationCreate
from services.annotation_store import LEGACY_OFFSET_UNIT, _normalize_annotation


def test_annotation_create_accepts_explicit_unicode_codepoint_unit():
    payload = AnnotationCreate(
        kind="highlight",
        start_offset=1,
        end_offset=2,
        offset_unit="unicode-codepoint-v1",
        selected_text="😀",
    )
    assert payload.offset_unit == "unicode-codepoint-v1"


def test_unversioned_annotation_is_preserved_as_legacy_unknown():
    record = _normalize_annotation({
        "book_id": "book-1",
        "kind": "highlight",
        "start_offset": 2,
        "end_offset": 4,
        "selected_text": "text",
    })
    assert record["offset_unit"] == LEGACY_OFFSET_UNIT
