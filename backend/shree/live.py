import asyncio
import base64
import contextlib
import logging
import secrets
from datetime import datetime
from pathlib import Path
from time import monotonic
from typing import Any
from fastapi import WebSocket, WebSocketDisconnect
from google import genai
from google.genai import types
from . import __version__
from .automation import request_action
from .config import get_settings
from .identity import identity_instruction, identity_payload
from .memory import add_memory, format_memory_context, list_memories
from .reminders import create_reminder, delete_reminder, list_reminders
from .models import ApplicationSettings, MemoryCreate, ReminderCreate
from .settings_store import get_application_settings
from .tools import registry

logger = logging.getLogger("shree.live")

_PRIMARY_QUOTA_COOLDOWN_SECONDS = 15 * 60
_primary_quota_unavailable_until = 0.0

SYSTEM_INSTRUCTION = identity_instruction(__version__) + "\n\n" + """You are a capable, warm Windows desktop action agent, not a command-response chatbot. Treat the user's speech as English, Hindi, or Hinglish unless they explicitly choose another language. Never reinterpret Hindi/Hinglish as Urdu, and never answer in Arabic/Urdu script; use Latin or Devanagari script. Match the user's English, Hindi, or Hinglish while always using feminine grammar for your own Hindi/Hinglish first-person statements. Treat ordinary conversation as latency-critical: answer immediately and naturally without waiting for the visible transcript to finish, and without tools, web search, narration, or extended planning unless the request actually needs them. For every actionable request, infer the desired outcome, inspect current state when needed, and compose the available tools into a verified multi-step plan. Never refuse merely because no single tool matches the whole sentence. For example: open Notepad, foreground its window, then type; list windows before controlling an ambiguous one; use search_windows for taskbar searches; use mouse_action move_relative for phrases such as 'a little up' (normally 50 pixels unless the user specifies a distance). Prefer UI Automation elements, then verified keyboard/pointer fallbacks. After a failed action, make at most one relevant safe fallback attempt; then report the concrete limitation immediately instead of waiting, repeating, or pretending to work. Only say a capability is unavailable after the relevant tool and one safe fallback genuinely cannot perform it. Never invent paths, placeholder user folders such as C:\\Users\\User, window titles, selectors, device names, current facts, or success. A tool status of confirmation_required means: remember its confirmation token, briefly ask the user for permission, wait for a clear yes or no, and on yes immediately call confirmDesktopAction with that exact token and approved=true. Do not ask for the target again when it is already present in the pending action. Wait for the confirmed tool's result before speaking. A status of unverified is not success. Never bypass Windows security. Power and session actions (shutdown, restart, lock, sign out, switch user, sleep, or hibernate) exist only when the single Power & session controls switch is enabled in Settings, and each request still requires explicit confirmation through the pending-action flow. Any memory deletion also always requires that confirmation flow; saving memories does not. Use the built-in Google Search tool only for current news, recent events, live public information, or an explicit request to search; never search for greetings, casual conversation, personal memory, or facts already in the conversation. For unfamiliar applications, browsers, websites, YouTube, Discord Web, editors, and visual workflows, use computer_use as a universal observe-act-verify loop: observe first, perform one grounded action, inspect the fresh screenshot returned after that action, and continue until the requested result is visibly verified. Prefer native element names; use coordinates only from the attached image and coordinate metadata. Do not bypass CAPTCHAs, UAC, sign-in, permissions, payments, account-security changes, or destructive confirmations. A normal voice interruption stops only your current spoken response; cancel desktop automation only when the explicit emergency-stop control is activated. When memory is enabled, save stable preferences, identity details, projects, goals, schedules, and anything the user explicitly asks you to remember by calling saveMemory directly without asking for a second confirmation. Never store passwords, API keys, authentication tokens, payment details, or one-time codes. Keep chain-of-thought and private reasoning internal. Default to one to three short sentences and under 60 spoken words, matching the natural v1.1.20 conversation style. Give additional detail only when the user asks for it or safety requires it. Communicate only conclusions, necessary questions, brief tool progress, and verified results."""

