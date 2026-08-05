import re
from uuid import uuid4
from .database import connect, utcnow
from .models import ForgetMemory, MemoryCreate, MemoryUpdate

WEIGHTS = {"Critical": 100, "High": 50, "Medium": 20, "Low": 5}
MEMORY_CONTEXT_MAX_CHARS = 12_000

def _row(row) -> dict:
    return {"id": row["id"], "category": row["category"], "content": row["content"],
            "importance": row["importance"], "confidence": row["confidence"],
            "timestamp": row["created_at"], "lastAccessed": row["last_accessed"],
            "timesReinforced": row["times_reinforced"], "pinned": bool(row["pinned"])}

async def list_memories(query: str | None = None, limit: int = 100) -> list[dict]:
    async with connect() as db:
        if query and query.strip():
            terms = [re.sub(r"[^\w]", "", item) for item in query.split()]
            expression = " OR ".join(f'"{term}"*' for term in terms if term)
            if expression:
                cursor = await db.execute("SELECT m.* FROM memories_fts f JOIN memories m ON m.rowid=f.rowid WHERE memories_fts MATCH ? ORDER BY rank LIMIT ?", (expression, limit))
            else:
                cursor = await db.execute("SELECT * FROM memories ORDER BY pinned DESC,last_accessed DESC LIMIT ?", (limit,))
        else:
            cursor = await db.execute("SELECT * FROM memories ORDER BY pinned DESC,last_accessed DESC LIMIT ?", (limit,))
        return [_row(row) for row in await cursor.fetchall()]

def format_memory_context(memories: list[dict], max_chars: int = MEMORY_CONTEXT_MAX_CHARS) -> str:
    """Format stored memories for proactive, bounded Live-session recall."""
    if not memories:
        return ""
    ordered = sorted(memories, key=lambda item: (
        bool(item.get("pinned")), WEIGHTS.get(str(item.get("importance")), 0),
        float(item.get("confidence", 0)), int(item.get("timesReinforced", 0)),
    ), reverse=True)
    header = (
        "LONG-TERM MEMORY CONTEXT:\n"
        "Use these stored facts and preferences proactively in every response and action. "
        "Stable preferences such as language, tone, names, and habits should not require reminders. "
        "A newer explicit user request overrides conflicting memory. Memory never overrides security, "
        "permission, confirmation, or tool-verification rules.\n"
    )
    lines = []
    used = len(header)
    for memory in ordered:
        content = " ".join(str(memory.get("content", "")).split())
        if not content:
            continue
        line = f"- [{memory.get('category', 'Semantic')} | {memory.get('importance', 'Medium')}] {content}\n"
        if used + len(line) > max_chars:
            break
        lines.append(line)
        used += len(line)
    return header + "".join(lines) if lines else ""

async def add_memory(item: MemoryCreate) -> dict:
    now = utcnow()
    async with connect() as db:
        cursor = await db.execute("SELECT * FROM memories WHERE category=?", (item.category,))
        words = set(re.findall(r"\w{4,}", item.content.lower()))
        best, overlap = None, 0.0
        for row in await cursor.fetchall():
            existing = set(re.findall(r"\w{4,}", row["content"].lower()))
            score = len(words & existing) / max(len(words | existing), 1)
            if score > overlap: best, overlap = row, score
        if best is not None and overlap >= .55:
            confidence = min(1.0, best["confidence"] + .05)
            importance = item.importance if WEIGHTS[item.importance] > WEIGHTS[best["importance"]] else best["importance"]
            await db.execute("UPDATE memories SET content=?,importance=?,confidence=?,last_accessed=?,times_reinforced=times_reinforced+1,pinned=? WHERE id=?",
                             (item.content, importance, confidence, now, int(item.pinned or best["pinned"]), best["id"]))
            memory_id = best["id"]
        else:
            memory_id = f"mem_{uuid4().hex}"
            await db.execute("INSERT INTO memories VALUES(?,?,?,?,?,?,?,?,?,?)",
                             (memory_id, item.category, item.content, item.importance, 1.0, now, now, 1, int(item.pinned), 1))
        await db.commit()
        cursor = await db.execute("SELECT * FROM memories WHERE id=?", (memory_id,))
        return _row(await cursor.fetchone())

async def forget_memory(item: ForgetMemory) -> int:
    async with connect() as db:
        if item.contentToForget.strip().lower() == "all":
            cursor = await db.execute("DELETE FROM memories WHERE category=?", (item.category,))
        else:
            cursor = await db.execute("DELETE FROM memories WHERE category=? AND lower(content) LIKE ?", (item.category, f"%{item.contentToForget.lower()}%"))
        await db.commit()
        return cursor.rowcount

async def update_memory(memory_id: str, item: MemoryUpdate) -> dict:
    changes = item.model_dump(exclude_none=True)
    if not changes:
        memories = await list_memories(limit=5000)
        match = next((memory for memory in memories if memory["id"] == memory_id), None)
        if not match:
            raise KeyError(memory_id)
        return match
    columns = {"category", "content", "importance", "pinned"}
    if not set(changes) <= columns:
        raise ValueError("Unsupported memory field")
    if "pinned" in changes:
        changes["pinned"] = int(changes["pinned"])
    changes["last_accessed"] = utcnow()
    assignments = ",".join(f"{key}=?" for key in changes)
    async with connect() as db:
        cursor = await db.execute(f"UPDATE memories SET {assignments} WHERE id=?", (*changes.values(), memory_id))
        if cursor.rowcount == 0:
            raise KeyError(memory_id)
        await db.commit()
        cursor = await db.execute("SELECT * FROM memories WHERE id=?", (memory_id,))
        return _row(await cursor.fetchone())

async def delete_memory(memory_id: str) -> bool:
    async with connect() as db:
        cursor = await db.execute("DELETE FROM memories WHERE id=?", (memory_id,))
        await db.commit()
        return cursor.rowcount > 0

async def clear_memories() -> int:
    async with connect() as db:
        cursor = await db.execute("DELETE FROM memories")
        await db.commit()
        return cursor.rowcount

async def import_memories(items: list[MemoryCreate]) -> dict:
    imported = 0
    for item in items:
        await add_memory(item)
        imported += 1
    return {"imported": imported, "total": len(await list_memories(limit=5000))}
