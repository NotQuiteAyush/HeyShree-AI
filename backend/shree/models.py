from datetime import datetime
from typing import Any, Literal
from pydantic import BaseModel, Field, field_validator

MemoryCategory = Literal["Identity", "Preferences", "Personality", "Projects", "Goals", "Relationships", "Schedule", "Habits", "Emotional", "Semantic"]
Importance = Literal["Critical", "High", "Medium", "Low"]

class MemoryCreate(BaseModel):
    category: MemoryCategory
    content: str = Field(min_length=2, max_length=2000)
    importance: Importance = "Medium"
    pinned: bool = False

class MemoryOut(BaseModel):
    id: str
    category: MemoryCategory
    content: str
    importance: Importance
    confidence: float
    timestamp: str
    lastAccessed: str
    timesReinforced: int
    pinned: bool = False

class ForgetMemory(BaseModel):
    category: MemoryCategory
    contentToForget: str = Field(min_length=1, max_length=500)

class ReminderCreate(BaseModel):
    text: str = Field(min_length=1, max_length=500)
    due_at: datetime | None = None
    recurrence: Literal["daily", "weekly", "monthly", "yearly", "weekdays"] | None = None
    urgent: bool = False

    @field_validator("due_at")
    @classmethod
    def require_reminder_timezone(cls, value: datetime | None):
        if value is not None and value.tzinfo is None:
            raise ValueError("Reminder due_at must include a timezone offset")
        return value

class ReminderPatch(BaseModel):
    text: str | None = Field(default=None, min_length=1, max_length=500)
    due_at: datetime | None = None
    recurrence: Literal["daily", "weekly", "monthly", "yearly", "weekdays"] | None = None
    urgent: bool | None = None
    completed: bool | None = None

    @field_validator("due_at")
    @classmethod
    def require_reminder_timezone(cls, value: datetime | None):
        if value is not None and value.tzinfo is None:
            raise ValueError("Reminder due_at must include a timezone offset")
        return value

class ToolRequest(BaseModel):
    action: str = Field(min_length=1, max_length=100)
    arguments: dict[str, Any] = Field(default_factory=dict)

class PermissionUpdate(BaseModel):
    decision: Literal["ask", "allow_always", "deny"]

class DesktopControlSettings(BaseModel):
    desktop_control_enabled: bool = True
    power_controls_enabled: bool = False
    exact_volume_enabled: bool = True
    keyboard_automation_enabled: bool = True
    mouse_automation_enabled: bool = True
    file_management_enabled: bool = True
    ocr_enabled: bool = True
    clipboard_access_enabled: bool = True
    screen_capture_enabled: bool = True
    clipboard_history_enabled: bool = False
    emergency_stop_shortcut: str = Field(default="CommandOrControl+Alt+Shift+Escape", min_length=3, max_length=100)
    file_access_folders: list[str] = Field(default_factory=list, max_length=25)
    application_aliases: dict[str, str] = Field(default_factory=dict)

class ConfirmationRequest(BaseModel):
    approved: bool

class SettingValue(BaseModel):
    value: Any

class SettingsPatch(BaseModel):
    values: dict[str, Any] = Field(default_factory=dict, max_length=100)

class SettingsImport(BaseModel):
    values: dict[str, Any] = Field(default_factory=dict, max_length=100)

class SetupComplete(BaseModel):
    completed: bool = True

class MemoryUpdate(BaseModel):
    category: MemoryCategory | None = None
    content: str | None = Field(default=None, min_length=2, max_length=2000)
    importance: Importance | None = None
    pinned: bool | None = None

class MemoryImport(BaseModel):
    memories: list[MemoryCreate] = Field(default_factory=list, max_length=5000)

class SavedMcpServer(BaseModel):
    name: str = Field(pattern=r"^[a-zA-Z0-9_-]{1,50}$")
    command: str = Field(min_length=1, max_length=500)
    args: list[str] = Field(default_factory=list, max_length=30)
    enabled: bool = True

