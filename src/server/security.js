// The SDK and model are served locally. This also blocks third-party metrics.
// wasm-unsafe-eval permits WebAssembly compilation, not JavaScript eval.
export const browserPolicy = [
  "default-src 'self'",
  "script-src 'self' 'wasm-unsafe-eval'",
  "connect-src 'self'",
  "worker-src 'self'",
  "img-src 'self' data:",
  "media-src 'self' blob:",
  "style-src 'self' 'unsafe-inline'",
  "object-src 'none'",
  "base-uri 'self'",
  "frame-ancestors 'none'"
].join('; ');
