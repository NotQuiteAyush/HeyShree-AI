import json
import re
import shutil
import zipfile
from io import BytesIO
from pathlib import Path
from typing import Any
from uuid import uuid4
from .config import get_settings

REQUIRED = {"id", "name", "version", "entrypoint", "permissions"}
PLUGIN_ID = re.compile(r"^[a-z0-9][a-z0-9.-]{2,80}$")

def _validate_manifest(manifest_path: Path) -> dict[str, Any]:
    data = json.loads(manifest_path.read_text(encoding="utf-8"))
    missing = REQUIRED - data.keys()
    if missing: raise ValueError(f"Missing fields: {', '.join(sorted(missing))}")
    if not PLUGIN_ID.fullmatch(str(data["id"])): raise ValueError("Plugin id is invalid")
    if not isinstance(data["permissions"], list): raise ValueError("permissions must be a list")
    allowed = {"network", "filesystem.read", "filesystem.write", "desktop.control", "clipboard", "notifications"}
    unknown = set(data["permissions"]) - allowed
    if unknown: raise ValueError(f"Unknown permissions: {', '.join(sorted(unknown))}")
    entrypoint = (manifest_path.parent / str(data["entrypoint"])).resolve()
    if manifest_path.parent.resolve() not in entrypoint.parents or not entrypoint.is_file():
        raise ValueError("entrypoint must be a file inside the plugin directory")
    return data

def discover_plugins() -> list[dict[str, Any]]:
    plugins: list[dict[str, Any]] = []
    root = get_settings().data_dir / "plugins"
    for manifest_path in root.glob("*/plugin.json"):
        try:
            data = _validate_manifest(manifest_path)
            plugins.append({**data, "path": str(manifest_path.parent), "status": "available"})
        except Exception as error:
            plugins.append({"id": manifest_path.parent.name, "name": manifest_path.parent.name, "status": "invalid", "error": str(error)})
    return plugins

def install_plugin_archive(data: bytes, replace: bool = False) -> dict[str, Any]:
    if not data or len(data) > 50 * 1024 * 1024:
        raise ValueError("Plugin archive must be between 1 byte and 50 MB")
    root = get_settings().data_dir / "plugins"
    staging = root / f".install-{uuid4().hex}"
    staging.mkdir(parents=True, exist_ok=False)
    try:
        with zipfile.ZipFile(BytesIO(data)) as archive:
            files = [member for member in archive.infolist() if not member.is_dir()]
            if not files or len(files) > 2000:
                raise ValueError("Plugin archive is empty or contains too many files")
            if sum(member.file_size for member in files) > 200 * 1024 * 1024:
                raise ValueError("Plugin archive expands beyond the 200 MB safety limit")
            for member in files:
                relative = Path(member.filename.replace("\\", "/"))
                if relative.is_absolute() or ".." in relative.parts:
                    raise ValueError("Plugin archive contains an unsafe path")
                target = (staging / relative).resolve()
                if staging.resolve() not in target.parents:
                    raise ValueError("Plugin archive escaped its installation directory")
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_bytes(archive.read(member))
        manifests = list(staging.rglob("plugin.json"))
        if len(manifests) != 1:
            raise ValueError("Plugin archive must contain exactly one plugin.json")
        manifest = _validate_manifest(manifests[0])
        source = manifests[0].parent
        target = root / manifest["id"]
        if target.exists() and not replace:
            raise FileExistsError(f"Plugin {manifest['id']} is already installed")
        if target.exists():
            shutil.rmtree(target)
        shutil.move(str(source), str(target))
        installed = _validate_manifest(target / "plugin.json")
        return {**installed, "path": str(target), "status": "available"}
    finally:
        if staging.exists():
            shutil.rmtree(staging, ignore_errors=True)

def remove_plugin(plugin_id: str) -> bool:
    if not PLUGIN_ID.fullmatch(plugin_id):
        raise ValueError("Plugin id is invalid")
    root = (get_settings().data_dir / "plugins").resolve()
    target = (root / plugin_id).resolve()
    if root not in target.parents or not target.is_dir():
        return False
    shutil.rmtree(target)
    return not target.exists()

def sdk_manifest_schema() -> dict[str, Any]:
    return {
        "$schema": "https://json-schema.org/draft/2020-12/schema",
        "type": "object", "required": sorted(REQUIRED), "additionalProperties": True,
        "properties": {
            "id": {"type": "string", "pattern": "^[a-z0-9][a-z0-9.-]{2,80}$"},
            "name": {"type": "string", "minLength": 1, "maxLength": 100},
            "version": {"type": "string"}, "entrypoint": {"type": "string"},
            "permissions": {"type": "array", "items": {"enum": ["network", "filesystem.read", "filesystem.write", "desktop.control", "clipboard", "notifications"]}, "uniqueItems": True},
            "commands": {"type": "array", "items": {"type": "object", "required": ["name", "description"]}},
            "settings": {"type": "object"}, "events": {"type": "array", "items": {"type": "string"}},
        },
    }
