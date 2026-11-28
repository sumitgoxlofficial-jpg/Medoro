// The annexures that go with an offer of employment: the Indian law that applies to the employment, and the policies a joiner accepts with the
// offer (pay and statutory benefits, leave, conduct, POSH, discipline and grievances, personal data, IT use, verification). Each annexure starts
// on a page of its own. Pure functions: the letter builder (letters.ts) decides the order and the annexure letters.
import type { Block } from "./letters";

type Sec = [string, string[]];
/** An annexure's sections, numbered 1, 2, 3… within it (paragraphs 1.1, 1.2…, sub-items (a), (b)…). */
const secs = (list: Sec[]): Block[] => list.map(([title, t], i) => ({ k: "sec" as const, n: String(i + 1), title, t }));
const open = (letter: string, title: string): Block[] => [{ k: "break" }, { k: "h", t: `Annexure ${letter}`, sub: title }];

/** The statutes that govern the employment, and what each means for the employee, in one table. */
export function statutoryAnnexure(letter: string, company: string): Block[] {
  return [
    ...open(letter, "Applicable laws and statutory framework"),
    { k: "p", t: `Your employment with ${company} is governed by the laws of India. The table below lists the principal central and state laws that apply to your employment, and explains in brief how each affects you. Where a law has been replaced or consolidated, the reference is to the law in force, together with the rules, notifications and schemes made under it, as amended from time to time.` },
    {
      k: "table", title: `Annexure ${letter} · Applicable laws`, head: ["Law", "How it applies to your employment"], widths: [0.34, 0.66], align: ["l", "l"],
      rows: [
        ["Code on Wages, 2019", "Governs the payment of wages, the time and manner of payment, permissible deductions, minimum wages, bonus and equal remuneration without discrimination on the ground of gender. Your wages are paid within the time limits set by the Code."],
        ["Code on Social Security, 2020", "Provides for provident fund and pension (through the Employees’ Provident Fund Organisation), employees’ state insurance, gratuity, maternity benefit and employees’ compensation for injury at work. Contributions are made at the notified rates."],
        ["Industrial Relations Code, 2020", "Governs conditions of service, standing orders, grievance redressal, and the procedure for resolving disputes between employers and employees."],
        ["Occupational Safety, Health and Working Conditions Code, 2020", "Requires the Company to issue you a letter of appointment, and sets standards for working hours, overtime, health, safety and welfare at the workplace."],
        ["Shops and establishments law in force in Jharkhand", "Regulates working hours, weekly holidays, leave and the registration of the Company’s establishment in the State."],
        ["Indian Contract Act, 1872", "Governs this letter as a contract between you and the Company. Under section 27, a restraint on carrying on a lawful profession after employment is void, which is why the restrictions in this letter are limited to confidentiality and non-solicitation."],
        ["Income-tax Act, 2025", "The Company deducts income-tax at source from your salary and issues you the certificate of tax deducted. For income of periods before 1 April 2026, the Income-tax Act, 1961 applies."],
        ["Digital Personal Data Protection Act, 2023", "Governs how the Company processes your personal data and how you handle the personal data of customers, patients and colleagues. Your rights as a data principal are explained in the data protection notice annexed to this letter."],
        ["Information Technology Act, 2000", "Recognises electronic records and electronic acceptance of this letter. Unauthorised access to computer systems, data theft and the disclosure of information in breach of a lawful contract are offences under sections 43, 66 and 72A."],
        ["Sexual Harassment of Women at Workplace (Prevention, Prohibition and Redressal) Act, 2013", "Prohibits sexual harassment at the workplace and provides for an Internal Committee (or the Local Committee) to inquire into complaints. The procedure is set out in the annexure on prevention of sexual harassment."],
        ["Rights of Persons with Disabilities Act, 2016", "Prohibits discrimination against persons with disabilities in employment and requires reasonable accommodation. The Company maintains an equal opportunity policy."],
        ["Transgender Persons (Protection of Rights) Act, 2019", "Prohibits discrimination against transgender persons in recruitment, promotion and other employment matters."],
        ["Maternity benefit provisions of the Code on Social Security, 2020", "Provide paid maternity leave of up to 26 weeks (12 weeks from the third child onwards), leave for adoptive and commissioning mothers, and protection against dismissal during maternity leave."],
        ["Copyright Act, 1957; Patents Act, 1970; Trade Marks Act, 1999", "Under section 17 of the Copyright Act, the Company is the first owner of copyright in work you create in the course of your employment. Inventions and marks created for the Company are assigned to it under this letter."],
        ["Prevention of Corruption Act, 1988", "Makes it an offence to give or accept an undue advantage. A commercial organisation is liable where a person associated with it bribes another to obtain business."],
        ["Bharatiya Nyaya Sanhita, 2023", "Theft, criminal breach of trust, cheating, forgery and criminal intimidation are offences, and may be reported to the police in addition to disciplinary action."],
        ["Specific Relief Act, 1963", "Enables the Company to seek an injunction to prevent a breach of confidentiality or non-solicitation obligations."],
        ["Arbitration and Conciliation Act, 1996", "Governs the resolution of disputes under this letter by arbitration, before a neutral arbitrator appointed by agreement."],
        ["Drugs and Cosmetics Act, 1940; Central Goods and Services Tax Act, 2017", "The Company’s customers are licensed pharmacies and distributors who keep records under these laws using the Company’s software. You must not alter or misuse their statutory records."],
      ],
      note: "This summary is for your information and does not limit the application of any law. Where a law is amended or replaced, the corresponding provisions will apply.",
    },
    { k: "p", t: "Where any term of this letter is less favourable to you than the minimum required by law, the minimum required by law will apply in its place, and the rest of this letter will continue in force." },
  ];
}

