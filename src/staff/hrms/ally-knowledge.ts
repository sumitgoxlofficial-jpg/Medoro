// Shared, no server imports: finds the passages of the company's published policies that answer a question, so Ally can
// quote them with their source instead of guessing. Plain keyword overlap with light stemming: predictable, explainable,
// and it never invents policy. Below the threshold nothing is returned and Ally says it doesn't know.

const STOP = new Set("a an the and or of to in on for at by is are was were be been do does did can could should would will i me my we our you your it its this that these those what when where which who how why with from as if not no yes any all there here about into than then so much many more most per have has had get got please tell know need".split(" "));
const stem = (w: string) => { if (w.length <= 3) return w; const s = w.replace(/(ments?|ations?|ings?|ed|es|s|ly)$/, ""); return s.length > 4 ? s.replace(/e$/, "") : s; };
export const terms = (text: string) => [...new Set(text.toLowerCase().normalize("NFKD").replace(/[^a-z0-9 ]+/g, " ").split(/\s+/).filter((w) => w.length > 2 && !STOP.has(w)).map(stem))];

export type Passage = { policy: string; category: string; text: string };
/** Splits a policy body into paragraphs (a blank line starts one); bullets stay with their paragraph. */
export function passages(p: { title: string; category: string; body: string }): Passage[] {
  return p.body.split(/\n\s*\n/).map((t) => t.trim()).filter(Boolean).map((text) => ({ policy: p.title, category: p.category, text }));
}

/** The best passages for a question: at least `min` shared terms (title terms count double), best first. */
export function search(question: string, all: Passage[], opts: { min?: number; take?: number } = {}) {
  const q = terms(question);
  if (!q.length) return [];
  const min = opts.min ?? 2;
  return all
    .map((p) => {
      const body = new Set(terms(p.text)), title = new Set(terms(p.policy));
      const score = q.reduce((a, t) => a + (body.has(t) ? 1 : 0) + (title.has(t) ? 2 : 0), 0);
      return { ...p, score };
    })
    .filter((p) => p.score >= min)
    .sort((a, b) => b.score - a.score)
    .slice(0, opts.take ?? 2);
}

/** Ally's reply quoting the passages, or null when nothing in the policies answers it. */
export function policyAnswer(question: string, all: Passage[]) {
  const hits = search(question, all);
  if (!hits.length) return null;
  const quote = (t: string) => (t.length > 600 ? t.slice(0, 597).trimEnd() + "…" : t);
  return `From the company policies:\n\n${hits.map((h) => `“${quote(h.text)}”\n— ${h.policy}${h.category ? ` (${h.category})` : ""}`).join("\n\n")}\n\nRead the full text in Company policies. If this doesn’t answer it, raise a ticket in Support.`;
}
