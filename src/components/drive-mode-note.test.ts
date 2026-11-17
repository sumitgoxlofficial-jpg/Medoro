import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { DriveModeNote } from "./drive-mode-note";

describe("Drive-mode note on server analysis screens", () => {
  it("says the screen has nothing to analyse when records live on the devices and in Drive", () => {
    const html = renderToStaticMarkup(createElement(DriveModeNote, { moved: true }));
    expect(html).toContain('data-testid="drive-mode-note"');
    expect(html).toMatch(/not on Medoro’s server/);
    expect(html).toMatch(/look empty/);
  });
  it("shows nothing for a pharmacy whose records are on the server", () => {
    expect(renderToStaticMarkup(createElement(DriveModeNote, { moved: false }))).toBe("");
    expect(renderToStaticMarkup(createElement(DriveModeNote, {}))).toBe("");
  });
});