/** Statutory benefits and pay rules, after the salary table in the pay annexure. */
export function payRules(ptax: number): Block[] {
  return [
    { k: "p", t: "Statutory benefits and payment of wages", bold: true },
    ...secs([
      ["Payment of salary", [
        "Salary is paid for each calendar month by bank transfer to an account in your name, on or before the seventh day of the following month, as required by the Code on Wages, 2019. A salary slip showing the components and deductions is published on the HRMS.",
        "Salary for an incomplete month, including the month of joining and the month of leaving, is paid in proportion to the days of service. Unauthorised absence is treated as loss of pay.",
      ]],
      ["Provident fund and pension", [
        "You will be enrolled with the Employees’ Provident Fund Organisation under the Code on Social Security, 2020. You contribute 12% of your basic salary, and the Company contributes an equal amount, part of which goes to the Employees’ Pension Scheme, on basic salary up to the statutory wage ceiling (currently ₹15,000 a month), unless both parties agree to contribute on a higher amount where the law permits.",
        "If you were a member with a previous employer, your Universal Account Number (UAN) will be carried forward and your earlier balance may be transferred online.",
      ]],
      ["Employees’ state insurance", [
        "While your gross monthly wages do not exceed the notified ceiling (currently ₹21,000), you and your family are covered by the Employees’ State Insurance Corporation for medical care, sickness, maternity and disablement benefits. You contribute 0.75% and the Company 3.25% of gross wages, or the rates notified from time to time.",
      ]],
      ["Gratuity", [
        "Gratuity is payable on the end of your employment after five years of continuous service, or earlier in the case of death or disablement, or after one year of service where your employment is for a fixed term, at the rate of fifteen days’ wages for each completed year of service, subject to the ceiling notified under the Code on Social Security, 2020.",
        "You will be asked to make a nomination for gratuity and provident fund on the HRMS within thirty (30) days of joining.",
      ]],
      ["Bonus", [
        "Where you are eligible under the Code on Wages, 2019, statutory bonus will be paid for each accounting year at not less than the minimum rate prescribed, in accordance with the allocable surplus of the Company. Any other bonus or variable pay is discretionary.",
      ]],
      ["Deductions", [
        "Only the deductions permitted by the Code on Wages, 2019 will be made from your salary: income-tax, provident fund, employees’ state insurance, professional tax (currently " + `₹${ptax}` + " a month), loss of pay for absence, recovery of advances and excess payments, and any other deduction you authorise in writing. Total deductions in a month will not exceed the limit set by law.",
      ]],
      ["Income-tax", [
        "Income-tax is deducted at source under the Income-tax Act, 2025 on the basis of the tax regime you choose and the declarations you submit on the HRMS. You are responsible for the accuracy of your declarations and for any tax, interest or penalty arising from an incorrect declaration. A certificate of tax deducted is issued after the end of each tax year.",
      ]],
      ["Full and final settlement", [
        "On the end of your employment, your unpaid salary, leave encashment where applicable, and other dues will be paid within the time required by the Code on Wages, 2019, after adjustment of any amount you owe the Company. Gratuity, where payable, is paid within thirty (30) days of it becoming due.",
      ]],
    ]),
  ];
}

