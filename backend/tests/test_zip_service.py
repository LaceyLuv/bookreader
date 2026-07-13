import os
import stat
import struct
import warnings
import zipfile

import pytest

from services import zip_service
from services.zip_service import (
    ZipSafetyError,
    clear_zip_caches,
    diagnose_zip,
    get_zip_image,
    list_zip_images,
)


PNG_BYTES = b"\x89PNG\r\n\x1a\n" + b"\x00" * 8


def write_zip(path, entries):
    with zipfile.ZipFile(path, "w") as zf:
        for name, data in entries:
            zf.writestr(name, data)


def set_encrypted_flag(path):
    payload = bytearray(path.read_bytes())
    local_header = payload.index(b"PK\x03\x04")
    central_header = payload.index(b"PK\x01\x02")
    struct.pack_into("<H", payload, local_header + 6, struct.unpack_from("<H", payload, local_header + 6)[0] | 1)
    struct.pack_into("<H", payload, central_header + 8, struct.unpack_from("<H", payload, central_header + 8)[0] | 1)
    path.write_bytes(payload)


def corrupt_stored_member_data(path):
    payload = bytearray(path.read_bytes())
    local_header = payload.index(b"PK\x03\x04")
    name_length = struct.unpack_from("<H", payload, local_header + 26)[0]
    extra_length = struct.unpack_from("<H", payload, local_header + 28)[0]
    data_offset = local_header + 30 + name_length + extra_length
    payload[data_offset + 10] ^= 0x01
    path.write_bytes(payload)


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


def test_zip_safety_error_keeps_message_and_exposes_stable_problem_fields():
    error = ZipSafetyError(
        "Readable message",
        code="test_code",
        stage="member_read",
        retryable=True,
        member_name="page.png",
    )

    assert str(error) == "Readable message"
    assert error.to_problem() == {
        "code": "test_code",
        "message": "Readable message",
        "severity": "error",
        "stage": "member_read",
        "retryable": True,
        "recovery": "retry",
        "member_name": "page.png",
        "context": {"member_name": "page.png"},
    }


def test_list_manifest_adds_revision_stats_and_skipped_diagnostics(tmp_path):
    archive = tmp_path / "diagnostics.zip"
    write_zip(
        archive,
        [
            ("page.png", PNG_BYTES),
            ("notes.txt", b"notes"),
            ("../unsafe.png", PNG_BYTES),
        ],
    )

    result = list_zip_images(str(archive))

    assert result["images"] == ["page.png"]
    assert result["total"] == 1
    assert len(result["archive_revision"]) == 64
    assert result["entries_total"] == 3
    assert result["skipped_entries"] == 2
    assert [item["code"] for item in result["diagnostics"]] == ["unsafe_member"]
    diagnosis = diagnose_zip(str(archive))
    assert diagnosis["status"] == "degraded"
    assert diagnosis["stats"]["archive_revision"] == result["archive_revision"]


def test_malformed_zip_returns_stable_non_throwing_diagnosis(tmp_path):
    archive = tmp_path / "malformed.zip"
    archive.write_bytes(b"not a zip archive")

    diagnosis = diagnose_zip(str(archive))

    assert diagnosis["status"] == "unsupported_or_corrupt"
    assert diagnosis["issues"][0]["code"] == "invalid_archive"
    assert diagnosis["issues"][0]["stage"] == "preflight"


def test_encrypted_member_is_rejected_during_preflight(tmp_path):
    archive = tmp_path / "encrypted.zip"
    write_zip(archive, [("page.png", PNG_BYTES)])
    set_encrypted_flag(archive)

    with pytest.raises(ZipSafetyError) as raised:
        list_zip_images(str(archive))

    assert raised.value.code == "encrypted_member"
    assert raised.value.member_name == "page.png"
    assert diagnose_zip(str(archive))["issues"][0]["code"] == "encrypted_member"


def test_unsupported_compression_is_rejected_during_preflight(tmp_path):
    archive = tmp_path / "bzip2.zip"
    with zipfile.ZipFile(archive, "w", compression=zipfile.ZIP_BZIP2) as zf:
        zf.writestr("page.png", PNG_BYTES + os.urandom(64))

    with pytest.raises(ZipSafetyError) as raised:
        list_zip_images(str(archive))

    assert raised.value.code == "unsupported_compression"


