import { describe, expect, it } from "vitest";
import { converse, start, startSelf, step, type Ctx } from "./engine";
import { understand, parseTime, withLoanwords } from "./nlu";
import { buildOutput } from "./output";
import { Index, kbFrom, productIndex } from "./knowledge";
import { scenarios, validateLibrary } from "./scenarios";
import { evaluateAll } from "./evaluate";

// The conversation engine, the knowledge retrieval and the scenario library (Part 20 cases that need no database).
const ctx = (over: Partial<Ctx> = {}): Ctx => ({ name: "Ravi", nowMin: 620, shiftStart: "10:00", shiftEnd: "19:00", kb: kbFrom(productIndex()), ...over });
const out = (r: ReturnType<typeof converse>, reason: Parameters<typeof converse>[0]) => buildOutput(r.state, { organisationId: "medoro", employeeId: "e1", reason, transcript: r.turns, status: "completed" });

describe("AI HR conversation engine", () => {
  it("opens with an introduction, AI disclosure, the reason and a permission question", () => {
    const t = start("late", ctx());
    expect(t.reply).toMatch(/Naina hoon, Medoro HR ki AI assistant/);
    expect(t.reply).toMatch(/attendance/);
    expect((t.reply.match(/\?/g) ?? []).length).toBe(1);
  });

  it("late arrival: remembers the reason and the time, never asks again", () => {
    const r = converse("late", ctx(), ["Haan bolo", "Haan, traffic mein hoon", "11 baje"]);
    expect(r.state.slots).toMatchObject({ status: "coming", reason: "traffic", eta: "11:00" });
    expect(r.state.asked.filter((q) => q === "ask_eta")).toHaveLength(1);
    expect(r.turns.at(-1)!.text).toMatch(/11 baje note/);
    expect(out(r, "late")).toMatchObject({ employeeResponse: "coming", expectedArrivalTime: "11:00", reasonCategory: "traffic", humanEscalationRequired: false });
  });

  it("absence: offers a leave draft that only HR or the manager can approve", () => {
    const r = converse("absent", ctx({ nowMin: 640 }), ["haan", "aaj nahi aa paunga, bukhar hai", "haan"]);
    const o = out(r, "absent");
    expect(o).toMatchObject({ employeeResponse: "absent", leaveRequestIntent: true, reasonCategory: "illness" });
    expect(o.recommended.map((x) => x.kind)).toContain("leave_draft");
    expect(r.turns.join?.toString()).toBeDefined();
    expect(r.turns.map((t) => t.text).join(" ")).toMatch(/approval HR ya manager/);
  });

  it("missing check-out: still working with a finish time, or forgot with the leaving time", () => {
    const a = converse("missing_checkout", ctx({ nowMin: 1160 }), ["haan", "abhi bhi kaam kar raha hoon, 8 baje tak"]);
    expect(a.state.slots).toMatchObject({ status: "still_working", eta: "20:00" });
    const b = converse("missing_checkout", ctx({ nowMin: 1160 }), ["checkout bhool gaya, 7:15 pe nikla tha"]);
    expect(b.state.slots).toMatchObject({ status: "forgot_checkout", leftAt: "19:15" });
    expect(out(b, "missing_checkout").recommended.map((x) => x.kind)).toContain("checkout_correction");
  });

  const ot = ctx({ nowMin: 900, overtime: { date: "2026-11-29", hours: 2, from: "19:00" } });
  it("overtime: acceptance needs an explicit yes and a confirmation", () => {
    const r = converse("overtime", ot, ["haan", "haan kar lunga", "haan"]);
    expect(out(r, "overtime").overtimeResponse).toBe("accepted");
    expect(r.turns.at(-1)!.text).toMatch(/Final approval unka/);
  });
  it("overtime: a no is accepted without pressure", () => {
    const r = converse("overtime", ot, ["haan", "nahi, aaj nahi ruk paunga"]);
    expect(out(r, "overtime").overtimeResponse).toBe("rejected");
    expect(r.state.ended).toBe(true);
  });
  it("overtime: silence is never consent", () => {
    const r = converse("overtime", ot, ["haan", "", ""]);
    expect(out(r, "overtime").overtimeResponse).toBe("none");
    expect(r.state.endReason).toBe("no_answer");
    const yesThenSilence = converse("overtime", ot, ["haan", "haan", "", ""]);
    expect(out(yesThenSilence, "overtime").overtimeResponse).toBe("none");
  });

  it("callback request records the time", () => {
    const r = converse("late", ctx(), ["abhi busy hoon, shaam 5 baje call karna"]);
    expect(out(r, "late")).toMatchObject({ callbackRequested: true, callbackTime: "17:00", employeeResponse: "callback" });
  });
  it("a request for a person ends the call with an escalation", () => {
    const r = converse("late", ctx(), ["HR se baat karao"]);
    expect(out(r, "late")).toMatchObject({ humanEscalationRequired: true, escalationPriority: "normal", employeeResponse: "escalated" });
  });
  it("stop-call requests stop at once, in any phase, and are recorded", () => {
    for (const u of [["mujhe aage se call mat karo"], ["haan", "please don't call me again"], ["haan", "haan aa raha hoon", "aur kabhi call mat karna"]]) {
      const r = converse("late", ctx(), u);
      expect(r.state.flags.stop).toBe(true);
      expect(r.state.ended).toBe(true);
      expect(out(r, "late").employeeRequestedStop).toBe(true);
    }
    // "not now" is a callback, not a stop
    expect(converse("late", ctx(), ["abhi call mat karo, baad mein"]).state.flags.stop).toBe(false);
  });
  it("harassment and accidents escalate urgently without probing", () => {
    const h = converse("late", ctx(), ["I feel unsafe, my lead keeps harassing me"]);
    expect(out(h, "late").escalationPriority).toBe("urgent");
    expect(h.turns.at(-1)!.text).not.toMatch(/\?/);
    const a = converse("late", ctx(), ["mera accident ho gaya hai"]);
    expect(out(a, "late").escalationPriority).toBe("urgent");
    expect(a.turns.at(-1)!.text).toMatch(/112/);
  });

  it("speaks Hindi, English and Hinglish, and follows a switch mid-call", () => {
    const hi = converse("late", ctx(), ["मैं ट्रैफिक में हूँ, आधे घंटे में पहुँच जाऊँगा"]);
    expect(hi.turns.at(-1)!.text).toMatch(/[ऀ-ॿ]/);
    expect(hi.state.slots.eta).toBe("10:50");
    const en = converse("late", ctx(), ["I'm stuck in traffic, will reach by 11:30"]);
    expect(en.turns.at(-1)!.text).toMatch(/expected arrival at 11:30 AM/);
    const sw = converse("late", ctx(), ["Haan bolo", "I'm stuck in traffic, 11:15"]);
    expect(sw.state.lang).toBe("en");
    expect(sw.state.slots.eta).toBe("11:15");
  });

  it("noise, broken speech and unclear answers: re-asks simply, then hands over", () => {
    const noisy = converse("late", ctx(), ["haan", "...aa...raha...11"]);
    expect(noisy.state.slots.eta).toBe("11:00");
    const unclear = converse("late", ctx(), ["haan", "hmm", "uh", "kuch nahi pata hmm"]);
    expect(unclear.state.ended).toBe(true);
    expect(unclear.state.flags.followup).toContain("unclear");
  });

  it("an interruption with a question is answered, then the pending question returns", () => {
    const t1 = start("late", ctx());
    const t2 = step(t1.state, ctx(), "haan");
    const t3 = step(t2.state, ctx(), "kya yeh call record ho rahi hai?");
    expect(t3.reply).toMatch(/audio save nahi/);
    expect(t3.reply).toMatch(/office aa rahe/);
    const t4 = step(t3.state, ctx(), "haan aa raha hoon 11 baje");
    expect(t4.state.slots.eta).toBe("11:00");
  });

  it("answers privacy questions plainly", () => {
    const r = converse("late", ctx(), ["mera data kaun dekhega?"]);
    expect(r.turns.at(-1)!.text).toMatch(/authorised HR/);
  });

  it("parses Hinglish and Hindi times", () => {
    expect(parseTime("sadhe gyarah baje tak", 620)?.at).toBe("11:30");
    expect(parseTime("paune 12", 620)).toBeNull();
    expect(parseTime("paune 12 baje", 620)?.at).toBe("11:45");
    expect(parseTime("shaam 4 baje", 620)?.at).toBe("16:00");
    expect(parseTime("20 minute mein", 620)?.at).toBe("10:40");
    expect(parseTime("डेढ़ घंटे में", 620)?.at).toBe("11:50");
    expect(understand("Night shift mein hoon, subah 6 baje tak kaam hai", 1160).slots.eta).toBe("06:00");
  });
});

