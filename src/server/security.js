// Pose SDK/model remain local. Explicit Google origins are for login/App Check.
// wasm-unsafe-eval permits WebAssembly compilation, not JavaScript eval.
export const browserPolicy = [
  "default-src 'self'",
  "script-src 'self' 'wasm-unsafe-eval' https://www.google.com/recaptcha/ https://www.gstatic.com/recaptcha/",
  "connect-src 'self' https://identitytoolkit.googleapis.com https://securetoken.googleapis.com https://firebaseappcheck.googleapis.com https://content-firebaseappcheck.googleapis.com https://www.google.com/recaptcha/ https://recaptchaenterprise.googleapis.com",
  "frame-src https://www.google.com/recaptcha/ https://recaptcha.google.com/recaptcha/",
  "worker-src 'self'",
  "img-src 'self' data:",
  "media-src 'self' blob:",
  "style-src 'self' 'unsafe-inline'",
  "object-src 'none'",
  "base-uri 'self'",
  "frame-ancestors 'none'"
].join('; ');
