/**
 * The owner's answers in the chat (shared by the worker and the fast lane, docs/DEV_WORKER.md "Modes, questions and
 * plans", "Code layout"): questions with buttons (AskUserQuestion), permission prompts with allow / deny buttons, and
 * the registry of everything waiting for the owner (a button press or a text message answers it; it is given up
 * after ANSWER_TIMEOUT_MS or when the tool call is aborted).
 *
 * createInteractions({ telegram, onWaiting }): onWaiting() runs when something starts waiting (e.g. the
 * progress message says so). Hosts with more kinds (the worker's plan review) use waitForOwner / newPendingId.
 */
import {
  escapeHtml,
  permissionHtml,
  permissionKeyboard,
  questionHtml,
  questionKeyboard,
} from './telegram-format.mjs';

/** A question / plan / permission prompt nobody answers is given up after this long (the turn ends, idle follows). */
export const ANSWER_TIMEOUT_MS = 60 * 60 * 1000;

export function createInteractions({ telegram, onWaiting = () => {} }) {
  const { sayHtml, editHtml, editButtons } = telegram;
  /** Questions, plans and permission prompts waiting for the owner: id → { kind, messageId, resolve, ... }. */
  const pending = new Map();
  let pendingSeq = 0;
  /** The interaction a text message from the owner answers (the newest one that takes text). */
  let textTarget = null;

  const newPendingId = () =>
    `${(++pendingSeq).toString(36)}${Math.random().toString(36).slice(2, 6)}`;

  /** Wait for the owner (a button or a text message) with a timeout and the tool call's abort signal. */
  function waitForOwner(entry, signal) {
    return new Promise((resolve) => {
      const done = (value) => {
        clearTimeout(timer);
        signal?.removeEventListener('abort', onAbort);
        pending.delete(entry.id);
        if (textTarget === entry)
          textTarget = [...pending.values()].reverse().find((e) => e.takesText) ?? null;
        resolve(value);
      };
      const onAbort = () => done({ aborted: true });
      const timer = setTimeout(() => done({ timeout: true }), ANSWER_TIMEOUT_MS);
      signal?.addEventListener('abort', onAbort, { once: true });
      entry.resolve = done;
      pending.set(entry.id, entry);
      if (entry.takesText) textTarget = entry;
      onWaiting();
    });
  }

  const giveUpText = (result) =>
    result.aborted ? '⌛ Скасовано' : `⌛ Без відповіді ${ANSWER_TIMEOUT_MS / 60000} хв`;
  /** AskUserQuestion: every question as a message with buttons; returns the tool's updated input with answers. */
  async function askQuestions(input, signal) {
    const questions = Array.isArray(input.questions) ? input.questions : [];
    const answers = {};
    for (const [index, question] of questions.entries()) {
      const id = newPendingId();
      const html = questionHtml(question, index, questions.length);
      const sent = await sayHtml(html, questionKeyboard(id, index, question));
      const entry = {
        id,
        kind: 'q',
        question,
        index,
        html,
        messageId: sent?.message_id,
        picked: new Set(),
        // A buttons-only question (question.buttonsOnly) never takes the owner's next text message as its answer
        takesText: !question.buttonsOnly,
      };
      const result = await waitForOwner(entry, signal);
      if (result.aborted || result.timeout) {
        if (entry.messageId) await editHtml(entry.messageId, `${html}\n\n${giveUpText(result)}`);
        return {
          behavior: 'deny',
          message: result.aborted
            ? 'Cancelled.'
            : 'The owner did not answer in time; ask again later.',
        };
      }
      answers[question.question] = result.answer;
      if (entry.messageId)
        await editHtml(entry.messageId, `${html}\n\n✅ <b>${escapeHtml(result.answer)}</b>`);
    }
    return { behavior: 'allow', updatedInput: { ...input, answers } };
  }

  /** A question's button: an option (single choice answers, multi-select toggles), "done" or "own answer". */
  async function onQuestionButton(entry, value) {
    const [, choice] = value.split('.');
    const { question } = entry;
    if (choice === 'own') {
      if (question.buttonsOnly) return;
      textTarget = entry;
      if (entry.messageId)
        await editHtml(entry.messageId, `${entry.html}\n\n✏️ <i>Напиши відповідь текстом</i>`);
      return;
    }
    if (choice === 'done') {
      const labels = question.options.filter((_, i) => entry.picked.has(i)).map((o) => o.label);
      if (!labels.length) return;
      entry.resolve({ answer: labels.join(', ') });
      return;
    }
    const option = question.options[Number(choice)];
    if (!option) return;
    if (!question.multiSelect) {
      entry.resolve({ answer: option.label });
      return;
    }
    const i = Number(choice);
    if (entry.picked.has(i)) entry.picked.delete(i);
    else entry.picked.add(i);
    if (entry.messageId) {
      await editButtons(
        entry.messageId,
        questionKeyboard(entry.id, entry.index, question, entry.picked)
      );
    }
  }
  /** A permission prompt (manual mode, auto's undecided calls, plan mode): the action with allow / deny buttons. */
  async function askPermission(toolName, input, options) {
    const id = newPendingId();
    const html = permissionHtml(toolName, input, options);
    const canAlways = !options.suppressAlwaysAllowRule && Boolean(options.suggestions?.length);
    const sent = await sayHtml(html, permissionKeyboard(id, canAlways));
    const entry = { id, kind: 'perm', html, messageId: sent?.message_id, takesText: true };
    const result = await waitForOwner(entry, options.signal);
    const close = (status) => entry.messageId && editHtml(entry.messageId, `${html}\n\n${status}`);
    if (result.aborted || result.timeout) {
      await close(giveUpText(result));
      return {
        behavior: 'deny',
        message: 'The owner did not answer the permission prompt.',
        interrupt: result.timeout,
      };
    }
    if (result.decision === 'allow' || result.decision === 'always') {
      await close(
        result.decision === 'always' ? '♾ <b>Дозволено до кінця сесії</b>' : '✅ <b>Дозволено</b>'
      );
      return {
        behavior: 'allow',
        updatedInput: input,
        // Claude Code's suggestions usually target localSettings (.claude/settings.local.json in the working copy,
        // which is saved to S3 and not git-ignored here): kept for this session only, as the button says
        ...(result.decision === 'always'
          ? {
              updatedPermissions: options.suggestions.map((rule) => ({
                ...rule,
                destination: 'session',
              })),
            }
          : {}),
      };
    }
    if (result.answer) {
      await close(`❌ <b>Відхилено:</b> ${escapeHtml(result.answer)}`);
      return { behavior: 'deny', message: `The owner declined this and said: ${result.answer}` };
    }
    await close('❌ <b>Відхилено</b>');
    return { behavior: 'deny', message: 'The owner declined this action.' };
  }
  /** Text answers go to a pending question only without photos / files (those are delivered as a message). */
  const answersPending = (message) =>
    Boolean(textTarget) &&
    (message.attachments ?? []).every((a) => a.kind === 'voice' || a.kind === 'audio');

  /** The entry a text message answers now (the newest one that takes text), or null. */
  const getTextTarget = () => textTarget;
  /** True while a question or a permission prompt waits for the owner (no "typing…" then). */
  const waitingForOwner = () => pending.size > 0;
  /** Make `entry` the one a text message answers (e.g. "own answer", "revise"). */
  const setTextTarget = (entry) => {
    textTarget = entry;
  };
  /** A waiting entry by id (a button's callback), or undefined. */
  const getPending = (id) => pending.get(id);
  /** Give up everything waiting (the session ends): each tool call gets "aborted". */
  const abortAll = () => {
    for (const entry of [...pending.values()]) entry.resolve({ aborted: true });
  };

  /** The owner's text (already transcribed) answers the entry text messages go to now. */
  function answerText(text) {
    const entry = textTarget;
    if (!entry || !text) return;
    entry.resolve(entry.kind === 'perm' ? { decision: 'deny', answer: text } : { answer: text });
  }

  return {
    newPendingId,
    waitForOwner,
    giveUpText,
    getPending,
    abortAll,
    getTextTarget,
    waitingForOwner,
    setTextTarget,
    askQuestions,
    onQuestionButton,
    askPermission,
    answersPending,
    answerText,
  };
}
