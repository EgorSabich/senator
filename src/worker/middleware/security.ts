import type { MiddlewareHandler } from 'hono';

/**
 * Security headers on every response handled by the worker.
 * noindex is NOT protection — real protection is auth + server-side checks (stage 2).
 */
export const securityHeaders: MiddlewareHandler = async (c, next) => {
  await next();
  const h = c.res.headers;
  h.set('X-Robots-Tag', 'noindex, nofollow, noarchive');
  h.set('X-Content-Type-Options', 'nosniff');
  h.set('X-Frame-Options', 'DENY');
  h.set('Referrer-Policy', 'same-origin');
  h.set('Permissions-Policy', 'camera=(self), microphone=(), geolocation=()');
  h.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  if (c.req.path.startsWith('/api/')) {
    h.set('Cache-Control', 'no-store');
  }
};
