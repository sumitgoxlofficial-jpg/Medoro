"""Last-resort Roman -> Devanagari transliteration for words no dictionary knows (mostly names: Rahul, Priya, Sunita).

Kokoro's Hindi pipeline reads Latin letters with English phonemes ("ji" -> /ʤI/, "hai" -> /hI/), so every Latin word is
turned into Devanagari before synthesis. Dictionaries come first (lexicon.py); this only handles what is left, with
common Hinglish spelling conventions: aa/ee/oo long vowels, kh/gh/ch/chh/jh/th/dh/ph/bh/sh aspirates, a word-final "a"
as आ (Priya -> प्रिया), "n" before a consonant as anusvara (Anand -> अनंद), and retroflex ट/ड for English-looking words.
"""
from __future__ import annotations

import re

_CONS = [
    ("chh", "छ"), ("ksh", "क्ष"), ("kh", "ख"), ("gh", "घ"), ("ch", "च"), ("jh", "झ"), ("th", "थ"), ("dh", "ध"),
    ("ph", "फ"), ("bh", "भ"), ("sh", "श"), ("ck", "क"), ("k", "क"), ("g", "ग"), ("c", "क"), ("j", "ज"), ("t", "त"),
    ("d", "द"), ("n", "न"), ("p", "प"), ("b", "ब"), ("m", "म"), ("y", "य"), ("r", "र"), ("l", "ल"), ("v", "व"),
    ("w", "व"), ("s", "स"), ("h", "ह"), ("f", "फ़"), ("z", "ज़"), ("q", "क"), ("x", "क्स"),
]
# (roman, independent vowel, matra)
_VOW = [
    ("aa", "आ", "ा"), ("ai", "ऐ", "ै"), ("au", "औ", "ौ"), ("ee", "ई", "ी"), ("ii", "ई", "ी"), ("oo", "ऊ", "ू"),
    ("uu", "ऊ", "ू"), ("ei", "ए", "े"), ("ou", "औ", "ौ"), ("a", "अ", ""), ("i", "इ", "ि"), ("u", "उ", "ु"),
    ("e", "ए", "े"), ("o", "ओ", "ो"),
]
HALANT = "्"
_ENGLISHY = re.compile(r"(tion|sion|ck|ph|q|x|w|ee|oo|ou|ea|igh|[^aeiou]e$|^c|c[eiy])")


def _englishy(w: str) -> bool:
    return bool(_ENGLISHY.search(w))


def to_devanagari(word: str) -> str:
    """'Rahul' -> 'रहुल', 'Priya' -> 'प्रिया', 'Neha' -> 'नेहा', 'Sunita' -> 'सुनीता'... unknown words only."""
    w = re.sub(r"[^a-z]", "", word.lower())
    if not w:
        return word
    eng = _englishy(w)
    if eng and w.endswith("e") and len(w) > 3 and w[-2] not in "aeiou":
        w = w[:-1]  # silent final e (code -> cod, mobile -> mobil)
    if w.startswith("x"):
        w = "z" + w[1:]  # Xavier, Xerox: an initial x is said as z
    out: list[str] = []
    i, n = 0, len(w)
    prev_cons = False
    while i < n:
        for r, ind, mat in _VOW:
            if w.startswith(r, i):
                last = i + len(r) == n
                if prev_cons:
                    # word-final short vowels are long in Hinglish names and words: Priya, Neha, Sunita, Shanti
                    if r == "a" and last and n > 2:
                        mat = "ा"
                    elif r == "i" and last:
                        mat = "ी"
                    elif r == "u" and last:
                        mat = "ू"
                    out.append(mat)
                else:
                    out.append(ind)
                i += len(r)
                prev_cons = False
                break
        else:
            for r, dev in _CONS:
                if w.startswith(r, i):
                    if eng and r in ("t", "d"):
                        dev = {"t": "ट", "d": "ड"}[r]
                    nxt = i + len(r)
                    followed_by_cons = nxt < n and w[nxt] not in "aeiou"
                    if r == "n" and prev_cons is False and out and followed_by_cons and w[nxt] not in "y":
                        out.append("ं")  # anusvara: Anand, Sunanda, bank
                        i = nxt
                        prev_cons = False
                        break
                    if prev_cons:
                        out.append(HALANT)
                    out.append(dev)
                    i = nxt
                    prev_cons = True
                    break
            else:
                i += 1  # unreachable for a-z, kept for safety
    return "".join(out)
