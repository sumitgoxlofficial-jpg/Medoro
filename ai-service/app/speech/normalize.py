"""Display text -> speech text for Kokoro.

Naina's replies reach the AI host in one of three forms: Devanagari Hindi (the app's `speech` text, which may still
contain Latin names and acronyms: "नमस्ते Rahul जी, HRMS में..."), Roman Hinglish ("Namaste Rahul ji, aapka attendance
record incomplete hai.") or English. Kokoro's Hindi pipeline reads Latin letters as English phonemes (measured: "hai"
-> /hI/, "ji" -> /ʤI/), so for Hindi and Hinglish every Latin token is turned into Devanagari, in this order:

  1. emails, web addresses, money, dates, times, phone numbers, employee IDs, percentages and numbers are expanded
     into spoken Hindi (₹25,000 -> पच्चीस हज़ार रुपये, 10:30 -> साढ़े दस बजे, EMP1023 -> ई एम पी एक शून्य दो तीन);
  2. multi-word dictionary phrases (longest first: "notice period", "work from home");
  3. single words: Hinglish words (hai -> है) before English HR terms (payslip -> पेस्लिप) before names (Rahul -> राहुल);
  4. acronyms are spelled (HRMS -> एच आर एम एस);
  5. anything left is transliterated by rule (translit.py).

English text is left for Kokoro's English pipeline, with only money and source tags tidied.
Nothing here logs or stores the text.
"""
from __future__ import annotations

import re
import unicodedata

from . import numbers as N
from .lexicon import Lexicon
from .translit import to_devanagari

DEV = re.compile(r"[ऀ-ॿ]")
LATIN_WORD = re.compile(r"[A-Za-z]+(?:['’][A-Za-z]+)?")
LETTERS = {c: v for c, v in zip("ABCDEFGHIJKLMNOPQRSTUVWXYZ", "ए बी सी डी ई एफ जी एच आई जे के एल एम एन ओ पी क्यू आर एस टी यू वी डब्ल्यू एक्स वाई ज़ेड".split())}
SOURCE_TAG = re.compile(r"\((?:Source|स्रोत)\s*:[^)]*\)", re.I)
# Words that read as Hindi even in a mostly-English sentence don't decide the language on their own.
_WEAK = {"main", "the", "to", "me", "hi", "use", "is", "us", "do", "par", "pa", "jo", "bus", "an", "man", "so", "ho", "hum", "na", "mat", "sun", "bas", "ok", "sir", "madam"}


def spell(token: str) -> str:
    """Letters and digits one by one: 'EMP-1023' -> ई एम पी एक शून्य दो तीन."""
    out = []
    for ch in token.upper():
        if ch in LETTERS:
            out.append(LETTERS[ch])
        elif ch.isdigit():
            out.append(N.DIGITS[int(ch)])
    return " ".join(out)


def detect_lang(text: str, lex: Lexicon) -> str:
    """'hi' (Devanagari), 'hinglish' (Roman Hindi) or 'en'."""
    if DEV.search(text):
        return "hi"
    # Names, emails and web addresses are the same in any language: they don't count either way.
    plain = re.sub(r"\S+@\S+|\b(?:https?://|www\.)\S+|\b[\w\-]+\.(?:in|com|org|net|co|io|app)\b\S*", " ", text)
    ws = [w.lower() for w in LATIN_WORD.findall(plain) if w.lower() not in lex.names]
    if not ws:
        return "hi"
    strong = sum(1 for w in ws if w in lex.words and w not in _WEAK)
    return "hinglish" if strong / len(ws) >= 0.2 or strong >= 3 else "en"


