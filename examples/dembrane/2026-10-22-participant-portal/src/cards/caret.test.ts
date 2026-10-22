import { describe, expect, it } from "vitest";
import { draftOffset } from "./caret";

// Stand-ins for the display's nodes: only their identity matters.
const display = {} as Node;
const draft = {} as Node;
const interim = {} as Node;

describe("draftOffset()", () => {
  it("is where the press landed in the draft", () => {
    const hit = { node: draft, offset: 7 };

    expect(draftOffset(hit, { display, draft, length: 20 })).toBe(7);
  });

  it("stays within the draft", () => {
    const hit = { node: draft, offset: 25 };

    expect(draftOffset(hit, { display, draft, length: 20 })).toBe(20);
  });

  it("is the end of the draft for a press on anything else after it", () => {
    const hit = { node: {} as Node, offset: 3 };

    expect(draftOffset(hit, { display, draft, length: 20 })).toBe(20);
  });

  it("is within the interim text, after the draft and its space, for a press on it", () => {
    const hit = { node: interim, offset: 3 };

    expect(
      draftOffset(hit, { display, draft, length: 20, interim, interimStart: 21 })
    ).toBe(24);
  });

  it("is the start for a press on the display before the draft", () => {
    const hit = { node: display, offset: 0 };

    expect(draftOffset(hit, { display, draft, length: 20 })).toBe(0);
  });

  it("is the end for a press on the display after the draft, like below it", () => {
    const hit = { node: display, offset: 2 };

    expect(draftOffset(hit, { display, draft, length: 20 })).toBe(20);
  });

  it("is the end when the browser can't say", () => {
    expect(draftOffset(null, { display, draft, length: 20 })).toBe(20);
  });

  it("is zero for an empty draft", () => {
    const hit = { node: display, offset: 0 };

    expect(draftOffset(hit, { display, draft: null, length: 0 })).toBe(0);
  });
});
