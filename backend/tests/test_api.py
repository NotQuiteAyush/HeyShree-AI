import asyncio
from datetime import UTC, datetime, timedelta
from pathlib import Path
import pytest
from types import SimpleNamespace
from httpx import ASGITransport, AsyncClient
from pydantic import BaseModel
from shree.config import get_settings

@pytest.fixture(autouse=True)
def isolated_database(tmp_path: Path, monkeypatch):
    monkeypatch.setenv("DATA_DIR", str(tmp_path / "data")); get_settings.cache_clear()
    yield tmp_path
    get_settings.cache_clear()

async def client():
    from shree.database import initialize_database
    from shree.main import app
    await initialize_database()
    return AsyncClient(transport=ASGITransport(app=app), base_url="http://test")

@pytest.mark.asyncio
async def test_health_and_memory_save_without_confirmation():
    async with await client() as http:
        response=await http.get("/api/health"); assert response.status_code==200
        saved=await http.post("/api/memories",json={"category":"Preferences","content":"User likes blue"}); assert saved.status_code==201


@pytest.mark.asyncio
async def test_worldwide_mobile_relay_is_enabled_once_and_respects_opt_out():
    from shree.database import initialize_database
    from shree.settings_store import get_application_settings, update_application_settings

    await initialize_database()
    settings = await get_application_settings()
    assert settings.mobile_remote_access_enabled is True
    assert settings.mobile_relay_url == "https://shree-e2e-relay.shree-e2e-relay.workers.dev"
    assert settings.mobile_worldwide_migrated is True

    await update_application_settings({"mobile_remote_access_enabled": False})
    settings = await get_application_settings()
    assert settings.mobile_remote_access_enabled is False

@pytest.mark.asyncio
async def test_database_migration_runs_once_and_creates_verified_backup():
    from shree.database import connect, initialize_database
    await initialize_database()
    settings = get_settings()
    backups = list((settings.data_dir / "backups").glob("shree-before-v2-*.db"))
    assert len(backups) == 1 and backups[0].stat().st_size > 0
    async with connect() as db:
        rows = await (await db.execute("SELECT version,name FROM schema_migrations")).fetchall()
        assert [(row["version"], row["name"]) for row in rows] == [
            (1, "initial_shree_schema"),
            (2, "secure_mobile_companion"),
        ]
    await initialize_database()
    assert list((settings.data_dir / "backups").glob("shree-before-v2-*.db")) == backups

@pytest.mark.asyncio
async def test_update_install_waits_for_file_operations_and_cancels_safe_automation():
    from shree.tools import registry
    async def wait_forever():
        await asyncio.Event().wait()
    file_task = asyncio.create_task(wait_forever(), name="tool:copy_item")
    registry.active_tasks.add(file_task)
    try:
        readiness = registry.update_readiness()
        assert readiness["ready"] is False and readiness["blocking_tasks"] == ["copy_item"]
    finally:
        file_task.cancel()
        await asyncio.gather(file_task, return_exceptions=True)
        registry.active_tasks.discard(file_task)
    safe_task = asyncio.create_task(wait_forever(), name="tool:open_application")
    registry.active_tasks.add(safe_task)
    prepared = await registry.prepare_update()
    assert prepared["ready"] is True and prepared["cancelled_safe_tasks"] == 1

@pytest.mark.asyncio
async def test_packaged_backend_requires_its_ephemeral_session_token():
    from shree import main
    previous = main.settings.backend_token
    main.settings.backend_token = "test-session-token"
    try:
        async with await client() as http:
            assert (await http.get("/api/health")).status_code == 401
            assert (await http.get("/api/health", headers={"X-Shree-Token":"wrong"})).status_code == 401
            assert (await http.get("/api/health", headers={"X-Shree-Token":"test-session-token"})).status_code == 200
    finally:
        main.settings.backend_token = previous

@pytest.mark.asyncio
async def test_live_websocket_rejects_an_invalid_local_session_token(monkeypatch):
    from shree import live
    class FakeWebSocket:
        query_params = {"token":"wrong"}
        def __init__(self): self.closed = None; self.accepted = False
        async def close(self, **details): self.closed = details
        async def accept(self): self.accepted = True
    monkeypatch.setattr(live, "get_settings", lambda: SimpleNamespace(backend_token="expected"))
    websocket = FakeWebSocket()
    await live.handle_live(websocket)
    assert websocket.closed and websocket.closed["code"] == 1008
    assert websocket.accepted is False

@pytest.mark.asyncio
async def test_shree_identity_has_stable_creator_and_mark_facts():
    async with await client() as http:
        response = await http.get("/api/identity")
        assert response.status_code == 200
        identity = response.json()
        assert identity["name"] == "Shree"
        assert identity["designation"] == "Mark 12"
        assert identity["creator"]["name"] == "Ayush Keshri"
        assert "designed and built Shree AI" in identity["creator"]["known_fact"]
        assert identity["runtime_version"] == "1.1.47"

    from shree.live import _live_config, _live_tools
    instruction = str(_live_config()["system_instruction"])
    assert "Your name is Shree" in instruction
    assert "created by Ayush" in instruction
    names = {item["name"] for item in _live_tools()[0]["function_declarations"]}
    assert "getShreeIdentity" in names