describe("Vocabulary HR teaches", () => {
  it("adds meanings for local phrases without changing what the rules already understand", () => {
    const plain = converse("late", ctx(), ["haan", "gaadi line me lagi hai"]);
    expect(plain.state.slots.status).toBeUndefined();
    const taught = converse("late", ctx({ vocabulary: [{ phrase: "line me lagi hai", intent: "coming", reason: "traffic" }] }), ["haan", "gaadi line me lagi hai"]);
    expect(taught.state.slots).toMatchObject({ status: "coming", reason: "traffic" });
    expect(taught.state.lastQ).toBe("ask_eta");
    // a taught "won't come" phrase beats an accidental "coming" match
    const absent = converse("late", ctx({ vocabulary: [{ phrase: "aaj ghar pe hi rahunga", intent: "absent" }] }), ["haan", "aaj ghar pe hi rahunga"]);
    expect(absent.state.slots.status).toBe("absent");
    // phrases with regex characters are matched literally
    expect(() => converse("late", ctx({ vocabulary: [{ phrase: "a+b (test)?", intent: "yes" }] }), ["a+b (test)?"])).not.toThrow();
  });
  it("custom words keep the whole library passing", () => {
    const r = evaluateAll(scenarios(), "", { vocabulary: [{ phrase: "line me lagi hai", intent: "coming", reason: "traffic" }, { phrase: "aaj ghar pe hi rahunga", intent: "absent" }] });
    expect(r.passed).toBe(r.total);
  });
});

