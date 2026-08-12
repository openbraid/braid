/**
 * POSIX-safe shell escape: wraps string in single quotes,
 * escaping any internal single quotes via the '\'' idiom
 * (end quote, escaped literal quote, start quote).
 *
 * Handles newlines, double quotes, backticks, dollar signs, etc.
 */
export function shellEscape(s: string): string {
  return "'" + s.replace(/'/g, "'\\''") + "'"
}