@pytest.mark.asyncio
async def test_timed_reminder_is_persisted_claimed_and_not_repeated():
    async with await client() as http:
        due_at = (datetime.now(UTC) - timedelta(seconds=1)).isoformat()
        created = await http.post("/api/reminders", json={"text":"Test the reminder bell","due_at":due_at})
        assert created.status_code == 201 and created.json()["due_at"] == due_at
        first = (await http.post("/api/reminders/due")).json()
        assert [item["text"] for item in first["reminders"]] == ["Test the reminder bell"]
        assert first["desktop_notifications"] is True and first["sound_notifications"] is True
        second = (await http.post("/api/reminders/due")).json()
        assert second["reminders"] == []
        stored = (await http.get("/api/reminders")).json()
        assert stored[0]["notified_at"] is not None

@pytest.mark.asyncio
async def test_recurring_reminder_advances_to_the_next_occurrence():
    async with await client() as http:
        now = datetime.now(UTC)
        due_at = (now - timedelta(days=2)).isoformat()
        created = await http.post("/api/reminders", json={"text":"Daily review","due_at":due_at,"recurrence":"daily"})
        assert created.status_code == 201
        fired = (await http.post("/api/reminders/due")).json()["reminders"]
        assert len(fired) == 1 and datetime.fromisoformat(fired[0]["next_due_at"]) > now
        stored = (await http.get("/api/reminders")).json()[0]
        assert datetime.fromisoformat(stored["due_at"]) > now and stored["notified_at"] is None

@pytest.mark.asyncio
async def test_reminder_delete_button_endpoint_removes_the_record():
    async with await client() as http:
        due_at = (datetime.now(UTC) + timedelta(hours=1)).isoformat()
        created = (await http.post("/api/reminders", json={"text":"Delete me","due_at":due_at})).json()
        deleted = await http.delete(f"/api/reminders/{created['id']}")
        assert deleted.status_code == 204
        assert (await http.get("/api/reminders")).json() == []

@pytest.mark.asyncio
async def test_tool_catalog_has_typed_contracts():
    async with await client() as http:
        response=await http.get("/api/tools"); assert response.status_code==200; tools={item["name"]:item for item in response.json()}
        required={"get_system_volume","set_system_volume","change_system_volume","set_application_volume","list_audio_devices","find_application","open_application","close_application","list_windows","control_window","type_text","press_keys","search_windows","mouse_action","computer_use","find_file","create_file","create_folder","copy_item","move_item","rename_item","recycle_item","capture_screen","inspect_screen","clipboard_action","get_system_status","change_windows_setting","shutdown_system","restart_system","lock_workstation","sign_out_user","switch_user","sleep_system","hibernate_system","cancel_power_action","delete_memory"}
        assert required <= tools.keys()
        removed_web_tools={"open_website","browser_action","youtube_action","discord_action","observe_screen","visual_action","confirmed_visual_action"}
        assert removed_web_tools.isdisjoint(tools)
        assert tools["set_system_volume"]["permission_level"]=="safe"
        confirmation_free={"type_text","press_keys","mouse_action","computer_use","find_file","capture_screen","inspect_screen","clipboard_action"}
        assert all(tools[name]["permission_level"]=="safe" for name in confirmation_free)
        assert tools["recycle_item"]["permission_level"]=="destructive"
        assert tools["shutdown_system"]["permission_level"]=="privileged"
        assert tools["delete_memory"]["permission_level"]=="destructive"
        assert "percent" in tools["set_system_volume"]["parameters"]["properties"]

def test_volume_validation_clamps_safely():
    from shree.tools.audio import SetVolumeParams
    assert SetVolumeParams(percent=150).percent==100
    assert SetVolumeParams(percent=-20).percent==0
    assert SetVolumeParams(percent="37").percent==37

def test_relative_mouse_and_close_window_are_available():
    from shree.tools.applications import ControlWindowParams
    from shree.tools.input import MouseActionParams, WindowsSearchParams
    assert MouseActionParams(action="move_relative", dy=-50).dy == -50
    with pytest.raises(ValueError): MouseActionParams(action="move_relative")
    assert ControlWindowParams(title="Notepad", action="close").action == "close"
    assert WindowsSearchParams(query="calculator", launch_first_result=True).launch_first_result is True

def test_window_matching_ignores_invisible_title_characters():
    from shree.tools.applications import normalize_window_text, window_matches
    edge = {"title": "New tab - Personal - Microsoft\u200b Edge", "process": "msedge.exe"}
    assert normalize_window_text(edge["title"]) == "new tab personal microsoft edge"
    assert window_matches(edge, "Microsoft Edge")
    assert window_matches(edge, "msedge")

def test_foregrounding_a_maximized_window_does_not_restore_or_shrink_it(monkeypatch):
    from shree.tools import applications
    calls=[]
    class User32:
        def IsWindow(self,_hwnd): return True
        def IsIconic(self,_hwnd): return False
        def ShowWindow(self,hwnd,command): calls.append((hwnd,command)); return True
        def BringWindowToTop(self,_hwnd): return True
        def SetForegroundWindow(self,_hwnd): return True
        def GetForegroundWindow(self): return 77
    monkeypatch.setattr(applications,"user32",User32())
    assert applications._bring_to_foreground(77) is True
    assert calls == []

