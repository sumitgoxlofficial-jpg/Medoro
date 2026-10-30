import { describe, expect, it } from "vitest";
import { unzipSync, strFromU8 } from "fflate";
import { crc32, zip } from "./zip";

describe("zip", () => {
  it("crc32 matches the standard check value", () => {
    expect(crc32(Buffer.from("123456789"))).toBe(0xcbf43926);
    expect(crc32(new Uint8Array())).toBe(0);
  });

  it("writes an archive another ZIP reader opens", () => {
    const big = "id,name\n" + Array.from({ length: 2000 }, (_, i) => `${i},Paracetamol 650 मात्रा`).join("\n");
    const out = unzipSync(new Uint8Array(zip([{ name: "medicines.csv", data: big }, { name: "empty.csv", data: "" }, { name: "dir/बिल.csv", data: Buffer.from([1, 2, 3]) }])));
    expect(Object.keys(out)).toEqual(["medicines.csv", "empty.csv", "dir/बिल.csv"]);
    expect(strFromU8(out["medicines.csv"])).toBe(big);
    expect(out["empty.csv"].length).toBe(0);
    expect([...out["dir/बिल.csv"]]).toEqual([1, 2, 3]);
  });
});