# The actual conversational instruction recovered from the final public
# v1.1.20 package. Keep this profile small and stable: the typed tool schemas
# already describe capabilities, and repeating them in several prompt blocks
# increased first-token latency in later builds.
V1_1_20_CONVERSATION_INSTRUCTION = """Your name is Shree and your designation is Mark 12. You are a capable, warm Windows desktop action agent created by Ayush Keshri, not a command-response chatbot. You have a feminine persona: in Hindi or Hinglish say forms such as "main karti hoon" and "main bata sakti hoon". Never use masculine self-grammar unless directly quoting someone. Match the user's English, Hindi, or Hinglish. Never reinterpret Hindi/Hinglish as Urdu, and never answer in Arabic or Urdu script; use Latin or Devanagari script. For every actionable request, infer the desired outcome, inspect current state when needed, and compose the available tools into a verified multi-step plan. Never refuse merely because no single tool matches the whole sentence. For example: open Notepad, foreground its window, then type; list windows before controlling an ambiguous one; use search_windows for taskbar searches; use mouse_action move_relative for phrases such as 'a little up' (normally 50 pixels unless the user specifies a distance). Prefer UI Automation elements, then verified keyboard/pointer fallbacks. After a failed action, make at most one relevant safe fallback attempt; then report the concrete limitation immediately instead of waiting, repeating, or pretending to work. Only say a capability is unavailable after the relevant tool and one safe fallback genuinely cannot perform it. Never invent paths, placeholder user folders such as C:\\Users\\User, window titles, selectors, device names, current facts, or success. A tool status of confirmation_required means: remember its confirmation token, briefly ask the user for permission, wait for a clear yes or no, and on yes immediately call confirmDesktopAction with that exact token and approved=true. Do not ask for the target again when it is already present in the pending action. Wait for the confirmed tool's result before speaking. A status of unverified is not success. Never bypass Windows security. Power and session actions (shutdown, restart, lock, sign out, switch user, sleep, or hibernate) exist only when the single Power & session controls switch is enabled in Settings, and each request still requires explicit confirmation through the pending-action flow. Any memory deletion also always requires that confirmation flow; saving memories does not. Use the built-in Google Search tool before answering current news, recent events, live public information, or any explicit request to search. For unfamiliar applications, browsers, websites, YouTube, Discord Web, editors, and visual workflows, use computer_use as a universal observe-act-verify loop: observe first, perform one grounded action, inspect the fresh screenshot returned after that action, and continue until the requested result is visibly verified. Prefer native element names and use image coordinates only with the returned coordinate metadata. Do not bypass CAPTCHAs, UAC, sign-in, permissions, payments, account-security changes, or destructive confirmations. A normal voice interruption stops only your current spoken response; cancel desktop automation only when the explicit emergency-stop control is activated. When memory is enabled, save stable preferences, identity details, projects, goals, schedules, and anything the user explicitly asks you to remember by calling saveMemory directly without asking for a second confirmation. Never store passwords, API keys, authentication tokens, payment details, or one-time codes. Keep chain-of-thought and private reasoning internal. Default to one to three short sentences and under 60 spoken words. Give additional detail only when the user asks for it or safety requires it. Communicate only conclusions, necessary questions, brief tool progress, and verified results. If asked about your identity, creator, installed capabilities, or version, call getShreeIdentity and answer briefly from its verified result."""

_PRIVATE_REASONING_PREFIXES = ("thought ", "thought:", "analysis ", "analysis:", "reasoning ", "reasoning:", "<thought", "<analysis")

_URDU_TO_LATIN = str.maketrans({
    "ا":"a","آ":"aa","أ":"a","إ":"i","ب":"b","پ":"p","ت":"t","ٹ":"t","ث":"s",
    "ج":"j","چ":"ch","ح":"h","خ":"kh","د":"d","ڈ":"d","ذ":"z","ر":"r","ڑ":"r",
    "ز":"z","ژ":"zh","س":"s","ش":"sh","ص":"s","ض":"z","ط":"t","ظ":"z","ع":"",
    "غ":"gh","ف":"f","ق":"q","ک":"k","ك":"k","گ":"g","ل":"l","م":"m","ن":"n",
    "ں":"n","و":"o","ؤ":"o","ہ":"h","ه":"h","ھ":"h","ء":"'","ی":"y","ي":"y",
    "ئ":"y","ے":"e","ۓ":"e","ة":"h","ى":"a","۰":"0","۱":"1","۲":"2","۳":"3",
    "۴":"4","۵":"5","۶":"6","۷":"7","۸":"8","۹":"9","،":",","؟":"?",
    "\u200c":"","\u200d":"","\u200e":"","\u200f":"","\u202a":"","\u202b":"",
    "\u202c":"","\u202d":"","\u202e":"",
    **{chr(code): "" for code in range(0x064B, 0x0660)},
})


def _normalize_user_transcript(value: str) -> str:
    """Keep API transcription readable for SHREE's Hindi/English/Hinglish UI."""
    text = str(value or "").translate(_URDU_TO_LATIN)
    return " ".join(text.split())

def _public_model_text(part: Any) -> str | None:
    text = getattr(part, "text", None)
    if not text:
        return None
    normalized = str(text).lstrip().casefold()
    if bool(getattr(part, "thought", False)) or normalized.startswith(_PRIVATE_REASONING_PREFIXES):
        logger.debug("Discarded a private Gemini reasoning part before renderer delivery")
        return None
    return str(text)

