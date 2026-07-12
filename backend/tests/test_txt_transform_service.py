from services.txt_transform_service import transform_txt_segments


def _expand_mapping(fragment):
    mapping = []
    for display_start, source_start, length in fragment["display_to_source_runs"]:
        assert display_start == len(mapping)
        mapping.extend(range(source_start, source_start + length))
    return mapping


def test_trim_spaces_and_remove_extra_blank_lines_preserves_source_offsets():
    segments = [
        {
            "segment_id": 0,
            "text": "Alpha   beta  \n\n\nGamma    delta",
            "start_offset": 0,
            "end_offset": 31,
        }
    ]

    result = transform_txt_segments(
        segments,
        trim_spaces=True,
        remove_empty_lines=True,
        split_paragraphs=False,
    )

    assert [fragment["display_text"] for fragment in result["fragments"]] == [
        "Alpha beta\n\nGamma delta"
    ]
    assert result["fragments"][0]["source_start_offset"] == 0
    assert result["fragments"][0]["source_end_offset"] == 31
    mapping = _expand_mapping(result["fragments"][0])
    assert mapping[0] == 0
    assert mapping[-1] == 30


def test_split_paragraphs_breaks_dense_single_line_block_without_losing_locator_range():
    segments = [
        {
            "segment_id": 2,
            "text": "One short sentence. Two short sentence. Three short sentence. Four short sentence.",
            "start_offset": 100,
            "end_offset": 182,
        }
    ]

    result = transform_txt_segments(
        segments,
        trim_spaces=False,
        remove_empty_lines=False,
        split_paragraphs=True,
    )

    assert len(result["fragments"]) == 2
    assert result["fragments"][0]["display_text"] == "One short sentence. Two short sentence."
    assert result["fragments"][1]["display_text"] == "Three short sentence. Four short sentence."
    assert result["fragments"][0]["segment_id"] == 2
    assert result["fragments"][1]["segment_id"] == 2
    assert result["fragments"][0]["source_start_offset"] == 100
    assert result["fragments"][0]["source_end_offset"] == 139
    assert result["fragments"][1]["source_start_offset"] == 140
    assert result["fragments"][1]["source_end_offset"] == 182
    assert _expand_mapping(result["fragments"][0]) == list(range(100, 139))
    assert _expand_mapping(result["fragments"][1]) == list(range(140, 182))


def test_transform_keeps_empty_output_segments_out_of_render_payload():
    segments = [
        {
            "segment_id": 5,
            "text": "   \n\n   ",
            "start_offset": 50,
            "end_offset": 58,
        }
    ]

    result = transform_txt_segments(
        segments,
        trim_spaces=True,
        remove_empty_lines=True,
        split_paragraphs=True,
    )

    assert result["fragments"] == []


def test_crlf_and_cr_newlines_preserve_source_offsets():
    segments = [
        {
            "segment_id": 7,
            "text": "Alpha\r\nBeta",
            "start_offset": 10,
            "end_offset": 21,
        }
    ]

    result = transform_txt_segments(
        segments,
        trim_spaces=False,
        remove_empty_lines=False,
        split_paragraphs=False,
    )

    fragment = result["fragments"][0]

    assert fragment["display_text"] == "Alpha\nBeta"
    assert fragment["source_start_offset"] == 10
    assert fragment["source_end_offset"] == 21
    assert _expand_mapping(fragment) == [10, 11, 12, 13, 14, 16, 17, 18, 19, 20]


def test_compact_whitespace_handles_unicode_and_invisible_spaces_without_offset_drift():
    source = "\tAlpha\u00a0\u00a0beta\u200b  gamma\u3000"
    result = transform_txt_segments(
        [{"segment_id": 3, "text": source, "start_offset": 50, "end_offset": 50 + len(source)}],
        trim_spaces=True,
        remove_empty_lines=False,
        split_paragraphs=False,
    )

    fragment = result["fragments"][0]
    assert fragment["display_text"] == "Alpha beta gamma"
    mapping = _expand_mapping(fragment)
    assert mapping[0] == 51
    assert mapping[5] == 56
    assert mapping[6:10] == [58, 59, 60, 61]
    assert mapping[10] == 63
    assert mapping[11:] == [65, 66, 67, 68, 69]


def test_korean_sentence_punctuation_and_quote_closers_create_balanced_fragments():
    source = (
        "첫 번째 문장은 충분히 길게 이어집니다. "
        "두 번째 질문도 자연스럽게 끝날까요? "
        "“세 번째 대답은 여기까지예요!” "
        "마지막 문장은 조용히 마무리됩니다."
    )
    result = transform_txt_segments(
        [{"segment_id": 4, "text": source, "start_offset": 100, "end_offset": 100 + len(source)}],
        trim_spaces=False,
        remove_empty_lines=False,
        split_paragraphs=True,
    )

    assert [fragment["display_text"] for fragment in result["fragments"]] == [
        "첫 번째 문장은 충분히 길게 이어집니다. 두 번째 질문도 자연스럽게 끝날까요?",
        "“세 번째 대답은 여기까지예요!” 마지막 문장은 조용히 마무리됩니다.",
    ]
    assert result["fragments"][0]["source_start_offset"] == 100
    assert result["fragments"][-1]["source_end_offset"] == 100 + len(source)


def test_korean_sentences_without_spaces_after_punctuation_still_split_safely():
    source = (
        "바람이 아주 세차게 불어오기 시작했다."
        "그는 창문을 천천히 닫았다."
        "밖에서는 누군가 이름을 불렀다."
        "아무도 대답하지 않았다."
    )
    result = transform_txt_segments(
        [{"segment_id": 8, "text": source, "start_offset": 0, "end_offset": len(source)}],
        trim_spaces=False,
        remove_empty_lines=False,
        split_paragraphs=True,
    )

    assert len(result["fragments"]) == 2
    assert "".join(fragment["display_text"] for fragment in result["fragments"]) == source


def test_chapter_title_and_dialogue_lines_become_separate_korean_novel_fragments():
    source = "제1장 시작\n비가 내렸다.\n“누구세요?”\n— 나야.\n문이 열렸다."
    result = transform_txt_segments(
        [{"segment_id": 5, "text": source, "start_offset": 0, "end_offset": len(source)}],
        trim_spaces=False,
        remove_empty_lines=False,
        split_paragraphs=True,
    )

    assert [fragment["display_text"] for fragment in result["fragments"]] == [
        "제1장 시작",
        "비가 내렸다.",
        "“누구세요?”",
        "— 나야.",
        "문이 열렸다.",
    ]
    flattened_mapping = [offset for fragment in result["fragments"] for offset in _expand_mapping(fragment)]
    assert flattened_mapping == [index for index, char in enumerate(source) if char != "\n"]


def test_very_long_unpunctuated_paragraph_uses_bounded_lossless_fragments():
    source = "가" * 1800
    result = transform_txt_segments(
        [{"segment_id": 6, "text": source, "start_offset": 20, "end_offset": 1820}],
        trim_spaces=False,
        remove_empty_lines=False,
        split_paragraphs=True,
    )

    fragments = result["fragments"]
    assert len(fragments) == 3
    assert all(len(fragment["display_text"]) <= 700 for fragment in fragments)
    assert "".join(fragment["display_text"] for fragment in fragments) == source
    assert [fragment["source_start_offset"] for fragment in fragments] == [20, 720, 1420]
    assert fragments[-1]["source_end_offset"] == 1820
