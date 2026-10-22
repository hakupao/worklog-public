// Demo stand-in for @cloudflare/puppeteer: there is no Browser Run in a browser tab or in the seed build. The demo
// replaces pdfDeps.htmlToPdf (app.ts), so this is never reached; if it is, the PDF route answers its own 502.
const puppeteer = {
  launch(): never { throw new Error("Browser Run is not available in the demo"); },
};
export default puppeteer;
