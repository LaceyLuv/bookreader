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


def test_annotation_preserves_structured_locator_v2_without_stringifying():
    locator_v2 = {
        "version": 2,
        "kind": "txt",
        "sourceOffset": 42,
        "sourceEndOffset": 48,
        "sourceRevision": "revision-a",
        "quote": {"exact": "target", "prefix": "before ", "suffix": " after", "position": 0},
    }
    payload = AnnotationCreate(
        kind="highlight",
        locator="segment:2:offset:4",
        locator_v2=locator_v2,
        selected_text="target",
    )
    record = _normalize_annotation({"book_id": "book-1", **payload.model_dump()})

    assert isinstance(record["locator_v2"], dict)
    assert record["locator_v2"] == locator_v2
    assert record["locator"] == "segment:2:offset:4"
