"""Hinglish speech layer: what Kokoro is asked to say. Pure Python, no model needed."""
import json
import re

import pytest

from app.speech import Normalizer, detect_lang, split_chunks
from app.speech import numbers as N
from app.speech.lexicon import DATA, Lexicon, hr_terms, load_json
from app.speech.translit import to_devanagari

LATIN = re.compile(r"[A-Za-z]")


@pytest.fixture(scope="module")
def n():
    return Normalizer(Lexicon(override_path=""))


def say(n, text, lang="auto"):
    return n.to_speech(text, lang)[0]


# ── The examples from the brief, exactly
@pytest.mark.parametrize("text,expected", [
    ("Namaste Rahul ji, aapka attendance record incomplete hai.", "नमस्ते राहुल जी, आपका अटेंडेंस रिकॉर्ड इनकम्प्लीट है।"),
    ("Namaste Rahul ji, main Medoro ki AI HR Assistant bol rahi hoon.", "नमस्ते राहुल जी, मैं मेडोरो की ए आई एच आर असिस्टेंट बोल रही हूँ।"),
    ("Aapka attendance record check kar rahi hoon.", "आपका अटेंडेंस रिकॉर्ड चेक कर रही हूँ।"),
    ("Aaj aapki shift 10 baje start ho rahi hai.", "आज आपकी शिफ्ट दस बजे स्टार्ट हो रही है।"),
    ("Aapne abhi tak leave request submit nahi ki hai.", "आपने अभी तक लीव रिक्वेस्ट सबमिट नहीं की है।"),
    ("Kya aap mujhe bata sakte hain ki aap office kab tak pahunch paayenge?", "क्या आप मुझे बता सकते हैं की आप ऑफ़िस कब तक पहुँच पाएँगे?"),
    ("Aapki salary slip HRMS ke payroll section mein available hai.", "आपकी सैलरी स्लिप एच आर एम एस के पेरोल सेक्शन में अवेलेबल है।"),
    ("Agar aapko koi problem hai, toh main HR team ko inform kar sakti hoon.", "अगर आपको कोई प्रॉब्लम है, तो मैं एच आर टीम को इन्फ़ॉर्म कर सकती हूँ।"),
])
def test_brief_examples(n, text, expected):
    assert say(n, text) == expected


def test_app_devanagari_with_latin_names_and_acronyms(n):
    # This is what the app's engine sends (speechFor): Devanagari with the employee's name and acronyms in Latin.
    assert say(n, "नमस्ते Rahul जी! मैं नैना हूँ, मेडोरो HR की AI असिस्टेंट।") == "नमस्ते राहुल जी! मैं नैना हूँ, मेडोरो एच आर की ए आई असिस्टेंट।"


def test_hindi_text_untouched(n):
    t = "आज आपका चेक-इन अभी तक दर्ज नहीं हुआ है। क्या आप ऑफिस आ रहे हैं?"
    assert say(n, t) == t


# ── Numbers, time, money, dates, IDs, contacts
def test_hindi_numbers_table():
    assert N.words(0) == "शून्य" and N.words(19) == "उन्नीस" and N.words(45) == "पैंतालीस" and N.words(99) == "निन्यानबे"
    assert N.words(100) == "एक सौ" and N.words(1250) == "एक हज़ार दो सौ पचास"
    assert N.words(125000) == "एक लाख पच्चीस हज़ार" and N.words(20000000) == "दो करोड़"
    assert N.words(2026) == "दो हज़ार छब्बीस"


@pytest.mark.parametrize("hm,expected", [
    ((10, 0), "दस बजे"), ((10, 30), "साढ़े दस बजे"), ((1, 30), "डेढ़ बजे"), ((14, 30), "ढाई बजे"), ((10, 15), "सवा दस बजे"),
    ((10, 45), "पौने ग्यारह बजे"), ((12, 45), "पौने एक बजे"), ((10, 20), "दस बजकर बीस मिनट"), ((0, 0), "बारह बजे"),
])
def test_clock(hm, expected):
    assert N.clock(*hm) == expected


@pytest.mark.parametrize("text,expected", [
    ("Shift 10:30 se hai", "शिफ्ट साढ़े दस बजे से है"),
    ("7:15 PM tak", "शाम सवा सात बजे तक"),
    ("9 am ko aaiye", "सुबह नौ बजे को आइए"),
    ("11 baje tak", "ग्यारह बजे तक"),
    ("11:00 baje", "ग्यारह बजे"),  # no "बजे बजे"
    ("Check-in 9:45 am. Theek hai", "चेक इन सुबह पौने दस बजे। ठीक है"),
])
def test_times(n, text, expected):
    assert say(n, text) == expected


