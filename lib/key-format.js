/**
 * Advisory API-key shape check for the settings panel. Never blocks anything:
 * providers change formats (Gemini AIzaSy… → AQ.…), so an unknown shape is
 * 'unknown' and the real connection test decides.
 */
export const KNOWN_KEY_PREFIXES = {
  gemini: ['AIzaSy', 'AQ.'],
  openai: ['sk-'],
  claude: ['sk-ant-'],
};

/** @returns {'ok'|'bad'|'unknown'} */
export function classifyApiKey(engine, key) {
  if (key.length < 10) return 'bad';
  const prefixes = KNOWN_KEY_PREFIXES[engine];
  if (!prefixes) return 'ok';
  return prefixes.some((p) => key.startsWith(p)) ? 'ok' : 'unknown';
}
