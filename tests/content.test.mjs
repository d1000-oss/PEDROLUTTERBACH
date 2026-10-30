import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateBiografia, ValidationError } from '../netlify/lib/content.mjs';

const ok = {
  heading: 'Música que sai dos',
  headingAccent: 'limites da erudição.',
  paragraphs: ['Texto com [link](https://exemplo.com).'],
  timeline: [{ year: '1982', title: 'Nasce', body: '' }],
};

const fields = fn => {
  try { fn(); } catch (e) { assert.ok(e instanceof ValidationError); return e.detalhes.map(d => d.campo); }
  assert.fail('deveria ter recusado');
};

test('aceita conteúdo válido, normaliza espaços e ignora campos extras', () => {
  const v = validateBiografia({ ...ok, heading: '  Música que sai dos  ', extra: 'x', timeline: [{ ...ok.timeline[0], hack: 1 }] });
  assert.deepEqual(v, ok);
});

test('recusa campos vazios, longos demais ou com tipo errado', () => {
  assert.deepEqual(fields(() => validateBiografia({ ...ok, heading: '', headingAccent: 'x'.repeat(81) })), ['heading', 'headingAccent']);
  assert.deepEqual(fields(() => validateBiografia({ ...ok, paragraphs: 'texto' })), ['paragraphs']);
  assert.deepEqual(fields(() => validateBiografia({ ...ok, timeline: [{ year: 1982, title: 'a', body: 'b' }] })), ['timeline[0].year']);
  assert.deepEqual(fields(() => validateBiografia({ ...ok, paragraphs: Array(9).fill('a') })), ['paragraphs']);
  assert.deepEqual(fields(() => validateBiografia(null)), ['biografia', 'heading', 'headingAccent', 'paragraphs', 'timeline']);
});

test('recusa sintaxe de template, quebras de linha e caracteres de controle', () => {
  assert.deepEqual(fields(() => validateBiografia({ ...ok, heading: 'a {{ b }}' })), ['heading']);
  assert.deepEqual(fields(() => validateBiografia({ ...ok, headingAccent: 'a\nb' })), ['headingAccent']);
  assert.deepEqual(fields(() => validateBiografia({ ...ok, paragraphs: ['a\u0000b'] })), ['paragraphs[0]']);
});

test('recusa links que não sejam http(s)', () => {
  assert.deepEqual(fields(() => validateBiografia({ ...ok, paragraphs: ['[x](javascript:alert)', '[y](ftp://a.b)'] })), ['paragraphs[0]', 'paragraphs[1]']);
});