def test_unicode_key_sends_bmp_and_surrogate_units(monkeypatch):
    from shree.tools import input as input_tools
    calls = []
    def send_input(count, _events, size):
        calls.append((count, size))
        return count
    monkeypatch.setattr(input_tools.user32, "SendInput", send_input)
    input_tools._unicode_key("A", False)
    input_tools._unicode_key("😀", False)
    assert len(calls) == 3

def test_type_text_converts_trailing_enter_macro_into_real_submit():
    from shree.tools.input import TypeTextParams
    normalized = TypeTextParams(text="youtube.com{ENTER}", target_application="Chrome")
    assert normalized.text == "youtube.com"
    assert normalized.submit is True
    explicit = TypeTextParams(text="google.com", target_application="Chrome", submit=True)
    assert explicit.text == "google.com"
    assert explicit.submit is True

@pytest.mark.asyncio
async def test_type_text_dispatches_real_enter_after_uia_text(monkeypatch):
    import asyncio
    from shree.tools import input as input_tools
    from shree.tools.base import ToolContext

    key_calls = []
    monkeypatch.setattr(input_tools, "active_window", lambda: {"handle": 7, "title": "New Tab - Google Chrome"})
    monkeypatch.setattr(input_tools, "prepare_text_target", lambda _hwnd: {"identified": True, "candidate_count": 1})
    monkeypatch.setattr(input_tools, "set_empty_text_target", lambda _hwnd, text: {"applied": True, "verified": text == "youtube.com"})
    monkeypatch.setattr(input_tools.keyboard, "send_keys", lambda keys, **_kwargs: key_calls.append(keys))

    execution, verification, _response = await input_tools.type_text(
        input_tools.TypeTextParams(text="youtube.com{ENTER}", target_application="Chrome"),
        ToolContext(asyncio.Event()),
    )
    assert key_calls == ["{ENTER}"]
    assert execution["submitted"] is True
    assert verification.verified is True

def test_uia_fast_path_never_overwrites_existing_text(monkeypatch):
    from shree.tools import input as input_tools
    class ValuePattern:
        def __init__(self, value): self.CurrentValue = value
        def SetValue(self, value): self.CurrentValue = value
    class Target:
        def __init__(self, value): self.iface_value = ValuePattern(value)
    existing = Target("keep me")
    monkeypatch.setattr(input_tools, "_editable_target", lambda _hwnd: (existing, 1))
    refused = input_tools.set_empty_text_target(1, "replacement")
    assert refused["applied"] is False
    assert existing.iface_value.CurrentValue == "keep me"
    empty = Target("")
    monkeypatch.setattr(input_tools, "_editable_target", lambda _hwnd: (empty, 1))
    written = input_tools.set_empty_text_target(1, "new text")
    assert written["applied"] is True and written["verified"] is True
    assert empty.iface_value.CurrentValue == "new text"

def test_live_tool_schemas_are_accepted_by_google_sdk():
    from google.genai import types
    from shree.live import _live_config,_live_tools
    config=types.LiveConnectConfig.model_validate(_live_config("resume-handle"))
    assert config.tools and len(_live_tools()[0]["function_declarations"]) >= 30
    assert config.session_resumption.handle == "resume-handle"
    assert config.session_resumption.transparent is None

def test_live_uses_soft_voice_short_answers_and_optional_current_search():
    from shree.config import get_settings
    from shree.live import _live_config, _live_tools, _normalize_user_transcript
    from shree.models import ApplicationSettings

    defaults = ApplicationSettings()
    config = _live_config(runtime=defaults)
    assert get_settings().gemini_live_model == "gemini-2.5-flash-native-audio-latest"
    assert config["speech_config"]["voice_config"]["prebuilt_voice_config"]["voice_name"] == "Aoede"
    assert "usually under 25 spoken words" in str(config["system_instruction"])
    assert "Do not restate the request" in str(config["system_instruction"])
    assert "never change volume for an application-launch request" in str(config["system_instruction"])
    assert config["thinking_config"]["thinking_budget"] == 0
    fallback_config = _live_config(runtime=defaults, model_name="gemini-3.1-flash-live-preview")
    assert fallback_config["thinking_config"]["thinking_level"] == "MINIMAL"
    vad = config["realtime_input_config"]["automatic_activity_detection"]
    assert vad["prefix_padding_ms"] == 40
    assert vad["silence_duration_ms"] == 420
    instruction = str(config["system_instruction"])
    assert "open Notepad, foreground its window, then type" in instruction
    assert "call getShreeIdentity" in instruction
    assert "Never reinterpret Hindi/Hinglish as Urdu" in instruction
    normalized = _normalize_user_transcript("ہیلو، آپ کیسے ہیں؟")
    assert normalized and "?" in normalized
    assert not any("\u0600" <= character <= "\u06ff" for character in normalized)
    enabled = _live_tools(defaults)
    disabled = _live_tools(ApplicationSettings(web_search_enabled=False))
    local = _live_tools(ApplicationSettings(local_only_mode=True))
    assert any("google_search" in item for item in enabled)
    assert not any("google_search" in item for item in disabled)
    assert not any("google_search" in item for item in local)

