/**
 * Writes text to the clipboard; false where the API is missing or refuses (an old WebView,
 * no user activation left, a denied permission), so the caller can show the text instead.
 */
export async function copyText(text: string): Promise<boolean> {
  if (typeof navigator.clipboard?.writeText !== 'function') return false;
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
