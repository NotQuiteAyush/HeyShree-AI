from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field, model_validator

from .base import ToolContext, Verification


class PhoneActionParams(BaseModel):
    action: Literal[
        "open_url", "open_app", "set_volume", "media", "write_clipboard",
        "read_notifications", "call", "send_sms", "type_text", "click_text",
        "tap", "open_accessibility_settings",
        "flashlight", "battery_status", "open_settings", "set_alarm", "open_camera", "share_text",
        "open_dialer", "end_call", "find_contact", "contact_phone", "search_apps", "close_app",
        "send_whatsapp", "reply_notification", "web_search", "youtube_search",
        "maps_search", "navigate", "adjust_volume", "mute", "set_brightness",
        "adjust_brightness", "storage_status", "device_info", "charging_status",
        "set_timer", "cancel_alarm", "cancel_timer", "calendar_create", "calendar_read",
        "read_clipboard", "share_link", "open_gallery", "open_files", "record_audio",
        "do_not_disturb", "set_orientation", "bluetooth", "list_notes", "save_note",
        "delete_note", "current_location",
    ]
    target: str | None = Field(default=None, max_length=4_000, description="URL, Android package, phone number, text, or visible label")
    message: str | None = Field(default=None, max_length=20_000, description="SMS message body")
    percent: int | None = Field(default=None, ge=0, le=100)
    media_command: Literal["play", "pause", "play_pause", "next", "previous", "stop"] | None = None
    enabled: bool | None = None
    hour: int | None = Field(default=None, ge=0, le=23)
    minute: int | None = Field(default=None, ge=0, le=59)
    x: float | None = Field(default=None, ge=0, le=10_000)
    y: float | None = Field(default=None, ge=0, le=10_000)

    @model_validator(mode="after")
    def validate_action_values(self):
        if self.action in {"open_url", "open_app", "write_clipboard", "call", "type_text", "click_text", "open_settings", "share_text", "find_contact", "contact_phone", "search_apps", "send_whatsapp", "reply_notification", "web_search", "youtube_search", "maps_search", "navigate", "share_link", "save_note", "delete_note", "set_orientation"} and not self.target:
            raise ValueError(f"target is required for {self.action}")
        if self.action == "send_sms" and (not self.target or not self.message):
            raise ValueError("target phone number and message are required for send_sms")
        if self.action == "set_volume" and self.percent is None:
            raise ValueError("percent is required for set_volume")
        if self.action == "media" and self.media_command is None:
            raise ValueError("media_command is required for media")
        if self.action == "tap" and (self.x is None or self.y is None):
            raise ValueError("x and y are required for tap")
        if self.action == "flashlight" and self.enabled is None:
            raise ValueError("enabled is required for flashlight")
        if self.action == "set_alarm" and (self.hour is None or self.minute is None):
            raise ValueError("hour and minute are required for set_alarm")
        if self.action in {"set_brightness"} and self.percent is None:
            raise ValueError("percent is required for set_brightness")
        if self.action in {"adjust_volume", "adjust_brightness"} and not self.target:
            raise ValueError(f"target must be increase or decrease for {self.action}")
        if self.action in {"mute", "do_not_disturb", "bluetooth"} and self.enabled is None:
            raise ValueError(f"enabled is required for {self.action}")
        if self.action == "set_timer" and self.minute is None:
            raise ValueError("minute is required for set_timer (timer duration in minutes)")
        return self


async def phone_action(params: PhoneActionParams, context: ToolContext):
    from ..mobile import PhoneCommand, connection_manager, list_devices

    context.ensure_active()
    connected = [item for item in await list_devices() if not item["revoked"] and item["connected"]]
    if not connected:
        raise RuntimeError("The paired Android phone is offline. Open SHREE Companion and confirm that both the phone and PC have internet access.")
    arguments: dict[str, object] = {}
    if params.action == "open_url": arguments["url"] = params.target
    elif params.action == "open_app": arguments["package"] = params.target
    elif params.action == "set_volume": arguments["percent"] = params.percent
    elif params.action == "media": arguments["command"] = params.media_command
    elif params.action in {"write_clipboard", "type_text", "click_text"}: arguments["text"] = params.target
    elif params.action == "call": arguments["number"] = params.target
    elif params.action == "send_sms": arguments.update(number=params.target, message=params.message)
    elif params.action == "tap": arguments.update(x=params.x, y=params.y)
    elif params.action == "flashlight": arguments["enabled"] = params.enabled
    elif params.action == "open_settings": arguments["section"] = params.target
    elif params.action == "set_alarm": arguments.update(hour=params.hour, minute=params.minute, label=params.message or "SHREE alarm")
    elif params.action == "share_text": arguments["text"] = params.target
    elif params.action in {"find_contact", "contact_phone", "search_apps", "web_search", "youtube_search", "maps_search", "navigate", "set_orientation", "delete_note"}: arguments["query"] = params.target
    elif params.action == "reply_notification": arguments.update(query=params.target, message=params.message or "")
    elif params.action == "send_whatsapp": arguments.update(target=params.target, message=params.message or "")
    elif params.action in {"adjust_volume", "adjust_brightness"}: arguments["direction"] = params.target
    elif params.action in {"mute", "do_not_disturb", "bluetooth"}: arguments["enabled"] = params.enabled
    elif params.action == "set_brightness": arguments["percent"] = params.percent
    elif params.action == "set_timer": arguments.update(minutes=params.minute, label=params.message or "SHREE timer")
    elif params.action == "calendar_create": arguments.update(title=params.target or params.message or "SHREE event", details=params.message or "")
    elif params.action in {"share_link", "save_note"}: arguments["text"] = params.target
    result = await connection_manager.command(connected[0]["id"], PhoneCommand(action=params.action, arguments=arguments))
    verified = bool(result.get("success"))
    message = str(result.get("message") or result.get("error") or "The phone returned no result")
    return result, Verification(
        verified=verified,
        method="encrypted Android companion command and on-device execution result",
        observed=result,
        message=message,
    ), message
