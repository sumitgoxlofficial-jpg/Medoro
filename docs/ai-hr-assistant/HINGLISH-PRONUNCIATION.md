# Hinglish pronunciation layer

Code: `ai-service/app/speech/` (pure Python, no model). Tests: `ai-service/tests/test_speech.py`.

## Why it exists (measured)

Kokoro's Hindi pipeline (`lang_code='h'`, espeak-ng `hi` for phonemes) reads **Latin letters with English phonemes**.
Measured on this build, with the phonemes Kokoro produced:

| Input | Phonemes | Result |
|---|---|---|
| `Namaste Rahul ji, aapka ... hai.` (Roman) | `nˈamast ɹˈɑːhʊl ʤˈI ... hˈI` | wrong: "namast", English "ji", "hai" as /hI/ |
| `नमस्ते राहुल जी, आपका ... है।` (Devanagari) | `nəmˈʌsteː ɾˈaːhʊl ɟˈi ... hɛː` | right |
| `पेस्लिप, ओवरटाइम, चेक इन` | `pˈeːslɪp, oːʋəɾʈˈaːɪm, cˈeːk ˈɪn` | Indian-English pronunciation of HR terms |
| `HRMS` inside Hindi | `ˌAʧˌɑːɹˌɛmˈɛs` (English r) | so acronyms are spelled in Devanagari: `एच आर एम एस` |

So Naina keeps **two texts**: the **display text** employees read (Roman Hinglish, Hindi or English, unchanged) and the
**speech text** Kokoro reads (Devanagari, with English office words written the way Indian offices say them).

## Order of processing (Hindi and Hinglish)

1. Clean-up: `(Source: …)` / `(स्रोत: …)` tags removed, Unicode NFC, zero-width characters removed.
2. Emails and web addresses: `rahul.sharma@medoro.in` → `राहुल डॉट शर्मा एट द रेट मेडोरो डॉट इन`.
3. Money: `₹1,25,000.50`, `Rs. 500`, `750/-`, `500 rupees` → `एक लाख पच्चीस हज़ार रुपये पचास पैसे` (Indian numbering).
4. Dates: `28/11/2026`, `2026-11-28`, `5 Dec`, `Jan 26, 2027` → `अट्ठाईस नवंबर दो हज़ार छब्बीस`.
5. Times: `10:30` → `साढ़े दस बजे`, `10:15` → `सवा दस बजे`, `10:45` → `पौने ग्यारह बजे`, `1:30` → `डेढ़ बजे`, `2:30` →
   `ढाई बजे`, `7:15 PM` → `शाम सवा सात बजे`, `11:00 baje` → `ग्यारह बजे` (never "बजे बजे").
6. Phone numbers (`9876543210`, `+91 98765 43210`) digit by digit in two groups; OTPs digit by digit; employee and
   document IDs (`EMP1023`, `MED-0045`, `HR/2026/14`) letter by letter and digit by digit.
7. Percentages (`12%` → `बारह परसेंट`), decimals (`2.5` → `ढाई`, `7.5` → `साढ़े सात`), other numbers in Hindi words.
8. Words, longest dictionary phrase first (`notice period`, `work from home`, `leave balance`, `check-in`):
   **Hinglish words** (`hai` → `है`; wins for words that are also English: `main`, `the`, `to`, `me`, `hi`, `use`) →
   **HR terms** → **names** → **acronyms** (all-caps, spelled: `KYC` → `के वाई सी`) → **rule-based transliteration**.
   A sentence-initial `Hi`/`Hi Priya` is the greeting `हाय`; elsewhere `hi` is `ही` ("aaj hi").
9. Punctuation: `.` → `।` after Hindi, `&` → `और`, `/` → `या`, brackets and symbols removed, spacing fixed.

English replies (detected, or `lang:"en"`) are left to Kokoro's English handling with only rupees and spacing tidied.

## Dictionaries (data, not code)

| File | Entries | Content |
|---|---|---|
| `app/speech/data/hr_terms.json` | **796** in 12 categories | attendance, shifts, leave, payroll, employee records, recruitment & onboarding, performance & training, exit, HR operations, HRMS app, workplace, spoken English. Reviewed against the HRMS screens. |
| `app/speech/data/hinglish.json` | 674 | every word in Naina's own Hinglish lines (exported from `phrases.ts`) and common spoken Hindi, with spelling variants (`nahi/nahin/nhi`). |
| `app/speech/data/names.json` | 240 | common Indian first names and surnames (`Deepak` → `दीपक`, `Gurpreet` → `गुरप्रीत`). |

Enforced by tests: at least 500 HR terms; keys lowercase and unique across all files (duplicate JSON keys are an error,
not silently merged); every value Devanagari; **every word Naina says in Hinglish is in a reviewed dictionary**
(`test_dictionary_covers_naina_vocabulary`); **every one of her 270 distinct lines comes out with no Latin letter
left** (`test_every_naina_line_becomes_pure_devanagari`).

## Fixing a pronunciation without changing code

On the AI host, edit `/etc/medoro-ai/lexicon.json` (the installer creates it, readable by the service):

```json
{
  "terms": { "tally": "टैली", "medoro plus": "मेडोरो प्लस" },
  "names": { "sumit": "सुमित", "aparna": "अपर्णा" },
  "words": { "theek": "ठीक" }
}
```

It is re-read automatically when the file changes (no restart). Values must be Devanagari; any other entry is skipped
and logged as "skipped an entry" (never spoken). A broken file is ignored (the reviewed dictionaries keep working) and
logged as "lexicon override unreadable". Check it took effect: `GET /health` → `tts.lexicon.overrides`.

To change a reviewed entry for everyone, edit the JSON in `ai-service/app/speech/data/`, run the tests
(`pytest tests/test_speech.py`), and deploy.

## Known limits

* `ki` (कि / की) and similar homographs are written one way (`की`); the sound difference is small.
* Unknown names fall back to rules (`Aparna` → `अपर्ना`, not `अपर्णा`); add them to the override's `names`.
* English sentences inside a Hindi reply are spoken through the Hindi voice word by word (via the dictionary), not as
  fluent English. Pure English replies use `KOKORO_EN_MODE` (see KOKORO-TTS-SETUP.md).
* The layer controls *what* Kokoro is asked to say. *How natural* the Hindi voice sounds is Kokoro's: its author grades
  both Hindi voices "C" overall. It must be judged by people listening (TEST-REPORT.md §4).
