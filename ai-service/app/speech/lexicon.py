"""Pronunciation dictionaries: the reviewed files in data/ plus an optional override file on the AI host.

The override (TTS_LEXICON_PATH, default /etc/medoro-ai/lexicon.json) is re-read when it changes, so HR's pronunciation
fixes apply without a code change or a restart:

    {"terms": {"tally": "टैली"}, "names": {"sumit": "सुमित"}, "words": {"theek": "ठीक"}}

Every value must be Devanagari (spaces, hyphens and the danda allowed); a bad entry is skipped, never spoken.
"""
from __future__ import annotations

import json
import logging
import os
import re
import threading
from pathlib import Path

log = logging.getLogger("medoro.tts")
DATA = Path(__file__).with_name("data")
DEVANAGARI_ONLY = re.compile(r"^[ऀ-ॿ\s\-।]+$")


def _strict(pairs):
    d = {}
    for k, v in pairs:
        if k in d:
            raise ValueError(f"duplicate key {k!r}")
        d[k] = v
    return d


def load_json(name: str) -> dict:
    with open(DATA / name, encoding="utf-8") as f:
        return json.load(f, object_pairs_hook=_strict)


def hr_terms() -> dict[str, str]:
    out: dict[str, str] = {}
    for cat in load_json("hr_terms.json")["categories"].values():
        out.update(cat)
    return out


class Lexicon:
    """Merged dictionaries. Lookups are by lowercase key; multi-word keys use single spaces ("leave balance")."""

    def __init__(self, override_path: str | None = None):
        self.override_path = override_path if override_path is not None else os.environ.get("TTS_LEXICON_PATH", "/etc/medoro-ai/lexicon.json")
        self._lock = threading.Lock()
        self._mtime: float | None = None
        self.base_terms = hr_terms()
        self.base_words = load_json("hinglish.json")["words"]
        self.base_names = load_json("names.json")["names"]
        self.terms, self.words, self.names = dict(self.base_terms), dict(self.base_words), dict(self.base_names)
        self.override_count = 0
        self._phrase_len()
        self.refresh()

    def _phrase_len(self) -> None:
        self.max_words = max(len(k.split()) for k in [*self.terms, *self.words, *self.names])

    def refresh(self) -> None:
        """Re-reads the override file if it changed (cheap: one stat per request)."""
        p = self.override_path
        try:
            mtime = os.stat(p).st_mtime if p else None
        except OSError:
            mtime = None
        if mtime == self._mtime:
            return
        with self._lock:
            terms, words, names, n = dict(self.base_terms), dict(self.base_words), dict(self.base_names), 0
            if mtime is not None:
                try:
                    with open(p, encoding="utf-8") as f:
                        data = json.load(f)
                    for section, target in (("terms", terms), ("words", words), ("names", names)):
                        for k, v in (data.get(section) or {}).items():
                            if isinstance(k, str) and isinstance(v, str) and k.strip() and DEVANAGARI_ONLY.match(v):
                                target[" ".join(k.lower().replace("-", " - ").split()).replace(" - ", "-")] = v.strip()
                                n += 1
                            else:
                                log.warning("lexicon override: skipped an entry in %s (value must be Devanagari)", section)
                except (OSError, ValueError, AttributeError) as e:
                    log.warning("lexicon override unreadable: %s", type(e).__name__)
            self.terms, self.words, self.names, self.override_count, self._mtime = terms, words, names, n, mtime
            self._phrase_len()

    def lookup_phrase(self, key: str) -> str | None:
        """Multi-word lookup in priority order: HR terms, then Hinglish phrases, then names."""
        return self.terms.get(key) or self.words.get(key) or self.names.get(key)
