from __future__ import annotations
import asyncio
import ctypes
import os
import shutil
import uuid
import zipfile
from pathlib import Path
from typing import Literal
from pydantic import BaseModel, Field, model_validator
from send2trash import send2trash
from .base import ToolContext, Verification

class FindFileParams(BaseModel):
    query: str = Field(min_length=1, max_length=260)
    roots: list[str] = Field(default_factory=list, max_length=10)
    kind: Literal["any", "file", "folder"] = "any"
    limit: int = Field(default=50, ge=1, le=200)
class PathParam(BaseModel):
    path: str = Field(
        min_length=1,
        max_length=2000,
        description="Absolute path or a user-known-folder path such as Desktop\\notes.txt, Documents\\letter.txt, or Downloads\\file.zip",
    )
class CreateFileParams(PathParam): content: str = Field(default="", max_length=5_000_000)
class TransferParams(BaseModel):
    source: str = Field(min_length=1, max_length=2000, description="Absolute path or Desktop, Documents, or Downloads relative path")
    destination: str = Field(min_length=1, max_length=2000, description="Absolute path or Desktop, Documents, or Downloads relative path")
class OverwriteItemParams(TransferParams): operation:Literal["copy","move"]="copy"
class RenameParams(BaseModel):
    path: str = Field(min_length=1,max_length=2000); new_name: str = Field(min_length=1,max_length=260)
    @model_validator(mode="after")
    def name_only(self):
        if Path(self.new_name).name != self.new_name: raise ValueError("new_name must not contain a path")
        return self
class ArchiveParams(BaseModel):
    source: str = Field(min_length=1,max_length=2000); destination: str = Field(min_length=1,max_length=2000)

_KNOWN_FOLDER_IDS = {
    "desktop": "B4BFCC3A-DB2C-424C-B029-7FE99A87C641",
    "documents": "FDD39AD0-238F-46AF-ADB4-6C85480369C7",
    "downloads": "374DE290-123F-4565-9164-39C4925E467B",
}


def _known_folder(name: str) -> Path:
    """Resolve redirected Windows user folders through the Shell API."""
    fallback = Path.home() / name.title()
    if os.name != "nt" or name not in _KNOWN_FOLDER_IDS:
        return fallback.resolve()

    class GUID(ctypes.Structure):
        _fields_ = [
            ("Data1", ctypes.c_uint32),
            ("Data2", ctypes.c_uint16),
            ("Data3", ctypes.c_uint16),
            ("Data4", ctypes.c_ubyte * 8),
        ]

    raw = uuid.UUID(_KNOWN_FOLDER_IDS[name]).bytes_le
    folder_id = GUID.from_buffer_copy(raw)
    output = ctypes.c_wchar_p()
    result = ctypes.windll.shell32.SHGetKnownFolderPath(
        ctypes.byref(folder_id), 0, None, ctypes.byref(output)
    )
    if result != 0 or not output.value:
        return fallback.resolve()
    try:
        return Path(output.value).resolve()
    finally:
        ctypes.windll.ole32.CoTaskMemFree(output)


def resolved(value: str) -> Path:
    raw = os.path.expandvars(str(value).strip().strip("\"'"))
    if not raw:
        raise ValueError("Path is empty")

    # Gemini can safely use friendly paths without knowing the Windows account
    # name. This also repairs legacy placeholder paths such as
    # C:\Users\User\Desktop\notes.txt before permission validation.
    normalized = raw.replace("/", "\\")
    pieces = [piece for piece in normalized.split("\\") if piece]
    lowered = [piece.casefold().rstrip(":") for piece in pieces]
    known_index = next(
        (index for index, piece in enumerate(lowered) if piece in _KNOWN_FOLDER_IDS),
        None,
    )
    if known_index is not None:
        prefix = lowered[:known_index]
        is_friendly = known_index == 0
        is_placeholder_user = (
            known_index >= 2
            and prefix[-2] == "users"
            and prefix[-1] in {"user", "you", "username"}
        )
        if is_friendly or is_placeholder_user:
            base = _known_folder(lowered[known_index])
            return base.joinpath(*pieces[known_index + 1:]).resolve()

    return Path(raw).expanduser().resolve()

def _find(params: FindFileParams):
    roots = [resolved(item) for item in params.roots] if params.roots else [
        _known_folder("desktop"),
        _known_folder("documents"),
        _known_folder("downloads"),
    ]
    query=params.query.lower(); results=[]
    for root in roots:
        if not root.exists(): continue
        for directory, folders, files in os.walk(root, onerror=lambda _: None):
            names = folders if params.kind=="folder" else files if params.kind=="file" else folders+files
            for name in names:
                if query in name.lower():
                    target=Path(directory)/name
                    try: stat=target.stat(); results.append({"path":str(target),"name":name,"type":"folder" if target.is_dir() else "file","size":stat.st_size,"modified":stat.st_mtime})
                    except OSError: continue
                    if len(results)>=params.limit: return results
    return results

async def find_file(params: FindFileParams, context: ToolContext):
    context.ensure_active(); results=await asyncio.to_thread(_find,params)
    return {"matches":results}, Verification(verified=True,method="Filesystem enumeration and stat",observed={"count":len(results)},message="Search completed."), f"Found {len(results)} matching item(s)."

async def create_file(params: CreateFileParams, context: ToolContext):
    context.ensure_active(); target=resolved(params.path)
    if target.exists(): raise FileExistsError(f"Refusing to overwrite existing item: {target}")
    target.parent.mkdir(parents=True,exist_ok=True); await asyncio.to_thread(target.write_text,params.content,encoding="utf-8")
    verified=target.is_file() and target.read_text(encoding="utf-8")==params.content
    return {"path":str(target),"bytes":target.stat().st_size}, Verification(verified=verified,method="Filesystem existence + content readback",observed={"exists":target.exists(),"bytes":target.stat().st_size if target.exists() else 0},message="File content verified." if verified else "File content did not verify."), f"Created {target}." if verified else f"Could not verify {target}."

