// Workers-only Web Crypto extension the server's bearer check uses (auth.ts). Browsers and Node lack it.
type Bytes = ArrayBuffer | ArrayBufferView;
declare global { interface SubtleCrypto { timingSafeEqual(a: Bytes, b: Bytes): boolean } }
const view = (b: Bytes) => (b instanceof ArrayBuffer ? new Uint8Array(b) : new Uint8Array(b.buffer, b.byteOffset, b.byteLength));
const subtle = globalThis.crypto.subtle;
if (typeof (subtle as Partial<SubtleCrypto>).timingSafeEqual !== "function") {
  Object.defineProperty(Object.getPrototypeOf(subtle), "timingSafeEqual", {
    configurable: true, writable: true,
    value(a: Bytes, b: Bytes): boolean {
      const x = view(a), y = view(b);
      if (x.byteLength !== y.byteLength) throw new TypeError("Input buffers must have the same byte length");
      let d = 0;
      for (let i = 0; i < x.byteLength; i++) d |= x[i] ^ y[i];
      return d === 0;
    },
  });
}

export {};