/** Leave in detail, after the leave table. */
export function leaveRules(): Block[] {
  return [
    ...secs([
      ["Application and approval", [
        "Leave is applied for on the HRMS and is subject to approval by your reporting manager. Planned leave should be applied for at least seven (7) days in advance, and privilege leave of more than five (5) days at least fifteen (15) days in advance.",
        "Leave cannot be claimed as of right and may be refused or recalled where the needs of the business require it, except leave that is guaranteed by law.",
      ]],
      ["Sick leave", [
        "Sick leave is for your own illness or injury. Inform your manager before the start of the working day. A certificate from a registered medical practitioner may be required for absence of more than two (2) consecutive days, and a fitness certificate before resuming work after a long illness.",
      ]],
      ["Leave without pay and absence", [
        "Absence without approved leave is treated as leave without pay and may also lead to disciplinary action. Absence without intimation for more than eight (8) consecutive working days may be treated as voluntary abandonment of employment, after a notice to your last known address.",
      ]],
      ["Maternity and paternity", [
        "Eligible women employees are entitled to maternity leave and benefits under the Code on Social Security, 2020, including up to twenty-six (26) weeks of paid leave, leave for adoption of a child below three months of age and for commissioning mothers, and nursing breaks. No employee will be dismissed or have her conditions of service changed to her disadvantage on account of pregnancy or maternity leave.",
        "Paternity leave, if any, will be granted as set out in the leave policy.",
      ]],
      ["Holidays and weekly off", [
        "You are entitled to a weekly day of rest and to the national and festival holidays declared by the Company each year in accordance with applicable law. If you are asked to work on a weekly off or holiday, you will receive a compensatory day off or wages as required by law.",
      ]],
      ["Leave on leaving", [
        "Leave balances are settled on leaving as provided in the leave policy and the law. Leave cannot be used to shorten the notice period without the Company’s written approval.",
      ]],
    ]),
  ];
}

export function conductAnnexure(letter: string, company: string): Block[] {
  return [
    ...open(letter, "Code of conduct"),
    { k: "p", t: `This Code sets out the standards of behaviour ${company} expects of every employee. It applies at the workplace, at customer sites, while travelling on Company business, at Company events and in online communication that relates to the Company. It is part of the Policies referred to in your letter, and a breach of it may lead to disciplinary action.` },
    ...secs([
      ["Integrity", [
        "You will act honestly and in good faith, keep accurate records, and not make false or misleading statements to the Company, its customers or any authority.",
        "You will record attendance, leave, expenses and work truthfully. Falsifying an attendance record, photograph, expense claim, invoice or report is serious misconduct.",
      ]],
      ["Respect at work", [
        "You will treat colleagues, customers and partners with courtesy and respect. Bullying, abusive language, threats, violence and discrimination on the ground of gender, religion, caste, region, language, disability, age, sexual orientation or any other personal characteristic are prohibited.",
      ]],
      ["Customers and their data", [
        "The Company’s customers trust it with their business records and with the personal data of their patients. You will access a customer’s account only when your work requires it, and only to the extent required. You will not alter a customer’s invoices, stock, batch or tax records except on the customer’s documented request and in accordance with the support process.",
        "You will not give medical advice, recommend medicines, or comment on a prescription to any customer or patient.",
      ]],
      ["Conflicts of interest", [
        "You will avoid any situation in which your personal interest conflicts, or appears to conflict, with the interests of the Company. You will disclose in writing any interest you or a close relative have in a competitor, customer, supplier or partner, and any outside employment, directorship or business.",
      ]],
      ["Gifts, hospitality and bribery", [
        "You will not offer, give, request or accept any bribe, kickback or undue advantage, in cash or in kind, in connection with the Company’s business. Gifts or hospitality of more than nominal value (₹2,000 or more) offered to or by you must be declared to your manager and may be accepted only with approval.",
        "Facilitation payments to public officials are prohibited, even where small or customary.",
      ]],
      ["Company property and resources", [
        "Company property, funds, devices, software and time are to be used for the Company’s business. You are responsible for the safe keeping of property issued to you and must report any loss or damage at once.",
      ]],
      ["Communication and social media", [
        "Only persons authorised by the Company may speak to the media, investors or government authorities on its behalf. On social media you will not disclose Confidential Information, post about customers, or make statements that could reasonably be taken as the Company’s view.",
      ]],
      ["Alcohol, drugs and smoking", [
        "You will not report for work, drive on Company business or attend a customer site under the influence of alcohol or any intoxicating or narcotic substance. Smoking is not permitted in the Company’s premises except in designated areas, in accordance with the Cigarettes and Other Tobacco Products Act, 2003.",
      ]],
      ["Health and safety", [
        "You will follow the safety instructions given to you, take reasonable care for your own safety and that of others, and report accidents, injuries and unsafe conditions to your manager.",
      ]],
      ["Reporting concerns", [
        "If you become aware of a breach of this Code, the law or the Policies, you should report it to your manager or to Human Resources. Reports made in good faith will be kept confidential to the extent possible, and no employee will suffer any detriment for making such a report.",
      ]],
    ]),
  ];
}

