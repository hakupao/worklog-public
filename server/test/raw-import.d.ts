// Vitest (via Vite) resolves `?raw` imports as the file's raw text content at runtime; tsc needs
// this ambient declaration to typecheck them.
declare module "*?raw" {
  const content: string;
  export default content;
}