def test_manual_activation_does_not_wait_for_a_wake_phrase():
    from shree.live import _live_config
    from shree.models import ApplicationSettings

    manual = str(_live_config(runtime=ApplicationSettings(
        wake_word_enabled=True,
        background_listening=False,
    ))["system_instruction"])
    background = str(_live_config(runtime=ApplicationSettings(
        wake_word_enabled=True,
        background_listening=True,
    ))["system_instruction"])
    assert "Respond normally without waiting for a wake phrase" in manual
    assert "Remain silent until the user says" not in manual
    assert "Remain silent until the user says" in background

def test_quota_errors_are_mapped_to_safe_actionable_guidance():
    from shree.live import _is_quota_error, _public_live_error

    error = RuntimeError("1011 None. You exceeded your current quota, please check your plan")
    assert _is_quota_error(error) is True
    code, message = _public_live_error(error)
    assert code == "gemini_quota_exhausted"
    assert "Settings" in message
    assert "http" not in message

@pytest.mark.asyncio
async def test_brightness_uses_windows_api_and_reports_readback(monkeypatch):
    from shree.tools import system

    monkeypatch.setattr(system, "_set_wmi_brightness", lambda percent: 1)
    monkeypatch.setattr(system, "_wmi_brightness_values", lambda: [43])
    assert await system.set_brightness(43) == "Windows WMI brightness API"
    assert await system.get_brightness() == 43

def test_approved_memory_context_is_injected_and_prioritized():
    from shree.live import _live_config
    from shree.memory import format_memory_context
    memories=[
        {"category":"Preferences","content":"Always speak with the user in Hindi.","importance":"High","confidence":1,"timesReinforced":2,"pinned":True},
        {"category":"Semantic","content":"The user's favorite color is blue.","importance":"Low","confidence":1,"timesReinforced":1,"pinned":False},
    ]
    context=format_memory_context(memories)
    config=_live_config(memory_context=context)
    instruction=str(config["system_instruction"])
    assert "Always speak with the user in Hindi" in instruction
    assert instruction.index("Always speak with the user in Hindi") < instruction.index("favorite color")
    assert "newer explicit user request overrides" in instruction

def test_live_tool_required_fields_exist_in_properties():
    from shree.live import _live_tools

    def validate(schema, location):
        assert "$defs" not in schema, location
        assert "$ref" not in schema, location
        properties = schema.get("properties", {})
        assert set(schema.get("required", [])) <= set(properties), location
        for name, child in properties.items():
            validate(child, f"{location}.properties.{name}")
        for index, child in enumerate(schema.get("anyOf", [])):
            validate(child, f"{location}.anyOf[{index}]")
        if isinstance(schema.get("items"), dict):
            validate(schema["items"], f"{location}.items")

    declarations = _live_tools()[0]["function_declarations"]
    for declaration in declarations:
        validate(declaration["parameters"], declaration["name"])

    control_window = next(item for item in declarations if item["name"] == "control_window")
    assert "title" in control_window["parameters"]["properties"]

def test_live_memory_saves_without_a_confirmation_tool():
    from shree.live import _live_tools

    names = {item["name"] for item in _live_tools()[0]["function_declarations"]}
    assert "saveMemory" in names
    assert "requestMemoryConsent" not in names
    assert "confirmMemoryConsent" not in names

def test_1_1_34_live_catalog_uses_atomic_browser_navigation_not_generic_workflow():
    from shree.live import _live_tools

    declarations = {item["name"]: item for item in _live_tools()[0]["function_declarations"]}
    assert "runDesktopWorkflow" not in declarations
    open_app = declarations["open_application"]
    assert "browser_target" in open_app["parameters"]["properties"]
    assert "normal profile" in open_app["description"]

def test_live_exposes_one_universal_visual_computer_interface():
    from shree.live import _live_config, _live_tools

    declarations = {item["name"]: item for item in _live_tools()[0]["function_declarations"]}
    universal = declarations["computer_use"]
    actions = set(universal["parameters"]["properties"]["action"]["enum"])
    assert {"observe", "launch", "type", "keys", "click", "drag", "scroll", "verify"} <= actions
    instruction = str(_live_config()["system_instruction"])
    assert "universal observe-act-verify loop" in instruction
    assert "Browser navigation, page analysis" not in instruction

def test_browser_target_converts_domains_and_searches_without_keyboard_steps():
    from shree.tools.applications import OpenApplicationParams, _browser_destination

    params = OpenApplicationParams(name="Chrome", browser_target="youtube.com")
    assert params.browser_target == "youtube.com"
    assert _browser_destination("youtube.com") == "https://youtube.com"
    assert _browser_destination("class 11 physics") == "https://www.google.com/search?q=class+11+physics"

def test_live_reminder_tools_require_a_real_due_time():
    from shree.live import _live_tools

    declarations = {item["name"]: item for item in _live_tools()[0]["function_declarations"]}
    assert "getCurrentDateTime" in declarations
    assert set(declarations["addReminder"]["parameters"]["required"]) == {"text", "due_at"}
    assert set(declarations["deleteReminder"]["parameters"]["required"]) == {"reminder_id"}

