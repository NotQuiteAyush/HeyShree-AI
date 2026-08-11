from __future__ import annotations

import logging
import re
from dataclasses import dataclass
from enum import Enum
from time import monotonic


logger = logging.getLogger("shree.wake_word")
_DEFAULT_WAKE_PHRASES = ("Hello Shree", "Hi Shree", "Hey Shree", "Namaste Shree", "Shree")
_WAKE_NAME_VARIANTS = {
    "shree", "shri", "sri", "sree", "three",
    "shre", "shry", "shrey", "shray", "shrie", "shiri",
    "sharee", "sherry", "siri", "tree", "3",
}
_NUMBER_CONTEXT_FOLLOWERS = {
    "file", "files", "folder", "folders", "percent", "percentage", "seconds", "minutes",
    "hours", "days", "items", "tabs", "windows", "times", "people", "messages",
}


class VoiceConversationState(str, Enum):
    SLEEPING = "sleeping"
    WAKE_DETECTED = "wake_detected"
    LISTENING = "listening"
    THINKING = "thinking"
    SPEAKING = "speaking"
    WAITING_FOR_USER = "waiting_for_user"
    RETURNING_TO_SLEEP = "returning_to_sleep"


@dataclass(frozen=True)
class WakeDecision:
    accepted: bool = False
    duplicate: bool = False
    active: bool = False
    command: str = ""
    phrase: str = ""


def _words(value: str) -> list[str]:
    return re.findall(r"[a-z0-9']+", value.casefold())


