import zipfile

import pytest

from services.zip_service import ZipSafetyError, get_zip_image, list_zip_images


PNG_BYTES = b"\x89PNG\r\n\x1a\n" + b"\x00" * 8


def write_zip(path, entries):
    with zipfile.ZipFile(path, "w") as zf:
        for name, data in entries:
            zf.writestr(name, data)


def test_list_zip_images_uses_natural_sort_for_numeric_filenames(tmp_path):
    archive = tmp_path / "comic.zip"
    write_zip(archive, [("10.jpg", b"\xff\xd8\xffx"), ("2.jpg", b"\xff\xd8\xffx"), ("1.jpg", b"\xff\xd8\xffx")])

    result = list_zip_images(str(archive))

    assert result["images"] == ["1.jpg", "2.jpg", "10.jpg"]


def test_list_zip_images_sorts_nested_directories_predictably(tmp_path):
    archive = tmp_path / "nested.zip"
    write_zip(
        archive,
        [
            ("chapter-2/1.png", PNG_BYTES),
            ("chapter-10/1.png", PNG_BYTES),
            ("chapter-1/2.png", PNG_BYTES),
            ("chapter-1/10.png", PNG_BYTES),
            ("chapter-1/1.png", PNG_BYTES),
        ],
    )

    result = list_zip_images(str(archive))

    assert result["images"] == [
        "chapter-1/1.png",
        "chapter-1/2.png",
        "chapter-1/10.png",
        "chapter-2/1.png",
        "chapter-10/1.png",
    ]


def test_get_zip_image_rejects_bad_image_content_without_breaking_listing(tmp_path):
    archive = tmp_path / "bad-image.zip"
    write_zip(archive, [("1.png", PNG_BYTES), ("2.png", b"not an image")])

    assert list_zip_images(str(archive))["images"] == ["1.png", "2.png"]
    with pytest.raises(ZipSafetyError, match="supported image"):
        get_zip_image(str(archive), "2.png")
