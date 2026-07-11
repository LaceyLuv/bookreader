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
