from __future__ import annotations

import asyncio
from statistics import median
from time import monotonic

from google import genai
from google.genai import types

from shree.config import get_settings
from shree.live import _live_config
from shree.models import ApplicationSettings


async def first_audio_ms(client: genai.Client, config: dict, model: str) -> float:
    async with client.aio.live.connect(model=model, config=config) as session:
        started = monotonic()
        await session.send_client_content(
            turns=types.Content(role="user", parts=[types.Part(text="Say ready.")]),
            turn_complete=True,
        )
        async for response in session.receive():
            content = getattr(response, "server_content", None)
            for part in getattr(getattr(content, "model_turn", None), "parts", None) or []:
                if getattr(getattr(part, "inline_data", None), "data", None):
                    return (monotonic() - started) * 1000
    raise RuntimeError("Live turn ended without audio")


async def main() -> None:
    settings = get_settings()
    api_key = settings.resolved_gemini_api_key()
    if not api_key:
        raise RuntimeError("Gemini API key is not configured")
    client = genai.Client(api_key=api_key, http_options={"api_version": "v1beta"})
    runtime = ApplicationSettings()
    base = _live_config(runtime=runtime, model_name=settings.gemini_live_fallback_model)
    variants = {
        "full": base,
        "without_transcription": {
            key: value for key, value in base.items()
            if key not in {"input_audio_transcription", "output_audio_transcription"}
        },
        "without_tools": {
            key: value for key, value in base.items()
            if key != "tools"
        },
        "minimal_no_tools": {
            **{
                key: value for key, value in base.items()
                if key not in {"tools", "input_audio_transcription", "output_audio_transcription", "system_instruction"}
            },
            "system_instruction": "Reply immediately and briefly.",
        },
    }
    for name, config in variants.items():
        samples = [await first_audio_ms(client, config, settings.gemini_live_fallback_model) for _ in range(2)]
        print(f"{name}: samples_ms={[round(value) for value in samples]} median_ms={round(median(samples))}")


if __name__ == "__main__":
    asyncio.run(main())
