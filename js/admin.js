// Admin accounts — mirrors the email allowlist in firestore.rules.
export const ADMIN_EMAILS = ['test@example.com', 'hagaigreenfeld@gmail.com'];

export function isAdmin(user) {
  return !!user && ADMIN_EMAILS.includes(user.email);
}
