"""Hinglish speech intelligence for Naina's voice: turns display text (Roman Hinglish, Devanagari Hindi or English)
into speech text that Kokoro's Hindi pipeline pronounces well. Pure Python, no model needed (tested anywhere)."""
from .normalize import Normalizer, detect_lang, split_chunks  # noqa: F401
