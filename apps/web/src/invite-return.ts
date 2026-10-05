// Only a local invitation route is accepted; never redirect to arbitrary URLs.
export function inviteReturnPath(search = window.location.search) {
  const next = new URLSearchParams(search).get('next');
  return next && /^\/invite\/[A-Za-z0-9_-]{43}$/.test(next) ? next : null;
}
export function inviteAuthPath(path: string, next: string | null) {
  return next ? `${path}?next=${encodeURIComponent(next)}` : path;
}