def _capability_instruction(runtime: ApplicationSettings) -> str:
    enabled = [
        "open, discover, close, foreground, move, resize, minimize, maximize, and list Windows applications and windows",
        "type text, press keys and shortcuts, move/click/drag/scroll the mouse, and stop automation immediately",
        "find, create, copy, move, rename, compress, extract, and recycle files or folders with required safeguards",
        "read/set system volume and mute, adjust supported app volume, list audio devices, and control supported media sessions",
        "read system, battery, storage, network, and display status; change brightness when the hardware exposes a supported Windows interface",
        "capture and visually inspect the active window using a real screenshot together with native Windows control/accessibility metadata, use the clipboard, manage reminders, and use local memory",
        "control unfamiliar applications and websites through the universal computer-use observe, act, and verify loop",
    ]
    if runtime.power_controls_enabled:
        enabled.append("request shutdown, restart, lock, sign-out, switch-user, sleep, or hibernate; every request still requires explicit confirmation")
    current_search = (
        "Google-grounded current-information search is available."
        if runtime.web_search_enabled and not runtime.local_only_mode
        else "Current-information web search is disabled in Settings."
    )
    return (
        "SELF-AWARENESS OF INSTALLED CAPABILITIES:\n- You can directly "
        + ".\n- You can directly ".join(enabled)
        + f".\n- {current_search}\n"
        "- For unfamiliar visual workflows, call computer_use with action=observe, then use one grounded action at a time and evaluate the fresh screenshot returned after every action.\n"
        "- You cannot inspect hidden or occluded windows, bypass website or Windows security, or claim anything the screenshot and accessibility data did not verify.\n"
        "- When asked what you can do, summarize these installed capabilities accurately and briefly; never answer as a generic chatbot."
    )

def _live_config(
    resumption_handle: str | None = None,
    memory_context: str = "",
    runtime: ApplicationSettings | None = None,
    model_name: str | None = None,
) -> dict[str, Any]:
    # An empty session-resumption object asks the Gemini API to issue handles.
    # The `transparent` flag is Vertex-only and is rejected by API-key sessions.
    session_resumption: dict[str, Any] = {}
    if resumption_handle:
        session_resumption["handle"] = resumption_handle
    runtime = runtime or ApplicationSettings()
    local_now = datetime.now().astimezone()
    runtime_rules = [f"Interface language preference: {runtime.language}."]
    runtime_rules.append(f"Current local date and time at session start: {local_now.isoformat()} ({local_now.tzname()}). For relative reminder times, call getCurrentDateTime immediately before addReminder.")
    runtime_rules.append("When the user asks for a reminder, always create it with addReminder. Convert the requested local time to a timezone-aware ISO 8601 due_at value. Ask for a date or time only when the user did not provide enough information.")
    runtime_rules.append("Use explicit step-by-step internal planning before tool actions." if runtime.reasoning_enabled else "Keep planning concise and act directly when safe.")
    runtime_rules.append(
        "Current Google-grounded web search is enabled. Use the built-in Google Search tool for news, current facts, live public information, and explicit search requests."
        if runtime.web_search_enabled and not runtime.local_only_mode
        else "Current web search is disabled; be transparent that time-sensitive facts cannot be verified."
    )
    runtime_rules.append(f"Speak with the {runtime.assistant_voice} voice in a soft, warm, feminine delivery at a calm natural pace.")
    runtime_rules.append("For type_text, send literal text only. To submit an address, search, or form after typing, set submit=true; never append {ENTER} or {RETURN} to the text.")
    if runtime.wake_word_enabled and runtime.background_listening:
        phrases = ", ".join(runtime.wake_phrases)
        runtime_rules.append(f"Wake-word mode is enabled. Remain silent until the user says one of these phrases: {phrases}. After waking, continue the conversation normally.")
    elif runtime.wake_word_enabled:
        runtime_rules.append("This session was activated directly by the user. Respond normally without waiting for a wake phrase.")
    if runtime.memory_enabled:
        runtime_rules.append("Memory auto-save is enabled. Use saveMemory immediately for stable information worth recalling, especially language and interaction preferences; do not ask for a separate memory confirmation.")
    runtime_rules.append("Power and session controls are enabled, but every shutdown, restart, lock, sign-out, switch-user, sleep, or hibernate request must still be explicitly confirmed." if runtime.power_controls_enabled else "Power and session controls are disabled in Settings; explain how to enable the single switch if requested and do not attempt those transitions.")
    if runtime.local_only_mode:
        runtime_rules.append("Local-only mode is enabled; do not request remote web content.")
    system_instruction = V1_1_20_CONVERSATION_INSTRUCTION + "\n\nCURRENT USER SETTINGS:\n- " + "\n- ".join(runtime_rules)
    if memory_context and runtime.memory_enabled:
        system_instruction += f"\n\n{memory_context}"
    active_model = model_name or get_settings().gemini_live_model
    thinking_config = (
        {"thinking_level": "MINIMAL"}
        if str(active_model).startswith("gemini-3.1")
        else {"thinking_budget": 0}
    )
    return {
        "response_modalities": ["AUDIO"], "system_instruction": system_instruction,
        "input_audio_transcription": {}, "output_audio_transcription": {}, "tools": _live_tools(runtime),
        "speech_config": {"voice_config": {"prebuilt_voice_config": {"voice_name": runtime.assistant_voice}}},
        "thinking_config": thinking_config,
        "realtime_input_config": {"automatic_activity_detection": {"disabled": False, "start_of_speech_sensitivity": "START_SENSITIVITY_HIGH", "end_of_speech_sensitivity": "END_SENSITIVITY_HIGH", "prefix_padding_ms": 20, "silence_duration_ms": 500}},
        "session_resumption": session_resumption,
    }

