/**
 * Auth utility — manajemen token admin dan member di sessionStorage
 * Token disimpan di browser session (terhapus otomatis saat tab ditutup).
 */

const ADMIN_TOKEN_KEY = "gr_admin_token";
const MEMBER_TOKEN_KEY = "gr_member_token";

// ─── Admin ────────────────────────────────────────────────────────────────────
export const getAdminToken = (): string | null =>
  typeof window !== "undefined" ? sessionStorage.getItem(ADMIN_TOKEN_KEY) : null;

export const setAdminToken = (token: string): void =>
  sessionStorage.setItem(ADMIN_TOKEN_KEY, token);

export const clearAdminToken = (): void =>
  sessionStorage.removeItem(ADMIN_TOKEN_KEY);

// ─── Member ───────────────────────────────────────────────────────────────────
export const getMemberToken = (): string | null =>
  typeof window !== "undefined" ? sessionStorage.getItem(MEMBER_TOKEN_KEY) : null;

export const setMemberToken = (token: string): void =>
  sessionStorage.setItem(MEMBER_TOKEN_KEY, token);

export const clearMemberToken = (): void =>
  sessionStorage.removeItem(MEMBER_TOKEN_KEY);

// ─── Helpers ──────────────────────────────────────────────────────────────────
/** Token terbaik yang tersedia: admin lebih prioritas dari member */
export const getAuthToken = (): string | null =>
  getAdminToken() ?? getMemberToken();

export const isAdmin = (): boolean => !!getAdminToken();
export const isMember = (): boolean => !!(getAdminToken() ?? getMemberToken());

export const logout = (role: "admin" | "member" | "all" = "all"): void => {
  if (role === "admin" || role === "all") clearAdminToken();
  if (role === "member" || role === "all") clearMemberToken();
};

/** Kirim request dengan Bearer token auth */
export async function authFetch(
  url: string,
  options: RequestInit = {},
  token?: string | null
): Promise<Response> {
  const tok = token ?? getAuthToken();
  return fetch(url, {
    ...options,
    headers: {
      ...(options.headers ?? {}),
      ...(tok ? { Authorization: `Bearer ${tok}` } : {}),
      "Content-Type": "application/json",
    },
  });
}
