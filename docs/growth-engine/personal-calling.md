# Personal mobile calling

Employees call pharmacies from **their own Android phone or iPhone and their own SIM**. Medoro needs no telephony
provider (no Exotel/Twilio) and does no WhatsApp calling.

## Flow

1. My assigned leads (or the calling queue: due follow-ups first, then never-called leads by score) → open the lead.
2. **CALL PHARMACY**: the server checks the staff session, the active assignment to this employee, that the lead is in
   their scope, the normalised E.164 number and the contact policy (DNC list; optionally "authorised contacts only"),
   then creates a `CallSession` with the launch time and returns `tel:+91…`.
3. The browser opens the phone's dialer through a `tel:` link (Android Chrome, iPhone Safari, desktop handlers such as
   a softphone). "Copy number" is the fallback; "Open dialer again" re-opens it.
4. The employee calls and comes back; the report form is already on screen (and open calls are listed in the queue).
5. The report (outcome, interest, notes, follow-up if needed, demo/conversion details, software status, consent given
   on the call, "number confirmed") is saved once, in one transaction with the follow-up, stage, evidence and timeline.

A second tap within 30 minutes reuses the open session. Launches are rate limited (150/hour per employee).

## What Medoro does not do

* No access to cellular audio, call logs, phone state or the microphone; no Android permissions are requested
  (`READ_CALL_LOG`, `READ_PHONE_STATE`, recording: none). The web app cannot read them anyway.
* A dialer launch does not prove a call happened, and a reported call is the employee's account, not carrier data. Both
  are shown separately everywhere. No call duration is recorded or invented.

## Effects of an outcome

| Outcome | Stage | Other |
|---|---|---|
| No answer / Busy / Not called | unchanged | NOT_CALLED is not counted as an attempt |
| Connected / Follow-up required | First contact (forward only) | follow-up date required for Follow-up required |
| Interested | Interested | follow-up date required |
| Demo scheduled | Demo scheduled | demo booking created |
| Converted | Converted | conversion + won deal; revenue in analytics |
| Not interested | Lost (or Follow-up later if a date is set) | |
| Wrong number | Research pending | phone verification removed; number on the DNC list for calls |
| Do not contact | Do not contact | phone and email on the DNC list (all channels), consents revoked, follow-ups cancelled |

**Read compliance.md before rolling this out**: promotional calls from personal 10-digit numbers carry TRAI risk.
