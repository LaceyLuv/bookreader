from pydantic import BaseModel
from typing import List


class BookMeta(BaseModel):
    id: str
    title: str
    file_type: str  # "txt", "epub", "zip"
    filename: str
    size: int  # bytes
    upload_date: str


class BookListResponse(BaseModel):
    books: List[BookMeta]


class TxtContent(BaseModel):
    text: str
    encoding: str


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