export function poshAnnexure(letter: string, company: string): Block[] {
  return [
    ...open(letter, "Prevention of sexual harassment and equal opportunity"),
    { k: "p", t: `${company} is committed to a workplace where every person is treated with dignity. This annexure summarises the Company’s policy under the Sexual Harassment of Women at Workplace (Prevention, Prohibition and Redressal) Act, 2013 (the “POSH Act”) and its equal opportunity policy. The full policy is published on the HRMS.` },
    ...secs([
      ["What is sexual harassment", [
        "Sexual harassment includes any one or more of the following unwelcome acts or behaviour, whether directly or by implication:",
        "(a) physical contact and advances;",
        "(b) a demand or request for sexual favours;",
        "(c) making sexually coloured remarks;",
        "(d) showing pornography; or",
        "(e) any other unwelcome physical, verbal or non-verbal conduct of a sexual nature, including by message, email or social media.",
        "Implied or explicit promise of preferential treatment, threat of detrimental treatment, interference with work, or creating an intimidating, offensive or hostile work environment in connection with such conduct also amounts to sexual harassment.",
      ]],
      ["Workplace", [
        "The workplace includes the Company’s offices, customer sites, any place visited in the course of employment including transport provided by the Company, Company events, and online and remote work settings.",
      ]],
      ["Making a complaint", [
        "An aggrieved woman may make a written complaint to the Internal Committee constituted by the Company or, where the Company is not required to constitute one, to the Local Committee constituted by the District Officer under the POSH Act. The complaint should be made within three (3) months of the incident, or of the last incident in a series, and the Committee may extend this by a further three (3) months for sufficient reasons.",
        "Where the aggrieved woman is unable to make a complaint because of physical or mental incapacity, death or otherwise, a complaint may be made on her behalf as provided under the POSH Act.",
      ]],
      ["Inquiry", [
        "Before starting an inquiry, the Committee may, at the request of the aggrieved woman, take steps to settle the matter through conciliation, provided that no monetary settlement is made the basis of conciliation.",
        "The Committee will complete its inquiry within ninety (90) days in accordance with the principles of natural justice, giving both parties an opportunity to be heard. During the inquiry the Committee may recommend interim measures, such as a transfer or leave.",
        "The Company will act on the recommendations of the Committee within sixty (60) days of receiving its report. A party aggrieved by the recommendations may appeal as provided under the POSH Act.",
      ]],
      ["Confidentiality and protection", [
        "The identity of the parties and witnesses, the contents of the complaint and the inquiry proceedings are confidential and may not be published or made known to the public, the press or the media. Victimisation of a complainant or witness is misconduct.",
        "A complaint that is found to be malicious, or false to the knowledge of the complainant, may lead to action against the complainant. A mere inability to prove a complaint does not make it false or malicious.",
      ]],
      ["Equal opportunity", [
        "The Company provides equal opportunity in recruitment, pay, training, promotion and all other terms of employment, without discrimination on the ground of gender, religion, caste, disability, gender identity, age or any other ground prohibited by law, in accordance with the Code on Wages, 2019, the Rights of Persons with Disabilities Act, 2016 and the Transgender Persons (Protection of Rights) Act, 2019.",
        "If you need a reasonable accommodation because of a disability, please inform Human Resources. Your request will be considered in confidence.",
      ]],
    ]),
  ];
}

