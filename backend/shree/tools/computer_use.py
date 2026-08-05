from __future__ import annotations

import asyncio
from typing import Literal

from pydantic import BaseModel, Field, model_validator

from .applications import OpenApplicationParams, open_application
from .base import ToolContext, Verification
from .input import MouseActionParams, PressKeysParams, TypeTextParams, mouse_action, press_keys, type_text
from .screen import InspectScreenParams, inspect_screen
from ..settings_store import get_setting


ComputerAction = Literal[
    "observe",
    "verify",
    "launch",
    "type",
    "keys",
    "move",
    "click",
    "double_click",
    "right_click",
    "drag",
    "scroll",
    "click_element",
    "wait",
]


class ComputerUseParams(BaseModel):
    action: ComputerAction
    application: str | None = Field(default=None, max_length=260, description="Application name for launch")
    browser_target: str | None = Field(default=None, max_length=2000, description="Optional URL/domain/search used with a browser launch")
    target_application: str | None = Field(default=None, max_length=300, description="Expected foreground application for typing or shortcuts")
    text: str | None = Field(default=None, max_length=50_000)
    submit: bool = False
    keys: str | None = Field(default=None, max_length=200, description="pywinauto key expression such as ^l, ^s, {TAB}, or {ENTER}")
    x: int | None = None
    y: int | None = None
    end_x: int | None = None
    end_y: int | None = None
    wheel_dist: int = Field(default=0, ge=-100, le=100)
    element_name: str | None = Field(default=None, max_length=300)
    control_type: str | None = Field(default=None, max_length=100)
    highlight: bool = True
    wait_seconds: float = Field(default=0.35, ge=0.1, le=3.0)
    expected_text: str | None = Field(default=None, max_length=500, description="Optional native UI text expected after the action")
    max_elements: int = Field(default=100, ge=1, le=300)

    @model_validator(mode="after")
    def validate_action_fields(self):
        if self.action == "launch" and not self.application:
            raise ValueError("application is required for launch")
        if self.action == "type" and (not self.text or not self.target_application):
            raise ValueError("text and target_application are required for type")
        if self.action == "keys" and not self.keys:
            raise ValueError("keys is required for keyboard shortcuts")
        if self.action in {"move", "click", "double_click", "right_click", "drag"} and (self.x is None or self.y is None):
            raise ValueError("x and y are required for this pointer action")
        if self.action == "drag" and (self.end_x is None or self.end_y is None):
            raise ValueError("end_x and end_y are required for drag")
        if self.action == "click_element" and not self.element_name:
            raise ValueError("element_name is required for click_element")
        return self


async def _ensure_capability(action: ComputerAction) -> None:
    if action in {"observe", "verify", "wait"}:
        if not await get_setting("screen_understanding_enabled", True) or not await get_setting("screen_capture_enabled", True):
            raise PermissionError("Screen understanding is disabled in Settings")
    if action in {"type", "keys"} and not await get_setting("keyboard_automation_enabled", True):
        raise PermissionError("Keyboard automation is disabled in Settings")
    if action in {"move", "click", "double_click", "right_click", "drag", "scroll", "click_element"} and not await get_setting("mouse_automation_enabled", True):
        raise PermissionError("Mouse automation is disabled in Settings")


async def computer_use(params: ComputerUseParams, context: ToolContext):
    """Perform one universal computer action and return a fresh visual observation."""
    context.ensure_active()
    await _ensure_capability(params.action)
    action_result: dict = {"action": params.action}
    action_verification = Verification(verified=True, method="observation requested", observed={}, message="No input action was required.")

    if params.action == "launch":
        action_result, action_verification, _ = await open_application(
            OpenApplicationParams(name=params.application, browser_target=params.browser_target), context
        )
    elif params.action == "type":
        action_result, action_verification, _ = await type_text(
            TypeTextParams(text=params.text or "", target_application=params.target_application or "", submit=params.submit), context
        )
    elif params.action == "keys":
        action_result, action_verification, _ = await press_keys(
            PressKeysParams(keys=params.keys or "", target_application=params.target_application), context
        )
    elif params.action in {"move", "click", "double_click", "right_click", "drag", "scroll", "click_element"}:
        action_result, action_verification, _ = await mouse_action(
            MouseActionParams(
                action=params.action,
                x=params.x,
                y=params.y,
                end_x=params.end_x,
                end_y=params.end_y,
                wheel_dist=params.wheel_dist,
                element_name=params.element_name,
                control_type=params.control_type,
                highlight=params.highlight,
            ),
            context,
        )
    elif params.action == "wait":
        await asyncio.sleep(params.wait_seconds)
        action_result = {"action": "wait", "seconds": params.wait_seconds}

    context.ensure_active()
    observation, observation_verification, _ = await inspect_screen(InspectScreenParams(max_elements=params.max_elements), context)
    native_text = " ".join(
        [str(observation.get("active_window", {}).get("title", ""))]
        + [str(element.get("name", "")) for element in observation.get("elements", [])]
    ).casefold()
    expected_verified = not params.expected_text or params.expected_text.casefold() in native_text
    verified = action_verification.verified and observation_verification.verified and expected_verified
    execution = {
        "action": params.action,
        "action_result": action_result,
        "active_window": observation.get("active_window", {}),
        "elements": observation.get("elements", []),
        "screenshot": observation.get("screenshot", {}),
        "expected_text": params.expected_text,
        "expected_text_observed": expected_verified if params.expected_text else None,
    }
    verification = Verification(
        verified=verified,
        method="Universal input dispatch + fresh active-window metadata and screenshot" + (" + native expected-text readback" if params.expected_text else ""),
        observed={
            "action_dispatched": action_verification.verified,
            "screen_captured": observation_verification.verified,
            "expected_text_observed": expected_verified if params.expected_text else None,
            "active_window": observation.get("active_window", {}),
        },
        message="The action was dispatched and a fresh screen observation is attached for the AI to evaluate." if verified else "The action or its requested verification could not be confirmed.",
    )
    response = "Observed the current screen." if params.action in {"observe", "verify"} else "The computer action was dispatched and the resulting screen was captured for verification."
    return execution, verification, response