class WakeWordGate:
    """Single-owner wake state and utterance-level duplicate suppression."""

    DUPLICATE_COOLDOWN_SECONDS = 2.5
    FRAGMENT_WINDOW_SECONDS = 3.0
    MAX_CANDIDATE_WORDS = 24

    def __init__(self, enabled: bool, background_listening: bool, phrases: list[str] | None = None) -> None:
        self.enabled = enabled
        self.background_listening = background_listening
        self.phrases = self._normalize_phrases(phrases)
        self.state = (
            VoiceConversationState.SLEEPING
            if enabled and background_listening
            else VoiceConversationState.LISTENING
        )
        self._last_wake_signature = ""
        self._last_wake_at = float("-inf")
        self._wake_generation = 0
        self._candidate_words: list[str] = []
        self._candidate_at = float("-inf")

    @property
    def active(self) -> bool:
        return self.state is not VoiceConversationState.SLEEPING

    @property
    def effective_phrases(self) -> list[str]:
        """Standard greetings plus user phrases, for local recognizer grammar."""
        return self._effective_phrases()

    @property
    def effective_phrases(self) -> list[str]:
        """Standard greetings plus user phrases, for local recognizer grammar."""
        return self._effective_phrases()

    def activate_manually(self) -> None:
        self._clear_candidate()
        self.state = VoiceConversationState.LISTENING
        logger.info("[Voice] Entering active conversation")

    def sleep(self) -> None:
        if not self.enabled:
            return
        self._clear_candidate()
        self.state = VoiceConversationState.SLEEPING
        logger.info("[Voice] Returning to wake-word mode")

    def set_state(self, state: VoiceConversationState) -> None:
        self.state = state

    def configure_phrases(self, phrases: list[str] | None) -> None:
        """Apply saved wake phrases to an already-running voice session."""
        self.phrases = self._normalize_phrases(phrases)
        self._clear_candidate()
        logger.info("[WakeWord] Applied %d custom wake phrase(s)", len(self.phrases))

    def inspect(self, transcript: str, now: float | None = None) -> WakeDecision:
        current_time = monotonic() if now is None else now
        transcript_words = _words(transcript)
        if self.active or not self.enabled:
            signature = " ".join(transcript_words)
            if (
                signature
                and signature == self._last_wake_signature
                and current_time - self._last_wake_at < self.DUPLICATE_COOLDOWN_SECONDS
            ):
                logger.info("[WakeWord] Duplicate ignored")
                return WakeDecision(duplicate=True, active=True)
            return WakeDecision(active=True)
        candidate_words = self._merge_candidate(transcript_words, current_time)
        match = self._match_prefix(candidate_words)
        if match is None:
            logger.debug("[WakeWord] Candidate pending or rejected (%d words)", len(candidate_words))
            if not self._could_be_configured_prefix(candidate_words):
                self._clear_candidate()
            return WakeDecision(active=False)
        phrase_words, phrase = match
        if (
            phrase_words == 1
            and len(candidate_words) > 1
            and candidate_words[0] in _WAKE_NAME_VARIANTS
            and candidate_words[1] == "3"
        ):
            # Some multilingual STT results contain both the spoken form and
            # its numeric rendering ("three 3") for a single wake utterance.
            phrase_words = 2
        signature = " ".join(candidate_words[:phrase_words])
        if (
            signature == self._last_wake_signature
            and current_time - self._last_wake_at < self.DUPLICATE_COOLDOWN_SECONDS
        ):
            logger.info("[WakeWord] Duplicate ignored")
            return WakeDecision(duplicate=True, active=False, phrase=phrase)
        self._last_wake_signature = signature
        self._last_wake_at = current_time
        self._wake_generation += 1
        self.state = VoiceConversationState.WAKE_DETECTED
        command = " ".join(candidate_words[phrase_words:])
        self._clear_candidate()
        self.state = VoiceConversationState.LISTENING
        logger.info("[WakeWord] Candidate detected: %s", signature)
        logger.info("[WakeWord] Wake accepted (generation %d)", self._wake_generation)
        return WakeDecision(accepted=True, active=True, command=command, phrase=phrase)

    def finish_turn(self) -> None:
        """Discard unmatched fragments when Gemini closes an utterance."""
        if not self.active:
            self._clear_candidate()

    def _clear_candidate(self) -> None:
        self._candidate_words = []
        self._candidate_at = float("-inf")

    def _merge_candidate(self, incoming: list[str], now: float) -> list[str]:
        if not incoming:
            return self._candidate_words
        if now - self._candidate_at > self.FRAGMENT_WINDOW_SECONDS:
            self._candidate_words = []

        current = self._candidate_words
        if not current:
            merged = incoming
        elif incoming[:len(current)] == current:
            # Gemini sometimes sends a growing/cumulative transcription.
            merged = incoming
        elif current[:len(incoming)] == incoming:
            # Ignore a shorter repeat of an already-seen partial.
            merged = current
        else:
            overlap = 0
            for size in range(min(len(current), len(incoming)), 0, -1):
                if current[-size:] == incoming[:size]:
                    overlap = size
                    break
            merged = current + incoming[overlap:]

        self._candidate_words = merged[-self.MAX_CANDIDATE_WORDS:]
        self._candidate_at = now
        return self._candidate_words

    def _could_be_configured_prefix(self, candidate: list[str]) -> bool:
        if not candidate:
            return False
        for phrase in self._effective_phrases():
            expected = _words(phrase)
            if not expected or len(candidate) >= len(expected):
                continue
            matches = True
            for index, word in enumerate(candidate):
                expected_word = expected[index]
                if expected_word == "shree":
                    if word not in _WAKE_NAME_VARIANTS:
                        matches = False
                        break
                elif word != expected_word:
                    matches = False
                    break
            if matches:
                return True
        return False

    def _match_prefix(self, transcript_words: list[str]) -> tuple[int, str] | None:
        if not transcript_words:
            return None
        configured: list[tuple[list[str], str]] = []
        for phrase in self._effective_phrases():
            phrase_words = _words(phrase)
            if phrase_words:
                configured.append((phrase_words, phrase))
        configured.append((["shree"], "Shree"))
        for phrase_words, phrase in sorted(configured, key=lambda item: len(item[0]), reverse=True):
            if len(transcript_words) < len(phrase_words):
                continue
            candidate = transcript_words[:len(phrase_words)]
            expected = phrase_words[:]
            if expected[-1] == "shree":
                if candidate[-1] not in _WAKE_NAME_VARIANTS:
                    continue
                if (
                    len(phrase_words) == 1
                    and candidate[-1] in {"three", "3"}
                    and len(transcript_words) > 1
                    and transcript_words[1] in _NUMBER_CONTEXT_FOLLOWERS
                ):
                    continue
                expected[-1] = candidate[-1]
            if candidate == expected:
                return len(phrase_words), phrase
        # A bare phonetic name is accepted only in wake mode and only at the
        # beginning of the utterance. Thus "set volume to three" remains 3.
        if (
            transcript_words[0] in _WAKE_NAME_VARIANTS
            and not (
                transcript_words[0] in {"three", "3"}
                and len(transcript_words) > 1
                and transcript_words[1] in _NUMBER_CONTEXT_FOLLOWERS
            )
        ):
            return 1, "Shree"
        return None

    @staticmethod
    def _normalize_phrases(phrases: list[str] | None) -> list[str]:
        generic_greetings = {"hey", "hello", "hi", "okay", "ok", "namaste"}
        normalized = list(dict.fromkeys(str(phrase).strip() for phrase in (phrases or []) if str(phrase).strip()))
        return [phrase for phrase in normalized if phrase.casefold() not in generic_greetings]

    def _effective_phrases(self) -> list[str]:
        # The standard Shree greetings always work; user phrases extend them.
        return list(dict.fromkeys((*_DEFAULT_WAKE_PHRASES, *self.phrases)))
