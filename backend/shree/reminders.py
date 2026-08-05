from calendar import monthrange
from datetime import UTC, datetime, timedelta
from uuid import uuid4
from .database import connect, utcnow
from .models import ReminderCreate, ReminderPatch

def _row(row) -> dict:
    return {"id": row["id"], "text": row["text"], "due_at": row["due_at"], "recurrence": row["recurrence"],
            "urgent": bool(row["urgent"]), "completed": bool(row["completed"]), "created_at": row["created_at"],
            "notified_at": row["notified_at"]}

def _parse_due_at(value: str) -> datetime:
    due = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if due.tzinfo is None:
        due = due.replace(tzinfo=datetime.now().astimezone().tzinfo)
    return due.astimezone(UTC)

def _add_months(value: datetime, months: int) -> datetime:
    month_index = value.month - 1 + months
    year = value.year + month_index // 12
    month = month_index % 12 + 1
    return value.replace(year=year, month=month, day=min(value.day, monthrange(year, month)[1]))

def _next_occurrence(due: datetime, recurrence: str, now: datetime) -> datetime:
    candidate = due
    while candidate <= now:
        if recurrence == "daily":
            candidate += timedelta(days=1)
        elif recurrence == "weekly":
            candidate += timedelta(weeks=1)
        elif recurrence == "monthly":
            candidate = _add_months(candidate, 1)
        elif recurrence == "yearly":
            candidate = _add_months(candidate, 12)
        elif recurrence == "weekdays":
            candidate += timedelta(days=1)
            while candidate.weekday() >= 5:
                candidate += timedelta(days=1)
        else:
            raise ValueError(f"Unsupported reminder recurrence: {recurrence}")
    return candidate

async def list_reminders() -> list[dict]:
    async with connect() as db:
        cursor = await db.execute("SELECT * FROM reminders ORDER BY completed,due_at IS NULL,due_at,created_at DESC")
        return [_row(row) for row in await cursor.fetchall()]

async def create_reminder(item: ReminderCreate) -> dict:
    reminder_id, now = f"rem_{uuid4().hex}", utcnow()
    async with connect() as db:
        await db.execute("INSERT INTO reminders(id,text,due_at,recurrence,urgent,completed,created_at) VALUES(?,?,?,?,?,0,?)",
                         (reminder_id, item.text, item.due_at.isoformat() if item.due_at else None, item.recurrence, int(item.urgent), now))
        await db.commit()
        cursor = await db.execute("SELECT * FROM reminders WHERE id=?", (reminder_id,))
        return _row(await cursor.fetchone())

async def update_reminder(reminder_id: str, patch: ReminderPatch) -> dict | None:
    fields = patch.model_dump(exclude_unset=True)
    if "due_at" in fields:
        fields["due_at"] = fields["due_at"].isoformat() if fields["due_at"] is not None else None
        fields["notified_at"] = None
    for key in ("urgent", "completed"):
        if key in fields: fields[key] = int(fields[key])
    if not fields: return next((x for x in await list_reminders() if x["id"] == reminder_id), None)
    async with connect() as db:
        await db.execute(f"UPDATE reminders SET {','.join(f'{key}=?' for key in fields)} WHERE id=?", (*fields.values(), reminder_id))
        await db.commit()
        cursor = await db.execute("SELECT * FROM reminders WHERE id=?", (reminder_id,))
        row = await cursor.fetchone()
        return _row(row) if row else None

async def claim_due_reminders(now: datetime | None = None) -> list[dict]:
    now_utc = (now or datetime.now(UTC)).astimezone(UTC)
    notified_at = now_utc.isoformat()
    due_reminders: list[dict] = []
    async with connect() as db:
        await db.execute("BEGIN IMMEDIATE")
        cursor = await db.execute(
            "SELECT * FROM reminders WHERE completed=0 AND due_at IS NOT NULL AND notified_at IS NULL ORDER BY due_at"
        )
        for row in await cursor.fetchall():
            due = _parse_due_at(row["due_at"])
            if due > now_utc:
                continue
            reminder = _row(row)
            reminder["fired_at"] = notified_at
            if row["recurrence"]:
                next_due = _next_occurrence(due, row["recurrence"], now_utc)
                reminder["next_due_at"] = next_due.isoformat()
                await db.execute("UPDATE reminders SET due_at=?,notified_at=NULL WHERE id=?", (next_due.isoformat(), row["id"]))
            else:
                await db.execute("UPDATE reminders SET notified_at=? WHERE id=?", (notified_at, row["id"]))
            due_reminders.append(reminder)
        await db.commit()
    return due_reminders

async def delete_reminder(reminder_id: str) -> bool:
    async with connect() as db:
        cursor = await db.execute("DELETE FROM reminders WHERE id=?", (reminder_id,))
        await db.commit()
        return cursor.rowcount > 0
