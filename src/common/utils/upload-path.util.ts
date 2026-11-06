import { isAbsolute, join, relative, resolve, sep } from 'path';

/**
 * The uploads folder. UPLOAD_BASE_PATH may be relative ("uploads", the default: inside the working
 * directory) or absolute ("D:\data\uploads", "/var/careflow/uploads": used as given, e.g. a separate
 * drive or mounted volume). Every upload area must build its folder from here so they all agree.
 */
export function uploadBasePath(base: string = process.env.UPLOAD_BASE_PATH ?? 'uploads'): string {
  return resolve(process.cwd(), base);
}

/**
 * A folder or file inside the uploads folder. Segments are joined (never resolved), so a stored
 * relative path can't jump out of the uploads folder by being absolute; callers that take a path from
 * stored data must still check it stays inside (see the policy and document stores).
 */
export function uploadPath(...segments: string[]): string {
  return join(uploadBasePath(), ...segments);
}

/**
 * A stored path or URL ("/uploads/company/logo.png" or "company/logo.png") as a file inside the
 * uploads folder, or null when it is empty, holds a NUL, or would land outside the folder ("..",
 * an absolute path, a drive letter) or on the folder itself. Use it wherever a path read from the
 * database is joined onto the uploads folder.
 */
export function safeUploadPath(stored: string | null | undefined, base: string = uploadBasePath()): string | null {
  if (!stored || stored.includes('\0')) return null;
  const rel = stored.replace(/^\/uploads\//, '');
  if (!rel || isAbsolute(rel) || /^[a-zA-Z]:/.test(rel)) return null;
  const root = resolve(base);
  const absolute = resolve(root, rel);
  const inside = relative(root, absolute);
  if (!inside || inside === '..' || inside.startsWith(`..${sep}`) || isAbsolute(inside)) return null;
  return absolute;
}
