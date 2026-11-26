import { TOUR_VIDEOS } from "@/data/tour-videos";
import type { QA } from "../shared";
import type { CourseLesson, Q } from "./types";
import { TOUR_SUBTITLES } from "./tour-subtitles";

/**
 * Medoro Pharmacy – Complete Product Knowledge: the 26 chapters of the official product tour (medoro.in/videos/complete-product-tour).
 * Every fact here comes from the tour's own narration (MEDORO_PRODUCT_TOUR/26_Scripts_Subtitles) and the product's
 * README; nothing is claimed that the software does not do. The tour is recorded on a demo server with made-up data.
 */
type Chapter = {
  part: number; slug: string; title: string;
  objectives: string[]; functions: string[]; problem: string; benefits: string[]; explain: string;
  qa: QA[]; quiz: Q[]; product: Q;
};

const C: Chapter[] = [
  {
    part: 1, slug: "part-01-introduction-to-medoro", title: "Introduction to Medoro",
    objectives: ["Medoro Pharmacy ek line mein samjhana", "Target customers pehchaanna", "Main benefits yaad rakhna"],
    functions: ["Billing, inventory, purchase, GST aur accounting ek hi software mein", "Keyboard se tez billing", "FEFO se expiry control, Schedule H check", "Internet band hone par bhi billing", "Hindi interface; data pharmacy ke apne Google Drive mein, encrypted"],
    problem: "Medical store owner alag-alag register, Excel aur purane software mein kaam karta hai; hisaab bikhra rehta hai.",
    benefits: ["Ek jagah poora business", "Expiry ka nuksaan kam", "GST reports samay par, CA ke review ke liye"],
    explain: "Sir, Medoro Pharmacy Bharat ki medical stores ke liye bana software hai. Billing, stock, purchase, GST aur accounts sab ek hi jagah milte hain, aur interface Hindi mein bhi chalta hai.",
    qa: [{ q: "Yeh kis type ki pharmacy ke liye hai?", a: "Mohalle ki medical store, hospital/clinic pharmacy aur multi-branch chains, sabke liye plans hain." }, { q: "Kya Hindi mein chalta hai?", a: "Haan, poora interface English aur Hindi mein switch hota hai." }],
    quiz: [
      { prompt: "Medoro Pharmacy mein kaun se kaam ek jagah hote hain?", options: ["Sirf billing", "Billing, inventory, purchase, GST aur accounting", "Sirf GST filing", "Sirf WhatsApp marketing"], answer: 1, explanation: "Tour ke Part 1 mein yahi paanch kaam ek jagah bataaye gaye hain." },
      { prompt: "Product tour ka data kaisa hai?", options: ["Asli customer data", "Demo pharmacy ka kaalpanik data", "Government data", "Kisi aur software ka data"], answer: 1, explanation: "Tour Medoro Demo Pharmacy, Ranchi par kaalpanik data ke saath record hua hai. Customer ko yeh saaf bataiye." },
    ],
    product: { prompt: "Medoro ka ek main benefit kaunsa hai jo tour mein bataaya gaya?", options: ["Guaranteed double sales", "Internet band hone par bhi billing", "Free medicines", "Automatic GST filing on portal"], answer: 1, explanation: "Offline billing ek real feature hai. Sales guarantee ya automatic filing jaise claims kabhi mat kijiye." },
  },
  {
    part: 2, slug: "part-02-account-registration", title: "Account Registration",
    objectives: ["Free trial sign-up ka process samjhana", "Login security (two-step) samjhana", "Password reset ka flow jaanna"],
    functions: ["medoro.in par 'Start 7-day free trial', koi card nahi", "Google account ya email se sign-up; email par 6 ankon ka code (10 minute valid)", "Owner/manager ke liye two-step verification (authenticator app), recovery codes", "Forgot password: 15 minute valid reset code; password badalte hi baaki devices sign out", "5 galat password par account kuch der lock; koi default login nahi"],
    problem: "Owner ko darr hota hai ki sign-up mushkil hoga ya card details maangi jaayengi, aur account koi bhi khol lega.",
    benefits: ["Bina card ke 7 din ka trial", "Account par two-step security", "Password bhoolne par khud reset"],
    explain: "Sir, aap medoro.in par 'Start 7-day free trial' dabaiye. Google ya email se sign-up hota hai, koi card nahi maanga jaata. Owner account par two-step verification hota hai, taaki sirf aap hi login kar sakein.",
    qa: [{ q: "Trial ke liye card dena padega?", a: "Nahi, 7 din ka trial bina card ke shuru hota hai." }, { q: "Phone kho gaya to login kaise hoga?", a: "Sign-up par mile recovery codes se; har code ek baar kaam aata hai." }],
    quiz: [
      { prompt: "Email verification code kitni der valid rehta hai?", options: ["1 minute", "10 minute", "24 ghante", "Hamesha"], answer: 1, explanation: "Sign-up code 10 minute tak valid rehta hai." },
      { prompt: "Owner aur manager ke login par kya zaroori hai?", options: ["Sirf PIN", "Two-step verification", "Koi password nahi", "Sirf OTP SMS"], answer: 1, explanation: "Owner/manager accounts par authenticator app se two-step verification zaroori hai." },
    ],
    product: { prompt: "Medoro ka free trial kitne din ka hai?", options: ["3 din", "7 din", "30 din", "Trial nahi hai"], answer: 1, explanation: "7-day free trial, bina card." },
  },
  {
    part: 3, slug: "part-03-pharmacy-onboarding", title: "Pharmacy Onboarding",
    objectives: ["Onboarding ke 6 steps jaanna", "GSTIN, drug licence aur pharmacy code ka matlab samjhana", "Recovery kit ka mahatva samjhana"],
    functions: ["Steps: Pharmacy, Your account, Branches, Team, Backups, Done", "GSTIN format check; drug licence (Form 20B/21B) zaroori kyunki bill par chhapta hai", "Branches aur counters; team invite (manager, pharmacist, cashier, accountant, delivery), invite code 48 ghante", "Recovery kit aur Drive recovery code: Medoro ke paas copy nahi hoti", "Pharmacy code: counter staff code + employee ID + PIN se login"],
    problem: "Naye software ka setup lamba aur confusing lagta hai; galat GSTIN ya licence bill par chhap jaata hai.",
    benefits: ["Step-by-step guided setup", "Galat GSTIN par turant error", "Shuru se hi branches, team aur backup taiyaar"],
    explain: "Sir, setup ek guided wizard hai: pharmacy details, owner account, branches, team aur backup. GSTIN galat ho to software wahi bata deta hai, aur aapki team ke liye invite codes ban jaate hain.",
    qa: [{ q: "Recovery kit kho gayi to Medoro de dega?", a: "Nahi. Recovery kit aur Drive recovery code ki copy Medoro ke paas nahi hoti, isliye inhein offline surakshit rakhna zaroori hai." }, { q: "Staff ko email chahiye?", a: "Counter staff pharmacy code, employee ID aur PIN se login karte hain; manager ko email se invite kiya jaata hai." }],
    quiz: [
      { prompt: "Drug licence number onboarding mein zaroori kyon hai?", options: ["Marketing ke liye", "Yeh har bill par chhapta hai", "WhatsApp ke liye", "Zaroori nahi hai"], answer: 1, explanation: "Form 20B/21B licence number har bill par chhapta hai." },
      { prompt: "Recovery kit ke baare mein sahi baat?", options: ["Medoro support kabhi bhi recover kar dega", "Isse offline surakshit rakhna hai; Medoro ke paas copy nahi", "Yeh public hoti hai", "Iski zaroorat nahi"], answer: 1, explanation: "Data ki key sirf pharmacy ke paas rehti hai." },
    ],
    product: { prompt: "Counter staff Medoro mein kaise login karte hain?", options: ["Owner ka password share karke", "Pharmacy code, employee ID aur PIN se", "Bina login ke", "Sirf Google se"], answer: 1, explanation: "Counter staff ka login pharmacy code + employee ID + PIN hai." },
  },
  {
    part: 4, slug: "part-04-dashboard", title: "Dashboard",
    objectives: ["Dashboard ke KPIs samjhana", "Insights aur alerts ko business problems se jodna", "Demo mein dashboard se shuruaat karna"],
    functions: ["Sales today, gross margin, purchases, expenses, receivables, payables; Today / 7 din / 30 din", "Sales chart aur cash/UPI/card/credit collection", "Insights: jaldi expire hone wala stock, reorder level se neeche medicines", "Low stock, 'Expiring within 90 days', branch performance, aakhri Drive backup ka samay", "Recent activity aur Export"],
    problem: "Owner ko din ke ant tak pata nahi chalta ki aaj kitni bikri hui, kitna udhaar baaki hai aur kya expire hone wala hai.",
    benefits: ["Ek screen par poore business ka haal", "Expiry aur low stock ki pehle se chetavni", "Branch-wise tulna"],
    explain: "Sir, login karte hi ek screen par aaj ki bikri, margin, khareed, kharch aur bakaaya dikh jaata hai. Neeche low stock aur 90 din mein expire hone wale batches bhi, taaki nuksaan se pehle action le sakein.",
    qa: [{ q: "Kya pichhle mahine ka data bhi dekh sakte hain?", a: "Dashboard par Today, 7 din aur 30 din ka view hai; detailed reports 'Reports & GST' mein milti hain." }, { q: "Backup ho raha hai ya nahi kaise pata chalega?", a: "Branch performance ke saath aakhri full Drive copy ka samay dikhta hai." }],
    quiz: [
      { prompt: "Dashboard par 'Receivables' ka matlab?", options: ["Suppliers ko dena", "Customers se lena", "Aaj ka kharch", "GST"], answer: 1, explanation: "Receivables = customers se kitna lena hai; Payables = suppliers ko kitna dena hai." },
      { prompt: "Insights box kya batata hai?", options: ["Mausam", "Jaldi expire hone wala stock aur reorder se neeche medicines", "Doctor ki salaah", "Competitor ki keemat"], answer: 1, explanation: "Insights stock aur expiry ki zaroori baatein batata hai." },
    ],
    product: { prompt: "Dashboard ka 'Expiring within 90 days' kya dikhata hai?", options: ["90 din mein expire hone wale batches, keemat ke saath", "90 din purane bills", "Staff ki chhutti", "GST due date"], answer: 0, explanation: "Woh batches jo 90 din mein expire honge, unki keemat aur bache din." },
  },
  {
    part: 5, slug: "part-05-medicine-management", title: "Medicine Management",
    objectives: ["Medicine master ke fields samjhana", "Salt search aur loose sale samjhana", "Medicine band karne ka sahi tareeka jaanna"],
    functions: ["Stock screen par har medicine: salt, schedule, kul stock, agli expiry, MRP, rack", "Brand, salt ya barcode se search", "Add medicine: naam, salt, MRP, GST, pack size, loose unit, reorder level, rack, barcode, schedule", "Edit karte hi badlaav har counter par; 'In use' hata kar billing se chhupana (record bana rehta hai)", "Batch icon se har batch ki expiry aur stock"],
    problem: "Same salt ki alag brands dhoondhna, rack yaad rakhna aur loose tablet ka hisaab manually mushkil hai.",
    benefits: ["Salt se substitute brand jaldi milti hai", "Loose tablet bikri ka sahi hisaab", "Rack location se medicine jaldi milti hai"],
    explain: "Sir, har medicine ka salt, MRP, GST, rack aur reorder level ek jagah rehta hai. Customer salt bole to us salt ki saari brands turant dikh jaati hain, aur strip ke saath loose tablet bhi bech sakte hain.",
    qa: [{ q: "Purani medicine delete karni ho to?", a: "Delete ki jagah 'In use' ka tick hataiye; woh billing se chhip jaati hai par purana record rehta hai." }, { q: "Stock medicine add karte hi aata hai?", a: "Nahi, batch aur expiry ke saath stock purchase bill (GRN) se aata hai." }],
    quiz: [
      { prompt: "Kisi medicine ko billing se hataane ka sahi tareeka?", options: ["Delete kar dena", "'In use' ka tick hataana", "Naam badal dena", "MRP zero karna"], answer: 1, explanation: "Isse purana record surakshit rehta hai." },
      { prompt: "Salt mein 'Paracetamol' search karne par kya milta hai?", options: ["Sirf ek brand", "Us salt ki saari brands", "Kuch nahi", "Doctor list"], answer: 1, explanation: "Salt search se substitutes jaldi milte hain." },
    ],
    product: { prompt: "Nayi medicine banane ke baad uska stock kahan se aata hai?", options: ["Apne-aap", "Purchase bill (GRN) se, batch aur expiry ke saath", "Dashboard se", "WhatsApp se"], answer: 1, explanation: "Medicine master mein stock zero rehta hai; GRN se batch-wise stock judta hai." },
  },
  {
    part: 6, slug: "part-06-inventory-and-stock", title: "Inventory and Stock",
    objectives: ["FEFO samjhana", "Stock import, adjustment aur count samjhana", "Batch status aur branch transfer jaanna"],
    functions: ["'Low stock only' filter", "Excel/CSV se purani stock list import: preview, galti par kuch save nahi", "FEFO: First Expiry, First Out — sabse pehle expire hone wala batch pehle bikta hai", "Correct stock (kaaran ke saath), stock count se farq auto-adjust", "Branch transfer; batch status OK / Quarantine / Recalled (quarantine/recalled billing mein nahi bikta)"],
    problem: "Expired maal shelf par pada reh jaata hai, purana stock baad mein bikta hai aur nuksaan hota hai.",
    benefits: ["FEFO se expiry ka nuksaan kam", "Purane software se data aasaani se aata hai", "Har adjustment ka kaaran record mein"],
    explain: "Sir, billing par Medoro khud FEFO lagata hai — jo batch pehle expire hoga wahi pehle bikega. Isse expiry ka nuksaan kam hota hai. Purana stock Excel se import ho jaata hai, aur galti ho to kuch save nahi hota.",
    qa: [{ q: "Marg ya doosre software se stock aa jaayega?", a: "Haan, Excel ya CSV export karke import kar sakte hain; har row pehle check hoti hai." }, { q: "Recall wali dava galti se bik jaaye to?", a: "Batch ko Recalled ya Quarantine kar dene par woh billing mein nahi bikta." }],
    quiz: [
      { prompt: "FEFO ka full form?", options: ["First Entry, First Out", "First Expiry, First Out", "Fast Entry For Orders", "Free Expiry For Owners"], answer: 1, explanation: "First Expiry, First Out." },
      { prompt: "Quarantine kiya hua batch?", options: ["Billing mein bikta hai", "Billing mein nahi bikta jab tak OK na karein", "Delete ho jaata hai", "Supplier ko chala jaata hai"], answer: 1, explanation: "Quarantine/Recalled batch bikta nahi." },
    ],
    product: { prompt: "Stock import mein galat row ho to kya hota hai?", options: ["Galat row bhi save ho jaati hai", "Preview mein kaaran dikhta hai aur kuch save nahi hota", "Software band ho jaata hai", "Sirf aadhi file save hoti hai"], answer: 1, explanation: "Medoro tabhi import karta hai jab saari rows sahi hon." },
  },
  {
    part: 7, slug: "part-07-purchase-management", title: "Purchase Management",
    objectives: ["Supplier bill entry aur GRN samjhana", "Free packs/scheme samjhana", "Supplier payment ka flow jaanna"],
    functions: ["Supplier bill: file upload ya haath se entry", "Har line: batch, expiry, packs, free packs, rate, MRP", "Total GST sahit apne-aap; supplier bill se milaakar 'Save bill and add stock' = GRN", "Stock aur supplier bakaaya turant update", "Supplier payment Accounts se: amount, mode, UTR/cheque; claims aur return Supplier tools mein"],
    problem: "Purchase bill ki entry, batch-expiry likhna aur supplier ka udhaar yaad rakhna alag-alag registers mein hota hai.",
    benefits: ["Ek entry se stock aur supplier bakaaya dono update", "Free goods scheme ka sahi hisaab", "Supplier payments ka record"],
    explain: "Sir, distributor ka bill ek baar daaliye — batch, expiry aur free packs ke saath. Save karte hi stock badh jaata hai aur supplier ka bakaaya bhi jud jaata hai. Alag register ki zaroorat nahi.",
    qa: [{ q: "Free scheme wali strips ka kya?", a: "Free packs stock mein judte hain par unka paisa nahi lagta; landed cost sahi nikalti hai." }, { q: "Supplier ko payment kahan se?", a: "Accounts screen ke 'Suppliers to pay' se, mode aur UTR/cheque number ke saath." }],
    quiz: [
      { prompt: "'Save bill and add stock' kya banata hai?", options: ["Sales invoice", "GRN (goods receipt)", "Credit note", "Estimate"], answer: 1, explanation: "Yahi goods receipt (GRN) hai." },
      { prompt: "Free packs ka matlab?", options: ["Expired maal", "Scheme mein mili muft strips jo stock mein judti hain", "Return", "Damaged"], answer: 1, explanation: "Stock mein judti hain, paisa nahi lagta." },
    ],
    product: { prompt: "Purchase bill save karne par kya update hota hai?", options: ["Sirf stock", "Stock aur supplier ka bakaaya dono", "Sirf GST", "Kuch nahi"], answer: 1, explanation: "Stock (naye batch ke saath) aur supplier bakaaya ek saath." },
  },
  {
    part: 8, slug: "part-08-purchase-invoice-import", title: "Purchase Invoice Import",
    objectives: ["E-bill import samjhana", "OCR scanner ki sahi sthiti bataana", "Review step ka mahatva samjhana"],
    functions: ["Distributor ki e-bill file (CSV, Excel, text) seedhe import", "Columns pehchaanna: item, batch, expiry, qty, free qty, rate, MRP, GST", "Har line catalogue ki medicine se match; na mile to jodiye ya nayi banaiye", "Post se pehle review zaroori", "PDF/photo scan wala feature server par OCR engine se chalta hai (setup par nirbhar)"],
    problem: "Har bill haath se type karne mein samay lagta hai aur typing galtiyan hoti hain.",
    benefits: ["Distributor file se tez entry", "Matching se kam galtiyan", "Stock, batch, bakaaya ek saath update"],
    explain: "Sir, zyaadatar distributors e-bill file dete hain. Medoro woh file seedhe padh leta hai, aapki medicines se match karta hai, aur aap review karke save kar dete hain — typing bahut kam ho jaati hai.",
    qa: [{ q: "Photo kheench kar bill aa jaayega?", a: "PDF/photo scan feature OCR engine se chalta hai jo server setup par nirbhar hai; e-bill file import hamesha chalta hai. Promise karne se pehle setup confirm kijiye." }, { q: "Galat match ho gaya to?", a: "Post karne se pehle review screen par har line sahi medicine se jodiye." }],
    quiz: [
      { prompt: "E-bill import kis format ki files padhta hai?", options: ["Sirf PDF", "CSV, Excel ya text", "Sirf photo", "Sirf Word"], answer: 1, explanation: "Distributor e-bill CSV/Excel/text." },
      { prompt: "Bill post karne se pehle kya zaroori hai?", options: ["Kuch nahi", "Har line ka review kaagzi bill se", "Customer ko call", "GST portal login"], answer: 1, explanation: "Review step galtiyan rokta hai." },
    ],
    product: { prompt: "Photo/PDF bill scanning ke baare mein customer ko kya bolna sahi hai?", options: ["Har jagah 100% automatic chalta hai", "Yeh OCR engine setup par nirbhar hai; e-bill file import hamesha chalta hai", "Yeh feature nahi hai", "Iske liye alag app"], answer: 1, explanation: "Tour mein bataaya gaya: OCR engine server par juda ho tabhi scan chalta hai. Over-promise mat kijiye." },
  },
  {
    part: 9, slug: "part-09-billing-and-pos", title: "Billing and POS",
    objectives: ["Keyboard shortcuts yaad rakhna", "Hold, split payment, credit samjhana", "Tax invoice ki details bataana"],
    functions: ["F2 search, Enter se cart, F4 hold, F9 complete", "Brand, salt ya barcode scanner se item; loose tablet; FEFO se batch apne-aap", "Customer mobile se purana customer pehchaan; role ke hisaab se discount ki seema", "Held bills; split payment (cash + UPI/card); credit (limit wale customer)", "Tax invoice: GSTIN, drug licence, batch, expiry, HSN, CGST/SGST; print ya PDF"],
    problem: "Rush ke time billing slow hoti hai, line lagti hai, galat batch ya zyaada discount chala jaata hai.",
    benefits: ["Keyboard se tez billing, line chhoti", "Batch chunne ki zaroorat nahi (FEFO)", "Discount par control"],
    explain: "Sir, billing keyboard se chalti hai — F2 se search, Enter se cart, F9 se bill. Batch Medoro khud FEFO se lagata hai. Rush mein doosra customer aaye to F4 se bill hold kar sakte hain.",
    qa: [{ q: "Staff zyaada discount de dega?", a: "Nahi, discount utna hi jitna role ko allowed hai." }, { q: "Aadha cash aadha UPI ho sakta hai?", a: "Haan, split payment se; invoice par dono alag chhapte hain." }],
    quiz: [
      { prompt: "Bill complete karne ki shortcut key?", options: ["F2", "F4", "F9", "F12"], answer: 2, explanation: "F9 se bill complete; F4 hold; F2 search." },
      { prompt: "Billing par batch kaun chunta hai?", options: ["Cashier har baar", "Medoro FEFO se apne-aap", "Customer", "Supplier"], answer: 1, explanation: "FEFO se sabse pehle expire hone wala batch." },
    ],
    product: { prompt: "Rush mein doosra customer aaye to kya karein?", options: ["Pehla bill delete", "F4 se bill hold karke baad mein Resume", "Software band", "Naya login"], answer: 1, explanation: "Held bills mein bill intezaar karta hai; Resume se cart, customer, discount waapas." },
  },
  {
    part: 10, slug: "part-10-prescription-and-schedule-h-h1", title: "Prescription and Schedule H/H1",
    objectives: ["Schedule H/H1 check samjhana", "H1 register bataana", "Compliance par sahi bhaasha use karna"],
    functions: ["Search mein Sch H / Sch H1 laal label", "H/H1 dava cart mein aate hi Prescription section; bina prescriber details bill nahi banta (bypass nahi)", "Doctor ka naam, registration no., H1 ke liye patient ka naam; invoice par chhapta hai", "Doctors screen aur 'Sales by doctor'", "Schedule H1 register (Books & registers): CSV/print; adhoori line laal"],
    problem: "Schedule H1 register manually likhna mushkil hai aur inspection ke time records adhoore milte hain.",
    benefits: ["Billing par hi prescription details zaroori", "H1 register apne-aap banta hai", "Inspection par CSV/print turant"],
    explain: "Sir, Schedule H ya H1 ki dava par Medoro bina doctor details ke bill nahi banata, aur H1 register apne-aap ban jaata hai jo aap print kar sakte hain. Legal zimmedaari pharmacist ki hi rehti hai — software record rakhne mein madad karta hai.",
    qa: [{ q: "Kya isse hum fully compliant ho jaayenge?", a: "Software record rakhne aur check lagaane mein madad karta hai; legal compliance ki zimmedaari licensed pharmacist aur pharmacy ki rehti hai." }, { q: "Emergency mein check hata sakte hain?", a: "Nahi, yeh check bypass nahi hota." }],
    quiz: [
      { prompt: "Schedule H1 dava par prescriber details na hon to?", options: ["Bill ban jaata hai", "Medoro bill nahi banata", "Discount milta hai", "Warning ke baad ban jaata hai"], answer: 1, explanation: "Check bypass nahi ho sakta." },
      { prompt: "Compliance par sahi statement?", options: ["Medoro legal compliance ki guarantee deta hai", "Medoro record aur check mein madad karta hai; zimmedaari pharmacist ki", "Register ki zaroorat khatam", "Drug inspector nahi aayega"], answer: 1, explanation: "Kabhi compliance guarantee mat kijiye." },
    ],
    product: { prompt: "Schedule H1 register Medoro mein kahan milta hai?", options: ["Dashboard", "Books & registers", "WhatsApp", "Subscription"], answer: 1, explanation: "Books & registers mein, CSV aur print ke saath." },
  },
  {
    part: 11, slug: "part-11-customer-management", title: "Customer Management",
    objectives: ["Credit limit aur udhaar vasooli samjhana", "WhatsApp consent ka niyam jaanna", "Customer statement bataana"],
    functions: ["Customers list bakaaya ke saath; naam/mobile search", "Add customer: naam, mobile, GSTIN (business), credit limit", "WhatsApp offers ke liye consent tick (record mein, kabhi bhi hataaya ja sakta hai)", "Receive (cash/UPI/card), Remind (WhatsApp), Pay link", "Customer statement: har bill, vasooli, credit note, chaalu bakaaya; CSV/print"],
    problem: "Udhaar diary mein likha jaata hai, bhool jaate hain, aur customer se hisaab par jhagda hota hai.",
    benefits: ["Udhaar ki seema tay", "Ek click mein reminder", "Saaf statement, koi uljhan nahi"],
    explain: "Sir, har customer ka udhaar aur credit limit software mein rehta hai. Bakaaya ho to WhatsApp reminder bhej sakte hain, aur statement print karke dene se hisaab mein koi jhagda nahi hota.",
    qa: [{ q: "Sabko offers bhej denge?", a: "Nahi, sirf un customers ko jinhone consent diya hai." }, { q: "Partial payment ho sakta hai?", a: "Haan, Receive se koi bhi amount; bakaaya turant ghatta hai." }],
    quiz: [
      { prompt: "Credit limit kya tay karti hai?", options: ["Discount", "Customer adhiktam kitna udhaar le sakta hai", "GST rate", "Points"], answer: 1, explanation: "Credit limit = adhiktam udhaar." },
      { prompt: "WhatsApp offers kisko ja sakte hain?", options: ["Sabko", "Sirf consent dene wale customers ko", "Sirf naye customers", "Doctors ko"], answer: 1, explanation: "Consent zaroori hai aur record hota hai." },
    ],
    product: { prompt: "Customer ka poora hisaab kahan dikhta hai?", options: ["Customer statement (Books & registers)", "Login page", "Backup screen", "Language settings"], answer: 0, explanation: "Statement mein har bill, vasooli aur chaalu bakaaya." },
  },
  {
    part: 12, slug: "part-12-sales-returns", title: "Sales Returns",
    objectives: ["Return aur credit note ka flow samjhana", "Sealed vs damaged samjhana", "Day-end summary jaanna"],
    functions: ["'Bills & day-end' par invoice/naam/mobile se bill dhoondhna", "Return: har line par utni hi maatra jitni biki, usi batch ki", "Condition Sealed = stock waapas; Damaged = stock mein nahi", "Refund: cash, UPI ya customer account credit; GST samet apne-aap", "Credit note; bill kabhi edit/delete nahi; day-end summary print"],
    problem: "Returns ka hisaab gadbad hota hai — stock waapas aaya ya nahi, refund kitna gaya, pata nahi chalta.",
    benefits: ["Sahi batch aur maatra ka return", "Stock aur refund apne-aap sahi", "Saaf itihaas: bill badla nahi jaata"],
    explain: "Sir, customer dava waapas kare to bill dhoondh kar Return dabaiye. Sealed dava stock mein waapas jaati hai, refund GST samet apne-aap nikalta hai aur credit note ban jaata hai. Purana bill kabhi badla nahi jaata.",
    qa: [{ q: "Zyaada maatra waapas le sakte hain?", a: "Nahi, utni hi jitni us bill mein biki thi." }, { q: "Toota hua pack?", a: "Damaged chunein; woh stock mein nahi judta." }],
    quiz: [
      { prompt: "Return mein 'Damaged' chunne par?", options: ["Stock mein judta hai", "Stock mein nahi judta", "Bill delete", "Supplier ko auto return"], answer: 1, explanation: "Sirf Sealed stock mein waapas jaata hai." },
      { prompt: "Return par asli bill ka kya hota hai?", options: ["Edit hota hai", "Delete hota hai", "Waisa hi rehta hai; credit note banta hai", "Gayab"], answer: 2, explanation: "Bill kabhi edit/delete nahi hota." },
    ],
    product: { prompt: "Return ke baad kya banta hai?", options: ["Credit note", "Purchase order", "Estimate", "GRN"], answer: 0, explanation: "Credit note: stock waapas, refund darj." },
  },
  {
    part: 13, slug: "part-13-supplier-management", title: "Supplier Management",
    objectives: ["Supplier bakaaya aur payments samjhana", "Pricing comparison aur claims jaanna", "Supplier statement bataana"],
    functions: ["'Suppliers to pay' mein har supplier ka bakaaya", "Payment: amount, mode (cash, bank, cheque), UTR/cheque no.; payment voucher", "Pricing tab: medicine ki supplier-wise khareed dar, landed cost, margin", "Claims tab: near-expiry return / credit note ka hisaab", "Cheques screen aur Supplier statement"],
    problem: "Kis supplier ko kitna dena hai aur kaun sasta hai, yeh yaad rakhna mushkil hai; expiry claims chhoot jaate hain.",
    benefits: ["Sasta supplier pehchaanna", "Expiry claims ka record", "Supplier se hisaab milaana aasaan"],
    explain: "Sir, Medoro dikhata hai ki har supplier ko kitna dena hai, aur Pricing tab mein kaunsa supplier kis medicine par sasta hai. Near-expiry maal ke claims ka hisaab bhi alag rehta hai.",
    qa: [{ q: "Post-dated cheque ka record?", a: "Cheques screen par, taaki clearing ki taareekh yaad rahe." }, { q: "Supplier se ledger milaana?", a: "Books & registers mein Supplier statement se." }],
    quiz: [
      { prompt: "Pricing tab kya dikhata hai?", options: ["Customer ka udhaar", "Supplier-wise khareed dar aur margin", "Staff salary", "GST portal"], answer: 1, explanation: "Sabse sasta supplier pehle, landed cost ke saath." },
      { prompt: "Near-expiry maal ka hisaab kahan?", options: ["Claims tab", "Dashboard", "Language", "Login"], answer: 0, explanation: "Claims tab mein claim aur credit ka record." },
    ],
    product: { prompt: "Supplier payment karne par kya banta hai?", options: ["Payment voucher aur bakaaya kam", "Sales invoice", "Credit note customer ko", "Kuch nahi"], answer: 0, explanation: "Payment voucher banta hai aur bakaaya ghatta hai." },
  },
  {
    part: 14, slug: "part-14-accounts-and-expenses", title: "Accounts and Expenses",
    objectives: ["Expense entry aur cash book samjhana", "P&L, trial balance, day book jaanna", "Jo report nahi hai woh bhi imaandari se bataana"],
    functions: ["Expense categories: kiraaya, tankhwaah, bijli, internet, transport, marammat, stationery, bank charges", "Cash book: In, Out, Net", "UPI & Bank: statement upload, credits ko bills/payments se match", "Sales and profit report; Day book, Trial balance, Profit & loss", "Cash flow ki alag report abhi nahi (cash book/day book mein dikhta hai)"],
    problem: "Kharch aur munafa ka sahi pata saal ke ant mein CA ke paas jaakar hi chalta hai.",
    benefits: ["Roz ka hisaab software mein", "Kisi bhi avadhi ka P&L", "Bank aur UPI ka milaan"],
    explain: "Sir, roz ke kharch ek click mein darj hote hain aur cash book apne-aap banti hai. Profit & loss kisi bhi taareekh ke liye dekh sakte hain, aur UPI ki entries bank statement se match ho jaati hain.",
    qa: [{ q: "Cash flow statement milega?", a: "Alag cash flow report abhi nahi hai; paise ka aana-jaana cash book aur day book mein dikhta hai." }, { q: "Accountant ko kya denge?", a: "Sales and profit CSV aur Books & registers ki reports." }],
    quiz: [
      { prompt: "Trial balance par 'Balanced' ka matlab?", options: ["Profit hua", "Naame aur jama ka jod barabar", "GST bhara", "Stock poora"], answer: 1, explanation: "Dono taraf ka jod barabar." },
      { prompt: "Cash flow report ke baare mein sahi baat?", options: ["Poori report hai", "Alag report abhi nahi; cash book/day book mein dikhta hai", "Sirf Multi-branch mein", "Tally mein hi"], answer: 1, explanation: "Tour mein yeh saaf kaha gaya hai — jo nahi hai woh promise nahi karna." },
    ],
    product: { prompt: "Bank statement upload karne par Medoro kya karta hai?", options: ["Bank account kholta hai", "UPI/bank credits ko bills aur payments se match karta hai", "Loan deta hai", "GST file karta hai"], answer: 1, explanation: "Jo match na ho, woh alag dikhata hai." },
  },
  {
    part: 15, slug: "part-15-gst-and-tax", title: "GST and Tax",
    objectives: ["MRP mein GST ka hisaab samjhana", "GSTR-1, GSTR-3B exports jaanna", "CA review wali line hamesha bolna"],
    functions: ["MRP se taxable value; state ke andar CGST + SGST, doosre state ke GST customer par IGST", "HSN code aur GST rate medicine master mein", "GSTR-1 (B2B, B2C, HSN summary) JSON offline tool ke liye; HSN CSV", "GSTR-3B JSON aur CSV", "Tally Prime XML export (masters + vouchers)"],
    problem: "Mahine ke ant mein GST data ikattha karna aur CA ko dena samay leta hai.",
    benefits: ["Bills se apne-aap GST reports", "CA ke liye JSON/CSV/Tally export", "HSN summary taiyaar"],
    explain: "Sir, Medoro aapke bills se GSTR-1 aur GSTR-3B ka data aur HSN summary bana deta hai, aur Tally ke liye export bhi deta hai. Yeh reports filing mein madad ke liye hain — file karne se pehle apne CA se zaroor check karvaiye.",
    qa: [{ q: "Kya Medoro GST return file kar deta hai?", a: "Nahi. Medoro reports aur JSON banata hai; filing GST portal par hoti hai aur CA ka review zaroori hai." }, { q: "Hamara CA Tally use karta hai.", a: "Books & registers se Tally Prime XML export hota hai." }],
    quiz: [
      { prompt: "Medicine ki MRP mein GST?", options: ["Alag se judta hai", "Pehle se shaamil hota hai", "Lagta hi nahi", "Customer chunta hai"], answer: 1, explanation: "Medoro MRP se taxable value back-calculate karta hai." },
      { prompt: "GST reports ke baare mein customer ko kya bolna hai?", options: ["100% sahi, CA ki zaroorat nahi", "Filing mein madad ke liye; CA se check karvaiye", "Automatic filing hoti hai", "Government approved"], answer: 1, explanation: "Hamesha CA review ki baat kijiye." },
    ],
    product: { prompt: "Doosre state ke GST registered customer ki bikri par kaunsa tax?", options: ["CGST + SGST", "IGST", "Koi nahi", "VAT"], answer: 1, explanation: "Inter-state par IGST." },
  },
  {
    part: 16, slug: "part-16-whatsapp-integration", title: "WhatsApp Integration",
    objectives: ["WhatsApp linking samjhana", "Consent aur STOP ka niyam jaanna", "Refill reminder ki seema samjhana"],
    functions: ["Pharmacy ka apna WhatsApp number QR se link (WhatsApp Web ki tarah)", "'Auto-send after sale' sirf consent wale customers ko; invoice PDF attach", "Sent / Delivered / Read / Failed log", "Refill reminders (customer kitne din mein dava leta hai, bas usi par), feedback, payment reminders", "Customer STOP likhkar opt-out"],
    problem: "Bill ki photo bhejna, udhaar yaad dilaana aur refill ke liye call karna manually hota hai.",
    benefits: ["Bill seedha WhatsApp par", "Refill aur payment reminders", "Delivery status ka record"],
    explain: "Sir, aap apna WhatsApp number QR se jodte hain, phir bill sale ke baad apne-aap customer ko ja sakta hai — sirf unhe jinhone haan kaha hai. Refill aur payment reminders bhi bhej sakte hain.",
    qa: [{ q: "Kya hum sabko promotional message bhej sakte hain?", a: "Sirf consent wale customers ko; STOP likhne par promotional message band." }, { q: "Refill reminder beemaari dekh kar jaata hai?", a: "Nahi, sirf is par ki customer dava kitne din mein dobara leta hai; Medoro beemaari ka andaaza nahi lagaata." }],
    quiz: [
      { prompt: "WhatsApp number kaise judta hai?", options: ["SMS se", "QR code scan karke, WhatsApp Web jaisa", "Email se", "Judta nahi"], answer: 1, explanation: "QR se pharmacy ka apna number." },
      { prompt: "Customer STOP likhe to?", options: ["Kuch nahi", "Use promotional message nahi jaata", "Account delete", "Bill cancel"], answer: 1, explanation: "Opt-out ka samman hota hai." },
    ],
    product: { prompt: "'Auto-send after sale' kisko bill bhejta hai?", options: ["Sab customers ko", "Sirf jinki WhatsApp consent darj hai", "Supplier ko", "Doctor ko"], answer: 1, explanation: "Consent ke bina nahi." },
  },
  {
    part: 17, slug: "part-17-ai-assistant", title: "AI Assistant",
    objectives: ["AI assistant ke sawaal-jawaab samjhana", "Seema bataana: doctor nahi", "Profit data sirf owner ko"],
    functions: ["Ask screen: English, Hindi, Hinglish mein sawaal", "Aaj ki sale, low stock, expiring batches, mahine ka profit", "Jawaab pharmacy ke apne data se, built-in rules se; internet ke bina bhi", "Har jawaab ke neeche data ka source", "Medicine ya ilaaj ki salaah nahi deta; profit owner ko"],
    problem: "Owner ko chhote sawaalon ke liye reports kholni padti hain.",
    benefits: ["Seedhi bhaasha mein sawaal", "Turant jawaab apne data se", "Hindi mein bhi"],
    explain: "Sir, aap Hindi ya Hinglish mein poochh sakte hain — 'Aaj ki total sale kitni hai?' — aur jawaab aapke apne data se aata hai. Yeh dava ki salaah nahi deta; sirf business ke sawaal.",
    qa: [{ q: "Kya AI dava suggest karega?", a: "Nahi. Medoro ka AI doctor nahi hai; clinical salaah nahi deta." }, { q: "Kya data internet par jaata hai?", a: "Default built-in rules isi data par chalte hain; remote AI owner ke opt-in par hi, aur strict mode mein kabhi nahi." }],
    quiz: [
      { prompt: "AI assistant kya nahi karta?", options: ["Aaj ki sale batana", "Low stock batana", "Dava ya ilaaj ki salaah", "Expiring batches batana"], answer: 2, explanation: "Clinical salaah nahi." },
      { prompt: "AI jawaab ke neeche kya likha hota hai?", options: ["Advertisement", "Kis data se jawaab bana", "Doctor ka naam", "Kuch nahi"], answer: 1, explanation: "Source dikhta hai, taaki owner khud check kar sake." },
    ],
    product: { prompt: "AI assistant kis bhaasha mein sawaal samajhta hai?", options: ["Sirf English", "English, Hindi aur Hinglish", "Sirf Hindi", "Koi nahi"], answer: 1, explanation: "Tour mein teeno dikhaye gaye." },
  },
  {
    part: 18, slug: "part-18-offline-billing", title: "Offline Billing",
    objectives: ["Offline billing kaise chalti hai samjhana", "Sync aur 'Changes waiting' jaanna", "Conflict ki imaandar jaankari"],
    functions: ["Counter device par apna database; internet band par bhi billing", "Counter PIN se offline counter khulta hai", "Offline bill device par save; 'Changes waiting' badhta hai", "Internet aate hi 'Sync now' ya apne-aap encrypted upload", "Do counters ne offline ek hi batch becha ho to stock minus dikh sakta hai; stock count se theek; bills kabhi badalte nahi"],
    problem: "Internet jaate hi billing ruk jaati hai aur customers waapas chale jaate hain.",
    benefits: ["Net band ho tab bhi bikri chalu", "Wapas aate hi sync", "Koi bill nahi khota"],
    explain: "Sir, internet chala jaaye tab bhi Medoro par billing chalti rehti hai. Bills isi device par save hote hain aur net aate hi apne-aap sync ho jaate hain.",
    qa: [{ q: "Har plan mein offline billing hai?", a: "Plans page ke hisaab se offline billing Professional aur Multi-branch mein hai; trial mein sab features khule hote hain. Current plan details confirm kijiye." }, { q: "Do counter offline the to?", a: "Ek hi batch dono ne becha ho to sync ke baad minus dikh sakta hai; stock count se theek hota hai." }],
    quiz: [
      { prompt: "Offline counter kis se khulta hai?", options: ["Counter PIN", "Google login", "OTP", "Bina kuch"], answer: 0, explanation: "Counter PIN set kiya jaata hai." },
      { prompt: "'Changes waiting' ka matlab?", options: ["Error", "Badlaav upload hone ka intezaar", "Bill delete", "Plan expire"], answer: 1, explanation: "Net aate hi sync ho jaata hai." },
    ],
    product: { prompt: "Internet band hone par Medoro counter par kya hota hai?", options: ["Billing band", "Billing chalti rehti hai, bills device par save", "Data delete", "Sirf view"], answer: 1, explanation: "Offline billing, phir sync." },
  },
  {
    part: 19, slug: "part-19-branches-and-counters", title: "Branches and Counters",
    objectives: ["Multi-branch setup samjhana", "Owner view jaanna", "Transfers ka record bataana"],
    functions: ["'Users & branches' se branches aur counters", "Branch switcher se kisi branch ka data", "Staff branch ke hisaab se", "Stock transfer aur 'Branches & transfers' record", "Owner view: har branch ki aaj/kal ki bikri, drawer cash, low stock, expiry; phone par bhi"],
    problem: "Kai branches wale owner ko har branch jaakar ya call karke haal poochhna padta hai.",
    benefits: ["Sab branches ek jagah", "Branch-wise tulna", "Transfer ka record"],
    explain: "Sir, aap saari branches ek account mein dekh sakte hain. Owner view phone par bhi chalta hai — har branch ki bikri, cash aur low stock ek nazar mein.",
    qa: [{ q: "Kitni branches jod sakte hain?", a: "Plan par nirbhar: Multi-branch plan mein 5 branches (add-on se zyaada)." }, { q: "Ek branch se doosri mein maal?", a: "Inventory se stock transfer; record 'Branches & transfers' mein." }],
    quiz: [
      { prompt: "Sab branches ka saath view kahan?", options: ["Owner view", "Login page", "Language", "Backup"], answer: 0, explanation: "Owner view phone par bhi." },
      { prompt: "Branches kahan se manage hoti hain?", options: ["Users & branches", "WhatsApp", "Ask AI", "GST"], answer: 0, explanation: "Users & branches screen." },
    ],
    product: { prompt: "Multi-branch plan mein kitni branches tak?", options: ["1", "5 (add-on se zyaada)", "Unlimited", "2"], answer: 1, explanation: "Plans: 5 branches, 15 counters, 25 users; extra-branch add-on." },
  },
  {
    part: 20, slug: "part-20-staff-and-users", title: "Staff and Users",
    objectives: ["Roles aur permissions samjhana", "'View as' aur audit trail bataana", "Login security jaanna"],
    functions: ["Users: role, branch, two-step sthiti, last active", "Add employee: naam, role, branch; counter staff PIN se", "Roles: Owner, Manager, Pharmacist, Cashier, Accountant, Delivery; discount seema role se", "'View as' se role ki screen dekhna", "Audit trail (mitaaya nahi ja sakta), Activity screen, sessions sign-out"],
    problem: "Owner ko darr hota hai ki staff galat discount, return ya chori kar sakta hai aur pata nahi chalega.",
    benefits: ["Har role ko sirf zaroori adhikaar", "Kisne kya kiya ka record", "Discount par control"],
    explain: "Sir, har staff ka role alag hota hai — cashier bill bana sakta hai par purchase ya report nahi dekh sakta. Audit trail mein har zaroori kaam ka record rehta hai jo mitaaya nahi ja sakta.",
    qa: [{ q: "Cashier profit dekh sakta hai?", a: "Default permissions mein nahi; role ke hisaab se adhikaar tay hote hain." }, { q: "Staff ne kya kiya kaise pata chale?", a: "Audit trail aur Activity screen mein." }],
    quiz: [
      { prompt: "'View as Cashier' kya karta hai?", options: ["Cashier ka password badalta hai", "Owner ko dikhata hai ki cashier ko screen kaisi dikhti hai", "Cashier ko delete", "Bill banata hai"], answer: 1, explanation: "Sirf preview, narrows only." },
      { prompt: "Audit trail ke baare mein sahi?", options: ["Owner mita sakta hai", "Mitaaya nahi ja sakta", "Roz delete hota hai", "Sirf cashier dekhta hai"], answer: 1, explanation: "Append-only record." },
    ],
    product: { prompt: "Discount ki seema kis se tay hoti hai?", options: ["Customer", "Role se", "Supplier", "Mausam"], answer: 1, explanation: "Role-based discount caps." },
  },
  {
    part: 21, slug: "part-21-backup-and-data-security", title: "Backup and Data Security",
    objectives: ["Data ownership samjhana", "Restore ka process jaanna", "Security par sirf sahi claims karna"],
    functions: ["Bills, stock, customers counters par aur pharmacy ke apne Google Drive mein, pharmacy ki key se encrypted", "Har badlaav kuch seconds mein Drive mein; samay-samay par poori copy (hidden app data)", "Restore: Drive recovery code se naya counter sab waapas le aata hai", "Privacy & data: strict mode (mobile numbers sirf owner/manager ko), export with reason", "Poora data export, customer data erasure, Integration health"],
    problem: "Owner ko darr hai ki computer kharab hua to data gaya, ya software company data dekh legi.",
    benefits: ["Data pharmacy ka apna", "Device kharab ho to restore", "Customer privacy controls"],
    explain: "Sir, aapka data aapke counters par aur aapke apne Google Drive mein encrypted rehta hai, us key se jo sirf aapke paas hai. Computer kharab ho jaaye to recovery code se sab waapas aa jaata hai.",
    qa: [{ q: "Kya Medoro hamara data dekh sakta hai?", a: "Drive wale setup mein data pharmacy ki key se encrypted rehta hai; Medoro ke paas account aur devices ki list rehti hai. '100% unhackable' jaisa claim mat kijiye." }, { q: "Recovery code kho gaya?", a: "Medoro use recover nahi kar sakta — isliye offline surakshit rakhna zaroori hai." }],
    quiz: [
      { prompt: "Pharmacy data kahan rehta hai (Drive setup)?", options: ["Medoro ke public server par khula", "Counters par aur pharmacy ke apne Google Drive mein, encrypted", "WhatsApp par", "Kahin nahi"], answer: 1, explanation: "Pharmacy ki key se encrypted." },
      { prompt: "Security par kaunsa claim galat hai?", options: ["Data encrypted rehta hai", "Recovery code se restore", "100% unhackable, kabhi kuch nahi hoga", "Strict mode mein mobile number masked"], answer: 2, explanation: "Absolute security ka claim kabhi mat kijiye." },
    ],
    product: { prompt: "Naya counter purana data kaise waapas laata hai?", options: ["Drive recovery code se", "Customer se poochh kar", "Data waapas nahi aata", "Supplier se"], answer: 0, explanation: "Restore recovery code se." },
  },
  {
    part: 22, slug: "part-22-reports-and-analytics", title: "Reports and Analytics",
    objectives: ["Main reports kahan hain jaanna", "Insights (forecast, dead stock) samjhana", "Anomalies ko sahi shabdon mein bataana"],
    functions: ["Sales and profit (From–To), CSV", "Best sellers, 'Expiring in 90 days'", "Insights: forecast, reorder salaah, dead stock, stock value, margins", "Audit anomalies: raat ke bills, zyaada discount, bahut refunds (sanket, saboot nahi)", "Books & registers: P&L, trial balance, day book, statements, H1 register, Tally export"],
    problem: "Kaunsi dava achhi bik rahi hai, kaunsa maal pada hai aur kahan paisa atka hai, pata nahi chalta.",
    benefits: ["Dead stock pehchaanna", "Sahi reorder", "Galat kaam ke sanket owner ko"],
    explain: "Sir, reports se pata chalta hai ki kaunsi medicine sabse zyaada bikti hai, kaunsa maal pada hai aur kitna stock kis keemat ka hai. Owner ko raat ke bills ya zyaada discount jaise sanket bhi milte hain.",
    qa: [{ q: "Anomaly ka matlab staff chor hai?", a: "Nahi, yeh sirf jaanchne laayak sanket hain, saboot nahi." }, { q: "Report Excel mein?", a: "CSV download hota hai jo Excel mein khulta hai." }],
    quiz: [
      { prompt: "Audit anomalies kya hain?", options: ["Galti ka saboot", "Jaanchne laayak sanket", "GST error", "Backup"], answer: 1, explanation: "Saboot nahi, sanket." },
      { prompt: "Dead stock kahan dikhta hai?", options: ["Insights", "Login", "Language", "WhatsApp"], answer: 0, explanation: "Insights mein slow/dead stock." },
    ],
    product: { prompt: "Sales and profit report ko CA ko kaise denge?", options: ["CSV download", "Photo", "Fax", "Nahi de sakte"], answer: 0, explanation: "CSV button se." },
  },
  {
    part: 23, slug: "part-23-subscription-and-plans", title: "Subscription and Plans",
    objectives: ["Plans ki tulna karna", "Trial aur payment ka flow jaanna", "Price par sirf approved jaankari dena"],
    functions: ["7 din free trial bina card", "Plans aur keematein medoro.in Pricing par (live)", "Plans: Starter, Professional, Multi-branch — branches, counters, users, add-ons", "App mein Subscription screen: plan, kya shaamil, payments, Medoro invoices", "'Renew or pay' se UPI/card; cancel par data pharmacy ke Drive mein rehta hai"],
    problem: "Owner confuse rehta hai ki kaunsa plan le, aur chhupe charges ka darr hota hai.",
    benefits: ["Dukaan ke size ke hisaab se plan", "Bina card trial", "Saaf invoices"],
    explain: "Sir, pehle 7 din free trial lijiye, koi card nahi. Phir apni dukaan ke size ke hisaab se Starter, Professional ya Multi-branch chuniye — current keematein medoro.in/pricing par hain.",
    qa: [{ q: "Discount milega?", a: "Sirf HR/management dwara approved offer hi bataiye; apne se koi discount promise mat kijiye." }, { q: "Cancel karne par data?", a: "Data pharmacy ke apne Google Drive mein pharmacy ke paas hi rehta hai." }],
    quiz: [
      { prompt: "Price batate waqt sahi tareeka?", options: ["Apne andaaze se discount", "Sirf live pricing page / approved offer", "Competitor se kam bol dena", "Free bol dena"], answer: 1, explanation: "Unapproved price ya discount kabhi nahi." },
      { prompt: "Plans ki tulna kis aadhar par?", options: ["Branches, counters, users aur features", "Rang", "Customer ka naam", "Mausam"], answer: 0, explanation: "Plan limits aur features." },
    ],
    product: { prompt: "Starter plan mein kitni branches/counters/users?", options: ["1 / 2 / 3", "5 / 15 / 25", "Unlimited", "1 / 5 / 10"], answer: 0, explanation: "Starter: 1 branch, 2 counters, 3 users. Professional: 1/5/10. Multi-branch: 5/15/25." },
  },
  {
    part: 24, slug: "part-24-language-settings", title: "Language Settings",
    objectives: ["Hindi switch dikhana", "Per-user language samjhana"],
    functions: ["Upar EN / Hindi switch", "Sidebar, dashboard, buttons, messages Hindi mein; medicine naam waise hi", "Billing screen Hindi mein", "Har user apni bhaasha alag chun sakta hai", "Ask screen par Hindi/Hinglish sawaal"],
    problem: "Staff English software se ghabraata hai aur galtiyan karta hai.",
    benefits: ["Staff apni bhaasha mein kaam kare", "Training jaldi", "Galtiyan kam"],
    explain: "Sir, ek click mein poora software Hindi mein ho jaata hai. Har staff apni pasand ki bhaasha chun sakta hai, isliye jo English mein comfortable nahi, woh bhi aasaani se billing kar leta hai.",
    qa: [{ q: "Medicine ke naam bhi Hindi mein?", a: "Nahi, medicines ke naam aur bill ki zaroori jaankari waisi hi rehti hai." }, { q: "Ek user Hindi, doosra English?", a: "Haan, pasand har user ke account par yaad rehti hai." }],
    quiz: [
      { prompt: "Language switch ka asar?", options: ["Sab users par zabardasti", "Har user ki apni pasand", "Sirf owner", "Kuch nahi"], answer: 1, explanation: "Per-user setting." },
      { prompt: "Hindi mode mein medicine naam?", options: ["Hindi mein translate", "Waise hi rehte hain", "Gayab", "Code mein"], answer: 1, explanation: "Naam aur zaroori bill jaankari waisi hi." },
    ],
    product: { prompt: "Medoro interface kin bhaashaon mein hai?", options: ["English aur Hindi", "Sirf English", "Sirf Tamil", "10 bhaashaayein"], answer: 0, explanation: "EN / हिंदी switch." },
  },
  {
    part: 25, slug: "part-25-a-complete-pharmacy-day", title: "A Complete Pharmacy Day",
    objectives: ["Poore din ka workflow ek kahani mein bataana", "Demo ko customer ke din se jodna"],
    functions: ["Subah: dashboard par kal ki bikri, bakaaya, low stock, expiry", "Stock check", "11 baje supplier bill → GRN → stock badha", "Dopahar: search, customer mobile, UPI, F9; invoice print/WhatsApp; stock ghata", "Shaam: return/refund; day-end; P&L; reports accountant ko"],
    problem: "Owner ko lagta hai software sirf billing ke liye hai; poore din mein kaise madad karega, samajh nahi aata.",
    benefits: ["Subah se shaam tak ek hi system", "Har kaam ka record", "Din ke ant mein saaf hisaab"],
    explain: "Sir, socho aapka poora din: subah dashboard, 11 baje maal aaya to bill entry, dopahar billing, shaam ko return aur din ke ant mein munafa — sab ek hi software mein.",
    qa: [{ q: "Itna sab seekhne mein kitna time lagega?", a: "Billing keyboard se simple hai; demo dekh kar aur trial mein try karke dekhiye — koi time guarantee mat kijiye." }, { q: "Day-end mein kya milta hai?", a: "Bills, cash, UPI, card, returns aur drawer mein kitna cash hona chahiye." }],
    quiz: [
      { prompt: "Supplier bill save karne par din mein kya hua?", options: ["Stock badha (GRN)", "Customer ko refund", "Plan renew", "Language badli"], answer: 0, explanation: "GRN se stock badhta hai." },
      { prompt: "Din ke ant mein owner kya dekhta hai?", options: ["Day-end aur P&L", "Sirf login", "Kuch nahi", "Doctor list"], answer: 0, explanation: "Day-end aur Books mein P&L." },
    ],
    product: { prompt: "'Complete Pharmacy Day' demo mein bikri ke baad stock?", options: ["Apne-aap ghat gaya", "Manually ghataana pada", "Badh gaya", "Waisa hi"], answer: 0, explanation: "Billing se stock apne-aap ghatta hai." },
  },
  {
    part: 26, slug: "part-26-conclusion", title: "Conclusion",
    objectives: ["Poore product ko 30 second mein summarize karna", "Next step (trial / demo) maangna"],
    functions: ["Billing, inventory, purchase, GST, accounts, AI ek jagah, Hindi aur English", "Tez billing, FEFO, GST reports, bakaaye par nazar", "Data pharmacy ke apne Google Drive mein", "medoro.in par 'Start 7-day free trial', koi card nahi", "'Book a demo' se WhatsApp par Medoro team"],
    problem: "Customer ko itni jaankari ke baad clear next step chahiye.",
    benefits: ["Ek line ka saaf summary", "Bina risk trial", "Live demo ka vikalp"],
    explain: "Sir, short mein: tez billing, FEFO se kam expiry nuksaan, GST reports CA ke liye, bakaaye par nazar, aur data aapke apne Drive mein. Aaj hi 7 din ka free trial shuru karein ya main aapke liye demo book kar doon?",
    qa: [{ q: "Pehle demo dekhna hai.", a: "'Book a demo' se WhatsApp par team se baat, ya aapke saath live demo schedule." }, { q: "Trial ke baad kya hoga?", a: "Plan chunkar renew; trial apne-aap paid nahi hota (plans never renew on their own)." }],
    quiz: [
      { prompt: "Conversation ka sahi ant?", options: ["'Theek hai, bye'", "Clear next step: trial ya demo booking", "Price ladaai", "Customer ko pressure"], answer: 1, explanation: "Hamesha next step maangiye." },
      { prompt: "Trial shuru karne ka raasta?", options: ["medoro.in par 'Start 7-day free trial'", "Bank jaana", "Card dena", "Office aana"], answer: 0, explanation: "Online, bina card." },
    ],
    product: { prompt: "Customer demo chahta hai — official raasta?", options: ["'Book a demo' (WhatsApp par Medoro team) ya live demo schedule", "Mana kar dena", "Apna personal software dikhana", "Kal dekhenge"], answer: 0, explanation: "Tour ke ant mein yahi bataaya gaya." },
  },
];