export function disciplineAnnexure(letter: string, company: string): Block[] {
  return [
    ...open(letter, "Disciplinary procedure and grievance redressal"),
    { k: "p", t: `${company} will deal with conduct and performance concerns fairly and consistently, in accordance with the principles of natural justice and applicable law, including the Industrial Relations Code, 2020 where it applies.` },
    ...secs([
      ["Misconduct", [
        "Without limiting the meaning of the term, the following acts amount to misconduct:",
        "(a) theft, fraud, dishonesty or criminal breach of trust in connection with the Company’s business or property;",
        "(b) falsification of attendance, expense, customer or financial records;",
        "(c) unauthorised access to, disclosure of, or use of Confidential Information or personal data;",
        "(d) wilful insubordination or disobedience of a lawful and reasonable order;",
        "(e) sexual harassment, violence, threats or abusive behaviour at the workplace;",
        "(f) giving or accepting a bribe or undue advantage;",
        "(g) habitual absence without leave, or habitual late attendance;",
        "(h) wilful damage to Company property or wilful slowing down of work; and",
        "(i) conviction for a criminal offence involving moral turpitude.",
      ]],
      ["Procedure", [
        "Where misconduct is alleged, you will be informed in writing of the allegations and the evidence relied on, and given a reasonable opportunity, of not less than seven (7) days, to submit a written explanation.",
        "If the explanation is not satisfactory, an inquiry may be held by an officer who has not been involved in the matter. You may present your case, examine the evidence and be accompanied by a colleague of your choice.",
        "Pending the inquiry, the Company may place you under suspension. Subsistence allowance will be paid during suspension as required by law.",
      ]],
      ["Penalties", [
        "Depending on the seriousness of the misconduct and your past record, the Company may impose one or more of the following: a written warning, withholding of an increment, recovery of loss caused, suspension, demotion, discharge or dismissal. The decision will be communicated to you in writing with the reasons for it.",
      ]],
      ["Performance", [
        "Where your performance does not meet the standards of your role, your manager will discuss the shortfall with you and may place you on a performance improvement plan of not less than thirty (30) days, with clear goals, support and regular reviews. Continued failure to meet the standards after the plan may lead to termination with notice under your letter.",
      ]],
      ["Grievance redressal", [
        "If you have a grievance about your work, pay, working conditions or treatment, you should first raise it with your reporting manager. If it is not resolved within seven (7) working days, you may raise it in writing with Human Resources, who will respond within fifteen (15) working days.",
        "Where the Company employs twenty or more workers, a Grievance Redressal Committee will be constituted under the Industrial Relations Code, 2020, and a worker may approach it as provided under that Code.",
        "No employee will be penalised for raising a grievance in good faith.",
      ]],
      ["Appeal", [
        "You may appeal against a disciplinary penalty in writing to the next higher authority within fifteen (15) days of receiving the decision. The appeal will be decided within thirty (30) days.",
      ]],
    ]),
  ];
}

export function privacyAnnexure(letter: string, company: string): Block[] {
  return [
    ...open(letter, "Notice on the processing of your personal data"),
    { k: "p", t: `This notice is given to you under the Digital Personal Data Protection Act, 2023 (the “DPDP Act”) and the rules made under it. It explains what personal data ${company}, as data fiduciary, processes about you in connection with your employment, why, and the rights you have.` },
    ...secs([
      ["Personal data we process", [
        "(a) identity and contact details: name, photograph, date of birth, address, phone number, email address, Aadhaar (masked), PAN and emergency contacts;",
        "(b) employment details: designation, department, reporting line, pay, bank account, tax declarations, provident fund and insurance details, and nominations;",
        "(c) education, previous employment and the results of background verification;",
        "(d) attendance records, including check-in photographs and the time and location of check-in, leave and travel records;",
        "(e) records of your use of Company systems, devices, email and the HRMS, including activity logs; and",
        "(f) performance reviews, disciplinary and grievance records, and any health information you provide for sick leave or reasonable accommodation.",
      ]],
      ["Why we process it", [
        "Section 7 of the DPDP Act allows an employer to process personal data for the purposes of employment, including to safeguard it from loss or liability and to provide benefits to the employee. We process your personal data to recruit and on-board you, pay you and meet our tax and social security obligations, manage attendance, leave and performance, protect the security of our systems and our customers’ data, comply with the law, and defend legal claims.",
        "Where we rely on your consent for any other purpose, we will ask for it separately, and you may withdraw it at any time with the same ease with which you gave it.",
      ]],
      ["Sharing", [
        "Your personal data is shared only with those who need it: your manager and Human Resources; payroll, banking and insurance providers; the Employees’ Provident Fund Organisation, the Employees’ State Insurance Corporation and the tax authorities; background verification agencies; and our technology service providers, who process it on our instructions under contract. We may also disclose it where required by law or a court order.",
      ]],
      ["Retention", [
        "We keep your personal data for as long as you are employed and afterwards for the periods required by labour, tax and other laws, and to deal with any claim, after which it is erased. Attendance photographs are kept only for as long as the attendance policy states.",
      ]],
      ["Security", [
        "We protect your personal data with reasonable security safeguards, including access controls, encryption, logging and staff training. If a personal data breach occurs that affects you, we will inform you and the Data Protection Board of India as required by the DPDP Act.",
      ]],
      ["Your rights", [
        "As a data principal you have the right to obtain a summary of the personal data we process about you and the processing activities; to have inaccurate or incomplete data corrected or updated, and data no longer needed erased (subject to our legal obligations); to grievance redressal; and to nominate another person to exercise your rights in the event of your death or incapacity.",
        "You also have duties under section 15 of the DPDP Act, including not to impersonate another person, not to suppress material information, and not to register a false or frivolous grievance.",
      ]],
      ["Contact and complaints", [
        "You may exercise your rights, or raise a concern, by writing to Human Resources through the HRMS. We will respond within the time prescribed under the DPDP Act. If you are not satisfied with our response, you may complain to the Data Protection Board of India.",
      ]],
    ]),
  ];
}

