import { parse } from "jsonc-parser";

// Parse JSONC (comments, trailing commas) the way wrangler.jsonc is actually written.
// A hand-rolled "// comment" regex only strips whole-line comments: it breaks on a
// trailing inline comment or on a URL value that itself contains "//".
export function parseJsonc(text: string): any {
  return parse(text);
}