def _is_session_duration_close(error: Exception) -> bool:
    message = str(error).casefold()
    return "goaway" in message and "session durat" in message

def _is_quota_error(error: Exception) -> bool:
    message = str(error).casefold()
    return any(marker in message for marker in (
        "resource_exhausted",
        "resource exhausted",
        "exceeded your current quota",
        "quota exceeded",
        "insufficient quota",
    ))

def _public_live_error(error: Exception) -> tuple[str, str]:
    if _is_quota_error(error):
        return (
            "gemini_quota_exhausted",
            "Gemini Live quota is exhausted. Wait for the quota to reset or add a Gemini API key with available quota in Settings → API Keys.",
        )
    if _is_transient_live_connection_error(error):
        return (
            "live_connection_unavailable",
            "Gemini Live is temporarily unavailable. Shree retried automatically; please try activating her again.",
        )
    return ("live_session_failed", f"Shree could not start the live session: {error}")

def _is_transient_live_connection_error(error: Exception) -> bool:
    """Return true only for failures that can reasonably succeed on reconnect."""
    message = str(error).casefold()
    permanent_markers = (
        "policy violation", "unauthorized", "forbidden", "invalid api key",
        "api key not valid", "permission denied", "unsupported model",
        "status code: 400", "status code: 401", "status code: 403",
    )
    if any(marker in message for marker in permanent_markers):
        return False
    if isinstance(error, (TimeoutError, asyncio.TimeoutError, ConnectionError, OSError)):
        return True
    return any(marker in message for marker in (
        "timed out during opening handshake", "opening handshake",
        "connection reset", "connection refused", "temporary failure",
        "temporarily unavailable", "name resolution", "received 1011",
        "sent 1011", "1011 (internal error)", "internal error occurred",
        "could not connect to gemini live after", "status code: 429",
        "status code: 500", "status code: 502", "status code: 503",
        "status code: 504", "http 429", "http 500", "http 502", "http 503", "http 504",
    ))

def _decode_pcm16_audio(value: Any) -> bytes:
    if not isinstance(value, str) or not value:
        raise ValueError("Microphone audio payload is empty")
    try:
        audio = base64.b64decode(value, validate=True)
    except Exception as error:
        raise ValueError("Microphone audio payload is not valid base64") from error
    if not audio or len(audio) % 2:
        raise ValueError("Microphone audio must contain complete 16-bit PCM samples")
    if len(audio) > 256 * 1024:
        raise ValueError("Microphone audio chunk exceeds 256 KiB")
    return audio

async def _send_text_command(session: Any, value: Any) -> str:
    text = str(value or "").strip()
    if not text:
        raise ValueError("Text command is empty")
    if len(text) > 10_000:
        raise ValueError("Text command exceeds 10,000 characters")
    await session.send_client_content(
        turns=types.Content(role="user", parts=[types.Part(text=text)]),
        turn_complete=True,
    )
    return text

