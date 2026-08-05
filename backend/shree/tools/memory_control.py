from __future__ import annotations

from pydantic import BaseModel, Field, model_validator

from ..memory import clear_memories, delete_memory as delete_memory_by_id, forget_memory
from ..models import ForgetMemory, MemoryCategory
from .base import ToolContext, Verification


class DeleteMemoryParams(BaseModel):
    all: bool = False
    memory_id: str | None = Field(default=None, max_length=100)
    category: MemoryCategory | None = None
    content: str | None = Field(default=None, min_length=2, max_length=2000)

    @model_validator(mode="after")
    def require_target(self):
        if not self.all and not self.memory_id and not (self.category and self.content):
            raise ValueError("all, memory_id, or category and content are required")
        return self


async def delete_memory(params: DeleteMemoryParams, context: ToolContext):
    context.ensure_active()
    if params.all:
        deleted = await clear_memories()
        target = {"all": True}
    elif params.memory_id:
        deleted = 1 if await delete_memory_by_id(params.memory_id) else 0
        target = {"memory_id": params.memory_id}
    else:
        deleted = await forget_memory(ForgetMemory(category=params.category, contentToForget=params.content or ""))
        target = {"category": params.category, "content": params.content}
    verified = deleted > 0
    return (
        {"deleted": deleted, "target": target},
        Verification(
            verified=verified,
            method="SQLite delete transaction and affected-row readback",
            observed={"deleted": deleted},
            message="The selected memory was removed." if verified else "No matching memory was found, so nothing was removed.",
        ),
        f"Deleted {deleted} matching memory item(s)." if verified else "No matching memory was deleted.",
    )
