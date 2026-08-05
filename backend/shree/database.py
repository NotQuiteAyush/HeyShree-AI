from contextlib import asynccontextmanager
from datetime import UTC, datetime
from pathlib import Path
import sqlite3
from typing import AsyncIterator
import aiosqlite
from .config import get_settings

SCHEMA = """
CREATE TABLE IF NOT EXISTS memories (
 id TEXT PRIMARY KEY, category TEXT NOT NULL, content TEXT NOT NULL,
 importance TEXT NOT NULL DEFAULT 'Medium', confidence REAL NOT NULL DEFAULT 1,
 created_at TEXT NOT NULL, last_accessed TEXT NOT NULL, times_reinforced INTEGER NOT NULL DEFAULT 1,
 pinned INTEGER NOT NULL DEFAULT 0, consented INTEGER NOT NULL DEFAULT 0
);
CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts USING fts5(id UNINDEXED, category, content, content='memories', content_rowid='rowid');
CREATE TRIGGER IF NOT EXISTS memories_ai AFTER INSERT ON memories BEGIN
 INSERT INTO memories_fts(rowid,id,category,content) VALUES(new.rowid,new.id,new.category,new.content); END;
CREATE TRIGGER IF NOT EXISTS memories_ad AFTER DELETE ON memories BEGIN
 INSERT INTO memories_fts(memories_fts,rowid,id,category,content) VALUES('delete',old.rowid,old.id,old.category,old.content); END;
CREATE TRIGGER IF NOT EXISTS memories_au AFTER UPDATE ON memories BEGIN
 INSERT INTO memories_fts(memories_fts,rowid,id,category,content) VALUES('delete',old.rowid,old.id,old.category,old.content);
 INSERT INTO memories_fts(rowid,id,category,content) VALUES(new.rowid,new.id,new.category,new.content); END;
CREATE TABLE IF NOT EXISTS reminders (
 id TEXT PRIMARY KEY, text TEXT NOT NULL, due_at TEXT, recurrence TEXT, urgent INTEGER NOT NULL DEFAULT 0,
 completed INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, notified_at TEXT
);
CREATE TABLE IF NOT EXISTS conversations (id TEXT PRIMARY KEY, title TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS messages (id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
 role TEXT NOT NULL, content TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS permissions (capability TEXT PRIMARY KEY, decision TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS audit_log (id INTEGER PRIMARY KEY AUTOINCREMENT, action TEXT NOT NULL, risk TEXT NOT NULL,
 approved INTEGER NOT NULL, details TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS clipboard_history (id INTEGER PRIMARY KEY AUTOINCREMENT, content TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS pending_actions (token TEXT PRIMARY KEY, action TEXT NOT NULL, arguments TEXT NOT NULL,
 risk TEXT NOT NULL, explanation TEXT NOT NULL, expires_at TEXT NOT NULL, created_at TEXT NOT NULL);
"""

MIGRATIONS = ((1, "initial_shree_schema", SCHEMA),)

def utcnow() -> str:
    return datetime.now(UTC).isoformat()

@asynccontextmanager
async def connect() -> AsyncIterator[aiosqlite.Connection]:
    db = await aiosqlite.connect(get_settings().database_path)
    db.row_factory = aiosqlite.Row
    await db.execute("PRAGMA foreign_keys=ON")
    try:
        yield db
    finally:
        await db.close()

async def initialize_database() -> None:
    database_path = Path(get_settings().database_path)
    database_path.parent.mkdir(parents=True, exist_ok=True)
    async with connect() as db:
        await db.execute("PRAGMA journal_mode=WAL")
        await db.execute("PRAGMA foreign_keys=ON")
        await db.execute(
            "CREATE TABLE IF NOT EXISTS schema_migrations ("
            "version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL)"
        )
        await db.commit()
        rows = await (await db.execute("SELECT version FROM schema_migrations")).fetchall()
        applied = {int(row["version"]) for row in rows}
        pending = [migration for migration in MIGRATIONS if migration[0] not in applied]
        backup_path: Path | None = None
        if pending and database_path.exists() and database_path.stat().st_size:
            await db.execute("PRAGMA wal_checkpoint(FULL)")
            await db.commit()
            backup_path = await _create_migration_backup(database_path, pending[-1][0])
        for version, name, script in pending:
            try:
                await db.executescript(f"BEGIN IMMEDIATE;\n{script}\nCOMMIT;")
                await db.execute(
                    "INSERT INTO schema_migrations(version,name,applied_at) VALUES(?,?,?)",
                    (version, name, utcnow()),
                )
                await db.commit()
            except Exception as error:
                await db.rollback()
                recovery = f" A verified recovery backup is available at {backup_path}." if backup_path else ""
                raise RuntimeError(f"Database migration {version} ({name}) failed; Shree stopped without continuing.{recovery}") from error


async def _create_migration_backup(database_path: Path, target_version: int) -> Path:
    backup_dir = database_path.parent / "backups"
    backup_dir.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now(UTC).strftime("%Y%m%dT%H%M%SZ")
    backup_path = backup_dir / f"shree-before-v{target_version}-{stamp}.db"

    def copy_and_verify() -> None:
        source = sqlite3.connect(database_path)
        destination = sqlite3.connect(backup_path)
        try:
            source.backup(destination)
            result = destination.execute("PRAGMA integrity_check").fetchone()
            if not result or result[0] != "ok":
                raise RuntimeError("The pre-update database backup failed its integrity check")
        finally:
            destination.close()
            source.close()

    import asyncio
    await asyncio.to_thread(copy_and_verify)
    backups = sorted(backup_dir.glob("shree-before-v*.db"), key=lambda item: item.stat().st_mtime, reverse=True)
    for old_backup in backups[5:]:
        old_backup.unlink(missing_ok=True)
    return backup_path