def test_power_live_tools_are_available_only_when_unified_switch_is_enabled():
    from shree.live import _live_tools
    from shree.models import ApplicationSettings
    disabled = {item["name"] for item in _live_tools(ApplicationSettings(power_controls_enabled=False))[0]["function_declarations"]}
    enabled = {item["name"] for item in _live_tools(ApplicationSettings(power_controls_enabled=True))[0]["function_declarations"]}
    transitions = {"shutdown_system", "restart_system", "lock_workstation", "sign_out_user", "switch_user", "sleep_system", "hibernate_system"}
    assert not transitions & disabled
    assert transitions <= enabled
    assert "cancel_power_action" in disabled

def test_shree_uses_feminine_hindi_and_hinglish_self_grammar():
    from shree.live import _live_config
    instruction = str(_live_config()["system_instruction"])
    assert "feminine persona" in instruction
    assert "main karti hoon" in instruction
    assert "Never use masculine self-grammar" in instruction

@pytest.mark.asyncio
async def test_typed_command_is_sent_as_a_complete_user_turn():
    from shree.live import _send_text_command
    class Session:
        def __init__(self): self.calls=[]
        async def send_client_content(self, **kwargs): self.calls.append(kwargs)
    session=Session()
    text=await _send_text_command(session,"  open normal Chrome  ")
    assert text=="open normal Chrome"
    assert session.calls[0]["turn_complete"] is True
    assert session.calls[0]["turns"].parts[0].text=="open normal Chrome"

def test_microphone_pcm_payload_validation():
    import base64
    from shree.live import _decode_pcm16_audio

    pcm = b"\x01\x00\xff\x7f"
    assert _decode_pcm16_audio(base64.b64encode(pcm).decode()) == pcm
    with pytest.raises(ValueError, match="base64"):
        _decode_pcm16_audio("not valid base64!")
    with pytest.raises(ValueError, match="complete 16-bit"):
        _decode_pcm16_audio(base64.b64encode(b"\x00").decode())
    with pytest.raises(ValueError, match="256 KiB"):
        _decode_pcm16_audio(base64.b64encode(bytes(256 * 1024 + 2)).decode())

@pytest.mark.asyncio
async def test_live_receiver_consumes_more_than_one_completed_turn(monkeypatch):
    from shree import live
    from shree.live import _receive_gemini

    def response(text: str, interrupted: bool = False, thought: bool = False):
        part = SimpleNamespace(inline_data=None, text=text, thought=thought)
        content = SimpleNamespace(
            model_turn=SimpleNamespace(parts=[part]),
            input_transcription=None,
            output_transcription=None,
            interrupted=interrupted,
        )
        return SimpleNamespace(server_content=content, tool_call=None)

    def metadata_only():
        return SimpleNamespace(
            server_content=None,
            tool_call=None,
            session_resumption_update=SimpleNamespace(resumable=False),
            go_away=None,
        )

    class FakeSession:
        def __init__(self):
            self.turns = [
                [metadata_only()],
                [response("thought private reasoning", thought=True), response("first answer", interrupted=True)],
                [response("second answer")],
            ]
            self.receive_calls = 0
            self.wait_forever = asyncio.Event()

        def receive(self):
            call = self.receive_calls
            self.receive_calls += 1

            async def messages():
                if call < len(self.turns):
                    for item in self.turns[call]:
                        yield item
                else:
                    await self.wait_forever.wait()
                    if False:
                        yield None

            return messages()

    class FakeWebSocket:
        def __init__(self):
            self.messages = []
            self.second_turn = asyncio.Event()

        async def send_json(self, message):
            self.messages.append(message)
            if message.get("text") == "second answer":
                self.second_turn.set()

    async def forbidden_emergency_stop():
        raise AssertionError("Voice VAD interruption must not cancel desktop tools")
    monkeypatch.setattr(live.registry, "emergency_stop", forbidden_emergency_stop)
    session = FakeSession()
    websocket = FakeWebSocket()
    input_started = asyncio.Event()
    task = asyncio.create_task(_receive_gemini(session, websocket, input_started=input_started))
    await asyncio.sleep(0)
    assert session.receive_calls == 0
    input_started.set()
    await asyncio.wait_for(websocket.second_turn.wait(), timeout=1)
    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await task

    answers = [item["text"] for item in websocket.messages if item.get("role") == "model"]
    assert answers == ["first answer", "second answer"]
    assert session.receive_calls >= 3
    completed = [item for item in websocket.messages if item.get("type") == "turn_complete"]
    assert len(completed) == 2

def test_private_reasoning_text_is_never_exposed_to_the_renderer():
    from shree.live import _public_model_text
    assert _public_model_text(SimpleNamespace(text="thought The user wants...", thought=False)) is None
    assert _public_model_text(SimpleNamespace(text="hidden plan", thought=True)) is None
    assert _public_model_text(SimpleNamespace(text="Here is the verified result.", thought=False)) == "Here is the verified result."


@pytest.mark.asyncio
async def test_new_voice_device_replaces_the_previous_live_session():
    from shree import live

    class FakeSocket:
        def __init__(self):
            self.messages = []
            self.closed = None
        async def send_json(self, message): self.messages.append(message)
        async def close(self, **details): self.closed = details

    first, second = FakeSocket(), FakeSocket()
    first_lease = await live._claim_live_connection(first, "PC")
    second_lease = await live._claim_live_connection(second, "phone")
    try:
        assert first.messages == [{"type": "session_replaced", "text": "Voice continued on phone."}]
        assert first.closed == {"code": 4001, "reason": "Voice continued on another SHREE device"}
        await live._release_live_connection(first_lease)
        assert live._active_live_connection and live._active_live_connection[0] == second_lease
    finally:
        await live._release_live_connection(second_lease)

