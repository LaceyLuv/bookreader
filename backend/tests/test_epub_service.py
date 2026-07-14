from ebooklib import epub

from services.epub_service import clear_epub_caches, get_epub_chapter, get_epub_toc


def write_epub(path, title="Stable EPUB"):
    book = epub.EpubBook()
    book.set_identifier("stable-epub")
    book.set_title(title)
    book.set_language("en")

    chapter1 = epub.EpubHtml(title="Intro", file_name="Text/chapter1.xhtml", lang="en")
    chapter1.content = '<html><head><link rel="stylesheet" href="../Styles/main.css"/></head><body><h1>Intro</h1><p>One</p><a href="chapter2.xhtml#target">Next</a></body></html>'
    chapter2 = epub.EpubHtml(title="Second", file_name="Text/chapter2.xhtml", lang="en")
    chapter2.content = '<html><body><h1 id="target">Second</h1><img src="../Images/pic.png"/></body></html>'
    style = epub.EpubItem(uid="style", file_name="Styles/main.css", media_type="text/css", content=b"body { background: url('../Images/bg.png'); }")
    image = epub.EpubItem(uid="pic", file_name="Images/pic.png", media_type="image/png", content=b"\x89PNG\r\n\x1a\n")
    bg = epub.EpubItem(uid="bg", file_name="Images/bg.png", media_type="image/png", content=b"\x89PNG\r\n\x1a\n")

    book.add_item(chapter1)
    book.add_item(chapter2)
    book.add_item(style)
    book.add_item(image)
    book.add_item(bg)
    book.toc = (
        epub.Link("Text/chapter1.xhtml#top", "Intro Link", "intro"),
        epub.Link("Text/chapter2.xhtml#target", "Second Link", "second"),
    )
    book.spine = ["nav", chapter1, chapter2]
    book.add_item(epub.EpubNcx())
    book.add_item(epub.EpubNav())
    epub.write_epub(str(path), book)


def test_epub_toc_maps_fragment_hrefs_to_spine_indexes(tmp_path):
    epub_path = tmp_path / "book.epub"
    write_epub(epub_path)
    clear_epub_caches()

    result = get_epub_toc(str(epub_path))

    assert result["toc"] == [
        {"title": "Intro Link", "index": 0, "href": "Text/chapter1.xhtml#top"},
        {"title": "Second Link", "index": 1, "href": "Text/chapter2.xhtml#target"},
    ]


def test_epub_chapter_rewrites_relative_assets_and_internal_links(tmp_path):
    epub_path = tmp_path / "book.epub"
    write_epub(epub_path)
    clear_epub_caches()

    chapter = get_epub_chapter(str(epub_path), 0, "book-1", asset_base_url="/api/books/book-1/asset")

    assert 'href="chapter2.xhtml#target"' in chapter["html"]
    assert "/api/books/book-1/asset/Styles/main.css" not in chapter["html"]
    assert "/api/books/book-1/asset/Images/bg.png" in chapter["html"]


def test_epub_chapter_navigation_next_prev_indexes_are_stable(tmp_path):
    epub_path = tmp_path / "book.epub"
    write_epub(epub_path)
    clear_epub_caches()

    first = get_epub_chapter(str(epub_path), 0, "book-1")
    second = get_epub_chapter(str(epub_path), 1, "book-1")

    assert first["index"] == 0
    assert second["index"] == 1
    assert first["total"] == second["total"] == 2
    assert "Intro" in first["html"]
    assert "Second" in second["html"]


def test_epub_cache_is_invalidated_when_same_path_revision_changes(tmp_path):
    epub_path = tmp_path / "replaceable.epub"
    write_epub(epub_path, title="First revision")
    clear_epub_caches()
    assert get_epub_toc(str(epub_path))["title"] == "First revision"

    write_epub(epub_path, title="Second revision with a different size")

    assert get_epub_toc(str(epub_path))["title"] == "Second revision with a different size"


def test_epub_chapter_out_of_range_has_stable_error_code(tmp_path):
    from services.epub_service import EpubSafetyError

    epub_path = tmp_path / "book.epub"
    write_epub(epub_path)
    clear_epub_caches()

    try:
        get_epub_chapter(str(epub_path), 99, "book-1")
    except EpubSafetyError as exc:
        assert exc.code == "epub_chapter_not_found"
        assert exc.stage == "content"
        assert exc.to_problem()["context"]["chapter_index"] == 99
    else:
        raise AssertionError("Expected out-of-range EPUB chapter to fail")


def test_epub_diagnostics_marks_svg_and_mathml_as_degraded(tmp_path):
    from services.epub_service import diagnose_epub

    epub_path = tmp_path / "limited.epub"
    book = epub.EpubBook()
    book.set_identifier("limited")
    book.set_title("Limited")
    book.set_language("en")
    chapter = epub.EpubHtml(title="Limited", file_name="chapter.xhtml", lang="en")
    chapter.content = "<html><body><svg><circle/></svg><math><mi>x</mi></math></body></html>"
    book.add_item(chapter)
    book.spine = [chapter]
    book.add_item(epub.EpubNcx())
    book.add_item(epub.EpubNav())
    epub.write_epub(str(epub_path), book)
    clear_epub_caches()

    report = diagnose_epub(str(epub_path))
    codes = {issue["code"] for issue in report["issues"]}

    assert report["status"] == "degraded"
    assert {"epub_svg_limited", "epub_mathml_limited"} <= codes
