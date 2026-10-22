import { describe, expect, it } from "vitest";
import { parseJsonc } from "./jsonc";

describe("parseJsonc", () => {
  it("parses whole-line comments, trailing inline comments, a // inside a URL value, and a trailing comma", () => {
    const text = `{
  // whole-line comment
  "a": 1,
  "b": "https://example.com/x", // trailing inline comment
  "c": [1, 2, 3,],
}`;
    expect(parseJsonc(text)).toEqual({ a: 1, b: "https://example.com/x", c: [1, 2, 3] });
  });
});
