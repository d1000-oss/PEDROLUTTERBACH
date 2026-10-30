import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hashPassword, verifyPassword, parseUsers, createSessionToken, readSessionToken, sessionCookie } from '../netlify/lib/auth.mjs';

const FAST = { N: 1024, r: 8, p: 1 };
const SECRET = 's'.repeat(40);

test('hash scrypt confere só com a senha certa', async () => {
  const hash = await hashPassword('uma senha longa', FAST);
  assert.match(hash, /^scrypt\$1024\$8\$1\$/);
  assert.equal(await verifyPassword('uma senha longa', hash), true);
  assert.equal(await verifyPassword('outra senha', hash), false);
  assert.equal(await verifyPassword('uma senha longa', 'lixo'), false);
  assert.notEqual(await hashPassword('uma senha longa', FAST), hash, 'salt aleatório');
});

test('lê CMS_USERS com vírgula, ponto e vírgula ou quebra de linha', async () => {
  const h = await hashPassword('x'.repeat(12), FAST);
  const users = parseUsers(`Pedro:${h};\n diogo:${h}`);
  assert.deepEqual([...users.keys()], ['pedro', 'diogo']);
  assert.equal(users.get('pedro').nome, 'Pedro');
  assert.throws(() => parseUsers('pedro:senha-em-texto'), /pedro/);
  assert.throws(() => parseUsers(`p:${h}`), /CMS_USERS/);
});

test('sessão: válida, adulterada, expirada, outro segredo, senha trocada', async () => {
  const users = parseUsers(`pedro:${await hashPassword('x'.repeat(12), FAST)}`);
  const user = users.get('pedro');
  const now = Date.now();
  const token = createSessionToken({ secret: SECRET, user, ttlSeconds: 60, now });
  assert.equal(readSessionToken({ secret: SECRET, token, users, now })?.id, 'pedro');

  const [v, payload, sig] = token.split('.');
  const forged = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(payload, 'base64url')), u: 'diogo' })).toString('base64url');
  assert.equal(readSessionToken({ secret: SECRET, token: `${v}.${forged}.${sig}`, users, now }), null);
  assert.equal(readSessionToken({ secret: SECRET, token: token.slice(0, -2), users, now }), null);
  assert.equal(readSessionToken({ secret: SECRET, token, users, now: now + 61_000 }), null);
  assert.equal(readSessionToken({ secret: 'o'.repeat(40), token, users, now }), null);
  assert.equal(readSessionToken({ secret: SECRET, token: undefined, users, now }), null);

  const changed = parseUsers(`pedro:${await hashPassword('y'.repeat(12), FAST)}`);
  assert.equal(readSessionToken({ secret: SECRET, token, users: changed, now }), null);
  assert.equal(readSessionToken({ secret: SECRET, token, users: new Map(), now }), null);
});

test('cookie de sessão é HttpOnly, SameSite=Strict e __Host- em HTTPS', () => {
  assert.equal(sessionCookie({ token: 't', secure: true, maxAge: 10 }), '__Host-cms_sessao=t; Path=/; HttpOnly; SameSite=Strict; Max-Age=10; Secure');
  assert.equal(sessionCookie({ token: 't', secure: false, maxAge: 10 }), 'cms_sessao=t; Path=/; HttpOnly; SameSite=Strict; Max-Age=10');
});
