import type { Lang } from "./nlu";

// Everything the assistant says, in Hinglish (default), Hindi (Devanagari) and English. Several wordings per message
// so the conversation doesn't sound scripted; the engine never repeats a wording within one call while another is left.
// {placeholders} are filled from facts the server supplied (never invented). Short sentences, one question at a time.

type Variants = Record<Lang, string[]>;
export const P = {
  intro: {
    hinglish: ["Hello {name} ji, namaste! Main Naina hoon, Medoro HR ki AI assistant. {purpose} Kya abhi ek minute baat kar sakte hain?", "Namaste {name} ji! Main Naina, Medoro HR ki taraf se AI assistant bol rahi hoon. {purpose} Kya abhi baat karna theek rahega?"],
    hi: ["नमस्ते {name} जी! मैं नैना हूँ, मेडोरो HR की AI असिस्टेंट। {purpose} क्या अभी एक मिनट बात कर सकते हैं?", "नमस्ते {name} जी, मैं नैना, मेडोरो HR की ओर से AI असिस्टेंट बोल रही हूँ। {purpose} क्या अभी बात करना ठीक रहेगा?"],
    en: ["Hello {name}, this is Naina, Medoro HR's AI assistant. {purpose} Is this a good time to talk for a minute?", "Hi {name}! I'm Naina, the AI assistant from Medoro HR. {purpose} Do you have a minute right now?"],
  },
  /** When the employee starts the chat themselves (Chats → Naina): no permission question, just an offer to help. */
  intro_self: {
    hinglish: ["Namaste {name} ji! Main Naina hoon, Medoro HR ki AI assistant. Bataiye, main aapki kis tarah madad kar sakti hoon?", "Hello {name} ji! Main Naina, Medoro HR ki AI assistant. Leave, attendance, payslip ya HRMS ke baare mein kuch bhi poochiye."],
    hi: ["नमस्ते {name} जी! मैं नैना हूँ, मेडोरो HR की AI असिस्टेंट। बताइए, मैं आपकी किस तरह मदद कर सकती हूँ?", "नमस्ते {name} जी! मैं नैना, मेडोरो HR की AI असिस्टेंट। छुट्टी, हाज़िरी, पे-स्लिप या HRMS के बारे में कुछ भी पूछिए।"],
    en: ["Hello {name}! I'm Naina, Medoro HR's AI assistant. How can I help you today?", "Hi {name}! I'm Naina, the AI assistant from Medoro HR. Ask me anything about leave, attendance, payslips or the HRMS."],
  },
  purpose_late: { hinglish: ["Aapki aaj ki attendance ke baare mein ek chhoti si baat karni thi."], hi: ["आपकी आज की हाज़िरी के बारे में एक छोटी सी बात करनी थी।"], en: ["I wanted to quickly check about your attendance today."] },
  purpose_absent: { hinglish: ["Aaj ki attendance ke baare mein bas check karna tha ki sab theek hai."], hi: ["आज की हाज़िरी के बारे में बस यह पूछना था कि सब ठीक है।"], en: ["I just wanted to check in about today's attendance and make sure everything is okay."] },
  purpose_missing_checkout: { hinglish: ["Aaj ke checkout ke baare mein ek chhota sa sawaal tha."], hi: ["आज के चेकआउट के बारे में एक छोटा सा सवाल था।"], en: ["I had a quick question about today's check-out."] },
  purpose_overtime: { hinglish: ["Aapke manager ki ek overtime request ke baare mein baat karni thi."], hi: ["आपके मैनेजर के एक ओवरटाइम अनुरोध के बारे में बात करनी थी।"], en: ["I'm calling about an overtime request from your manager."] },
  purpose_manual: { hinglish: ["HR team ne aapse ek follow-up ke liye baat karne ko kaha tha."], hi: ["HR टीम ने आपसे एक फॉलो-अप के लिए बात करने को कहा था।"], en: ["The HR team asked me to follow up with you."] },

  q_late: {
    hinglish: ["Aaj aapka check-in abhi tak record nahi hua hai{shift}. Kya aap office aa rahe hain?", "Aapka check-in abhi system mein nahi dikh raha{shift}. Aap aaj office aa rahe hain na?"],
    hi: ["आज आपका चेक-इन अभी तक दर्ज नहीं हुआ है{shift}। क्या आप ऑफिस आ रहे हैं?"],
    en: ["Your check-in hasn't been recorded yet today{shift}. Are you on your way to the office?"],
  },
  q_absent: {
    hinglish: ["Aaj aapka check-in record nahi hua hai aur koi approved leave bhi nahi dikh rahi. Kya aap aaj office aa paayenge?", "System mein aaj na check-in hai na approved leave. Aaj office aana ho paayega?"],
    hi: ["आज आपका चेक-इन नहीं हुआ है और कोई स्वीकृत छुट्टी भी नहीं दिख रही। क्या आप आज ऑफिस आ पाएँगे?"],
    en: ["There's no check-in or approved leave for you today. Will you be able to come in today?"],
  },
  q_missing_checkout: {
    hinglish: ["Aapki shift {end} par khatam ho gayi thi, lekin checkout record nahi hua. Kya aap abhi bhi kaam kar rahe hain, ya checkout karna reh gaya?", "Shift {end} tak thi, par checkout abhi tak nahi hua. Aap abhi kaam par hain ya checkout bhool gaye?"],
    hi: ["आपकी शिफ्ट {end} पर खत्म हो गई थी, लेकिन चेकआउट दर्ज नहीं हुआ। क्या आप अभी भी काम कर रहे हैं, या चेकआउट करना रह गया?"],
    en: ["Your shift ended at {end}, but no check-out was recorded. Are you still working, or did the check-out get missed?"],
  },
  q_overtime: {
    hinglish: ["Aapke manager ne {date} ko {hours} ghante overtime ki request ki hai{from}{why}. Kya aap available hain?"],
    hi: ["आपके मैनेजर ने {date} को {hours} घंटे ओवरटाइम का अनुरोध किया है{from}{why}। क्या आप उपलब्ध हैं?"],
    en: ["Your manager has requested {hours} hours of overtime on {date}{from}{why}. Would you be available?"],
  },
  q_manual: { hinglish: ["Bataiye, main aapki kis tarah madad kar sakti hoon?"], hi: ["बताइए, मैं आपकी किस तरह मदद कर सकती हूँ?"], en: ["How can I help you today?"] },

  ask_eta: {
    hinglish: ["Aap approximately kitne baje tak pahunch paayenge?", "Lagbhag kitne baje tak office pahunchna ho jaayega?", "Andaazan kitne baje tak aa jaayenge?"],
    hi: ["आप लगभग कितने बजे तक पहुँच पाएँगे?", "अंदाज़न कितने बजे तक ऑफिस पहुँचेंगे?"],
    en: ["Roughly what time do you expect to reach?", "About what time should we expect you?"],
  },
  ask_eta_hint: { hinglish: ["Koi baat nahi, bas ek andaaza bata dijiye, jaise aadha ghanta ya ek ghanta?"], hi: ["कोई बात नहीं, बस एक अंदाज़ा बता दीजिए, जैसे आधा घंटा या एक घंटा?"], en: ["No problem, just a rough idea, like half an hour or an hour?"] },
  ask_finish: {
    hinglish: ["Theek hai. Aap lagbhag kitne baje tak kaam khatam karenge?", "Achha. Andaazan kitne baje tak nikalna hoga?"],
    hi: ["ठीक है। आप लगभग कितने बजे तक काम खत्म करेंगे?"],
    en: ["Okay. Roughly what time do you think you'll finish?"],
  },
  ask_left_at: {
    hinglish: ["Koi baat nahi. Aap office se lagbhag kitne baje nikle the?", "Chaliye. Andaazan kitne baje nikalna hua tha?"],
    hi: ["कोई बात नहीं। आप ऑफिस से लगभग कितने बजे निकले थे?"],
    en: ["No problem. Roughly what time did you leave the office?"],
  },
  ask_leave: {
    hinglish: ["Kya aap aaj ki leave lena chahenge? Main HR ke liye leave request ka draft bana sakti hoon; approval HR ya manager hi denge.", "Agar aap chahein toh main aaj ki leave ka draft HR ko bhej doon? Final approval HR ya aapke manager ka hoga."],
    hi: ["क्या आप आज की छुट्टी लेना चाहेंगे? मैं HR के लिए छुट्टी अनुरोध का ड्राफ्ट बना सकती हूँ; मंज़ूरी HR या मैनेजर ही देंगे।"],
    en: ["Would you like to take leave today? I can prepare a leave request draft for HR; HR or your manager will make the decision."],
  },
  ask_callback: {
    hinglish: ["Koi baat nahi. Aap kis time par baat karna prefer karenge?", "Bilkul. Main kab dobara contact karoon?"],
    hi: ["कोई बात नहीं। आप किस समय बात करना पसंद करेंगे?"],
    en: ["No problem. What time would suit you better?"],
  },
  ask_ot_confirm: {
    hinglish: ["Toh main note kar rahi hoon ki aap {date} ko {hours} ghante overtime ke liye available hain. Sahi hai?"],
    hi: ["तो मैं नोट कर रही हूँ कि आप {date} को {hours} घंटे ओवरटाइम के लिए उपलब्ध हैं। सही है?"],
    en: ["So I'm noting that you're available for {hours} hours of overtime on {date}. Is that right?"],
  },

  ack: {
    hinglish: ["Achha, koi baat nahi.", "Theek hai.", "Samajh gayi.", "Okay ji.", "Ji, bilkul."],
    hi: ["अच्छा, कोई बात नहीं।", "ठीक है।", "समझ गई।", "जी, बिल्कुल।"],
    en: ["Alright.", "Got it.", "Okay.", "No problem."],
  },
  empathy: {
    hinglish: ["Oh, yeh sunkar bura laga.", "Arre, aap apna dhyaan rakhiye.", "Samajh sakti hoon, aisa ho jaata hai."],
    hi: ["ओह, यह सुनकर बुरा लगा।", "आप अपना ध्यान रखिए।"],
    en: ["Oh, I'm sorry to hear that.", "Please take care of yourself."],
  },
  angry: {
    hinglish: ["Main samajh sakti hoon ki aapko inconvenience hua hai.", "Maafi chahti hoon agar is call se pareshani hui."],
    hi: ["मैं समझ सकती हूँ कि आपको असुविधा हुई है।", "माफ़ी चाहती हूँ अगर इस कॉल से परेशानी हुई।"],
    en: ["Sorry for the trouble.", "I'm sorry if this call is a bother."],
  },
  confused: {
    hinglish: ["Main simple words mein bata deti hoon.", "Chaliye, aasaan shabdon mein poochti hoon."],
    hi: ["मैं आसान शब्दों में बता देती हूँ।"],
    en: ["Let me put it simply."],
  },
  simple_late: { hinglish: ["Aaj aap office aa rahe hain, haan ya nahi?"], hi: ["आज आप ऑफिस आ रहे हैं, हाँ या नहीं?"], en: ["Are you coming to the office today, yes or no?"] },
  simple_missing_checkout: { hinglish: ["Aap abhi office mein kaam kar rahe hain, ya ghar nikal chuke hain?"], hi: ["आप अभी ऑफिस में काम कर रहे हैं, या घर निकल चुके हैं?"], en: ["Are you still at work, or have you already left?"] },
  simple_overtime: { hinglish: ["{date} ko {hours} ghante extra ruk paayenge? Haan ya nahi?"], hi: ["{date} को {hours} घंटे ज़्यादा रुक पाएँगे? हाँ या नहीं?"], en: ["Can you stay {hours} extra hours on {date}? Yes or no?"] },

  note_eta: {
    hinglish: ["Theek hai, main aapka expected arrival {eta} note kar rahi hoon. Safe travel kijiye!", "Done, {eta} tak aane ki baat note kar li hai. Aaram se aaiye."],
    hi: ["ठीक है, मैं आपके पहुँचने का समय {eta} नोट कर रही हूँ। सुरक्षित आइए!"],
    en: ["Okay, I've noted your expected arrival at {eta}. Travel safe!"],
  },
  note_finish: { hinglish: ["Theek hai, main note kar rahi hoon ki aap {eta} tak kaam karenge. Kaam khatam karke checkout zaroor kar lijiye."], hi: ["ठीक है, मैंने नोट किया कि आप {eta} तक काम करेंगे। काम खत्म करके चेकआउट ज़रूर कर लीजिए।"], en: ["Okay, I've noted you'll work until about {eta}. Please remember to check out when you finish."] },
  note_forgot: { hinglish: ["Koi baat nahi. Agar abhi ho sake toh HRMS mein Attendance kholkar correction request daal dijiye{left}. Main HR ko bhi note bhej deti hoon."], hi: ["कोई बात नहीं। HRMS में अटेंडेंस खोलकर सुधार अनुरोध डाल दीजिए{left}। मैं HR को भी नोट भेज देती हूँ।"], en: ["No problem. Please open Attendance in the HRMS and request a correction{left}. I'll also send HR a note."] },
  note_checked_in: { hinglish: ["Achha, agar aapne check-in kiya tha aur record nahi hua, toh Attendance mein us din par correction request daal dijiye. Main HR ko bhi bata deti hoon ki check kar lein."], hi: ["अच्छा, अगर आपने चेक-इन किया था और दर्ज नहीं हुआ, तो अटेंडेंस में सुधार अनुरोध डाल दीजिए। मैं HR को भी बता देती हूँ।"], en: ["I see. If you checked in and it wasn't recorded, please raise a correction for the day in Attendance. I'll let HR know to check as well."] },
  note_system: { hinglish: ["Samajh gayi, system ki dikkat hai. Main HR ko issue bata deti hoon. Tab tak Attendance mein correction request daal sakte hain."], hi: ["समझ गई, सिस्टम की दिक्कत है। मैं HR को बता देती हूँ। तब तक अटेंडेंस में सुधार अनुरोध डाल सकते हैं।"], en: ["Understood, that sounds like a system problem. I'll report it to HR; meanwhile you can raise a correction in Attendance."] },
  note_dispute: { hinglish: ["Samajh gayi. Us din ke liye Attendance mein correction request daal dijiye, HR use check karega. Main HR ko bhi note bhej deti hoon."], hi: ["समझ गई। उस दिन के लिए अटेंडेंस में सुधार अनुरोध डाल दीजिए, HR उसे जाँचेगा। मैं HR को भी नोट भेज देती हूँ।"], en: ["Understood. Please raise a correction for that day in Attendance and HR will check it. I'll send HR a note as well."] },
  note_not_scheduled: { hinglish: ["Achha, batane ke liye shukriya. Shayad roster ya calendar mein galti hai; main HR ko check karne ke liye bata deti hoon. Aapko kuch karne ki zaroorat nahi."], hi: ["अच्छा, बताने के लिए धन्यवाद। शायद रोस्टर या कैलेंडर में गलती है; मैं HR को जाँचने के लिए बता देती हूँ।"], en: ["Thanks for letting me know. The roster or calendar may be wrong; I'll ask HR to check. Nothing more is needed from you."] },
  why_call: { hinglish: ["Main isliye contact kar rahi hoon kyunki {purpose_text}"], hi: ["मैं इसलिए संपर्क कर रही हूँ क्योंकि {purpose_text}"], en: ["I'm reaching out because {purpose_text}"] },
  note_leave_applied: { hinglish: ["Achha, aapne leave apply kar di hai. Main HR ko note kar deti hoon ki approval pending hai.", "Theek hai, leave request already gayi hui hai. Main HR ko yaad dila deti hoon."], hi: ["अच्छा, आपने छुट्टी के लिए आवेदन कर दिया है। मैं HR को नोट कर देती हूँ कि मंज़ूरी बाकी है।"], en: ["Okay, you've already applied for leave. I'll note for HR that the approval is pending."] },
  note_leave_draft: { hinglish: ["Theek hai, main aaj ki leave ka draft HR ko bhej rahi hoon. Approval ka update aapko HRMS mein milega."], hi: ["ठीक है, मैं आज की छुट्टी का ड्राफ्ट HR को भेज रही हूँ। मंज़ूरी की जानकारी आपको HRMS में मिलेगी।"], en: ["Okay, I'm sending a leave draft to HR. You'll see their decision in the HRMS."] },
  note_no_leave: { hinglish: ["Theek hai, main HR ko bata deti hoon ki aap aaj nahi aa paayenge."], hi: ["ठीक है, मैं HR को बता देती हूँ कि आप आज नहीं आ पाएँगे।"], en: ["Okay, I'll let HR know you won't be in today."] },
  note_wfh: { hinglish: ["Work from home ke liye manager ya HR ki approval chahiye hoti hai. Main aapki request HR ko note kar deti hoon."], hi: ["घर से काम के लिए मैनेजर या HR की मंज़ूरी चाहिए होती है। मैं आपका अनुरोध HR को नोट कर देती हूँ।"], en: ["Working from home needs approval from your manager or HR. I'll pass your request to HR."] },
  note_half_day: { hinglish: ["Half day ke liye bhi approval HR ya manager ka hota hai. Main HR ko note kar deti hoon."], hi: ["आधे दिन के लिए भी मंज़ूरी HR या मैनेजर की होती है। मैं HR को नोट कर देती हूँ।"], en: ["A half day also needs HR or manager approval. I'll note it for HR."] },
  note_ot_yes: { hinglish: ["Shukriya! Main manager ko bata deti hoon ki aap available hain. Final approval unka hoga."], hi: ["धन्यवाद! मैं मैनेजर को बता देती हूँ कि आप उपलब्ध हैं। अंतिम मंज़ूरी उनकी होगी।"], en: ["Thank you! I'll tell your manager you're available; the final approval is theirs."] },
  note_ot_no: { hinglish: ["Koi baat nahi, bilkul theek hai. Main manager ko bata deti hoon ki aap available nahi hain."], hi: ["कोई बात नहीं, बिल्कुल ठीक है। मैं मैनेजर को बता देती हूँ कि आप उपलब्ध नहीं हैं।"], en: ["That's completely fine. I'll let your manager know you're not available."] },
  note_ot_clarify: { hinglish: ["Achha sawaal hai. Overtime ke payment aur timing ki details HR policy ke hisaab se HR hi confirm karega. Main aapka sawaal manager aur HR tak pahuncha deti hoon."], hi: ["अच्छा सवाल है। ओवरटाइम के भुगतान और समय की जानकारी HR ही पक्का करेगा। मैं आपका सवाल मैनेजर और HR तक पहुँचा देती हूँ।"], en: ["Good question. HR will confirm the overtime pay and timing details as per policy. I'll pass your question to your manager and HR."] },
  note_callback: { hinglish: ["Theek hai, main {cb} dobara contact karungi.", "Done, {cb} phir se baat karte hain."], hi: ["ठीक है, मैं {cb} फिर से संपर्क करूँगी।"], en: ["Sure, I'll get back to you {cb}."] },
  note_callback_hr: { hinglish: ["Theek hai, main HR ko bata deti hoon ki aapse baad mein baat karein."], hi: ["ठीक है, मैं HR को बता देती हूँ कि आपसे बाद में बात करें।"], en: ["Okay, I'll ask HR to get back to you later."] },
  note_followup: { hinglish: ["Main yeh baat HR team tak pahuncha deti hoon."], hi: ["मैं यह बात HR टीम तक पहुँचा देती हूँ।"], en: ["I'll pass this on to the HR team."] },

  stop: { hinglish: ["Bilkul. Main aage se aapko AI calls nahi karungi. Agar kabhi zaroorat ho toh HRMS mein yeh setting badal sakte hain. Dhanyavaad."], hi: ["बिल्कुल। मैं आगे से आपको AI कॉल नहीं करूँगी। ज़रूरत हो तो HRMS में यह सेटिंग बदल सकते हैं। धन्यवाद।"], en: ["Of course. I won't contact you with AI calls again. You can change this in the HRMS any time. Thank you."] },
  human: { hinglish: ["Bilkul, main HR team ko bata deti hoon. Woh aapse jaldi contact karenge.", "Zaroor. Aapki request HR ko bhej rahi hoon; koi HR person aapse jaldi baat karega."], hi: ["बिल्कुल, मैं HR टीम को बता देती हूँ। वे आपसे जल्दी संपर्क करेंगे।"], en: ["Of course. I'll ask the HR team to contact you soon."] },
  harassment: { hinglish: ["Yeh bahut serious baat hai, aur aapne batakar sahi kiya. Aapko abhi details batane ki zaroorat nahi hai. Main ise urgent mark karke HR ko bhej rahi hoon; designated HR person aapse confidentially baat karenge."], hi: ["यह बहुत गंभीर बात है, और आपने बताकर सही किया। अभी विवरण बताने की ज़रूरत नहीं है। मैं इसे तुरंत HR को भेज रही हूँ; नामित HR व्यक्ति आपसे गोपनीय रूप से बात करेंगे।"], en: ["This is serious, and thank you for telling me. You don't need to share details now. I'm marking this urgent for HR; the designated HR person will speak with you confidentially."] },
  accident: { hinglish: ["Aapki safety sabse zaroori hai. Agar emergency hai toh turant 112 par call kijiye. Main HR ko abhi urgent inform kar rahi hoon. Attendance ki chinta mat kijiye."], hi: ["आपकी सुरक्षा सबसे ज़रूरी है। आपात स्थिति हो तो तुरंत 112 पर कॉल कीजिए। मैं HR को अभी सूचित कर रही हूँ। हाज़िरी की चिंता मत कीजिए।"], en: ["Your safety comes first. If it's an emergency, please call 112 now. I'm informing HR urgently. Don't worry about attendance."] },
  emergency: { hinglish: ["Oh, aap apne parivaar ka dhyaan rakhiye. Main HR ko bata deti hoon taaki woh aapse baat kar sakein. Attendance ki chinta abhi mat kijiye."], hi: ["ओह, आप अपने परिवार का ध्यान रखिए। मैं HR को बता देती हूँ ताकि वे आपसे बात कर सकें। हाज़िरी की चिंता अभी मत कीजिए।"], en: ["I'm sorry. Please take care of your family. I'll let HR know so they can reach you. Don't worry about attendance right now."] },
  complaint: { hinglish: ["Aapki baat sun rahi hoon. Main aapki concern HR team tak pahuncha deti hoon; woh aapse properly baat karenge."], hi: ["मैं आपकी बात सुन रही हूँ। मैं आपकी चिंता HR टीम तक पहुँचा देती हूँ; वे आपसे ठीक से बात करेंगे।"], en: ["I hear you. I'll pass your concern to the HR team so they can talk it through with you."] },
  ai_identity: { hinglish: ["Haan, main ek AI assistant hoon, Medoro HRMS ki taraf se. Main sirf aapki baat note karti hoon; koi faisla HR hi leta hai. Aap chahein toh kabhi bhi HR se baat kar sakte hain."], hi: ["हाँ, मैं मेडोरो HRMS की ओर से एक AI असिस्टेंट हूँ। मैं सिर्फ आपकी बात नोट करती हूँ; फैसला HR ही लेता है। आप कभी भी HR से बात कर सकते हैं।"], en: ["Yes, I'm an AI assistant for Medoro's HRMS. I only note what you tell me; HR makes any decisions. You can ask for a person from HR at any time."] },
  recording: { hinglish: ["Is conversation ki audio save nahi hoti. Sirf text summary aur transcript HR ke liye {days} din tak rakhe jaate hain, aur sirf authorised HR hi dekh sakta hai."], hi: ["इस बातचीत की ऑडियो सेव नहीं होती। सिर्फ टेक्स्ट सारांश HR के लिए {days} दिन तक रखा जाता है, और केवल अधिकृत HR ही देख सकता है।"], en: ["The audio of this conversation isn't saved. Only a text summary and transcript are kept for HR for {days} days, visible to authorised HR only."] },
  privacy: { hinglish: ["Main sirf aapki attendance aur shift ki zaroori jaankari use karti hoon. Aapki baat sirf authorised HR dekh sakta hai, kisi aur employee ko nahi dikhti."], hi: ["मैं सिर्फ आपकी हाज़िरी और शिफ्ट की ज़रूरी जानकारी इस्तेमाल करती हूँ। आपकी बात सिर्फ अधिकृत HR देख सकता है।"], en: ["I only use the attendance and shift details needed for this call. What you say is visible only to authorised HR, never to other employees."] },
  // Small talk a person would simply answer before going back to the question.
  hear_yes: { hinglish: ["Ji haan, main aapko achhi tarah sun pa rahi hoon.", "Haan ji, aapki aawaz bilkul saaf aa rahi hai."], hi: ["जी हाँ, मैं आपको अच्छी तरह सुन पा रही हूँ।", "हाँ जी, आपकी आवाज़ बिल्कुल साफ़ आ रही है।"], en: ["Yes, I can hear you clearly.", "Yes, you're coming through clearly."] },
  how_are_you: { hinglish: ["Main bilkul theek hoon, poochne ke liye shukriya!"], hi: ["मैं बिल्कुल ठीक हूँ, पूछने के लिए शुक्रिया!"], en: ["I'm doing well, thanks for asking!"] },
  uncomfortable: { hinglish: ["Theek hai, aapko kuch personal batane ki zaroorat nahi hai."], hi: ["ठीक है, आपको कुछ निजी बताने की ज़रूरत नहीं है।"], en: ["That's fine, you don't need to share anything personal."] },
  unrelated: { hinglish: ["Uske baare mein main madad nahi kar paungi, main sirf HR ki baaton ke liye hoon.", "Yeh mere scope se bahar hai; main HR aur attendance ki baaton mein madad karti hoon."], hi: ["उसके बारे में मैं मदद नहीं कर पाऊँगी, मैं सिर्फ HR की बातों के लिए हूँ।"], en: ["I can't help with that, I'm here only for HR matters."] },
  kb_unknown: { hinglish: ["Iske baare mein mere paas confirmed jaankari nahi hai, toh main andaaza nahi lagaungi. Main aapka sawaal HR ko bhej deti hoon, woh confirm karenge."], hi: ["इस बारे में मेरे पास पक्की जानकारी नहीं है, इसलिए मैं अंदाज़ा नहीं लगाऊँगी। मैं आपका सवाल HR को भेज देती हूँ।"], en: ["I don't have confirmed information on that, so I won't guess. I'll send your question to HR to confirm."] },
  kb_answer: { hinglish: ["{answer} (Source: {source})"], hi: ["{answer} (स्रोत: {source})"], en: ["{answer} (Source: {source})"] },
  unclear: {
    hinglish: ["Maaf kijiye, theek se samajh nahi aaya.", "Sorry, main thoda miss kar gayi.", "Ek baar aur bataiye, please."],
    hi: ["माफ़ कीजिए, ठीक से समझ नहीं आया।", "एक बार और बताइए।"],
    en: ["Sorry, I didn't quite catch that.", "Could you say that once more?"],
  },
  silence: { hinglish: ["Hello, lagta hai awaaz nahi aa rahi.", "Hello, mujhe aapki awaaz sunai nahi di."], hi: ["हेलो, लगता है आवाज़ नहीं आ रही।"], en: ["Hello, I can't hear you.", "Sorry, I didn't hear anything."] },
  give_up: { hinglish: ["Lagta hai abhi baat nahi ho pa rahi. Main HR ko note kar deti hoon, woh aapse contact kar lenge. Dhanyavaad!"], hi: ["लगता है अभी बात नहीं हो पा रही। मैं HR को नोट कर देती हूँ, वे आपसे संपर्क कर लेंगे। धन्यवाद!"], en: ["It seems we can't talk right now. I'll let HR know so they can follow up. Thank you!"] },
  close: {
    hinglish: ["Dhanyavaad {name} ji, aapka din achha rahe!", "Thank you {name} ji. Take care!", "Shukriya, aapka samay dene ke liye."],
    hi: ["धन्यवाद {name} जी, आपका दिन शुभ हो!", "शुक्रिया, समय देने के लिए।"],
    en: ["Thank you {name}, have a good day!", "Thanks for your time, {name}."],
  },
  close_decline: { hinglish: ["Koi baat nahi. Agar aap chahein toh baad mein HRMS se mujhse ya HR se baat kar sakte hain. Dhanyavaad!"], hi: ["कोई बात नहीं। चाहें तो बाद में HRMS से मुझसे या HR से बात कर सकते हैं। धन्यवाद!"], en: ["No problem. You can talk to me or HR later from the HRMS. Thank you!"] },
} satisfies Record<string, Variants>;
export type PhraseKey = keyof typeof P;

/** Words a natural conversation shouldn't lean on (checked by the evaluation, never produced by the templates). */
export const ROBOTIC = [/\bi understand\b/i, /thank you for sharing/i, /how may i assist you/i, /please provide more information/i, /as an ai language model/i];

export function fill(s: string, vars: Record<string, string | number | undefined>): string {
  return s.replace(/\{(\w+)\}/g, (_, k: string) => String(vars[k] ?? "")).replace(/\s+([.,?!।])/g, "$1").replace(/\s{2,}/g, " ").trim();
}