class ApplicationSettings(BaseModel):
    # General
    setup_completed: bool = False
    language: Literal["Auto", "English", "Hindi"] = "Auto"
    theme: Literal["Dark", "Light", "Auto"] = "Dark"
    accent_color: str = "#6EE7FF"
    animation_speed: Literal["Reduced", "Normal", "Fast"] = "Normal"
    minimize_to_tray: bool = True
    start_minimized: bool = False
    remember_window_position: bool = True
    check_updates_automatically: bool = True
    automatic_download_updates: bool = False
    automatic_install_updates: bool = False
    update_channel: Literal["stable", "beta", "alpha"] = "stable"
    notifications_enabled: bool = True

    # Floating companion
    floating_mode_enabled: bool = True
    start_in_floating_mode: bool = False
    floating_always_on_top: bool = True
    floating_auto_hide_fullscreen: bool = True
    floating_avatar_size: Literal["Small", "Medium", "Large"] = "Medium"
    floating_opacity: int = Field(default=96, ge=35, le=100)
    floating_click_through_idle: bool = False
    floating_show_subtitles: bool = True
    floating_show_speech_bubble: bool = True
    floating_idle_animations: bool = True
    floating_lip_sync: bool = True
    floating_desktop_awareness: bool = False
    floating_proactive_suggestions: bool = False
    floating_voice_volume: int = Field(default=82, ge=0, le=100)
    floating_edge_snapping: bool = True
    floating_animation_quality: Literal["Low", "Balanced", "High"] = "Balanced"
    floating_activation_shortcut: str = Field(default="CommandOrControl+Alt+Space", min_length=3, max_length=100)

    # Android companion connectivity
    mobile_remote_access_enabled: bool = True
    mobile_relay_url: str = Field(default="https://shree-e2e-relay.shree-e2e-relay.workers.dev", max_length=500)
    mobile_worldwide_migrated: bool = False

    # Wake word and AI
    wake_word_enabled: bool = False
    wake_phrases: list[str] = Field(default_factory=lambda: ["Hello Shree", "Hi Shree", "Hey Shree", "Namaste Shree", "Shree"], max_length=10)
    background_listening: bool = False
    reasoning_enabled: bool = True
    tool_use_enabled: bool = True
    web_search_enabled: bool = True
    memory_enabled: bool = True
    code_execution_enabled: bool = False
    screen_understanding_enabled: bool = True
    desktop_control_enabled: bool = True
    assistant_voice: Literal["Achernar", "Vindemiatrix", "Leda", "Aoede", "Kore"] = "Aoede"
    v1_1_20_voice_restored: bool = False

    # Memory
    memory_importance_level: Importance = "Medium"

    # Desktop control
    power_controls_enabled: bool = False
    exact_volume_enabled: bool = True
    keyboard_automation_enabled: bool = True
    mouse_automation_enabled: bool = True
    file_management_enabled: bool = True
    ocr_enabled: bool = True
    clipboard_access_enabled: bool = True
    screen_capture_enabled: bool = True
    clipboard_history_enabled: bool = False
    emergency_stop_shortcut: str = Field(default="CommandOrControl+Alt+Shift+Escape", min_length=3, max_length=100)
    file_access_folders: list[str] = Field(default_factory=list, max_length=25)
    application_aliases: dict[str, str] = Field(default_factory=dict)

    # Audio devices and notifications
    audio_input_device_id: str = "default"
    audio_output_device_id: str = "default"
    desktop_notifications: bool = True
    sound_notifications: bool = True
    reminder_notifications: bool = True
    update_notifications: bool = True
    error_notifications: bool = True
    quiet_hours_enabled: bool = False
    quiet_hours_start: str = "22:00"
    quiet_hours_end: str = "07:00"

    # Privacy, plugins, performance and developer options
    local_only_mode: bool = False
    encrypt_saved_settings: bool = False
    plugins_enabled: bool = True
    plugin_states: dict[str, bool] = Field(default_factory=dict)
    mcp_servers: list[SavedMcpServer] = Field(default_factory=list, max_length=50)
    hardware_acceleration: bool = True
    background_cpu_limit: int = Field(default=50, ge=10, le=100)
    memory_usage_limit_mb: int = Field(default=1024, ge=256, le=8192)
    cache_size_mb: int = Field(default=256, ge=32, le=4096)
    developer_mode: bool = False
    debug_logs: bool = False
    tool_execution_logs: bool = True
    api_request_logs: bool = False
    gemini_api_validated_at: str | None = None

    @field_validator("accent_color")
    @classmethod
    def validate_accent(cls, value: str) -> str:
        if len(value) != 7 or not value.startswith("#") or any(char not in "0123456789abcdefABCDEF" for char in value[1:]):
            raise ValueError("Accent color must be a six-digit hex color")
        return value.upper()

    @field_validator("mobile_relay_url")
    @classmethod
    def validate_mobile_relay_url(cls, value: str) -> str:
        normalized = value.strip().rstrip("/")
        if normalized and not normalized.startswith("https://"):
            raise ValueError("Mobile relay URL must use HTTPS")
        return normalized

    @field_validator("wake_phrases")
    @classmethod
    def validate_wake_phrases(cls, value: list[str]) -> list[str]:
        phrases = [phrase.strip() for phrase in value if phrase.strip()]
        if any(len(phrase) > 80 for phrase in phrases):
            raise ValueError("Wake phrases must be 80 characters or fewer")
        return list(dict.fromkeys(phrases))

    @field_validator("quiet_hours_start", "quiet_hours_end")
    @classmethod
    def validate_clock_time(cls, value: str) -> str:
        pieces = value.split(":")
        if len(pieces) != 2 or not all(piece.isdigit() for piece in pieces):
            raise ValueError("Quiet hours must use HH:MM")
        hour, minute = (int(piece) for piece in pieces)
        if hour > 23 or minute > 59:
            raise ValueError("Quiet hours must use a valid 24-hour time")
        return f"{hour:02d}:{minute:02d}"

class McpServerCreate(BaseModel):
    name: str = Field(pattern=r"^[a-zA-Z0-9_-]{1,50}$")
    command: str = Field(min_length=1, max_length=500)
    args: list[str] = Field(default_factory=list, max_length=30)
    env: dict[str, str] = Field(default_factory=dict)

    @field_validator("env")
    @classmethod
    def validate_env(cls, value: dict[str, str]) -> dict[str, str]:
        if len(value) > 30 or any(len(k) > 100 or len(v) > 4000 for k, v in value.items()):
            raise ValueError("MCP environment is too large")
        return value
