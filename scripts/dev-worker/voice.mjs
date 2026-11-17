/**
 * Voice of the chat (shared by the worker and the fast lane, docs/DEV_WORKER.md "Voice replies", "Code layout"):
 * speech to text of the owner's voice messages (Gemini on Vertex AI, AWS Transcribe as the fallback), speech
 * synthesis of replies (Chirp 3 HD or Gemini-TTS) with the Gemini budget from Google's own figures, and the `/voice`
 * settings menu.
 *
 * createVoice({ env, log, telegram, settings, store, aws, upload, bucket, onUsageChanged, formatTime }):
 * - settings: { get() -> { voiceMode, voiceName, voiceModel }, set(patch) } (kept by the host, e.g. meta.json);
 * - store: { getJson(key) -> object | null (null only when missing), updateJson(key, (current) -> next) } on the state
 *   bucket (updateJson: a conditional read-modify-write retried on a conflict, as both lanes write the same objects);
 * - aws(...args): the AWS CLI (Transcribe); upload(path, s3Uri): put a local audio file into the bucket;
 * - onUsageChanged(): the Gemini figure changed (e.g. refresh the pinned status); formatTime(date, withDay).
 */
import { createSign } from 'node:crypto';
import { readPlainFile } from './isolation.mjs';
import {
  degenerateTranscript,
  transcriptTimeoutMs,
  transcriptTokenBudget,
} from './transcript-guard.mjs';
import {
  budgetLevel,
  budgetStates,
  latestBudgetState,
  mergeSpeechUsage,
  SPEECH_BUDGET_NAME,
} from './session-state.mjs';
import { VOICE_MODELS, voiceKeyboard, voiceText } from './telegram-format.mjs';

/** Voice / audio uploaded for AWS Transcribe (deleted after; the bucket lifecycle covers leftovers). */
const INBOX_PREFIX = 'inbox/';