class Normalizer:
    def __init__(self, lexicon: Lexicon | None = None):
        self.lex = lexicon or Lexicon()

    # ── public
    def to_speech(self, text: str, lang: str = "auto") -> tuple[str, str]:
        """Returns (speech_text, lang) where lang is 'hi', 'hinglish' or 'en'."""
        self.lex.refresh()
        t = unicodedata.normalize("NFC", text)
        t = SOURCE_TAG.sub("", t)
        t = t.replace("…", "।").replace("’", "'").replace("“", '"').replace("”", '"')
        t = re.sub(r"[​-‍﻿]", "", t)
        if lang not in ("hi", "hinglish", "en"):
            lang = detect_lang(t, self.lex)
        if lang == "en":
            return self._english(t), "en"
        return self._hindi(t), lang

    # ── English: Kokoro's English G2P copes with most of it; money in rupees and spacing only.
    def _english(self, t: str) -> str:
        t = re.sub(r"(?:₹|\bRs\.?|\bINR)\s?(\d[\d,]*(?:\.\d+)?)", lambda m: f"{m.group(1).replace(',', '')} rupees", t)
        t = re.sub(r"\bHRMS\b", "H R M S", t)
        return re.sub(r"\s+", " ", t).strip()

    # ── Hindi and Hinglish
    def _hindi(self, t: str) -> str:
        t = self._emails_urls(t)
        t = self._money(t)
        t = self._dates(t)
        t = self._times(t)
        t = self._phones_ids(t)
        t = self._numbers(t)
        t = self._words(t)
        t = self._punctuation(t)
        return t

    def _emails_urls(self, t: str) -> str:
        def say_part(p: str) -> str:
            bits = re.split(r"([._\-])", p)
            sym = {".": "डॉट", "_": "अंडरस्कोर", "-": "डैश"}
            return " ".join(sym[b] if b in sym else self._word(b) if b.isalpha() else spell(b) for b in bits if b)

        t = re.sub(r"\b([\w.\-]+)@([\w\-]+(?:\.[\w\-]+)+)\b", lambda m: f"{say_part(m.group(1))} एट द रेट {say_part(m.group(2))}", t)
        t = re.sub(r"\bhttps?://", "", t)
        t = re.sub(r"\b(?:www\.)?([a-z0-9\-]+(?:\.[a-z0-9\-]+)*\.(?:in|com|org|net|co|io|app))(/[\w/\-]*)?\b",
                   lambda m: say_part(m.group(1)) + "".join(" स्लैश " + say_part(seg) for seg in (m.group(2) or "").split("/") if seg), t, flags=re.I)
        return t

    def _money(self, t: str) -> str:
        t = re.sub(r"(?:₹|\bRs\.?|\bINR)\s?(\d[\d,]*(?:\.\d{1,2})?)(\s*(?:/-|rupees|rupaye|rupay|रुपये|रुपए))?", lambda m: f" {N.rupees(m.group(1))} ", t, flags=re.I)
        t = re.sub(r"\b(\d[\d,]*(?:\.\d{1,2})?)\s*(?:rupees|rupaye|rupay|rupee|रुपये|रुपए|/-)", lambda m: f"{N.rupees(m.group(1))} ", t, flags=re.I)
        return t

    def _dates(self, t: str) -> str:
        def ok(d: int, m: int) -> bool:
            return 1 <= d <= 31 and 1 <= m <= 12
        t = re.sub(r"\b(\d{4})-(\d{2})-(\d{2})\b", lambda m: N.date(int(m.group(3)), int(m.group(2)), int(m.group(1))) if ok(int(m.group(3)), int(m.group(2))) else m.group(0), t)
        t = re.sub(r"\b(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{4}|\d{2})\b", lambda m: N.date(int(m.group(1)), int(m.group(2)), int(m.group(3)) + (2000 if len(m.group(3)) == 2 else 0)) if ok(int(m.group(1)), int(m.group(2))) else m.group(0), t)
        mon = r"(jan|feb|mar|apr|may|jun|jul|aug|sept|sep|oct|nov|dec)[a-z]*\.?"
        t = re.sub(rf"\b(\d{{1,2}})(?:st|nd|rd|th)?\s+{mon}(?:,?\s+(\d{{4}}))?", lambda m: N.date(int(m.group(1)), N.MONTH_ABBR[m.group(2).lower()] + 1, int(m.group(3)) if m.group(3) else None) if 1 <= int(m.group(1)) <= 31 else m.group(0), t, flags=re.I)
        t = re.sub(rf"\b{mon}\s+(\d{{1,2}})(?:st|nd|rd|th)?(?:,?\s+(\d{{4}}))?", lambda m: N.date(int(m.group(2)), N.MONTH_ABBR[m.group(1).lower()] + 1, int(m.group(3)) if m.group(3) else None) if 1 <= int(m.group(2)) <= 31 else m.group(0), t, flags=re.I)
        return t

    def _times(self, t: str) -> str:
        baje = r"(\s*(?:baje|बजे|o'clock))?"

        def hm(m: re.Match) -> str:
            h, mi, ap = int(m.group(1)), int(m.group(2) or 0), (m.group(3) or "").lower().replace(".", "")
            if h > 23 or mi > 59:
                return m.group(0)
            prefix = ""
            if ap == "pm" and h < 12:
                h += 12
            if ap:
                prefix = N.day_part(h if not (ap == "am" and h == 12) else 0) + " "
            return f" {prefix}{N.clock(h, mi)} "
        ampm = r"(a\.?m|p\.?m)(?![a-z])"  # a trailing full stop is left for the sentence
        t = re.sub(rf"\b(\d{{1,2}}):(\d{{2}})\s*(?:{ampm})?{baje}", hm, t, flags=re.I)
        t = re.sub(rf"\b(\d{{1,2}})()\s*{ampm}{baje}", hm, t, flags=re.I)
        t = re.sub(r"\b(\d{1,2})\s*(baje|बजे)", lambda m: f"{N.words(int(m.group(1)))} बजे" if int(m.group(1)) <= 24 else m.group(0), t, flags=re.I)
        return t

    def _phones_ids(self, t: str) -> str:
        t = re.sub(r"(?:\+91[\s\-]?)?\b([6-9]\d{4})[\s\-]?(\d{5})\b", lambda m: f"{N.digits(m.group(1))}, {N.digits(m.group(2))}", t)
        t = re.sub(r"\b(?:otp|pin)\s*(?:is|hai|:)?\s*(\d{4,8})\b", lambda m: f"ओ टी पी {N.digits(m.group(1))}", t, flags=re.I)
        # Employee and document IDs: letters followed by digits (EMP1023, MED-0045, HR/2026/14).
        t = re.sub(r"\b([A-Za-z]{1,6})[\-/]?(\d{2,})(?:[\-/](\d+))*\b", lambda m: spell(m.group(0)), t)
        return t

    def _numbers(self, t: str) -> str:
        t = re.sub(r"(\d+(?:\.\d+)?)\s?%", lambda m: f"{N.decimal(m.group(1))} परसेंट", t)
        t = re.sub(r"\b(\d{1,3}(?:,\d{2,3})+|\d+)(?:\.(\d+))?(st|nd|rd|th)?\b",
                   lambda m: N.decimal(m.group(1).replace(",", "") + "." + m.group(2)) if m.group(2) else (N.words(int(m.group(1).replace(",", ""))) if len(m.group(1).replace(",", "")) <= 9 else N.digits(m.group(1))), t)
        return t

    def _word(self, w: str) -> str:
        lw = w.lower().replace("’", "'")
        lx = self.lex
        if lw in lx.words:
            return lx.words[lw]
        if w.isupper() and 1 < len(w) <= 6:  # acronyms: HR, HRMS, PF (dictionary first, else spelled)
            return lx.terms.get(lw) or spell(w)
        if lw in lx.terms:
            return lx.terms[lw]
        if lw in lx.names:
            return lx.names[lw]
        if lw.endswith("'s") and lw[:-2] in lx.terms:
            return lx.terms[lw[:-2]] + "ज़"
        if len(w) == 1:
            return LETTERS.get(w.upper(), w)
        return to_devanagari(lw)

    def _words(self, t: str) -> str:
        # Tokens: Latin words (with internal hyphens, e.g. check-in, half-day) and everything else, kept as is.
        parts = re.split(r"([A-Za-z]+(?:['’-][A-Za-z]+)*)", t)
        out: list[str] = []
        i = 0
        lx = self.lex
        while i < len(parts):
            p = parts[i]
            if i % 2 == 0:
                out.append(p)
                i += 1
                continue
            # Greeting "Hi Rahul" is हाय, but "aaj hi" is ही.
            if p.lower() == "hi" and not "".join(out).strip(" ,") and (i + 2 >= len(parts) or parts[i + 1].strip(" ,!") == ""):
                out.append("हाय")
                i += 1
                continue
            # Longest multi-word match across the following Latin tokens separated only by spaces/hyphens.
            done = False
            for n in range(min(lx.max_words, (len(parts) - i + 1) // 2), 1, -1):
                seps = [parts[i + 2 * k + 1] for k in range(n - 1)]
                if any(s not in (" ", "-") for s in seps):
                    continue
                key = " ".join(parts[i + 2 * k].lower() for k in range(n))
                val = lx.lookup_phrase(key) or lx.lookup_phrase("-".join(parts[i + 2 * k].lower() for k in range(n)))
                if val:
                    out.append(val)
                    i += 2 * n - 1
                    done = True
                    break
            if done:
                continue
            if "-" in p:
                whole = lx.lookup_phrase(p.lower()) or lx.lookup_phrase(p.lower().replace("-", " "))
                out.append(whole or " ".join(self._word(x) for x in p.split("-")))
            else:
                out.append(self._word(p))
            i += 1
        return "".join(out)

    def _punctuation(self, t: str) -> str:
        t = t.replace("&", " और ").replace("+", " प्लस ").replace("@", " एट ").replace("#", " नंबर ")
        t = re.sub(r"\s*/\s*", " या ", t)
        t = re.sub(r"[\"“”*_~`^<>\[\]{}|\\]", " ", t)
        t = re.sub(r"\s*\(\s*", ", ", t)
        t = re.sub(r"\s*\)\s*", ", ", t)
        t = re.sub(r"(?<=[ऀ-ॿ\s])\.(?=\s|$)", "।", t)
        t = re.sub(r"\s*([,।?!;:])", r"\1", t)
        t = re.sub(r"([,।?!;:])(?=\S)", r"\1 ", t)
        t = re.sub(r",\s*([।?!])", r"\1", t)
        t = re.sub(r"([।?!])\s*[,।]+", r"\1", t)
        t = re.sub(r"\s+", " ", t).strip(" ,;:-")
        return t


SENTENCE_END = re.compile(r"(?<=[।?!.])\s+")


def split_chunks(text: str, max_chars: int = 220) -> list[tuple[str, str]]:
    """Sentence-level chunks for long replies, each with the pause that should follow it:
    'q' after a question, 's' after a sentence, 'c' after a comma split (a long sentence cut at a comma or space)."""
    out: list[tuple[str, str]] = []
    for sent in SENTENCE_END.split(text.strip()):
        sent = sent.strip()
        if not sent:
            continue
        end = "q" if sent.endswith("?") else "s"
        if len(sent) <= max_chars:
            out.append((sent, end))
            continue
        pieces, cur = [], ""
        for clause in re.split(r"(?<=[,;:])\s+", sent):
            if len(cur) + len(clause) + 1 <= max_chars:
                cur = f"{cur} {clause}".strip()
                continue
            if cur:
                pieces.append(cur)
            while len(clause) > max_chars:  # no comma: cut at the last space before the limit
                cut = clause.rfind(" ", 0, max_chars)
                cut = cut if cut > 0 else max_chars
                pieces.append(clause[:cut].strip())
                clause = clause[cut:].strip()
            cur = clause
        if cur:
            pieces.append(cur)
        out.extend((p, "c") for p in pieces[:-1])
        out.append((pieces[-1], end))
    return out
