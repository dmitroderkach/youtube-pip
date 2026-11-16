import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TOKENS_CAP, degenerateTranscript, transcriptTokenBudget } from './transcript-guard.mjs';

test('token budget: from the duration, else from the file size, capped', () => {
  assert.equal(transcriptTokenBudget({ seconds: 60 }), 60 * 12 + 256);
  assert.equal(transcriptTokenBudget({ seconds: 60, bytes: 10 }), 60 * 12 + 256);
  assert.equal(transcriptTokenBudget({ bytes: 150000 }), 100 * 12 + 256);
  assert.equal(transcriptTokenBudget({ seconds: 3600 }), TOKENS_CAP);
  assert.equal(transcriptTokenBudget({}), TOKENS_CAP);
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
