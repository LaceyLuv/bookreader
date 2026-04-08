from typing import List, Literal

from pydantic import BaseModel, Field

ReadingStatus = Literal['unread', 'reading', 'completed', 'paused']
AnnotationKind = Literal['highlight', 'note']


class BookMeta(BaseModel):
    id: str
    legacy_id: str | None = None
    title: str
    author: str | None = None
    file_type: str
    filename: str
    size: int
    upload_date: str
    last_opened_at: str | None = None
    last_read_at: str | None = None
    reading_status: ReadingStatus = 'unread'
    favorite: bool = False
    pinned: bool = False
    tags: List[str] = Field(default_factory=list)
    collections: List[str] = Field(default_factory=list)
    library_folder_id: str | None = None
    library_folder_name: str | None = None
    series_name: str | None = None
    series_index: int | None = None
    duplicate_group: str | None = None
    version_label: str | None = None
    duplicate_lead: bool = False
    content_fingerprint: str | None = None
    annotation_count: int = 0


class BookInfo(BookMeta):
    stored_filename: str
    path: str


class BookListResponse(BaseModel):
    books: List[BookMeta]


class BookMetaUpdate(BaseModel):
    title: str | None = None
    author: str | None = None
    reading_status: ReadingStatus | None = None
    favorite: bool | None = None
    pinned: bool | None = None
    tags: List[str] | None = None
    collections: List[str] | None = None
    library_folder_id: str | None = None
    series_name: str | None = None
    series_index: int | None = None
    duplicate_group: str | None = None
    version_label: str | None = None
    duplicate_lead: bool | None = None


class LibraryFolder(BaseModel):
    id: str
    name: str
    created_at: str
    updated_at: str
    book_count: int = 0


class LibraryFolderCreate(BaseModel):
    name: str


class LibraryFolderUpdate(BaseModel):
    name: str | None = None


class LibraryFolderAssign(BaseModel):
    book_ids: List[str] = Field(default_factory=list)
    folder_id: str | None = None


class LibraryFolderAssignResult(BaseModel):
    updated_count: int


class BookSearchResult(BaseModel):
    index: int
    snippet: str
    position: int | None = None
    locator: str | None = None
    segment_id: int | None = None
    segment_local_start: int | None = None
    segment_local_end: int | None = None
    chapter_index: int | None = None
    chapter_title: str | None = None
    chapter_match_index: int | None = None


class BookSearchResponse(BaseModel):
    query: str
    total: int
    results: List[BookSearchResult] = Field(default_factory=list)


class Annotation(BaseModel):
    id: str
    book_id: str
    kind: AnnotationKind
    locator: str | None = None
    page: int | None = None
    chapter_index: int | None = None
    chapter_title: str | None = None
    segment_id: int | None = None
    segment_local_start: int | None = None
    segment_local_end: int | None = None
    start_offset: int | None = None
    end_offset: int | None = None
    selected_text: str
    note_text: str | None = None
    color: str | None = None
    snippet: str | None = None
    created_at: str
    updated_at: str


class AnnotationCreate(BaseModel):
    kind: AnnotationKind
    locator: str | None = None
    page: int | None = None
    chapter_index: int | None = None
    chapter_title: str | None = None
    segment_id: int | None = None
    segment_local_start: int | None = None
    segment_local_end: int | None = None
    start_offset: int | None = None
    end_offset: int | None = None
    selected_text: str
    note_text: str | None = None
    color: str | None = None
    snippet: str | None = None


class AnnotationUpdate(BaseModel):
    note_text: str | None = None
    color: str | None = None


class FontMeta(BaseModel):
    id: str
    filename: str
    ext: str
    created_at: str


class TxtContent(BaseModel):
    text: str
    encoding: str


class TxtSegment(BaseModel):
    segment_id: int
    text: str
    start_offset: int
    end_offset: int


class TxtManifest(BaseModel):
    encoding: str
    total_chars: int
    segment_count: int


class TxtSegmentWindow(BaseModel):
    start: int
    limit: int
    total: int
    segments: List[TxtSegment] = Field(default_factory=list)


class EpubTocItem(BaseModel):
    title: str
    index: int


class EpubToc(BaseModel):
    title: str
    toc: List[EpubTocItem]


class EpubChapter(BaseModel):
    title: str
    html: str
    index: int
    total: int


class ZipImageList(BaseModel):
    images: List[str]
    total: int
