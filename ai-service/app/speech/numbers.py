"""Numbers, times, money and dates as they are said in Hindi (Indian numbering: hazaar, lakh, crore)."""
from __future__ import annotations

# 0..99 are irregular in Hindi, so they are listed, not composed.
_UNITS = (
    "शून्य एक दो तीन चार पाँच छह सात आठ नौ "
    "दस ग्यारह बारह तेरह चौदह पंद्रह सोलह सत्रह अठारह उन्नीस "
    "बीस इक्कीस बाईस तेईस चौबीस पच्चीस छब्बीस सत्ताईस अट्ठाईस उनतीस "
    "तीस इकतीस बत्तीस तैंतीस चौंतीस पैंतीस छत्तीस सैंतीस अड़तीस उनतालीस "
    "चालीस इकतालीस बयालीस तैंतालीस चवालीस पैंतालीस छियालीस सैंतालीस अड़तालीस उनचास "
    "पचास इक्यावन बावन तिरपन चौवन पचपन छप्पन सत्तावन अट्ठावन उनसठ "
    "साठ इकसठ बासठ तिरसठ चौंसठ पैंसठ छियासठ सड़सठ अड़सठ उनहत्तर "
    "सत्तर इकहत्तर बहत्तर तिहत्तर चौहत्तर पचहत्तर छिहत्तर सतहत्तर अठहत्तर उन्यासी "
    "अस्सी इक्यासी बयासी तिरासी चौरासी पचासी छियासी सत्तासी अट्ठासी नवासी "
    "नब्बे इक्यानबे बानबे तिरानबे चौरानबे पंचानबे छियानबे सत्तानबे अट्ठानबे निन्यानबे"
).split()
assert len(_UNITS) == 100, len(_UNITS)

DIGITS = _UNITS[:10]
MONTHS = ["जनवरी", "फ़रवरी", "मार्च", "अप्रैल", "मई", "जून", "जुलाई", "अगस्त", "सितंबर", "अक्टूबर", "नवंबर", "दिसंबर"]
MONTH_ABBR = {m: i for i, m in enumerate(["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"])}
MONTH_ABBR["sept"] = 8


def words(n: int) -> str:
    """Whole numbers in words, Indian system: 125000 -> एक लाख पच्चीस हज़ार."""
    if n < 0:
        return "माइनस " + words(-n)
    if n < 100:
        return _UNITS[n]
    parts: list[str] = []
    for size, name in ((10_000_000, "करोड़"), (100_000, "लाख"), (1000, "हज़ार"), (100, "सौ")):
        if n >= size:
            q, n = divmod(n, size)
            parts.append(f"{words(q)} {name}")
    if n:
        parts.append(_UNITS[n])
    return " ".join(parts)


def digits(s: str) -> str:
    """Each digit on its own (phone numbers, IDs, OTPs): 98 -> नौ आठ."""
    return " ".join(DIGITS[int(c)] for c in s if c.isdigit())


def decimal(s: str) -> str:
    """7.5 -> साढ़े सात, 1.5 -> डेढ़, 2.5 -> ढाई, 3.25 -> तीन दशमलव दो पाँच."""
    whole, _, frac = s.partition(".")
    w = int(whole or 0)
    if frac.rstrip("0") == "5":
        return {0: "आधा", 1: "डेढ़", 2: "ढाई"}.get(w, f"साढ़े {words(w)}")
    if not frac.strip("0"):
        return words(w)
    return f"{words(w)} दशमलव {digits(frac)}"


def clock(h: int, m: int, with_baje: bool = True) -> str:
    """10:30 -> साढ़े दस बजे, 10:15 -> सवा दस बजे, 10:45 -> पौने ग्यारह बजे, 13:30 -> डेढ़ बजे, 10:20 -> दस बजकर बीस मिनट."""
    h12 = h % 12 or 12
    nxt = h12 % 12 + 1
    baje = " बजे" if with_baje else ""
    if m == 0:
        return f"{words(h12)}{baje}"
    if m == 30:
        return {1: "डेढ़", 2: "ढाई"}.get(h12, f"साढ़े {words(h12)}") + baje
    if m == 15:
        return f"सवा {words(h12)}{baje}"
    if m == 45:
        return ("पौने एक" if nxt == 1 else f"पौने {words(nxt)}") + baje
    return f"{words(h12)} बजकर {words(m)} मिनट"


def day_part(h: int) -> str:
    return "सुबह" if 4 <= h < 12 else "दोपहर" if 12 <= h < 16 else "शाम" if 16 <= h < 20 else "रात"


def rupees(amount: str) -> str:
    """'25,000.50' -> पच्चीस हज़ार रुपये पचास पैसे."""
    a = amount.replace(",", "")
    whole, _, frac = a.partition(".")
    out = f"{words(int(whole or 0))} रुपये"
    paise = int((frac + "00")[:2]) if frac else 0
    return f"{out} {words(paise)} पैसे" if paise else out


def date(d: int, m: int, y: int | None = None) -> str:
    """28/11/2026 -> अट्ठाईस नवंबर दो हज़ार छब्बीस."""
    s = f"{words(d)} {MONTHS[m - 1]}"
    return f"{s} {words(y)}" if y else s
