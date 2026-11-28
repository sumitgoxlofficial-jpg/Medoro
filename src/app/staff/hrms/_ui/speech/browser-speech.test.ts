import { afterEach, describe, expect, it } from "vitest";
import { deviceVoiceKind, speakReply } from "./browser-speech";

// Device voices: a Hindi voice reads the Devanagari reply; without one, an English voice reads the Hinglish text.
type V = { name: string; lang: string; localService: boolean };
function device(voices: V[]) {
  const spoken: { text: string; lang: string }[] = [];
  Object.assign(globalThis, {
    speechSynthesis: { getVoices: () => voices, cancel: () => {}, speak: (u: { text: string; lang: string }) => spoken.push({ text: u.text, lang: u.lang }) },
    SpeechSynthesisUtterance: class { text: string; lang = ""; voice: unknown = null; rate = 1; pitch = 1; constructor(t: string) { this.text = t; } },
  });
  return spoken;
}
afterEach(() => { delete (globalThis as Record<string, unknown>).speechSynthesis; delete (globalThis as Record<string, unknown>).SpeechSynthesisUtterance; });

describe("Naina's voice on the device", () => {
  const hi = "नमस्ते नेहा जी! मैं नैना हूँ।", latin = "Namaste Neha ji! Main Naina hoon.";
  it("uses a Hindi voice for the Devanagari text when there is one", () => {
    const spoken = device([{ name: "Google हिन्दी", lang: "hi-IN", localService: true }, { name: "Heera", lang: "en-IN", localService: true }]);
    expect(deviceVoiceKind()).toBe("hi");
    expect(speakReply(hi, latin)).toBe("hi");
    expect(spoken).toEqual([{ text: hi, lang: "hi-IN" }]);
  });
  it("falls back to an Indian English voice reading the Hinglish text", () => {
    const spoken = device([{ name: "Microsoft Zira", lang: "en-US", localService: true }, { name: "Microsoft Heera", lang: "en-IN", localService: true }]);
    expect(deviceVoiceKind()).toBe("en");
    expect(speakReply(hi, latin)).toBe("en");
    expect(spoken).toEqual([{ text: latin, lang: "en-IN" }]);
  });
  it("uses any English voice when there is no Indian one, and stays silent with none (text only)", () => {
    const spoken = device([{ name: "Samantha", lang: "en-US", localService: true }]);
    expect(speakReply(hi, latin)).toBe("en");
    expect(spoken[0].lang).toBe("en-US");
    device([]);
    expect(deviceVoiceKind()).toBeNull();
    expect(speakReply(hi, latin)).toBeNull();
  });
  it("never sends text to an online voice (only voices on the device)", () => {
    const spoken = device([{ name: "Google हिन्दी", lang: "hi-IN", localService: false }]);
    expect(speakReply(hi, latin)).toBeNull();
    expect(spoken).toEqual([]);
  });
});