export function itAnnexure(letter: string, company: string): Block[] {
  return [
    ...open(letter, "Information security and acceptable use"),
    { k: "p", t: `${company} runs software that holds the business records of pharmacies and the personal data of their patients. The security of that information depends on every employee. This annexure sets out the minimum rules for the use of Company systems; the information security policy on the HRMS contains the full rules.` },
    ...secs([
      ["Accounts and passwords", [
        "Your accounts are personal to you. You will use a strong password, enable two-factor authentication where available, and never share your password or a one-time code with anyone, including a colleague or a person claiming to be from the Company or a customer.",
      ]],
      ["Devices", [
        "You will use Company-approved devices for Company work, keep them locked when unattended, keep the operating system and software up to date, and not disable security software. Personal devices may be used only as the Company permits in writing, and must meet its security requirements.",
      ]],
      ["Data handling", [
        "You will store Company and customer data only in Company systems. You will not copy such data to personal email, personal cloud storage, removable media or messaging applications, and will not take screenshots or photographs of customer data except for an approved support purpose.",
        "Production databases and customer accounts may be accessed only through the approved tools, and only when a ticket or task requires it. Every access is logged.",
      ]],
      ["Software and source code", [
        "You will install only licensed software approved by the Company. Source code, credentials and keys must be kept in the Company’s repositories and secret stores, and never in public repositories, documents or chat messages. You will not use Company code or data to train, prompt or test an external artificial intelligence service unless the Company has approved that service for the purpose.",
      ]],
      ["Email, internet and messaging", [
        "Company email and messaging are for business use. Reasonable personal use is permitted if it does not interfere with your work or breach this annexure. You will not open suspicious links or attachments, and will report phishing attempts.",
      ]],
      ["Monitoring", [
        "Subject to applicable law, the Company may monitor, log and review the use of its systems, devices, networks, email and the HRMS, including attendance photographs and activity on the HRMS, for security, compliance and the investigation of misconduct. Personal communication on Company systems is not private.",
      ]],
      ["Incidents", [
        "You will report any actual or suspected security incident, lost device, malware or data breach to the Company immediately, and in any case within twenty-four (24) hours, so that the Company can contain it and meet its legal obligations, including those under the Information Technology Act, 2000 and the DPDP Act.",
      ]],
      ["On leaving", [
        "Your access will be withdrawn on your last working day. Before then you will return all devices, hand over your work, and delete Company data from any personal device or account.",
      ]],
    ]),
  ];
}

/** The authorisation for background checks, after the documents table. */
export function verificationConsent(company: string, name: string): Block[] {
  return [
    { k: "p", t: "Authorisation for background verification", bold: true },
    { k: "p", t: `I, ${name}, authorise ${company} and any agency appointed by it to verify the information and documents I have provided, including my identity, address, education, previous employment and references, and, where permitted by law, records of criminal proceedings. I authorise my previous employers and educational institutions to release this information to the Company. I understand that the results will be kept confidential and used only for the purposes of my employment, as described in the data protection notice.` },
    { k: "sign", boxes: [{ title: "Candidate", lines: ["", `Name: ${name}`, "Date:"] }] },
  ];
}