@pytest.mark.parametrize("text,expected", [
    ("₹25,000 credit hue", "पच्चीस हज़ार रुपये क्रेडिट हुए"),
    ("Rs. 1,25,000.50 bonus", "एक लाख पच्चीस हज़ार रुपये पचास पैसे बोनस"),
    ("500 rupees deduction", "पाँच सौ रुपये डिडक्शन"),
    ("INR 750/-", "सात सौ पचास रुपये"),
])
def test_money(n, text, expected):
    assert say(n, text, "hinglish") == expected


@pytest.mark.parametrize("text,expected", [
    ("28/11/2026 ko", "अट्ठाईस नवंबर दो हज़ार छब्बीस को"),
    ("2026-11-28 ko", "अट्ठाईस नवंबर दो हज़ार छब्बीस को"),
    ("5 Dec tak", "पाँच दिसंबर तक"),
    ("Jan 26, 2027 holiday hai", "छब्बीस जनवरी दो हज़ार सत्ताईस हॉलिडे है"),
])
def test_dates(n, text, expected):
    assert say(n, text) == expected


def test_ids_phones_emails_percent(n):
    # Short fragments like "12% hike" could be English; the app states the language, so the test does too.
    assert say(n, "Employee ID EMP1023 hai", "hinglish") == "एम्प्लॉई आईडी ई एम पी एक शून्य दो तीन है"
    assert say(n, "ID MED-0045", "hinglish") == "आईडी एम ई डी शून्य शून्य चार पाँच"
    assert say(n, "call 9876543210", "hinglish") == "कॉल नौ आठ सात छह पाँच, चार तीन दो एक शून्य"
    assert say(n, "+91 98765 43210 par", "hinglish") == "नौ आठ सात छह पाँच, चार तीन दो एक शून्य पर"
    assert say(n, "rahul.sharma@medoro.in par bhejiye", "hinglish") == "राहुल डॉट शर्मा एट द रेट मेडोरो डॉट इन पर भेजिए"
    assert say(n, "medoro.in/staff/hrms kholiye", "hinglish") == "मेडोरो डॉट इन स्लैश स्टाफ़ स्लैश एच आर एम एस खोलिए"
    assert say(n, "12% hike", "hinglish") == "बारह परसेंट हाइक"
    assert say(n, "2.5 ghante overtime", "hinglish") == "ढाई घंटे ओवरटाइम"
    assert say(n, "OTP 482913 hai", "hinglish") == "ओ टी पी चार आठ दो नौ एक तीन है"


# ── Words: phrases, precedence, hyphens, names, fallback
def test_multiword_terms_win(n):
    assert say(n, "Notice period kitna hai?") == "नोटिस पीरियड कितना है?"
    assert say(n, "Work from home chahiye") == "वर्क फ्रॉम होम चाहिए"
    assert say(n, "half-day ya half day") == "हाफ डे या हाफ डे"
    assert say(n, "check-in aur check-out") == "चेक इन और चेक आउट"
    assert say(n, "Leave balance batao") == "लीव बैलेंस बताओ"


def test_hindi_beats_english_for_ambiguous_words(n):
    assert say(n, "main aaj hi aa jaunga") == "मैं आज ही आ जाऊँगा"
    assert say(n, "Hi Priya, kaise ho?") == "हाय प्रिया, कैसे हो?"
    assert say(n, "use bata do") == "उसे बता दो"


def test_names_and_fallback(n):
    assert say(n, "Sunita, Deepak, Gurpreet ji") == "सुनीता, दीपक, गुरप्रीत जी"
    assert to_devanagari("Rahul") in ("रहुल", "राहुल") and to_devanagari("Priya") == "प्रिया" and to_devanagari("Neha") == "नेहा"
    assert to_devanagari("Anand") == "अनंद" and to_devanagari("Xavier").startswith("ज़")
    out = say(n, "Bhuvaneshwari aur Thirumalai ji, Zorblax")
    assert not LATIN.search(out)  # nothing is ever left in Latin letters


def test_acronyms_spelled(n):
    assert say(n, "PF aur ESI aur KYC aur XYZ") == "पी एफ और ई एस आई और के वाई सी और एक्स वाई ज़ेड"


