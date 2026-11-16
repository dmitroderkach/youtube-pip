/**
 * Guards for speech-to-text output (voice.mjs, Gemini): a bound on the output tokens from the audio's length, and a
 * check for a runaway transcript (the model looping on one phrase or writing its own reasoning instead of the
 * words), which voice.mjs treats as a failure so the AWS Transcribe fallback runs instead.
 *
 * Seen on 2026-11-16: a one-minute Ukrainian voice message came back as the real words, then English meta-text
 * ("Wait, let's listen to the very beginning…") and one question repeated a few hundred times.
 */

/**
 * Output token bound: TOKENS_PER_SECOND per second of audio + TOKENS_BASE, at most the model's own output limit
 * (gemini-3.5-flash: 65,536). Ukrainian speech runs at about 6–8 tokens per second, so 10 leaves room, and a
 * 15-minute message (≈ 9,300 tokens) fits.
 */
const TOKENS_PER_SECOND = 10;
const TOKENS_BASE = 256;
export const MODEL_OUTPUT_TOKENS_MAX = 65536;

/**
 * Request timeout: TIMEOUT_BASE_MS + TIMEOUT_MS_PER_10_SECONDS for every 10 s of audio, at most TIMEOUT_MAX_MS
 * (20 s for a short message, 110 s for 15 minutes), so a long message is not cut off and a runaway one still ends.
 */
const TIMEOUT_BASE_MS = 20000;
const TIMEOUT_MS_PER_10_SECONDS = 1000;
export const TIMEOUT_MAX_MS = 120000;

/** Telegram voice messages are OGG/Opus at roughly 2–4 KB per second; a low guess gives generous bounds. */
const BYTES_PER_SECOND_LOW = 1500;

/** Seconds of audio: Telegram's duration when known, else estimated from the file size; null when neither is. */
export function audioSeconds({ seconds, bytes } = {}) {
  if (Number(seconds) > 0) return Number(seconds);
  if (Number(bytes) > 0) return Number(bytes) / BYTES_PER_SECOND_LOW;
  return null;
}

/** maxOutputTokens for a transcript of this audio (`seconds` from Telegram, or the file size in `bytes`). */
export function transcriptTokenBudget(audio = {}) {
  const length = audioSeconds(audio);
  if (length === null) return MODEL_OUTPUT_TOKENS_MAX;
  return Math.min(MODEL_OUTPUT_TOKENS_MAX, Math.ceil(length * TOKENS_PER_SECOND) + TOKENS_BASE);
}

/** The Gemini request's timeout (ms) for this audio. */
export function transcriptTimeoutMs(audio = {}) {
  const length = audioSeconds(audio);
  if (length === null) return TIMEOUT_MAX_MS;
  return Math.min(
    TIMEOUT_MAX_MS,
    TIMEOUT_BASE_MS + Math.ceil(length / 10) * TIMEOUT_MS_PER_10_SECONDS
  );
}

/** English meta-text a transcript of the owner's speech never contains (the model talking about the audio). */
const META_TEXT = [
  /\bwait,\s*let'?s\b/i,
  /\blet'?s listen\b/i,
  /\b(?:listen|listening) (?:to|again)\b.*\b(?:beginning|audio|recording)\b/i,
  /\bthe (?:speaker|audio|recording) (?:says|said|is saying)\b/i,
  /\bor "[^"]{1,80}"\?/i,
];

/** Consecutive Latin-script words that make a run of English prose (terms such as "PR" or "Terraform" stay short). */
const LATIN_RUN = 10;
/** n-gram size, how often one n-gram may repeat, and the share of the words repeated n-grams may cover. */
const NGRAM = 3;
const NGRAM_MAX_REPEATS = 12;
const NGRAM_MAX_SHARE = 0.4;
/** Below this many words repetition is left alone (a short "так, так, так" is real speech). */
const MIN_WORDS_FOR_REPEATS = 60;

/**
 * Why a transcript looks degenerate (a short reason for the log), or null when it looks like speech.
 * `finishReason` is Gemini's (`MAX_TOKENS`: it ran into the bound, so the end is a loop or cut off).
 */
export function degenerateTranscript(text, finishReason) {
  if (finishReason === 'MAX_TOKENS') return 'hit the output token bound';
  const value = String(text ?? '');
  for (const pattern of META_TEXT) {
    if (pattern.test(value)) return `meta-text (${pattern.source})`;
  }
  const words = value.toLowerCase().match(/[\p{L}\p{N}'’-]+/gu) ?? [];
  let latinRun = 0;
  for (const word of words) {
    latinRun = /^[a-z'’-]+$/.test(word) ? latinRun + 1 : 0;
    if (latinRun >= LATIN_RUN) return `a run of ${LATIN_RUN}+ English words`;
  }
  if (words.length < MIN_WORDS_FOR_REPEATS) return null;
  const counts = new Map();
  for (let i = 0; i + NGRAM <= words.length; i++) {
    const gram = words.slice(i, i + NGRAM).join(' ');
    counts.set(gram, (counts.get(gram) ?? 0) + 1);
  }
  let top = 0;
  let topGram = '';
  for (const [gram, count] of counts) {
    if (count > top) [top, topGram] = [count, gram];
  }
  if (top > NGRAM_MAX_REPEATS && (top * NGRAM) / words.length > NGRAM_MAX_SHARE)
    return `"${topGram}" repeated ${top} times`;
  return null;
}
