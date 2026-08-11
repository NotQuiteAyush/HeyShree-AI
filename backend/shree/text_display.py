from __future__ import annotations

import re
import unicodedata


_DEVANAGARI_VOWELS = {
    "अ": "a", "आ": "aa", "इ": "i", "ई": "i", "उ": "u", "ऊ": "u",
    "ऋ": "ri", "ए": "e", "ऐ": "ai", "ओ": "o", "औ": "au",
}
_DEVANAGARI_SIGNS = {
    "ा": "aa", "ि": "i", "ी": "i", "ु": "u", "ू": "u", "ृ": "ri",
    "े": "e", "ै": "ai", "ो": "o", "ौ": "au", "ॅ": "e", "ॉ": "o",
}
_DEVANAGARI_CONSONANTS = {
    "क": "k", "ख": "kh", "ग": "g", "घ": "gh", "ङ": "n",
    "च": "ch", "छ": "chh", "ज": "j", "झ": "jh", "ञ": "ny",
    "ट": "t", "ठ": "th", "ड": "d", "ढ": "dh", "ण": "n",
    "त": "t", "थ": "th", "द": "d", "ध": "dh", "न": "n",
    "प": "p", "फ": "ph", "ब": "b", "भ": "bh", "म": "m",
    "य": "y", "र": "r", "ल": "l", "व": "v", "श": "sh",
    "ष": "sh", "स": "s", "ह": "h", "ळ": "l", "क़": "q",
    "ख़": "kh", "ग़": "gh", "ज़": "z", "ड़": "d", "ढ़": "dh", "फ़": "f", "य़": "y",
}
_DEVANAGARI_DIGITS = str.maketrans("०१२३४५६७८९", "0123456789")
_ARABIC_TO_LATIN = str.maketrans({
    "ا":"a", "آ":"aa", "أ":"a", "إ":"i", "ب":"b", "پ":"p", "ت":"t", "ٹ":"t", "ث":"s",
    "ج":"j", "چ":"ch", "ح":"h", "خ":"kh", "د":"d", "ڈ":"d", "ذ":"z", "ر":"r", "ڑ":"r",
    "ز":"z", "ژ":"zh", "س":"s", "ش":"sh", "ص":"s", "ض":"z", "ط":"t", "ظ":"z", "ع":"",
    "غ":"gh", "ف":"f", "ق":"q", "ک":"k", "ك":"k", "گ":"g", "ل":"l", "م":"m", "ن":"n",
    "ں":"n", "و":"o", "ؤ":"o", "ہ":"h", "ه":"h", "ھ":"h", "ء":"'", "ی":"y", "ي":"y",
    "ئ":"y", "ے":"e", "ۓ":"e", "ة":"h", "ى":"a", "۰":"0", "۱":"1", "۲":"2", "۳":"3",
    "۴":"4", "۵":"5", "۶":"6", "۷":"7", "۸":"8", "۹":"9", "،":",", "؟":"?",
    "\u200c":"", "\u200d":"", "\u200e":"", "\u200f":"", "\u202a":"", "\u202b":"",
    "\u202c":"", "\u202d":"", "\u202e":"",
    **{chr(code): "" for code in range(0x064B, 0x0660)},
})
_ARABIC_WORDS = {
    "کیا": "kya", "کر": "kar", "رہی": "rahi", "رہا": "raha", "ہو": "ho",
    "مجھے": "mujhe", "میں": "main", "ہاں": "haan", "بولو": "bolo",
    "کھولو": "kholo", "کھول": "khol", "کرو": "karo", "شری": "shree",
    "شریے": "shree", "سری": "shree", "نمستے": "namaste",
}
_ARABIC_WORD_PATTERN = re.compile(r"[\u0600-\u06ff\u0750-\u077f\u08a0-\u08ff]+")
_COMMON_SCRIPT_WORDS = {
    "మూడు": "three", "శ్రీ": "shree",
    "শ্রী": "shree", "ਸ੍ਰੀ": "shree", "શ્રી": "shree",
    "ஸ்ரீ": "shree", "ಶ್ರೀ": "shree", "ശ്രീ": "shree",
}
_ASCII_PUNCTUATION = {"‘": "'", "’": "'", "“": '"', "”": '"', "–": "-", "—": "-", "…": "..."}
_PROTECTED_TEXT = re.compile(r"(```[\s\S]*?```|`[^`\n]*`|(?:https?|file)://[^\s]+)", re.IGNORECASE)


def _romanize_devanagari_word(word: str) -> str:
    result: list[str] = []
    index = 0
    while index < len(word):
        character = word[index]
        consonant = _DEVANAGARI_CONSONANTS.get(character)
        if consonant is not None:
            result.append(consonant)
            following = word[index + 1] if index + 1 < len(word) else ""
            if following == "्":
                index += 2
                continue
            sign = _DEVANAGARI_SIGNS.get(following)
            if sign is not None:
                result.append(sign)
                index += 2
                continue
            result.append("a")
        elif character in _DEVANAGARI_VOWELS:
            result.append(_DEVANAGARI_VOWELS[character])
        elif character in {"ं", "ँ"}:
            result.append("n")
        elif character == "ः":
            result.append("h")
        elif character in {"़", "्"}:
            pass
        elif character == "।":
            result.append(".")
        elif character == "॥":
            result.append(".")
        else:
            result.append(character.translate(_DEVANAGARI_DIGITS))
        index += 1
    romanized = "".join(result)
    if romanized.endswith("a") and len(romanized) > 1:
        romanized = romanized[:-1]
    # Common Hindi conjunct spelling: "kyaa" is normally written "kya" in Hinglish.
    return romanized.replace("kyaa", "kya").replace("Kyaa", "Kya").replace("iyaa", "iya")


def _romanize_unprotected(value: str) -> str:
    for source, replacement in _COMMON_SCRIPT_WORDS.items():
        value = value.replace(source, replacement)
    value = _ARABIC_WORD_PATTERN.sub(
        lambda match: _ARABIC_WORDS.get(
            match.group(0),
            _ARABIC_WORD_PATTERN.sub("", match.group(0).translate(_ARABIC_TO_LATIN)),
        ),
        value,
    )
    parts = re.split(r"([\u0900-\u097f]+)", value)
    value = "".join(
        _romanize_devanagari_word(part) if part and any("\u0900" <= char <= "\u097f" for char in part) else part
        for part in parts
    )
    ascii_output: list[str] = []
    for character in unicodedata.normalize("NFKD", value):
        if unicodedata.combining(character):
            continue
        if ord(character) < 128:
            ascii_output.append(character)
            continue
        replacement = _ASCII_PUNCTUATION.get(character)
        if replacement is not None:
            ascii_output.append(replacement)
            continue
        try:
            ascii_output.append(str(unicodedata.digit(character)))
        except (TypeError, ValueError):
            if ascii_output and not ascii_output[-1].endswith(" "):
                ascii_output.append(" ")
    return "".join(ascii_output)


def to_latin_display(value: object) -> str:
    """Romanize conversational Indic text while preserving URLs and code spans."""
    text = str(value or "")
    pieces = _PROTECTED_TEXT.split(text)
    converted = [piece if _PROTECTED_TEXT.fullmatch(piece or "") else _romanize_unprotected(piece) for piece in pieces]
    return " ".join("".join(converted).split())


def contains_devanagari(value: str) -> bool:
    return any("\u0900" <= character <= "\u097f" for character in value)