describe("Knowledge retrieval", () => {
  it("answers HRMS questions from approved records with their source", () => {
    const kb = kbFrom(productIndex());
    expect(kb("Leave cancel kaise karte hain HRMS mein?", "hinglish")?.source).toBe("Cancelling leave");
    expect(kb("How do I request a correction for a missed check-out?", "en")?.source).toMatch(/correction|check-out/i);
    expect(kb("payslip kahan milegi", "hinglish")?.source).toMatch(/Payslip/);
  });
  it("says nothing rather than guess when knowledge is missing", () => {
    const kb = kbFrom(productIndex());
    expect(kb("canteen ka coupon kahan milega", "hinglish")).toBeNull();
    const r = converse("manual", ctx(), ["Office mein parking milti hai kya?"]);
    expect(r.state.flags.followup.some((f) => f === "question_for_hr" || f === "hr_followup")).toBe(true);
    expect(r.turns.at(-1)!.text).not.toMatch(/Source/);
  });
  it("only uses records it was given (organisation knowledge is separate)", () => {
    const idx = new Index([{ key: "p1", title: "Work from home policy", body: "Employees may work from home two days a week with their manager's approval.", source: "Policy · WFH v3", scope: "organisation" }]);
    expect(idx.search("wfh policy kya hai")[0].coverage).toBeGreaterThanOrEqual(0.5);
    expect(kbFrom(idx)("wfh policy kya hai", "hinglish")?.source).toBe("Work from home policy");
  });
});

describe("Scenario library", () => {
  it("has at least 1,000 unique, structurally valid scenarios in 100 categories of 10 or more", () => {
    const v = validateLibrary();
    expect(v.total).toBeGreaterThanOrEqual(1000);
    expect(v.categories).toBeGreaterThanOrEqual(100);
    expect(Math.min(...Object.values(v.perCategory))).toBeGreaterThanOrEqual(10);
    expect(v.duplicates).toEqual([]);
    expect(v.problems).toEqual([]);
    expect(v.valid).toBe(v.total);
  });
  it("runs every scenario and meets the acceptance targets that can be measured offline", () => {
    const r = evaluateAll(scenarios());
    expect(r.total).toBe(1000);
    expect(r.metrics.stop_compliance.rate).toBe(100);
    expect(r.metrics.no_false_stop.rate).toBe(100);
    expect(r.metrics.structured_output.rate).toBeGreaterThanOrEqual(95);
    expect(r.metrics.intent.rate).toBeGreaterThanOrEqual(90);
    expect(r.metrics.ai_disclosure.rate).toBe(100);
    // every scenario that expects an urgent escalation gets one
    const urgent = scenarios().filter((s) => s.expect.esc === "urgent").map((s) => s.id);
    expect(r.failures.filter((f) => urgent.includes(f.id) && f.failed.some((x) => x.startsWith("escalation")))).toEqual([]);
  });
});

describe("Naina: a chat the employee starts", () => {
  it("opens with an offer to help, no permission question, and answers the next message", () => {
    const ctx = { name: "Neha", nowMin: 600 };
    const t = startSelf(ctx);
    expect(t.reply).toMatch(/^(Namaste|Hello) Neha ji! Main Naina/);
    expect(t.reply).not.toMatch(/baat kar sakte|theek rahega/);
    expect(t.speech).toMatch(/नैना/);
    expect(t.state.turns).toBe(0);
    const n = step(t.state, ctx, "HR se baat karni hai");
    expect(n.reply).toMatch(/HR/);
  });
});

describe("Speech recognition writes English words in Devanagari", () => {
  it("adds the English form after the text, and leaves Latin text alone", () => {
    expect(withLoanwords("चेकआउट करना भूल गया")).toBe("चेकआउट करना भूल गया checkout");
    expect(withLoanwords("checkout bhool gaya")).toBe("checkout bhool gaya");
    expect(withLoanwords("बस दस मिनट")).toBe("बस दस मिनट"); // "bas" means "just", not a bus
  });
  it("understands what Chrome's Hindi recognition hears", () => {
    expect(understand("चेकआउट करना भूल गया था", 600, { reason: "missing_checkout" }).primary).toBe("forgot_checkout");
    expect(understand("हाँ ट्रैफिक में हूँ 15 मिनट में पहुंच जाऊंगा", 600, { reason: "late" }).primary).toBe("coming");
    expect(understand("मुझे एचआर से बात करनी है", 600, { reason: "late" }).primary).toBe("human");
    expect(understand("पेस्लिप कहां मिलेगी", 600, { reason: "manual" }).primary).toBe("payroll_question");
  });
  it("finds knowledge answers for Devanagari questions", () => {
    const kb = kbFrom(productIndex());
    expect(kb("पेस्लिप कहां मिलेगी", "hi")?.source).toBe("Payslips and tax statement");
    expect(kb("लीव कैसे कैंसिल करें", "hi")?.source).toBe("Cancelling leave");
  });
});

