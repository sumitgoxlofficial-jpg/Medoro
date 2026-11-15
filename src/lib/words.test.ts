import { describe, expect, it } from "vitest";
import { numberInWords, rupeesInWords } from "./words";

describe("amounts in words", () => {
  it("uses Indian grouping", () => {
    expect(numberInWords(0)).toBe("Zero");
    expect(numberInWords(19)).toBe("Nineteen");
    expect(numberInWords(105)).toBe("One Hundred Five");
    expect(numberInWords(1000)).toBe("One Thousand");
    expect(numberInWords(100000)).toBe("One Lakh");
    expect(numberInWords(1234567)).toBe("Twelve Lakh Thirty Four Thousand Five Hundred Sixty Seven");
    expect(numberInWords(250000000)).toBe("Twenty Five Crore");
    expect(numberInWords(1_00_00_00_000)).toBe("One Hundred Crore");
  });

  it("formats rupees and paise for invoices", () => {
    expect(rupeesInWords(38600)).toBe("Rupees Three Hundred Eighty Six Only");
    expect(rupeesInWords(1050)).toBe("Rupees Ten and Fifty Paise Only");
    expect(rupeesInWords(0)).toBe("Rupees Zero Only");
  });
});
