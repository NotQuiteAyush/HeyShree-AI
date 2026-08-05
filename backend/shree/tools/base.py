from __future__ import annotations
import asyncio
from dataclasses import dataclass
from enum import StrEnum
from typing import Any, Awaitable, Callable, Generic, TypeVar
from pydantic import BaseModel, Field

class PermissionLevel(StrEnum):
    SAFE = "safe"
    SENSITIVE = "sensitive"
    DESTRUCTIVE = "destructive"
    PRIVILEGED = "privileged"

class Verification(BaseModel):
    verified: bool
    method: str
    observed: dict[str, Any] = Field(default_factory=dict)
    message: str

class ToolOutcome(BaseModel):
    tool_name: str
    permission_level: PermissionLevel
    status: str
    execution_result: dict[str, Any] = Field(default_factory=dict)
    verification_result: Verification
    human_response: str
    duration_ms: int

class ToolContext:
    def __init__(self, cancel_event: asyncio.Event): self.cancel_event = cancel_event
    def ensure_active(self) -> None:
        if self.cancel_event.is_set(): raise asyncio.CancelledError("Emergency stop activated")

P = TypeVar("P", bound=BaseModel)
Handler = Callable[[P, ToolContext], Awaitable[tuple[dict[str, Any], Verification, str]]]

@dataclass(frozen=True)
class ToolDefinition(Generic[P]):
    name: str
    description: str
    permission: PermissionLevel
    parameters: type[P]
    handler: Handler[P]
    timeout_seconds: float = 15.0
    capability: str = "desktop_control"

    def public_schema(self) -> dict[str, Any]:
        schema = self.parameters.model_json_schema()
        schema.pop("title", None)
        return {"name": self.name, "description": self.description, "permission_level": self.permission.value,
                "timeout_seconds": self.timeout_seconds, "parameters": schema}