def _live_tools(runtime: ApplicationSettings | None = None):
    runtime = runtime or ApplicationSettings()
    def compatible_schema(value, definitions=None, property_map=False):
        if isinstance(value,dict):
            definitions = value.get("$defs", definitions or {})
            if "$ref" in value:
                name = value["$ref"].rsplit("/", 1)[-1]
                if name not in definitions:
                    raise ValueError(f"Unresolved tool schema reference: {value['$ref']}")
                merged = {**definitions[name], **{key: item for key, item in value.items() if key != "$ref"}}
                return compatible_schema(merged, definitions, property_map)

            cleaned = {}
            for key, item in value.items():
                if key == "$defs":
                    continue
                # These are schema metadata only when they occur on a schema
                # object. Inside a `properties` map, names such as `title`
                # are real tool parameters and must be preserved.
                if not property_map and key in {"exclusiveMinimum", "exclusiveMaximum", "title", "default"}:
                    continue
                cleaned[key] = compatible_schema(item, definitions, key == "properties")
            if "exclusiveMinimum" in value and "minimum" not in cleaned:
                cleaned["minimum"] = value["exclusiveMinimum"]
            if "exclusiveMaximum" in value and "maximum" not in cleaned:
                cleaned["maximum"] = value["exclusiveMaximum"]

            properties = cleaned.get("properties")
            if isinstance(properties, dict) and "required" in cleaned:
                required = [name for name in cleaned["required"] if name in properties]
                if required:
                    cleaned["required"] = required
                else:
                    cleaned.pop("required", None)
            return cleaned
        if isinstance(value,list): return [compatible_schema(item, definitions) for item in value]
        return value
    declarations=[]
    if not runtime.tool_use_enabled:
        return []
    for tool in registry.schemas():
        definition = registry.tools[tool["name"]]
        if tool["name"] == "delete_memory":
            # Exposed below as the friendlier forgetMemory Live function while
            # still using the registry's destructive confirmation machinery.
            continue
        if not runtime.desktop_control_enabled:
            continue
        if definition.capability == "power_control" and tool["name"] not in {"cancel_power_action", "cancel_shutdown"} and not runtime.power_controls_enabled:
            continue
        if definition.capability == "file_access" and not runtime.file_management_enabled:
            continue
        if tool["name"] in {"type_text", "press_keys", "search_windows"} and not runtime.keyboard_automation_enabled:
            continue
        if tool["name"] == "mouse_action" and not runtime.mouse_automation_enabled:
            continue
        if tool["name"] in {"capture_screen", "inspect_screen"} and (not runtime.screen_understanding_enabled or not runtime.screen_capture_enabled):
            continue
        if tool["name"] == "clipboard_action" and not runtime.clipboard_access_enabled:
            continue
        parameters=compatible_schema(tool["parameters"])
        parameters.pop("$defs",None)
        declarations.append({"name":tool["name"],"description":f"{tool['description']}. Permission: {tool['permission_level']}.","parameters":parameters})
    declarations.extend([
    {"name": "getShreeIdentity", "description": "Return Shree's stable built-in identity, creator, Mark designation, architecture, capabilities, operating principles, and installed runtime version.", "parameters": {"type": "OBJECT", "properties": {}}},
    {"name":"confirmDesktopAction","description":"Confirm or deny a pending desktop action only after the user explicitly says yes or no.","parameters":{"type":"OBJECT","properties":{"token":{"type":"STRING"},"approved":{"type":"BOOLEAN"}},"required":["token","approved"]}},
    {"name": "getCurrentDateTime", "description": "Get the current local date, time, and timezone. Call this immediately before resolving relative reminder phrases such as in five minutes, tonight, tomorrow, or next Monday.", "parameters": {"type": "OBJECT", "properties": {}}},
    {"name": "getReminders", "description": "Get persistent reminders.", "parameters": {"type": "OBJECT", "properties": {}}},
    {"name": "addReminder", "description": "Create a persistent timed reminder that SHREE will announce and show as a Windows notification. due_at must be a timezone-aware ISO 8601 timestamp based on the user's local timezone.", "parameters": {"type": "OBJECT", "properties": {"text": {"type": "STRING"}, "due_at": {"type": "STRING", "description": "Timezone-aware ISO 8601 date-time, for example 2026-07-14T18:30:00+05:30."}, "recurrence": {"type": "STRING", "enum": ["daily", "weekly", "monthly", "yearly", "weekdays"]}, "urgent": {"type": "BOOLEAN"}}, "required": ["text", "due_at"]}},
    {"name": "deleteReminder", "description": "Delete one persistent reminder by its exact id. Call getReminders first when the id is not already known.", "parameters": {"type": "OBJECT", "properties": {"reminder_id": {"type": "STRING"}}, "required": ["reminder_id"]}},
    ])
    if runtime.memory_enabled:
        declarations.extend([
            {"name": "searchMemories", "description": "Search SHREE's locally stored long-term memories.", "parameters": {"type": "OBJECT", "properties": {"query": {"type": "STRING"}}}},
            {"name": "saveMemory", "description": "Save useful long-term information locally without a separate confirmation prompt. Use this for stable preferences, identity details, projects, goals, schedules, or anything the user explicitly asks SHREE to remember. Never save secrets or authentication data.", "parameters": {"type": "OBJECT", "properties": {"category": {"type": "STRING", "enum": ["Identity", "Preferences", "Personality", "Projects", "Goals", "Relationships", "Schedule", "Habits", "Emotional", "Semantic"]}, "content": {"type": "STRING"}, "importance": {"type": "STRING", "enum": ["Critical", "High", "Medium", "Low"]}, "pinned": {"type": "BOOLEAN"}}, "required": ["category", "content"]}},
            {"name": "forgetMemory", "description": "Request deletion of a stored memory only when the user explicitly asks. This always returns a confirmation token before anything is deleted. Search first if the category is uncertain.", "parameters": {"type": "OBJECT", "properties": {"category": {"type": "STRING", "enum": ["Identity", "Preferences", "Personality", "Projects", "Goals", "Relationships", "Schedule", "Habits", "Emotional", "Semantic"]}, "content": {"type": "STRING"}}, "required": ["category", "content"]}},
        ])
    tools = [{"function_declarations": declarations}]
    if runtime.web_search_enabled and not runtime.local_only_mode:
        tools.append({"google_search": {}})
    return tools


