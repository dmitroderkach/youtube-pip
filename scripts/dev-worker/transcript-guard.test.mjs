import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  MODEL_OUTPUT_TOKENS_MAX,
  TIMEOUT_MAX_MS,
  degenerateTranscript,
  transcriptTimeoutMs,
  transcriptTokenBudget,
} from './transcript-guard.mjs';

test('token budget: 10 per second + 256 from the duration, else the file size; the model limit at most', () => {
  assert.equal(transcriptTokenBudget({ seconds: 60 }), 60 * 10 + 256);
  assert.equal(transcriptTokenBudget({ seconds: 60, bytes: 10 }), 60 * 10 + 256);
  assert.equal(transcriptTokenBudget({ bytes: 150000 }), 100 * 10 + 256);
  assert.equal(transcriptTokenBudget({ seconds: 15 * 60 }), 900 * 10 + 256);
  assert.equal(transcriptTokenBudget({ seconds: 10 * 3600 }), MODEL_OUTPUT_TOKENS_MAX);
  assert.equal(transcriptTokenBudget({}), MODEL_OUTPUT_TOKENS_MAX);
});

test('timeout: 20 s + 1 s per 10 s of audio, 120 s at most', () => {
  assert.equal(transcriptTimeoutMs({ seconds: 5 }), 21000);
  assert.equal(transcriptTimeoutMs({ seconds: 60 }), 26000);
  assert.equal(transcriptTimeoutMs({ seconds: 15 * 60 }), 110000);
  assert.equal(transcriptTimeoutMs({ seconds: 3600 }), TIMEOUT_MAX_MS);
  assert.equal(transcriptTimeoutMs({ bytes: 15000 }), 21000);
  assert.equal(transcriptTimeoutMs({}), TIMEOUT_MAX_MS);
});

test('ordinary speech passes, with English terms and short repetitions', () => {
  for (const text of [
    'Окей, давай тоді змерджимо PR і запустимо Terraform plan, а потім перевіримо CI.',
    'Так, так, так, так, я зрозумів. Ну давай.',
    'Ну і знову воно застрягло, глянь логи CloudWatch для fast lane, будь ласка.',
    '',
  ]) {
    assert.equal(degenerateTranscript(text, 'STOP'), null, text);
  }
});

test('the output token bound is a failure', () => {
  assert.match(degenerateTranscript('Окей.', 'MAX_TOKENS'), /token bound/);
});

test('a runaway transcript with leaked reasoning and a repeated question is caught', () => {
  const loop = Array.from(
    { length: 200 },
    () => `"справжній дев'ятий" or "справжній дев'ять"?`
  ).join(' ');
  const bad =
    'нерозбірливо] порядок повідомлень це справжній дев\'ять. А, окей, окей. Ну то давай це виправим, я поняв."\n' +
    '    *   Wait, let\'s listen to the very beginning: "А-а... порядок повідомлень це справжній дев\'ять."\n' +
    `    *   Actually, ${loop}`;
  assert.ok(degenerateTranscript(bad, 'STOP'));
});

test('each signal on its own', () => {
  assert.match(
    degenerateTranscript(
      'Добре. Hmm, I need to think about what was actually meant here.',
      'STOP'
    ) ?? '',
    /English/
  );
  assert.match(degenerateTranscript("Окей. Wait, let's check that.", 'STOP'), /meta-text/);
  const repeated = `${'ну давай це '.repeat(40)}і все`;
  assert.match(degenerateTranscript(repeated, 'STOP'), /repeated/);
});