/** The 26 chapters as lessons with the official tour part as their video. Durations and timestamps come from the tour itself. */
export function tourLessons(): { lessons: CourseLesson[]; product: (Q & { lessonSlug: string })[] } {
  const tour = TOUR_VIDEOS.find((v) => v.slug === "complete-product-tour")!;
  const lessons = C.map((c): CourseLesson => {
    const part = TOUR_VIDEOS.find((v) => v.slug === c.slug);
    const seconds = part?.seconds ?? 0, startsAt = tour.chapters[c.part - 1]?.at ?? 0;
    const slug = `tour-${String(c.part).padStart(2, "0")}`;
    return {
      slug, title: `${String(c.part).padStart(2, "0")}. ${c.title}`,
      summary: `Official product tour, part ${c.part} of 26 (starts at ${Math.floor(startsAt / 60)}:${String(startsAt % 60).padStart(2, "0")} in the complete tour). Demo pharmacy with made-up data.`,
      durationMin: Math.max(2, Math.ceil(seconds / 60) + 3), mandatory: true,
      video: { kind: "official", ref: c.slug },
      transcript: (TOUR_SUBTITLES[c.part] ?? []).join("\n\n"),
      slides: [
        { title: `${c.title}: kya seekhenge`, bullets: c.objectives, narration: `Is chapter mein hum ${c.title} dekhenge. ${c.objectives.join(". ")}.` },
        { title: "Software kya karta hai", bullets: c.functions, narration: c.functions.join(". ") + "." },
        { title: "Pharmacy ki problem", bullets: [c.problem], narration: c.problem },
        { title: "Customer ko fayda", bullets: c.benefits, narration: c.benefits.join(". ") + "." },
        { title: "Customer ko aise samjhaiye", bullets: [c.explain], narration: c.explain },
        { title: "Customer ke sawaal", bullets: c.qa.map((x) => `${x.q} → ${x.a}`), narration: c.qa.map((x) => `Agar customer poochhe: ${x.q} Jawaab: ${x.a}`).join(" ") },
      ],
      content: {
        objectives: c.objectives, qa: c.qa, takeaways: c.benefits,
        chapter: { part: c.part, startsAt, seconds, functions: c.functions, problem: c.problem, benefits: c.benefits, explain: c.explain },
        keyPoints: ["Tour demo server par kaalpanik data ke saath record hua hai: customer ko demo data aur asli data ka farq saaf bataiye.", ...c.functions.slice(0, 2)],
      },
      quiz: c.quiz.map((q) => ({ ...q, area: "product" as const })),
    };
  });
  const product = C.map((c) => ({ ...c.product, area: "product" as const, lessonSlug: `tour-${String(c.part).padStart(2, "0")}` }));
  return { lessons, product };
}
export const TOUR_CHAPTER_COUNT = C.length;