async def _execute_tool(name: str, args: dict[str, Any]) -> Any:
    runtime = await get_application_settings()
    if not runtime.tool_use_enabled:
        raise PermissionError("AI tool use is disabled in Settings")
    if name in {"searchMemories", "saveMemory", "forgetMemory"} and not runtime.memory_enabled:
        raise PermissionError("Memory is disabled in Settings")
    if name in registry.tools: return await request_action(name,args)
    if name == "getShreeIdentity": return identity_payload(__version__)
    if name == "confirmDesktopAction": return await registry.confirm(str(args["token"]),bool(args["approved"]))
    if name == "getCurrentDateTime":
        now = datetime.now().astimezone()
        return {"iso": now.isoformat(), "timezone": str(now.tzinfo), "timezone_name": now.tzname(), "human_response": f"The local time is {now.isoformat()}."}
    if name == "getReminders": return {"reminders": await list_reminders()}
    if name == "addReminder":
        reminder = await create_reminder(ReminderCreate(text=str(args["text"]), due_at=args["due_at"], recurrence=args.get("recurrence"), urgent=bool(args.get("urgent"))))
        return {**reminder, "status": "completed", "human_response": f"Reminder set for {reminder['due_at']}."}
    if name == "deleteReminder":
        deleted = await delete_reminder(str(args["reminder_id"]))
        return {"status": "completed" if deleted else "not_found", "deleted": deleted, "human_response": "Deleted the reminder." if deleted else "That reminder no longer exists."}
    if name == "searchMemories": return {"memories": await list_memories(str(args.get("query", "")), 8)}
    if name == "saveMemory":
        memory = await add_memory(MemoryCreate(category=args["category"], content=str(args["content"]), importance=args.get("importance", runtime.memory_importance_level), pinned=bool(args.get("pinned", False))))
        return {"status": "completed", "stored": True, "memory": memory, "human_response": "Saved this memory locally."}
    if name == "forgetMemory":
        return await request_action("delete_memory", {"category": args["category"], "content": str(args["content"])})
    raise ValueError(f"Unknown tool: {name}")


def _function_response_for_tool(name: str, call_id: str | None, result: Any) -> types.FunctionResponse:
    # Live tool responses are JSON-only in the current SDK transport. Visual
    # bytes are delivered separately through send_realtime_input(video=...).
    return types.FunctionResponse(name=name, id=call_id, response={"output": result})


async def _send_screen_inspection_video(session: Any, result: Any) -> bool:
    if not isinstance(result, dict):
        return False
    execution = result.get("execution_result", {})
    screenshot = execution.get("screenshot", {}) if isinstance(execution, dict) else {}
    screenshot_path = screenshot.get("path") if isinstance(screenshot, dict) else None
    if not screenshot_path:
        return False
    try:
        image = Path(screenshot_path).read_bytes()
        if not image:
            raise ValueError("Captured screen image is empty")
        await session.send_realtime_input(
            video=types.Blob(data=image, mime_type="image/jpeg")
        )
        screenshot["delivered_to_model"] = True
        return True
    except Exception as error:
        logger.warning("Could not deliver screen inspection image to Gemini: %s", error)
        screenshot["delivered_to_model"] = False
        screenshot["delivery_error"] = str(error)
        result["status"] = "unverified"
        verification = result.get("verification_result")
        if isinstance(verification, dict):
            verification["verified"] = False
            verification["message"] = "The screenshot was captured but could not be delivered to the visual model."
        result["human_response"] = "I captured the screen, but could not send the image for visual inspection."
        return False