def test_exact_and_unicode_casefold_name_collisions_are_rejected(tmp_path):
    exact = tmp_path / "exact.zip"
    with warnings.catch_warnings():
        warnings.simplefilter("ignore", UserWarning)
        write_zip(exact, [("page.png", PNG_BYTES), ("page.png", PNG_BYTES)])

    with pytest.raises(ZipSafetyError) as duplicate:
        list_zip_images(str(exact))
    assert duplicate.value.code == "duplicate_member"

    canonical = tmp_path / "canonical.zip"
    write_zip(canonical, [("caf\u00e9.png", PNG_BYTES), ("CAFE\u0301.PNG", PNG_BYTES)])

    with pytest.raises(ZipSafetyError) as collision:
        list_zip_images(str(canonical))
    assert collision.value.code == "member_name_collision"


@pytest.mark.parametrize(
    ("mode", "expected_code"),
    [
        (stat.S_IFLNK | 0o777, "symlink_member"),
        (stat.S_IFIFO | 0o600, "special_member"),
    ],
)
def test_symlink_and_special_members_are_rejected(tmp_path, mode, expected_code):
    archive = tmp_path / f"{expected_code}.zip"
    info = zipfile.ZipInfo("page.png")
    info.create_system = 3
    info.external_attr = mode << 16
    with zipfile.ZipFile(archive, "w") as zf:
        zf.writestr(info, PNG_BYTES)

    with pytest.raises(ZipSafetyError) as raised:
        list_zip_images(str(archive))

    assert raised.value.code == expected_code


def test_manifest_cache_is_reused_by_list_and_member_reads(tmp_path, monkeypatch):
    archive = tmp_path / "cached.zip"
    write_zip(archive, [("page.png", PNG_BYTES)])
    clear_zip_caches()
    calls = 0
    original_infolist = zipfile.ZipFile.infolist

    def counted_infolist(self):
        nonlocal calls
        calls += 1
        return original_infolist(self)

    monkeypatch.setattr(zipfile.ZipFile, "infolist", counted_infolist)

    first = list_zip_images(str(archive))
    second = list_zip_images(str(archive))
    get_zip_image(str(archive), "page.png")
    get_zip_image(str(archive), "page.png")

    assert first["archive_revision"] == second["archive_revision"]
    assert calls == 1


def test_manifest_cache_invalidates_and_revision_changes_with_file_stat(tmp_path):
    archive = tmp_path / "revision.zip"
    write_zip(archive, [("one.png", PNG_BYTES)])
    clear_zip_caches()
    first = list_zip_images(str(archive))

    write_zip(archive, [("one.png", PNG_BYTES), ("two.png", PNG_BYTES)])
    current = archive.stat()
    os.utime(archive, ns=(current.st_atime_ns, current.st_mtime_ns + 1))
    second = list_zip_images(str(archive))

    assert second["images"] == ["one.png", "two.png"]
    assert second["archive_revision"] != first["archive_revision"]


def test_member_diagnosis_classifies_signature_and_crc_failures(tmp_path):
    bad_signature = tmp_path / "bad-signature.zip"
    write_zip(bad_signature, [("page.png", b"not an image")])

    signature_diagnosis = diagnose_zip(str(bad_signature), "page.png")

    assert signature_diagnosis["status"] == "degraded"
    assert signature_diagnosis["issues"][0]["code"] == "invalid_image_signature"
    assert signature_diagnosis["issues"][0]["stage"] == "signature"

    bad_crc = tmp_path / "bad-crc.zip"
    with zipfile.ZipFile(bad_crc, "w", compression=zipfile.ZIP_STORED) as zf:
        zf.writestr("page.png", PNG_BYTES + os.urandom(64))
    corrupt_stored_member_data(bad_crc)

    crc_diagnosis = diagnose_zip(str(bad_crc), "page.png")

    assert crc_diagnosis["status"] == "degraded"
    assert crc_diagnosis["issues"][0]["code"] == "crc_mismatch"
    assert crc_diagnosis["issues"][0]["stage"] == "member_read"
