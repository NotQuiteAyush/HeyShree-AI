from __future__ import annotations

import json
import logging
import os
from functools import lru_cache
from pathlib import Path
from typing import Any, Callable, Iterable

logger = logging.getLogger("shree.local_wake")


def _default_model_path() -> Path:
    configured = os.environ.get("SHREE_WAKE_MODEL_PATH", "").strip()
    if configured:
        return Path(configured)
    return Path(__file__).resolve().parents[1] / "models" / "vosk-model-small-en-us-0.15"


@lru_cache(maxsize=2)
def _load_model(model_path: str) -> Any:
    from vosk import Model, SetLogLevel

    SetLogLevel(-1)
    return Model(model_path)


def _wake_grammar(phrases: Iterable[str]) -> list[str]:
    """Create a compact Vosk grammar while preserving phonetic Shree spellings."""
    variants = (
        # Spellings present in the small English model's vocabulary. The wake
        # gate maps these phonetic outputs to the canonical name "Shree".
        "shree", "shri", "sri", "sree", "three", "shiri", "sherry", "siri", "tree",
    )
    grammar: list[str] = []
    for raw_phrase in phrases:
        phrase = " ".join(str(raw_phrase).casefold().split())
        if not phrase:
            continue
        grammar.append(phrase)
        words = phrase.split()
        if words[-1] == "shree":
            grammar.extend(" ".join((*words[:-1], variant)) for variant in variants)
    grammar.extend(variants)
    # [unk] is important: without it a constrained recognizer can force random
    # background speech into the closest wake phrase.
    grammar.append("[unk]")
    return list(dict.fromkeys(grammar))


class LocalWakeRecognizer:
    """Low-latency offline wake transcription over the browser's PCM16 stream."""

    def __init__(
        self,
        phrases: Iterable[str],
        *,
        sample_rate: int = 16_000,
        model_path: Path | None = None,
        model_loader: Callable[[str], Any] = _load_model,
        recognizer_factory: Callable[[Any, int, str], Any] | None = None,
    ) -> None:
        self.sample_rate = sample_rate
        self.model_path = model_path or _default_model_path()
        self._model_loader = model_loader
        self._recognizer_factory = recognizer_factory
        self._model: Any | None = None
        self._recognizer: Any | None = None
        self._last_text = ""
        self.available = False
        if not self.model_path.is_dir():
            logger.warning("Offline wake model is unavailable at %s; using Gemini transcription fallback", self.model_path)
            return
        try:
            self._model = self._model_loader(str(self.model_path))
            if self._recognizer_factory is None:
                from vosk import KaldiRecognizer

                self._recognizer_factory = KaldiRecognizer
            self.configure_phrases(phrases)
            self.available = True
            logger.info("Offline Vosk wake listener ready (%s)", self.model_path)
        except Exception:
            logger.exception("Could not initialize offline wake listener; using Gemini transcription fallback")

    def configure_phrases(self, phrases: Iterable[str]) -> None:
        if self._model is None or self._recognizer_factory is None:
            return
        grammar = json.dumps(_wake_grammar(phrases))
        self._recognizer = self._recognizer_factory(self._model, self.sample_rate, grammar)
        self._last_text = ""

    def accept_audio(self, pcm16: bytes) -> str | None:
        if not pcm16 or self._recognizer is None:
            return None
        complete = bool(self._recognizer.AcceptWaveform(pcm16))
        payload = self._recognizer.Result() if complete else self._recognizer.PartialResult()
        try:
            result = json.loads(payload or "{}")
        except (TypeError, json.JSONDecodeError):
            return None
        text = str(result.get("text") if complete else result.get("partial") or "").strip()
        if not text or text == "[unk]" or text == self._last_text:
            return None
        self._last_text = text
        return text

    def reset(self) -> None:
        if self._recognizer is not None:
            self._recognizer.Reset()
        self._last_text = ""