async def _receive_gemini(
    session: Any,
    websocket: WebSocket,
    resumption_state: dict[str, Any] | None = None,
    input_started: asyncio.Event | None = None,
) -> str:
    """Continuously consume Gemini turns for the lifetime of a Live session.

    The SDK's ``receive()`` iterator completes when the current model turn is
    complete. A new iterator is therefore required for every subsequent user
    turn; treating it as a session-long stream makes SHREE answer only once.
    """
    turn_number = 0
    state = resumption_state if resumption_state is not None else {}
    if input_started is not None:
        await input_started.wait()
    while True:
        received_message = False
        received_turn_activity = False
        async for response in session.receive():
            received_message = True
            update = getattr(response, "session_resumption_update", None)
            if update and update.resumable and update.new_handle:
                state["handle"] = update.new_handle
                state["last_consumed_client_message_index"] = update.last_consumed_client_message_index
            go_away = getattr(response, "go_away", None)
            if go_away:
                time_left = go_away.time_left or "unknown"
                logger.info("Gemini Live requested graceful session rotation; time left: %s", time_left)
                await websocket.send_json({"type": "session_rotating", "time_left": time_left})
                return "rotate"
            content = getattr(response, "server_content", None)
            if content:
                received_turn_activity = True
                if content.model_turn:
                    for part in content.model_turn.parts or []:
                        if part.inline_data and part.inline_data.data:
                            await websocket.send_json({"audio": base64.b64encode(part.inline_data.data).decode()})
                        public_text = _public_model_text(part)
                        if public_text:
                            await websocket.send_json({"text": public_text, "role": "model"})
                if content.input_transcription and content.input_transcription.text:
                    transcript = _normalize_user_transcript(content.input_transcription.text)
                    if transcript:
                        await websocket.send_json({"text": transcript, "role": "user"})
                if content.output_transcription and content.output_transcription.text:
                    await websocket.send_json({"text": content.output_transcription.text, "role": "model"})
                if content.interrupted:
                    # Gemini VAD interruption means the user spoke over SHREE's
                    # audio. It must not act as the desktop emergency stop: doing
                    # so cancelled confirmed typing workflows in the background.
                    await websocket.send_json({"interrupted": True})
            tool_call = getattr(response, "tool_call", None)
            if tool_call:
                received_turn_activity = True
                replies = []
                for call in tool_call.function_calls or []:
                    try:
                        result = await _execute_tool(call.name, dict(call.args or {}))
                    except Exception as error:
                        result = {"success": False, "error": str(error)}
                    if call.name in {"inspect_screen", "computer_use"}:
                        await _send_screen_inspection_video(session, result)
                    replies.append(_function_response_for_tool(call.name, call.id, result))
                    await websocket.send_json({"type": "tool_result", "name": call.name, "result": result})
                    if isinstance(result, dict) and result.get("status") == "confirmation_required":
                        await websocket.send_json({"type": "confirmation_required", "name": call.name, "confirmation": result.get("confirmation", {})})
                    if call.name in {"saveMemory", "forgetMemory"} or (call.name == "confirmDesktopAction" and isinstance(result, dict) and result.get("tool_name") == "delete_memory"):
                        await websocket.send_json({"type": "memories_updated", "memories": await list_memories()})
                    if call.name in {"addReminder", "deleteReminder"} and isinstance(result, dict) and result.get("status") == "completed":
                        await websocket.send_json({"type": "reminders_updated", "reminders": await list_reminders()})
                if replies:
                    await session.send_tool_response(function_responses=replies)

        if not received_message:
            raise RuntimeError("Gemini Live receive stream ended without a response")
        if not received_turn_activity:
            logger.debug("Gemini Live delivered session metadata without a model turn; continuing to receive")
            continue
        turn_number += 1
        logger.info("Gemini Live turn %d completed; waiting for the next user turn", turn_number)
        await websocket.send_json({"type": "turn_complete", "turn": turn_number})