export function createVoice({
  env,
  log,
  telegram,
  settings,
  store,
  aws,
  upload,
  bucket,
  onUsageChanged = () => {},
  formatTime,
}) {
  const { say, sayHtml, editHtml, sendVoice } = telegram;
  const BUCKET = bucket;
  const TRANSCRIBE_LANGUAGE = env.TRANSCRIBE_LANGUAGE ?? 'uk-UA';
  const shortTime = formatTime;
  /** Voice replies (Google Cloud Text-to-Speech, Chirp 3 HD voices): OGG/Opus, sent as Telegram voice messages. */
  const TTS_URL = 'https://texttospeech.googleapis.com/v1/text:synthesize';
  const TTS_LANGUAGE = 'uk-UA';
  const TTS_VOICE_PREFIX = 'uk-UA-Chirp3-HD-';
  const TTS_DEFAULT_VOICE = env.TTS_VOICE ?? 'Aoede';
  /**
   * Gemini-TTS style instructions (VOICE_MODELS): Chirp 3 HD takes none, and its Ukrainian word stress and intonation
   * were often off.
   */
  const TTS_STYLE_PROMPT =
    'Read this Ukrainian text aloud the way a calm, friendly colleague talks: natural Ukrainian word stress and ' +
    'intonation, clear sentence structure, an even pace, no dramatising.';
  /** Female voices for `/voice samples` (Chirp 3 HD and Gemini-TTS share these names). */
  const TTS_SAMPLE_VOICES = ['Aoede', 'Kore', 'Leda', 'Zephyr', 'Despina', 'Sulafat'];
  const TTS_SAMPLE_TEXT =
    'Привіт! Це голос воркера youtube-pip. PR змерджено, перевірки зелені, можна релізити.';
  /** Spoken text cap (a summary of 20–40 s; a fallback cut of a long answer stays short). */
  const TTS_MAX_CHARS = 900;
  /** Voice reply modes: auto = only to the owner's voice messages, on = to every message, off = never. */
  const VOICE_MODES = ['auto', 'on', 'off'];
  const VOICE_BLOCK_RE = /<voice>([\s\S]*?)<\/voice>/i;
  const TRANSCRIBE_POLL_MS = 2000;
  const TRANSCRIBE_TIMEOUT_MS = 180000;
  /** Telegram MIME type → AWS Transcribe media format. */
  const TRANSCRIBE_FORMATS = {
    'audio/ogg': 'ogg',
    'audio/opus': 'ogg',
    'audio/mpeg': 'mp3',
    'audio/mp3': 'mp3',
    'audio/mp4': 'mp4',
    'audio/x-m4a': 'mp4',
    'audio/m4a': 'mp4',
    'audio/wav': 'wav',
    'audio/x-wav': 'wav',
    'audio/flac': 'flac',
    'audio/webm': 'webm',
  };
  /**
   * Speech to text with Gemini 3.5 Flash on Vertex AI (GA, `global`; the service account of the speech models,
   * GOOGLE_TTS_API_KEY): one synchronous request, ~1–3 s for a voice message, ~$0.005 per minute of audio (32 audio
   * tokens per second at $1.50 / 1M, text output $9 / 1M). Flash-Lite was cheaper but put in words the owner never
   * said. AWS Transcribe (a batch job, ~10 s, $0.024 / min) is the fallback.
   */
  const TRANSCRIBE_MODEL = 'gemini-3.5-flash';
  /**
   * An overloaded Gemini (429 "Resource exhausted": Vertex AI's shared quota, seen live on 2026-11-16; or 5xx) is
   * asked once more after a short pause; then AWS Transcribe takes the message.
   */
  const TRANSCRIBE_RETRY_DELAY_MS = 1000;
  const overloaded = (error) => /^Gemini (429|5\d\d)\b/.test(String(error?.message ?? ''));
  const TRANSCRIBE_PROMPT =
    'Transcribe this voice message word for word, exactly as spoken. It is mostly Ukrainian and may contain English ' +
    'technical terms (PR, CI, merge, Terraform, Docker, Claude, Gemini, youtube-pip, Telegram). Strict rules: never ' +
    'add, drop, reorder, replace or "improve" words; never guess what the speaker meant; keep repetitions, slang, ' +
    'surzhyk and unfinished sentences as they are; do not translate; write English terms in Latin script; when a ' +
    'word is not clear, write [нерозбірливо] instead of guessing. Output only the transcript text: no comments, ' +
    'quotes, labels or timestamps. If there is no speech, output nothing.';

  async function transcribeGemini(path, mimeType, { seconds } = {}) {
    const { token, project } = await gcpAccessToken();
    const audio = readPlainFile(path);
    // Bounds from the audio's length (transcript-guard.mjs): a slower or longer answer is a runaway and falls back
    const length = { seconds, bytes: audio.length };
    const url =
      `https://aiplatform.googleapis.com/v1/projects/${project}/locations/global/publishers/google/models/` +
      `${TRANSCRIBE_MODEL}:generateContent`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        contents: [
          {
            role: 'user',
            parts: [
              {
                inlineData: {
                  mimeType: mimeType || 'audio/ogg',
                  data: audio.toString('base64'),
                },
              },
              { text: TRANSCRIBE_PROMPT },
            ],
          },
        ],
        generationConfig: {
          temperature: 0,
          // The lowest thinking level of Gemini 3.x Flash (it cannot be turned off): a transcript needs none
          thinkingConfig: { thinkingLevel: 'MINIMAL' },
          maxOutputTokens: transcriptTokenBudget(length),
        },
      }),
      signal: AbortSignal.timeout(transcriptTimeoutMs(length)),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`Gemini ${res.status}: ${json.error?.message ?? 'no transcript'}`);
    const candidate = json.candidates?.[0] ?? {};
    const text = (candidate.content?.parts ?? [])
      // Thought summaries are not the transcript (not requested, but never take them as words)
      .filter((part) => !part.thought)
      .map((part) => part.text ?? '')
      .join('')
      .trim();
    const degenerate = degenerateTranscript(text, candidate.finishReason);
    if (degenerate) throw new Error(`Gemini transcript looks degenerate: ${degenerate}`);
    return text;
  }

  /** Text of a voice message or audio file: Gemini when the service account is there, AWS Transcribe otherwise. */
  async function transcribe(path, mimeType, { seconds } = {}) {
    if (ttsServiceAccount()) {
      try {
        return await transcribeGemini(path, mimeType, { seconds });
      } catch (error) {
        if (overloaded(error)) {
          log('Gemini transcription overloaded, retrying once', error);
          await new Promise((resolveDelay) => setTimeout(resolveDelay, TRANSCRIBE_RETRY_DELAY_MS));
          try {
            return await transcribeGemini(path, mimeType, { seconds });
          } catch (retryError) {
            log('Gemini transcription failed, falling back to AWS Transcribe', retryError);
          }
        } else {
          log('Gemini transcription failed, falling back to AWS Transcribe', error);
        }
      }
    }
    return transcribeAws(path, mimeType);
  }

  async function transcribeAws(path, mimeType) {
    const format = TRANSCRIBE_FORMATS[mimeType] ?? 'ogg';
    const key = `${INBOX_PREFIX}${path.slice(path.lastIndexOf('/') + 1)}`;
    // The project's prefix: the fast lane's role (permissions boundary) may only touch jobs named so
    const job = `youtube-pip-voice-${Date.now()}`;
    // Uploaded by Claude's user: the file is in Claude's inbox (never read with the worker's rights)
    await upload(path, `s3://${BUCKET}/${key}`);
    try {
      await aws(
        'transcribe',
        'start-transcription-job',
        '--transcription-job-name',
        job,
        '--media',
        `MediaFileUri=s3://${BUCKET}/${key}`,
        '--media-format',
        format,
        '--language-code',
        TRANSCRIBE_LANGUAGE
      );
      const started = Date.now();
      for (;;) {
        const out = JSON.parse(
          await aws(
            'transcribe',
            'get-transcription-job',
            '--transcription-job-name',
            job,
            '--output',
            'json'
          )
        ).TranscriptionJob;
        if (out.TranscriptionJobStatus === 'COMPLETED') {
          const transcript = await (await fetch(out.Transcript.TranscriptFileUri)).json();
          return (transcript.results?.transcripts ?? [])
            .map((t) => t.transcript)
            .join(' ')
            .trim();
        }
        if (out.TranscriptionJobStatus === 'FAILED')
          throw new Error(out.FailureReason ?? 'Transcribe failed');
        if (Date.now() - started > TRANSCRIBE_TIMEOUT_MS) throw new Error('Transcribe: таймаут');
        await new Promise((resolve) => setTimeout(resolve, TRANSCRIBE_POLL_MS));
      }
    } finally {
      await aws('transcribe', 'delete-transcription-job', '--transcription-job-name', job).catch(
        () => {}
      );
      await aws('s3', 'rm', `s3://${BUCKET}/${key}`, '--quiet').catch(() => {});
    }
  }

  const voiceMode = () =>
    VOICE_MODES.includes(settings.get()?.voiceMode) ? settings.get().voiceMode : 'auto';
  const voiceName = () => settings.get()?.voiceName ?? TTS_DEFAULT_VOICE;
  const voiceModel = () =>
    VOICE_MODELS[settings.get()?.voiceModel] ? settings.get().voiceModel : 'chirp3';

  /**
   * GOOGLE_TTS_API_KEY holds either a plain API key (Chirp 3 HD only) or the JSON key of a GCP service account (with
   * Vertex AI User and Service Usage Consumer): Gemini-TTS takes only OAuth, and Google cannot put its API and
   * Text-to-Speech in one API key. With the JSON, every request uses the account's token.
   */
  const ttsServiceAccount = () =>
    env.GOOGLE_TTS_API_KEY?.trim().startsWith('{') ? JSON.parse(env.GOOGLE_TTS_API_KEY) : null;

  /** OAuth access token of the service account in GOOGLE_TTS_API_KEY, cached. */
  let gcpToken = null;

  async function gcpAccessToken() {
    if (gcpToken && gcpToken.expires > Date.now() + 60_000) return gcpToken;
    const account = ttsServiceAccount();
    const base64url = (value) => Buffer.from(value).toString('base64url');
    const now = Math.floor(Date.now() / 1000);
    const unsigned = `${base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))}.${base64url(
      JSON.stringify({
        iss: account.client_email,
        scope: 'https://www.googleapis.com/auth/cloud-platform',
        aud: account.token_uri,
        iat: now,
        exp: now + 3600,
      })
    )}`;
    const signature = createSign('RSA-SHA256')
      .update(unsigned)
      .sign(account.private_key, 'base64url');
    const res = await fetch(account.token_uri, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion: `${unsigned}.${signature}`,
      }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok || !json.access_token) {
      throw new Error(
        `Google OAuth ${res.status}: ${json.error_description ?? json.error ?? 'no token'}`
      );
    }
    gcpToken = {
      token: json.access_token,
      project: account.project_id,
      expires: Date.now() + (json.expires_in ?? 3600) * 1000,
    };
    return gcpToken;
  }

  /** Credentials of a Text-to-Speech request: the service account's token, else the API key (Chirp 3 HD only). */
  async function ttsHeaders(gemini) {
    if (!env.GOOGLE_TTS_API_KEY) throw new Error('GOOGLE_TTS_API_KEY is not set');
    if (ttsServiceAccount()) {
      const { token, project } = await gcpAccessToken();
      return { Authorization: `Bearer ${token}`, 'x-goog-user-project': project };
    }
    if (gemini) {
      throw new Error(
        'Gemini voices need a service account JSON key in google_tts_api_key, not an API key'
      );
    }
    // The key in a header, never in the URL (URLs end up in error messages and logs)
    return { 'X-Goog-Api-Key': env.GOOGLE_TTS_API_KEY };
  }

  /**
   * Gemini speech budget from Google's own figures: the Cloud Billing budget `tts-voice-monthly` (Text-to-Speech of the
   * project; Gemini-TTS is billed there and Google's spend caps do not cover it) publishes its state to the Pub/Sub
   * topic `tts-budget` several times a day; the worker pulls the subscription BUDGET_SUBSCRIPTION_ID with the service
   * account in GOOGLE_TTS_API_KEY and keeps the newest figure in SPEECH_USAGE_KEY. No price formulas: the spend, the
   * budget and the period are Google's. At 80% a silent warning, at 100% Gemini is skipped (Chirp 3 HD) until the
   * period ends. TTS_MONTHLY_BUDGET_USD (Terraform `dev_worker_tts_monthly_budget_usd`) is only the off switch: 0 = no
   * Gemini speech.
   */
  const GEMINI_SPEECH_OFF = Number.parseFloat(env.TTS_MONTHLY_BUDGET_USD ?? '') === 0;
  const BUDGET_SUBSCRIPTION_ID = 'tts-budget-worker';
  /** Pull Google's budget figure this often while running (and before a Gemini reply when the last pull is older). */
  const BUDGET_PULL_MS = 15 * 60 * 1000;
  /** At most this many pulls in a row to empty the subscription's backlog (100 messages each). */
  const BUDGET_PULL_ROUNDS = 10;
  /** No figure from Google for this long while Gemini speech is in use: say so (the topic or the role may be missing). */
  const BUDGET_STALE_MS = 48 * 60 * 60 * 1000;

  class SpeechBudgetError extends Error {}

  const SPEECH_USAGE_KEY = 'state/voice-usage.json';

  /**
   * The saved budget state ({ period, usd, budget, currency, updatedAt, …flags }) or null. Only a missing object means
   * "none yet": any other failure (network, throttling) throws, so a failed read never replaces Google's figure.
   */
  async function speechUsage() {
    const usage = await store.getJson(SPEECH_USAGE_KEY);
    if (usage === null) return null;
    // The earlier estimate (`month`, `seconds`) is not Google's figure: ignored, replaced by the first pull
    return usage?.period ? usage : { waitingSince: usage?.waitingSince ?? null };
  }

  /**
   * Save the budget state, merged with what the other lane may have saved meanwhile (mergeSpeechUsage: the newest
   * Google figure, the flags of both), with a conditional write.
   */
  async function saveSpeechUsage(usage) {
    onUsageChanged();
    await store
      .updateJson(SPEECH_USAGE_KEY, (current) => mergeSpeechUsage(current, usage))
      .catch((error) => log('save speech usage failed', error));
  }

  const usd = (value) => `$${Number(value).toFixed(2)}`;

  let lastBudgetPull = 0;
  let lastBudgetError = '';

  /**
   * Pull Google's budget notifications, keep the newest figure and acknowledge everything pulled (test messages too);
   * the 80% warning and the stale-data note are sent from here.
   */
  async function pullSpeechBudget() {
    const account = ttsServiceAccount();
    if (!account || GEMINI_SPEECH_OFF) return;
    lastBudgetPull = Date.now();
    const subscription = `projects/${account.project_id}/subscriptions/${BUDGET_SUBSCRIPTION_ID}`;
    let received = [];
    try {
      const { token, project } = await gcpAccessToken();
      const headers = {
        Authorization: `Bearer ${token}`,
        'x-goog-user-project': project,
        'Content-Type': 'application/json',
      };
      // One pull returns only part of the backlog (Google publishes every ~20 min, the worker may have slept for
      // days): pull until the subscription is empty, then keep the newest figure
      for (let round = 0; round < BUDGET_PULL_ROUNDS; round++) {
        const res = await fetch(`https://pubsub.googleapis.com/v1/${subscription}:pull`, {
          method: 'POST',
          headers,
          body: JSON.stringify({ maxMessages: 100 }),
          // A pull with nothing queued may wait: an empty answer is fine
          signal: AbortSignal.timeout(10_000),
        }).catch((error) => {
          if (error?.name === 'TimeoutError') return null;
          throw error;
        });
        if (!res) break;
        const json = await res.json().catch(() => ({}));
        if (!res.ok)
          throw new Error(`Pub/Sub ${res.status}: ${json.error?.message ?? 'pull failed'}`);
        const batch = json.receivedMessages ?? [];
        if (!batch.length) break;
        received.push(...batch);
      }
      lastBudgetError = '';
      const states = budgetStates(received);
      const saved = await speechUsage();
      let usage = latestBudgetState(saved?.period ? saved : null, states) ?? {
        waitingSince: saved?.waitingSince ?? new Date().toISOString(),
      };
      const level = budgetLevel(usage);
      const warn = level === 'warn' && usage.warned !== usage.period;
      if (warn) usage = { ...usage, warned: usage.period };
      const stale = budgetStale(usage);
      if (stale) usage = { ...usage, staleNoted: usage.updatedAt ?? usage.waitingSince };
      if (states.length || warn || stale || !saved) await saveSpeechUsage(usage);
      // Acknowledged only once saved, so a failed save gets the figures again next time
      if (received.length) {
        await fetch(`https://pubsub.googleapis.com/v1/${subscription}:acknowledge`, {
          method: 'POST',
          headers,
          body: JSON.stringify({ ackIds: received.map((item) => item.ackId) }),
        }).catch((error) => log('budget acknowledge failed', error));
      }
      if (warn) {
        await say(
          `🟡 Gemini-озвучка: за даними Google витрачено ${usd(usage.usd)} з ${usd(usage.budget)} цього місяця.`,
          { silent: true }
        ).catch(() => {});
      }
      if (stale) await sayBudgetStale(usage);
    } catch (error) {
      lastBudgetError = String(error?.message ?? error).slice(0, 300);
      log('budget pull failed', error);
    }
  }

  /** Gemini speech is in use, but Google's figure is older than BUDGET_STALE_MS (said once per figure). */
  function budgetStale(usage) {
    if (!VOICE_MODELS[voiceModel()]?.model) return false;
    const since = usage.updatedAt ?? usage.waitingSince;
    return (
      Boolean(since) &&
      Date.now() - Date.parse(since) > BUDGET_STALE_MS &&
      usage.staleNoted !== since
    );
  }

  async function sayBudgetStale(usage) {
    await say(
      `🟡 Google не надсилає суму бюджету ${SPEECH_BUDGET_NAME} понад 48 год` +
        (usage.updatedAt
          ? ` (остання: ${usd(usage.usd)}, ${shortTime(new Date(usage.updatedAt), true)})`
          : '') +
        `: перевір, що бюджет підключено до топіка tts-budget, підписку ${BUDGET_SUBSCRIPTION_ID} і роль Pub/Sub ` +
        `Subscriber для сервісного акаунта.${lastBudgetError ? `\n${lastBudgetError}` : ''}`,
      { silent: true }
    ).catch(() => {});
  }

  async function speechUsageText() {
    if (GEMINI_SPEECH_OFF) return 'Gemini-озвучку вимкнено (TTS_MONTHLY_BUDGET_USD = 0)';
    const usage = await speechUsage().catch((error) => log('read speech usage failed', error));
    if (budgetLevel(usage) === 'none')
      return `Gemini: Google ще не надіслав суму бюджету ${SPEECH_BUDGET_NAME}`;
    const age = Math.max(0, Math.round((Date.now() - Date.parse(usage.updatedAt)) / 3_600_000));
    return `Gemini цього місяця: ${usd(usage.usd)} з ${usd(usage.budget)} (Google, ${age} год тому)`;
  }

  /** Throws SpeechBudgetError when Google's figure says the budget is spent (saying so once a period). */
  /**
   * A pull when the last one is older than BUDGET_PULL_MS (none yet in this process: at once). The fast lane calls it
   * in the background with each invocation, so Google's figure stays current while the worker sleeps.
   */
  async function pullSpeechBudgetIfDue() {
    if (Date.now() - lastBudgetPull > BUDGET_PULL_MS) await pullSpeechBudget();
  }

  async function checkSpeechBudget() {
    if (GEMINI_SPEECH_OFF) throw new SpeechBudgetError('Gemini-озвучку вимкнено');
    if (Date.now() - lastBudgetPull > BUDGET_PULL_MS) await pullSpeechBudget();
    // Unreadable usage does not block speech (the next request checks again)
    const usage = await speechUsage().catch((error) => log('read speech usage failed', error));
    if (budgetLevel(usage) !== 'exhausted') return;
    if (usage.exhausted !== usage.period) {
      await saveSpeechUsage({ ...usage, exhausted: usage.period });
      await say(
        `🔇 Ліміт Gemini-озвучки вичерпано: за даними Google ${usd(usage.usd)} з ${usd(usage.budget)}. ` +
          'До кінця місяця відповідаю голосом Chirp 3 HD.'
      );
    }
    throw new SpeechBudgetError('ліміт Gemini-озвучки на цей місяць вичерпано');
  }

  /** OGG/Opus audio of `text` in the voice `name` with the speech model `model` (VOICE_MODELS), or throws. */
  async function synthesize(text, name = voiceName(), model = voiceModel()) {
    const gemini = Boolean(VOICE_MODELS[model]?.model);
    if (gemini) await checkSpeechBudget();
    const res = await fetch(TTS_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(await ttsHeaders(gemini)) },
      body: JSON.stringify(
        gemini
          ? {
              input: { text, prompt: TTS_STYLE_PROMPT },
              voice: { languageCode: TTS_LANGUAGE, name, modelName: VOICE_MODELS[model].model },
              audioConfig: { audioEncoding: 'OGG_OPUS' },
            }
          : {
              input: { text },
              voice: { languageCode: TTS_LANGUAGE, name: `${TTS_VOICE_PREFIX}${name}` },
              audioConfig: { audioEncoding: 'OGG_OPUS' },
            }
      ),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok || !json.audioContent) {
      throw new Error(`Text-to-Speech ${res.status}: ${json.error?.message ?? 'no audio'}`);
    }
    const audio = Buffer.from(json.audioContent, 'base64');
    return audio;
  }

  /** Text to speak when Claude gave no <voice> block: the answer without links, code and markup, cut short. */
  function speakable(text) {
    const plain = text
      .replace(/```[\s\S]*?```/g, ' ')
      .replace(/`[^`]*`/g, ' ')
      .replace(/https?:\/\/\S+/g, ' ')
      .replace(/[*_#>|]/g, ' ')
      .replace(/[ \t]+/g, ' ')
      .trim();
    if (plain.length <= TTS_MAX_CHARS) return plain;
    const cut = plain.slice(0, TTS_MAX_CHARS);
    return cut.slice(0, Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('\n'), 200) + 1);
  }

  /** Note for Claude on a message that gets a voice reply: end the answer with a spoken summary. */
  const VOICE_NOTE =
    '[Voice reply: end your answer with <voice>…</voice>, a short spoken summary in Ukrainian for the owner to hear ' +
    '(1–4 natural sentences, 20–40 s, no links, code, paths, ids or lists; short, simply built sentences, numbers ' +
    'and abbreviations written out as words, so speech synthesis reads them naturally). The worker removes it from ' +
    'the text and sends it as a voice message.]';

  /** Split the spoken summary off the answer: { text, spoken }. */
  function splitVoiceBlock(answer) {
    const match = answer.match(VOICE_BLOCK_RE);
    if (!match) return { text: answer, spoken: null };
    return { text: answer.replace(VOICE_BLOCK_RE, '').trim(), spoken: match[1].trim() || null };
  }

  /**
   * Audio of a voice reply: with a Gemini model chosen, a failed synthesis (quota, spend cap, a refused token, an
   * outage) falls back to Chirp 3 HD, so the reply still gets its voice; the fallback is logged and noted silently.
   */
  async function synthesizeWithFallback(text) {
    const model = voiceModel();
    try {
      return await synthesize(text, voiceName(), model);
    } catch (error) {
      if (!VOICE_MODELS[model]?.model) throw error;
      // The budget is spent: Chirp without a note each time (the chat was told once)
      if (error instanceof SpeechBudgetError) return synthesize(text, voiceName(), 'chirp3');
      log(`voice reply: ${model} failed, falling back to chirp3`, error);
      const audio = await synthesize(text, voiceName(), 'chirp3');
      await say(
        `ℹ️ ${VOICE_MODELS[model].label} не озвучив (${String(error.message ?? error).slice(0, 200)}), озвучено Chirp 3 HD`,
        { silent: true }
      ).catch(() => {});
      return audio;
    }
  }

  /** The `/voice` message: settings and buttons (`messageId`: edit that message instead of sending one). */
  async function voiceMenu(messageId) {
    const keyboard = voiceKeyboard(TTS_SAMPLE_VOICES, voiceMode(), voiceName(), voiceModel());
    const html = voiceText(voiceMode(), voiceName(), voiceModel(), await speechUsageText());
    if (messageId) await editHtml(messageId, html, keyboard);
    else await sayHtml(html, keyboard);
  }

  function setVoiceMode(mode) {
    settings.set({ voiceMode: mode });
  }

  async function voiceSamples() {
    for (const name of TTS_SAMPLE_VOICES) {
      try {
        await sendVoice(
          await synthesize(TTS_SAMPLE_TEXT, name),
          `${VOICE_MODELS[voiceModel()].label} · ${name} — /voice ${name}`
        );
      } catch (error) {
        await say(`⚠️ ${name}: ${String(error.message ?? error).slice(0, 300)}`);
        return;
      }
    }
  }

  /** The same sentence in the current voice with every speech model, to compare them by ear. */
  async function voiceCompare() {
    for (const [key, { label }] of Object.entries(VOICE_MODELS)) {
      try {
        await sendVoice(
          await synthesize(TTS_SAMPLE_TEXT, voiceName(), key),
          `${label} · ${voiceName()}`
        );
      } catch (error) {
        await say(`⚠️ ${label}: ${String(error.message ?? error).slice(0, 300)}`);
      }
    }
  }

  /** Switch to the speech model `key` after a sample of it; false when it does not work. */
  async function setVoiceModel(key) {
    const { label } = VOICE_MODELS[key];
    try {
      await sendVoice(
        await synthesize(`Тепер я говорю моделлю ${label}.`, voiceName(), key),
        label
      );
    } catch (error) {
      await say(`⚠️ Модель ${label} не працює: ${String(error.message ?? error).slice(0, 300)}`);
      return false;
    }
    settings.set({ voiceModel: key });
    return true;
  }

  /** Switch to the voice `name` after a sample of it; false when it does not work. */
  async function setVoice(name) {
    try {
      await sendVoice(await synthesize(`Тепер я говорю голосом ${name}.`, name), name);
    } catch (error) {
      await say(`⚠️ Голос ${name} не працює: ${String(error.message ?? error).slice(0, 300)}`);
      return false;
    }
    settings.set({ voiceName: name });
    return true;
  }

  /** `/voice` [auto | on | off | samples | compare | <voice name>]: voice reply settings, answered without a Claude turn. */
  async function voiceCommand(argument) {
    const arg = (argument ?? '').trim();
    if (!arg) return voiceMenu();
    if (VOICE_MODES.includes(arg.toLowerCase())) {
      setVoiceMode(arg.toLowerCase());
      return voiceMenu();
    }
    if (arg.toLowerCase() === 'samples') return voiceSamples();
    if (arg.toLowerCase() === 'compare') return voiceCompare();
    const name = arg.charAt(0).toUpperCase() + arg.slice(1).toLowerCase();
    if (!/^[A-Z][a-z]+$/.test(name)) {
      await say('ℹ️ /voice auto | on | off | samples | <імʼя голосу>');
      return;
    }
    if (await setVoice(name)) await voiceMenu();
  }

  /** A `/voice` button: `mode:<auto|on|off>`, `name:<voice>` or `samples`; the menu is updated in place. */
  async function onVoiceButton(messageId, id, value) {
    if (id === 'samples') return voiceSamples();
    if (id === 'compare') return voiceCompare();
    if (id === 'model' && VOICE_MODELS[value] && value !== voiceModel()) await setVoiceModel(value);
    if (id === 'mode' && VOICE_MODES.includes(value) && value !== voiceMode()) setVoiceMode(value);
    if (id === 'name' && TTS_SAMPLE_VOICES.includes(value) && value !== voiceName())
      await setVoice(value);
    await voiceMenu(messageId);
  }

  return {
    VOICE_MODES,
    VOICE_NOTE,
    TTS_MAX_CHARS,
    TTS_SAMPLE_VOICES,
    voiceMode,
    voiceName,
    voiceModel,
    transcribe,
    synthesize,
    synthesizeWithFallback,
    speakable,
    splitVoiceBlock,
    speechUsage,
    speechUsageText,
    pullSpeechBudget,
    pullSpeechBudgetIfDue,
    BUDGET_PULL_MS,
    voiceCommand,
    onVoiceButton,
  };
}