@pytest.mark.asyncio
async def test_live_receiver_requests_rotation_on_goaway():
    from shree.live import _receive_gemini
    update = SimpleNamespace(new_handle="resume-123", resumable=True, last_consumed_client_message_index=42)
    go_away = SimpleNamespace(time_left="5s")
    responses = [
        SimpleNamespace(server_content=None, tool_call=None, session_resumption_update=update, go_away=None),
        SimpleNamespace(server_content=None, tool_call=None, session_resumption_update=None, go_away=go_away),
    ]
    class FakeSession:
        def receive(self):
            async def messages():
                for response in responses: yield response
            return messages()
    class FakeWebSocket:
        def __init__(self): self.messages=[]
        async def send_json(self,message): self.messages.append(message)
    state={}; websocket=FakeWebSocket()
    outcome=await _receive_gemini(FakeSession(),websocket,state)
    assert outcome=="rotate"
    assert state=={"handle":"resume-123","last_consumed_client_message_index":42}
    assert websocket.messages[-1]=={"type":"session_rotating","time_left":"5s"}

def test_session_duration_and_server_1011_closes_are_recoverable():
    from shree.live import (
        _is_session_duration_close,
        _is_transient_live_connection_error,
        _public_live_error,
    )
    assert _is_session_duration_close(RuntimeError("GoAway signal once the session duration limit was reached"))
    assert not _is_session_duration_close(RuntimeError("1008 policy violation: invalid tool schema"))
    assert _is_transient_live_connection_error(TimeoutError("timed out during opening handshake"))
    assert _is_transient_live_connection_error(RuntimeError("server rejected WebSocket connection: HTTP 503"))
    internal = RuntimeError(
        "received 1011 (internal error) Internal error occurred.; "
        "then sent 1011 (internal error) Internal error occurred."
    )
    assert _is_transient_live_connection_error(internal)
    code, message = _public_live_error(internal)
    assert code == "live_connection_unavailable"
    assert "retried automatically" in message
    assert not _is_transient_live_connection_error(RuntimeError("1008 policy violation: invalid tool schema"))
    assert not _is_transient_live_connection_error(RuntimeError("status code: 403 forbidden"))

@pytest.mark.asyncio
async def test_floating_companion_settings_are_validated_and_persisted():
    async with await client() as http:
        updates = {
            "floating_mode_enabled": True,
            "start_in_floating_mode": False,
            "floating_avatar_size": "Large",
            "floating_opacity": 84,
            "floating_voice_volume": 63,
            "floating_animation_quality": "High",
            "floating_activation_shortcut": "CommandOrControl+Alt+Space",
        }
        response = await http.put("/api/settings", json={"values": updates})
        assert response.status_code == 200
        stored = (await http.get("/api/settings")).json()["values"]
        assert all(stored[key] == value for key, value in updates.items())
        invalid = await http.put("/api/settings/floating_opacity", json={"value": 10})
        assert invalid.status_code == 400

@pytest.mark.asyncio
async def test_screen_inspection_uses_live_video_and_keeps_tool_response_json_only(tmp_path):
    from shree.live import _function_response_for_tool, _send_screen_inspection_video

    screenshot = tmp_path / "inspection.jpg"
    screenshot.write_bytes(b"\xff\xd8screen-image\xff\xd9")
    result = {
        "status": "completed",
        "execution_result": {
            "active_window": {"title": "Example"},
            "elements": [],
            "screenshot": {"path": str(screenshot), "captured": True},
        },
    }
    class FakeSession:
        def __init__(self): self.video = None
        async def send_realtime_input(self, *, video): self.video = video

    session = FakeSession()
    assert await _send_screen_inspection_video(session, result) is True
    assert session.video.mime_type == "image/jpeg"
    assert session.video.data == screenshot.read_bytes()
    assert result["execution_result"]["screenshot"]["delivered_to_model"] is True
    response = _function_response_for_tool("inspect_screen", "call-1", result)
    assert response.id == "call-1"
    assert response.parts is None

@pytest.mark.asyncio
async def test_universal_computer_action_always_returns_a_fresh_visual_observation(monkeypatch, tmp_path):
    from shree.tools import computer_use as universal
    from shree.tools.base import ToolContext, Verification

    screenshot = tmp_path / "computer-use.jpg"
    screenshot.write_bytes(b"visual")

    async def allowed(_action): return None
    async def clicked(_params, _context):
        return {"x": 50, "y": 60}, Verification(verified=True, method="input", observed={}, message="clicked"), "clicked"
    async def observed(_params, _context):
        return {
            "active_window": {"title": "Example App", "handle": 7},
            "elements": [{"name": "Done", "control_type": "Button"}],
            "screenshot": {"path": str(screenshot), "captured": True, "origin_x": 0, "origin_y": 0},
        }, Verification(verified=True, method="screen", observed={}, message="captured"), "observed"

    monkeypatch.setattr(universal, "_ensure_capability", allowed)
    monkeypatch.setattr(universal, "mouse_action", clicked)
    monkeypatch.setattr(universal, "inspect_screen", observed)
    execution, verification, _ = await universal.computer_use(
        universal.ComputerUseParams(action="click", x=50, y=60, expected_text="Done"),
        ToolContext(asyncio.Event()),
    )
    assert verification.verified is True
    assert execution["screenshot"]["path"] == str(screenshot)
    assert execution["expected_text_observed"] is True