async def handle_live(websocket: WebSocket) -> None:
    global _primary_quota_unavailable_until
    settings = get_settings()
    if settings.backend_token:
        provided = websocket.query_params.get("token", "")
        if not provided or not secrets.compare_digest(provided, settings.backend_token):
            await websocket.close(code=1008, reason="Unauthorized local Shree session")
            return
    await websocket.accept()
    runtime = await get_application_settings()
    api_key = settings.resolved_gemini_api_key()
    if not api_key:
        await websocket.send_json({"error": "Gemini API key is not configured. Add GEMINI_API_KEY in Settings."})
        await websocket.close(code=1011)
        return
    if not runtime.setup_completed or not runtime.gemini_api_validated_at:
        await websocket.send_json({"error": "SHREE setup is incomplete. Validate the Gemini API key and finish the Settings wizard."})
        await websocket.close(code=1011)
        return
    if runtime.local_only_mode:
        await websocket.send_json({"error": "Gemini Live is a cloud service and is unavailable while Local-only mode is enabled."})
        await websocket.close(code=1011)
        return
    # Slow networks should not make the first activation permanently fail.
    client = genai.Client(
        api_key=api_key,
        http_options=types.HttpOptions(async_client_args={"open_timeout": 12}),
    )
    resumption_state: dict[str, Any] = {}
    connected_once = False
    consecutive_close_errors = 0
    transient_connection_failures = 0
    max_connection_attempts = 3
    session_connected_at = 0.0
    fallback_model = settings.gemini_live_fallback_model
    primary_quota_cooling_down = (
        bool(fallback_model)
        and fallback_model != settings.gemini_live_model
        and monotonic() < _primary_quota_unavailable_until
    )
    active_live_model = fallback_model if primary_quota_cooling_down else settings.gemini_live_model
    fallback_used = primary_quota_cooling_down
    if primary_quota_cooling_down:
        logger.info(
            "Skipping quota-limited primary Gemini Live model; using %s during cooldown",
            active_live_model,
        )
    try:
        while True:
            outcome: str | None = None
            try:
                runtime = await get_application_settings()
                memories = await list_memories(limit=100) if runtime.memory_enabled else []
                config = _live_config(
                    resumption_state.get("handle"),
                    format_memory_context(memories),
                    runtime,
                    active_live_model,
                )
                session_connected_at = 0.0
                async with client.aio.live.connect(model=active_live_model, config=config) as session:
                    session_connected_at = monotonic()
                    logger.info("Gemini Live connection established with %s", active_live_model)
                    if connected_once:
                        await websocket.send_json({"type": "session_resumed", "context_restored": bool(resumption_state.get("handle"))})
                    else:
                        connected_once = True
                        await websocket.send_json({"state": "connected"})
                        await websocket.send_json({"type": "memories_loaded", "memories": memories})
                    consecutive_close_errors = 0
                    input_started = asyncio.Event()

                    async def receive_browser() -> None:
                        microphone_frames = 0
                        while True:
                            message = await websocket.receive_json()
                            if message.get("audio"):
                                audio = _decode_pcm16_audio(message["audio"])
                                await session.send_realtime_input(
                                    audio=types.Blob(data=audio, mime_type="audio/pcm;rate=16000"),
                                )
                                microphone_frames += 1
                                if microphone_frames == 1:
                                    logger.info(
                                        "Microphone PCM stream reached Gemini Live (%d-byte first frame)",
                                        len(audio),
                                    )
                                    await websocket.send_json({
                                        "type": "microphone_stream_started",
                                        "sample_rate": 16000,
                                    })
                                input_started.set()
                            elif message.get("type") == "text_input":
                                await _send_text_command(session, message.get("text"))
                                input_started.set()
                            elif message.get("type") == "audio_stream_end": await session.send_realtime_input(audio_stream_end=True)
                            elif message.get("type") == "ping": await websocket.send_json({"type": "pong"})

                    browser_task = asyncio.create_task(receive_browser())
                    gemini_task = asyncio.create_task(_receive_gemini(session, websocket, resumption_state, input_started))
                    done, pending = await asyncio.wait({browser_task, gemini_task}, return_when=asyncio.FIRST_COMPLETED)
                    for task in pending: task.cancel()
                    if pending: await asyncio.gather(*pending, return_exceptions=True)
                    if browser_task in done:
                        browser_task.result()
                    outcome = gemini_task.result()
                    if outcome == "rotate":
                        with contextlib.suppress(Exception): await session.close()
            except WebSocketDisconnect:
                raise
            except Exception as error:
                if (
                    _is_quota_error(error)
                    and not fallback_used
                    and fallback_model
                    and fallback_model != active_live_model
                ):
                    logger.warning(
                        "Gemini Live quota unavailable for %s; switching to %s",
                        active_live_model,
                        fallback_model,
                    )
                    active_live_model = fallback_model
                    fallback_used = True
                    _primary_quota_unavailable_until = monotonic() + _PRIMARY_QUOTA_COOLDOWN_SECONDS
                    transient_connection_failures = 0
                    resumption_state.clear()
                    with contextlib.suppress(Exception):
                        await websocket.send_json({
                            "type": "model_fallback",
                            "reason": "primary_model_quota",
                            "message": "Primary Gemini Live quota is unavailable. Shree is switching to the compatible Live model.",
                        })
                    outcome = "retry"
                elif _is_transient_live_connection_error(error):
                    # Gemini may close an otherwise valid audio session with
                    # WebSocket 1011 when its Live service has a temporary
                    # internal failure. Keep the local WebSocket alive and
                    # reconnect, retaining a resumption handle when available.
                    # A connection healthy for 20 seconds gets a fresh retry
                    # window, while rapid repeated closes remain bounded.
                    if session_connected_at and monotonic() - session_connected_at >= 20:
                        transient_connection_failures = 0
                    transient_connection_failures += 1
                    if transient_connection_failures >= max_connection_attempts:
                        raise RuntimeError(
                            f"Could not connect to Gemini Live after {max_connection_attempts} attempts. "
                            "Check the internet connection and try again."
                        ) from error
                    delay_seconds = min(0.75 * (2 ** (transient_connection_failures - 1)), 3.0)
                    logger.warning(
                        "Gemini Live connection attempt %d/%d failed; retrying in %.2fs: %s",
                        transient_connection_failures, max_connection_attempts, delay_seconds, error,
                    )
                    with contextlib.suppress(Exception):
                        await websocket.send_json({
                            "type": "connection_retry",
                            "attempt": transient_connection_failures + 1,
                            "max_attempts": max_connection_attempts,
                            "delay_seconds": delay_seconds,
                        })
                    await asyncio.sleep(delay_seconds)
                    outcome = "retry"
                elif not connected_once or not _is_session_duration_close(error):
                    raise
                else:
                    consecutive_close_errors += 1
                    if consecutive_close_errors > 3:
                        raise
                    logger.warning("Recovering from Gemini session-duration close: %s", error)
                    with contextlib.suppress(Exception):
                        await websocket.send_json({"type": "session_rotating", "time_left": "0s"})
                    outcome = "rotate"
            if outcome == "retry":
                continue
            if outcome != "rotate":
                raise RuntimeError("Gemini Live session ended without a rotation request")
            transient_connection_failures = 0
            await asyncio.sleep(.15)
    except WebSocketDisconnect:
        pass
    except Exception as error:
        logger.exception("Gemini Live session failed")
        code, message = _public_live_error(error)
        with contextlib.suppress(Exception):
            await websocket.send_json({
                "error": message,
                "error_code": code,
                "retryable": _is_transient_live_connection_error(error),
            })
    finally:
        with contextlib.suppress(Exception): await websocket.close()