async def create_folder(params: PathParam, context: ToolContext):
    context.ensure_active(); target=resolved(params.path); target.mkdir(parents=True,exist_ok=False); verified=target.is_dir()
    return {"path":str(target)}, Verification(verified=verified,method="Filesystem directory readback",observed={"exists":verified},message="Folder exists." if verified else "Folder was not observed."), f"Created folder {target}." if verified else f"Could not verify folder {target}."

async def copy_item(params: TransferParams, context: ToolContext):
    context.ensure_active(); source,destination=resolved(params.source),resolved(params.destination)
    if not source.exists(): raise FileNotFoundError(str(source))
    if destination.exists(): raise FileExistsError(f"Refusing to overwrite: {destination}")
    if source.is_dir(): await asyncio.to_thread(shutil.copytree,source,destination)
    else: destination.parent.mkdir(parents=True,exist_ok=True); await asyncio.to_thread(shutil.copy2,source,destination)
    verified=destination.exists() and (source.is_dir()==destination.is_dir()) and (source.is_dir() or source.stat().st_size==destination.stat().st_size)
    return {"source":str(source),"destination":str(destination)}, Verification(verified=verified,method="Filesystem existence/type/size readback",observed={"destination_exists":destination.exists()},message="Copied item verified." if verified else "Copy did not verify."), f"Copied {source.name} to {destination}." if verified else "Copy could not be verified."

async def move_item(params: TransferParams, context: ToolContext):
    context.ensure_active(); source,destination=resolved(params.source),resolved(params.destination)
    if not source.exists(): raise FileNotFoundError(str(source))
    if destination.exists(): raise FileExistsError(f"Refusing to overwrite: {destination}")
    destination.parent.mkdir(parents=True,exist_ok=True); await asyncio.to_thread(shutil.move,str(source),str(destination)); verified=destination.exists() and not source.exists()
    return {"source":str(source),"destination":str(destination)}, Verification(verified=verified,method="Source absence + destination existence",observed={"source_exists":source.exists(),"destination_exists":destination.exists()},message="Move verified." if verified else "Move did not verify."), f"Moved {source.name} to {destination}." if verified else "Move could not be verified."

async def overwrite_item(params:OverwriteItemParams,context:ToolContext):
    context.ensure_active(); source,destination=resolved(params.source),resolved(params.destination)
    if not source.exists(): raise FileNotFoundError(str(source))
    if not destination.exists(): raise FileNotFoundError("Destructive overwrite tool requires an existing destination")
    await asyncio.to_thread(send2trash,str(destination))
    if params.operation=="copy": return await copy_item(TransferParams(source=str(source),destination=str(destination)),context)
    return await move_item(TransferParams(source=str(source),destination=str(destination)),context)

async def rename_item(params: RenameParams, context: ToolContext):
    target=resolved(params.path); destination=target.with_name(params.new_name)
    return await move_item(TransferParams(source=str(target),destination=str(destination)),context)

async def recycle_item(params: PathParam, context: ToolContext):
    context.ensure_active(); target=resolved(params.path)
    if not target.exists(): raise FileNotFoundError(str(target))
    await asyncio.to_thread(send2trash,str(target)); verified=not target.exists()
    return {"path":str(target),"recycled":verified}, Verification(verified=verified,method="Recycle Bin operation + original-path absence",observed={"original_exists":target.exists()},message="Original path no longer exists." if verified else "Item is still present."), f"Moved {target.name} to the Recycle Bin." if verified else f"Windows did not confirm that {target.name} was recycled."

async def compress_item(params: ArchiveParams, context: ToolContext):
    context.ensure_active(); source,destination=resolved(params.source),resolved(params.destination)
    if not source.exists(): raise FileNotFoundError(str(source))
    if destination.exists(): raise FileExistsError(str(destination))
    destination.parent.mkdir(parents=True,exist_ok=True)
    def create():
        with zipfile.ZipFile(destination,"w",zipfile.ZIP_DEFLATED) as archive:
            if source.is_file(): archive.write(source,source.name)
            else:
                for item in source.rglob("*"):
                    if item.is_file(): archive.write(item,item.relative_to(source.parent))
    await asyncio.to_thread(create)
    with zipfile.ZipFile(destination) as archive: valid=archive.testzip() is None; count=len(archive.infolist())
    return {"path":str(destination),"entries":count}, Verification(verified=valid,method="ZIP CRC validation",observed={"entries":count},message="Archive CRC validation passed." if valid else "Archive CRC validation failed."), f"Created {destination.name} with {count} entries." if valid else "Archive creation could not be verified."

async def extract_archive(params: ArchiveParams, context: ToolContext):
    context.ensure_active(); source,destination=resolved(params.source),resolved(params.destination)
    if destination.exists() and any(destination.iterdir()): raise FileExistsError("Destination is not empty")
    destination.mkdir(parents=True,exist_ok=True)
    def extract():
        with zipfile.ZipFile(source) as archive:
            for info in archive.infolist():
                target=(destination/info.filename).resolve()
                if destination not in target.parents and target!=destination: raise ValueError("Archive contains an unsafe path")
            archive.extractall(destination); return len(archive.infolist())
    count=await asyncio.to_thread(extract); observed=sum(1 for _ in destination.rglob("*")); verified=observed>0 or count==0
    return {"destination":str(destination),"entries":count}, Verification(verified=verified,method="Path-safe extraction + destination enumeration",observed={"entries":observed},message="Archive extraction verified."), f"Extracted {count} entries to {destination}."