@pytest.mark.asyncio
async def test_destructive_recycle_requires_confirmation(tmp_path):
    target=tmp_path/"delete-me.txt"; target.write_text("keep until confirmed")
    async with await client() as http:
        response=await http.post("/api/tools/execute",json={"action":"recycle_item","arguments":{"path":str(target)}})
        assert response.status_code==200; body=response.json(); assert body["status"]=="confirmation_required"; assert target.exists()
        denied=await http.post(f"/api/tools/confirm/{body['confirmation']['token']}",json={"approved":False})
        assert denied.json()["status"]=="denied"; assert target.exists()

@pytest.mark.asyncio
async def test_memory_deletion_always_uses_one_time_confirmation():
    async with await client() as http:
        memory=(await http.post("/api/memories",json={"category":"Preferences","content":"Always speak Hindi"})).json()
        requested=(await http.post("/api/tools/execute",json={"action":"delete_memory","arguments":{"memory_id":memory["id"]}})).json()
        assert requested["status"]=="confirmation_required"
        assert len((await http.get("/api/memories")).json())==1
        confirmed=(await http.post(f"/api/tools/confirm/{requested['confirmation']['token']}",json={"approved":True})).json()
        assert confirmed["status"]=="completed" and confirmed["verification_result"]["verified"] is True
        assert (await http.get("/api/memories")).json()==[]

@pytest.mark.asyncio
async def test_power_controls_are_disabled_by_default_and_every_transition_requires_confirmation_when_enabled():
    async with await client() as http:
        disabled=await http.post("/api/tools/execute",json={"action":"shutdown_system","arguments":{"delay_seconds":10}})
        assert disabled.status_code==403
        assert (await http.put("/api/settings/power_controls_enabled",json={"value":True})).status_code==200
        for action, arguments in (("shutdown_system", {"delay_seconds":10}), ("restart_system", {"delay_seconds":10}), ("lock_workstation", {}), ("switch_user", {}), ("sleep_system", {})):
            requested=(await http.post("/api/tools/execute",json={"action":action,"arguments":arguments})).json()
            assert requested["status"]=="confirmation_required"
            denied=(await http.post(f"/api/tools/confirm/{requested['confirmation']['token']}",json={"approved":False})).json()
            assert denied["status"]=="denied"

def test_numeric_windows_media_status_is_named_correctly():
    from shree.tools.media import _playback_status_name
    assert _playback_status_name(4)=="playing"
    assert _playback_status_name(5)=="paused"

@pytest.mark.asyncio
async def test_media_fallback_never_claims_success_without_session_readback(monkeypatch):
    from shree.tools import media
    from shree.tools.base import ToolContext
    async def unavailable(): raise OSError("media service unavailable")
    monkeypatch.setattr(media,"_current",unavailable)
    monkeypatch.setattr(media,"_browser_media_fallback",lambda action:{"window":{"title":"YouTube - Google Chrome"},"app_command":46,"send_result":0})
    _,verification,response=await media.media_action(media.MediaActionParams(action="play"),ToolContext(asyncio.Event()))
    assert verification.verified is False
    assert "cannot confirm" in response

@pytest.mark.asyncio
async def test_clipboard_tool_does_not_request_confirmation():
    async with await client() as http:
        response=await http.post("/api/tools/execute",json={"action":"clipboard_action","arguments":{"action":"read_text"}})
        assert response.status_code==200; assert response.json()["status"]!="confirmation_required"

@pytest.mark.asyncio
async def test_create_file_verifies_and_refuses_overwrite(tmp_path):
    target=tmp_path/"notes.txt"
    async with await client() as http:
        created=await http.post("/api/tools/execute",json={"action":"create_file","arguments":{"path":str(target),"content":"chemistry"}})
        body=created.json(); assert body["status"]=="completed"; assert body["verification_result"]["verified"] is True; assert target.read_text()=="chemistry"
        overwrite=await http.post("/api/tools/execute",json={"action":"create_file","arguments":{"path":str(target),"content":"replace"}})
        assert overwrite.status_code==200; assert overwrite.json()["status"]=="failed"; assert overwrite.json()["verification_result"]["verified"] is False; assert target.read_text()=="chemistry"

@pytest.mark.asyncio
async def test_friendly_desktop_paths_use_the_windows_known_folder(monkeypatch, tmp_path):
    from shree.tools import files

    desktop = tmp_path / "Redirected Desktop"
    desktop.mkdir()
    monkeypatch.setattr(files, "_known_folder", lambda name: desktop if name == "desktop" else tmp_path / name)

    assert files.resolved(r"Desktop\School Notes.txt") == (desktop / "School Notes.txt").resolve()
    assert files.resolved(r"C:\Users\User\Desktop\School Notes.txt") == (desktop / "School Notes.txt").resolve()
    async with await client() as http:
        created = await http.post(
            "/api/tools/execute",
            json={
                "action": "create_file",
                "arguments": {
                    "path": r"Desktop\SHREE Desktop test.txt",
                    "content": "verified",
                },
            },
        )
    assert created.json()["status"] == "completed"
    assert (desktop / "SHREE Desktop test.txt").read_text(encoding="utf-8") == "verified"