# ── Language detection
def test_detect_lang(n):
    assert detect_lang("नमस्ते", n.lex) == "hi"
    assert detect_lang("Aapka check-in nahi hua hai", n.lex) == "hinglish"
    assert detect_lang("Your check-in hasn't been recorded yet.", n.lex) == "en"
    assert detect_lang("Is this a good time to talk to me?", n.lex) == "en"  # weak words (is, to, me) don't make it Hindi


def test_english_kept_for_english_pipeline(n):
    s, lang = n.to_speech("Your salary of ₹25,000 was credited. (Source: Payroll)")
    assert lang == "en" and s == "Your salary of 25000 rupees was credited."


def test_source_tags_removed(n):
    assert say(n, "Payslip HRMS mein milegi. (Source: Payroll FAQ)") == "पेस्लिप एच आर एम एस में मिलेगी।"
    assert say(n, "पेस्लिप मिलेगी। (स्रोत: पेरोल)") == "पेस्लिप मिलेगी।"


# ── Chunking
def test_chunks_and_pauses():
    c = split_chunks("पहला वाक्य। दूसरा सवाल? तीसरा!")
    assert c == [("पहला वाक्य।", "s"), ("दूसरा सवाल?", "q"), ("तीसरा!", "s")]
    long = ", ".join(["यह एक लंबा हिस्सा है"] * 20) + "।"
    parts = split_chunks(long, 80)
    assert len(parts) > 3 and all(len(p) <= 80 for p, _ in parts) and parts[-1][1] == "s" and all(k == "c" for _, k in parts[:-1])
    nocomma = "अ " * 200
    assert all(len(p) <= 80 for p, _ in split_chunks(nocomma.strip(), 80))
    assert split_chunks("   ") == []


# ── Dictionaries
def test_dictionary_size_and_quality():
    terms = hr_terms()
    assert len(terms) >= 500
    dev = re.compile(r"^[ऀ-ॿ\s\-।]+$")
    for d in (terms, load_json("hinglish.json")["words"], load_json("names.json")["names"]):
        for k, v in d.items():
            assert k == k.lower().strip() and dev.match(v), (k, v)
    words = load_json("hinglish.json")
    assert not set(terms) & set(words["words"])  # one meaning per key across files
    assert not set(terms) & set(load_json("names.json")["names"])
    for f in DATA.glob("*.json"):  # no duplicate keys anywhere (json would silently keep the last)
        load_json(f.name)


def test_dictionary_covers_naina_vocabulary(n):
    """Every word in Naina's own Hinglish lines (exported from phrases.ts) is in a reviewed dictionary, not guessed."""
    lines = json.loads((DATA.parent.parent.parent / "tests" / "data" / "naina_lines.json").read_text(encoding="utf-8"))
    unknown = set()
    for line in lines["hinglish"]:
        for w in re.findall(r"[A-Za-z]+(?:-[A-Za-z]+)*", re.sub(r"\{[^}]+\}", " ", line)):
            lw = w.lower()
            if not (lw in n.lex.words or lw in n.lex.terms or lw in n.lex.names or (w.isupper() and len(w) <= 6) or all(p in n.lex.words or p in n.lex.terms for p in lw.split("-"))):
                unknown.add(lw)
    assert not unknown, sorted(unknown)


def test_every_naina_line_becomes_pure_devanagari(n):
    lines = json.loads((DATA.parent.parent.parent / "tests" / "data" / "naina_lines.json").read_text(encoding="utf-8"))
    assert len(lines["hinglish"]) > 80 and len(lines["speech"]) > 150
    for line in lines["hinglish"] + lines["speech"]:
        out = say(n, line, "hinglish")
        assert out and not LATIN.search(out), (line, out)


def test_override_file_hot_reload(tmp_path):
    p = tmp_path / "lexicon.json"
    lex = Lexicon(override_path=str(p))
    nn = Normalizer(lex)
    assert say(nn, "Tally check karo") != "टैली चेक करो"
    p.write_text(json.dumps({"terms": {"tally": "टैली"}, "names": {"sumit": "सुमित"}, "words": {"bad": "not devanagari"}}), encoding="utf-8")
    assert say(nn, "Tally check karo, Sumit") == "टैली चेक करो, सुमित"
    assert lex.override_count == 2  # the Latin value was skipped, not spoken
    p.write_text("{ broken", encoding="utf-8")
    import os
    os.utime(p, (1, 1))
    assert say(nn, "Tally") != "टैली"  # unreadable override: back to the reviewed dictionaries, no crash
