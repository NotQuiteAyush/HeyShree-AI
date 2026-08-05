"""Compatibility facade for the structured desktop tool registry."""
from typing import Any
from .tools import registry

ACTIONS={name:(definition.permission.value,definition.description,definition.handler) for name,definition in registry.tools.items()}

async def request_action(action:str,arguments:dict[str,Any]): return await registry.request(action,arguments)
async def confirm_action(token:str,approved:bool): return await registry.confirm(token,approved)