@pytest.mark.asyncio
async def test_permission_deny_blocks_before_execution(tmp_path):
    async with await client() as http:
        await http.put("/api/desktop-control/permissions/file_access",json={"decision":"deny"})
        response=await http.post("/api/tools/execute",json={"action":"create_folder","arguments":{"path":str(tmp_path/"blocked")}})
        assert response.status_code==403; assert not (tmp_path/"blocked").exists()

@pytest.mark.asyncio
async def test_emergency_stop_cancels_active_tool():
    from shree.database import initialize_database
    from shree.tools.base import PermissionLevel,ToolDefinition,Verification
    from shree.tools.registry import ToolRegistry
    class Params(BaseModel): pass
    started=asyncio.Event()
    async def slow(_,context):
        started.set()
        while True: context.ensure_active(); await asyncio.sleep(.01)
    await initialize_database(); local=ToolRegistry(); definition=ToolDefinition("slow","slow test",PermissionLevel.SAFE,Params,slow,5); local.add(definition)
    task=asyncio.create_task(local.execute(definition,Params())); await started.wait(); result=await local.emergency_stop()
    assert result["stopped"]==1
    with pytest.raises(asyncio.CancelledError): await task

@pytest.mark.asyncio
async def test_desktop_settings_round_trip():
    payload={"desktop_control_enabled":True,"exact_volume_enabled":True,"clipboard_history_enabled":False,"emergency_stop_shortcut":"CommandOrControl+Alt+Shift+Escape","file_access_folders":[str(Path.home()/"Documents")],"application_aliases":{}}
    async with await client() as http:
        saved=await http.put("/api/desktop-control/settings",json=payload); assert saved.status_code==200
        loaded=await http.get("/api/desktop-control/settings"); settings=loaded.json()["settings"]
        assert all(settings[key] == value for key,value in payload.items())
        assert settings["keyboard_automation_enabled"] is True
        assert settings["screen_capture_enabled"] is True

@pytest.mark.asyncio
async def test_setup_requires_a_validated_credential(monkeypatch):
    from shree import main
    stored={"value":None}
    monkeypatch.setattr(type(main.settings),"resolved_gemini_api_key",lambda _self:stored["value"])
    monkeypatch.setattr(main.keyring,"set_password",lambda _service,_name,value:stored.update(value=value))
    async def valid(_key): return {"valid":True,"provider":"gemini","model":"test-live-model"}
    monkeypatch.setattr(main,"validate_gemini_key",valid)
    async with await client() as http:
        status=(await http.get("/api/setup/status")).json(); assert status["requires_setup"] is True
        saved=await http.put("/api/secrets/gemini",json={"api_key":"valid-test-key-1234567890"}); assert saved.status_code==200
        still_incomplete=(await http.get("/api/setup/status")).json(); assert still_incomplete["providers"]["gemini"]["validated"] is True and still_incomplete["ready"] is False
        finished=await http.post("/api/setup/complete",json={"completed":True}); assert finished.json()["ready"] is True

@pytest.mark.asyncio
async def test_settings_are_typed_and_can_use_dpapi():
    async with await client() as http:
        bad=await http.put("/api/settings/not_a_real_setting",json={"value":True}); assert bad.status_code==400
        protected=await http.put("/api/settings/gemini_api_validated_at",json={"value":"forged"}); assert protected.status_code==403
        bulk_protected=await http.put("/api/settings",json={"values":{"setup_completed":True}}); assert bulk_protected.status_code==403
        encrypted=await http.put("/api/settings/encrypt_saved_settings",json={"value":True}); assert encrypted.status_code==200
        loaded=(await http.get("/api/settings")).json()["values"]
        assert loaded["encrypt_saved_settings"] is True and loaded["theme"]=="Dark"
    from shree.database import connect
    async with connect() as db:
        row=await (await db.execute("SELECT value FROM settings WHERE key='theme'")).fetchone()
        assert row["value"].startswith("dpapi:")

@pytest.mark.asyncio
async def test_memory_manager_edit_export_and_clear():
    async with await client() as http:
        memory=(await http.post("/api/memories",json={"category":"Preferences","content":"Always answer in Hindi","importance":"High"})).json()
        edited=await http.put(f"/api/memories/{memory['id']}",json={"content":"Always speak in Hindi","pinned":True}); assert edited.json()["pinned"] is True
        exported=(await http.get("/api/memories/export")).json(); assert exported["format"]=="shree-memories" and len(exported["memories"])==1
        requested=(await http.delete("/api/memories")).json(); assert requested["status"]=="confirmation_required"
        assert len((await http.get("/api/memories")).json())==1
        cleared=(await http.post(f"/api/tools/confirm/{requested['confirmation']['token']}",json={"approved":True})).json(); assert cleared["execution_result"]["deleted"]==1
