# -*- mode: python ; coding: utf-8 -*-

from PyInstaller.utils.hooks import collect_data_files

hiddenimports = [
    "main",
    "models",
    "paths",
    "routers.annotations",
    "routers.books",
    "routers.data_backup",
    "routers.fonts",
    "routers.library_folders",
    "services.annotation_store",
    "services.annotation_export_service",
    "services.backup_service",
    "services.library_store",
    "services.search_service",
    "services.txt_transform_service",
    "services.txt_service",
    "services.epub_service",
    "services.zip_service",
    "multipart",
    "multipart.multipart",
    "uvicorn.logging",
    "uvicorn.loops.auto",
    "uvicorn.loops.asyncio",
    "uvicorn.protocols.http.auto",
    "uvicorn.protocols.http.h11_impl",
    "uvicorn.protocols.http.httptools_impl",
    "uvicorn.protocols.websockets.auto",
    "uvicorn.protocols.websockets.websockets_impl",
    "uvicorn.lifespan.on",
    "uvicorn.lifespan.off",
]

datas = []
datas += collect_data_files("ebooklib")
datas += collect_data_files("bs4")

# Force UTF-8 mode during embedded interpreter pre-initialization. This is a
# PyInstaller bootloader option (not an environment variable) and keeps the
# one-file sidecar startable from Korean and other non-ASCII install paths.
interpreter_options = [
    ("X utf8", None, "OPTION"),
]

a = Analysis(
    ['run_server.py'],
    pathex=[],
    binaries=[],
    datas=datas,
    hiddenimports=hiddenimports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[],
    noarchive=False,
    optimize=0,
)
pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.datas,
    interpreter_options,
    name='bookreader-backend',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    upx_exclude=[],
    runtime_tmpdir=None,
    console=True,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)
