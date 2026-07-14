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
    file_missing: bool = False
    content_fingerprint: str | None = None
    annotation_count: int = 0
    txt_encoding_override: str | None = None


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
    txt_encoding_override: Literal['utf-8', 'utf-8-sig', 'utf-16', 'utf-16-le', 'utf-16-be', 'cp949', 'euc-kr', 'latin-1'] | None = None


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
    complete: bool = True
    partial_reason: Literal['timeout', 'cancelled'] | None = None
    results_truncated: bool = False
    scanned_units: int = 0
    total_units: int | None = None


class Annotation(BaseModel):
    id: str
    book_id: str
    kind: AnnotationKind
    locator: str | None = None
    locator_v2: dict | None = None
    page: int | None = None
    chapter_index: int | None = None
    chapter_title: str | None = None
    segment_id: int | None = None
    segment_local_start: int | None = None
    segment_local_end: int | None = None
    start_offset: int | None = None
    end_offset: int | None = None
    offset_unit: str | None = None
    selected_text: str
    note_text: str | None = None
    color: str | None = None
    snippet: str | None = None
    created_at: str
    updated_at: str


class AnnotationCreate(BaseModel):
    kind: AnnotationKind
    locator: str | None = None
    locator_v2: dict | None = None
    page: int | None = None
    chapter_index: int | None = None
    chapter_title: str | None = None
    segment_id: int | None = None
    segment_local_start: int | None = None
    segment_local_end: int | None = None
    start_offset: int | None = None
    end_offset: int | None = None
    offset_unit: str | None = None
    selected_text: str
    note_text: str | None = None
    color: str | None = None
    snippet: str | None = None


class AnnotationUpdate(BaseModel):
    note_text: str | None = None
    color: str | None = None
    locator_v2: dict | None = None


class ReadingProgressUpdate(BaseModel):
    version: int = 1
    position: int = Field(ge=0)
    totalPages: int = Field(ge=1)
    type: Literal['txt', 'epub', 'zip']
    percent: int = Field(default=0, ge=0, le=100)
    bookmarks: List[dict] = Field(default_factory=list)
    locator: dict | None = None
    updatedAt: str | None = None


class FontMeta(BaseModel):
    id: str
    filename: str
    ext: str
    created_at: str


class TxtContent(BaseModel):
    text: str
    encoding: str


class TxtEncodingCandidate(BaseModel):
    encoding: str
    label: str
    valid: bool
    strict_valid: bool = False
    preview: str
    confidence: float | None = None
    replacement_count: int = 0


class TxtEncodingPreview(BaseModel):
    encoding: str
    detected_encoding: str | None = None
    encoding_confidence: float | None = None
    encoding_override: str | None = None
    encoding_source: Literal['auto', 'override'] = 'auto'
    encoding_candidates: List[TxtEncodingCandidate] = Field(default_factory=list)
    warnings: List[str] = Field(default_factory=list)
    sampled_bytes: int = 0


class TxtSegment(BaseModel):
    segment_id: int
    text: str
    start_offset: int
    end_offset: int


class TxtTransformOptions(BaseModel):
    trim_spaces: bool = False
    remove_empty_lines: bool = False
    split_paragraphs: bool = False


class TxtDisplayFragment(BaseModel):
    segment_id: int
    fragment_index: int | None = None
    display_text: str
    source_start_offset: int
    source_end_offset: int
    display_start_offset: int = 0
    display_to_source: List[int] = Field(default_factory=list)
    display_to_source_runs: List[tuple[int, int, int]] = Field(default_factory=list)


class TxtManifest(BaseModel):
    title: str | None = None
    encoding: str
    detected_encoding: str | None = None
    encoding_confidence: float | None = None
    encoding_override: str | None = None
    encoding_source: Literal['auto', 'override'] = 'auto'
    encoding_candidates: List[TxtEncodingCandidate] = Field(default_factory=list)
    source_revision: str | None = None
    total_chars: int
    segment_count: int
    transform_options: TxtTransformOptions = Field(default_factory=TxtTransformOptions)
    display_fragments: List[TxtDisplayFragment] = Field(default_factory=list)


class TxtSegmentWindow(BaseModel):
    contract_version: int = 1
    start: int
    limit: int
    total: int
    returned_chars: int = 0
    next_cursor: str | None = None
    has_more: bool = False
    transform_options: TxtTransformOptions = Field(default_factory=TxtTransformOptions)
    display_fragments: List[TxtDisplayFragment] = Field(default_factory=list)


class EpubTocItem(BaseModel):
    title: str
    index: int
    href: str | None = None


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
    archive_revision: str | None = None
    entries_total: int | None = None
    skipped_entries: int = 0
    diagnostics: List[dict] = Field(default_factory=list)


class FormatDiagnosticIssue(BaseModel):
    code: str
    message: str
    severity: Literal['info', 'warning', 'error'] = 'warning'
    stage: str
    retryable: bool = False
    recovery: str = 'none'
    context: dict = Field(default_factory=dict)


class BookDiagnostics(BaseModel):
    format: Literal['epub', 'zip']
    status: Literal['supported', 'degraded', 'unsupported_or_corrupt']
    issues: List[FormatDiagnosticIssue] = Field(default_factory=list)
    stats: dict = Field(default_factory=dict)
