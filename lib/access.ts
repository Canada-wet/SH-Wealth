export const ALLOWED_EMAILS = [
  "henrywhy233@gmail.com",
  "sallyxie0378@gmail.com",
] as const;
export function allowedEmail(email?: string | null) {
  return (
    !!email &&
    ALLOWED_EMAILS.some((item) => item === email.trim().toLowerCase())
  );
}
export function safeReturnPath(path: string | null) {
  return path?.startsWith("/") &&
    !path.startsWith("//") &&
    !/[\u0000-\u0020\\]/.test(path) &&
    !path.startsWith("/login") &&
    !path.startsWith("/auth/")
    ? path
    : "/space";
}
