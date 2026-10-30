// Senhas (scrypt) e sessões (cookie assinado com HMAC-SHA256).
// Nenhuma senha ou segredo sai do servidor: o navegador só recebe um cookie
// HttpOnly que ele não consegue ler.

import { scrypt as scryptCb, randomBytes, createHmac, timingSafeEqual, createHash } from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCb);
const KEYLEN = 32;
const DEFAULT_COST = { N: 32768, r: 8, p: 1 };
const USERNAME = /^[a-z0-9._-]{2,32}$/;

const b64 = buf => Buffer.from(buf).toString('base64url');
const unb64 = s => Buffer.from(s, 'base64url');

function scryptOptions({ N, r, p }) {
  return { N, r, p, maxmem: 256 * N * r };
}

export async function hashPassword(password, cost = DEFAULT_COST) {
  const salt = randomBytes(16);
  const key = await scrypt(password.normalize('NFC'), salt, KEYLEN, scryptOptions(cost));
  return `scrypt$${cost.N}$${cost.r}$${cost.p}$${b64(salt)}$${b64(key)}`;
}

function parseHash(hash) {
  const m = /^scrypt\$(\d+)\$(\d+)\$(\d+)\$([\w-]+)\$([\w-]+)$/.exec(hash || '');
  if (!m) return null;
  const [N, r, p] = [m[1], m[2], m[3]].map(Number);
  if (N < 1024 || N > 1 << 20 || (N & (N - 1)) || r < 1 || r > 32 || p < 1 || p > 16) return null;
  return { N, r, p, salt: unb64(m[4]), key: unb64(m[5]) };
}

export async function verifyPassword(password, hash) {
  const h = parseHash(hash);
  if (!h || typeof password !== 'string') return false;
  const key = await scrypt(password.normalize('NFC'), h.salt, h.key.length, scryptOptions(h));
  return key.length === h.key.length && timingSafeEqual(key, h.key);
}

// Hash descartável para gastar o mesmo tempo quando o usuário não existe.
let dummyHash;
export async function dummyVerify(password) {
  dummyHash ??= await hashPassword('senha-inexistente');
  await verifyPassword(String(password ?? ''), dummyHash);
  return false;
}

// CMS_USERS = "diogo:scrypt$...,pedro:scrypt$..." (vírgula, ponto e vírgula ou quebra de linha)
export function parseUsers(raw) {
  const users = new Map();
  for (const entry of String(raw || '').split(/[\s,;]+/).filter(Boolean)) {
    const i = entry.indexOf(':');
    const id = entry.slice(0, i).toLowerCase(), hash = entry.slice(i + 1);
    if (i < 1 || !USERNAME.test(id) || !parseHash(hash)) throw new Error(`CMS_USERS: entrada inválida para "${entry.slice(0, Math.max(i, 0)) || '?'}"`);
    users.set(id, { id, nome: id.charAt(0).toUpperCase() + id.slice(1), hash });
  }
  return users;
}

function sign(secret, data) {
  return createHmac('sha256', secret).update(data).digest('base64url');
}

// Impressão digital do hash da senha: trocar a senha invalida as sessões abertas.
function passwordVersion(secret, user) {
  return sign(secret, 'pv:' + createHash('sha256').update(user.hash).digest('hex')).slice(0, 16);
}

export function createSessionToken({ secret, user, ttlSeconds, now = Date.now() }) {
  const payload = b64(JSON.stringify({ u: user.id, exp: Math.floor(now / 1000) + ttlSeconds, pv: passwordVersion(secret, user) }));
  return `v1.${payload}.${sign(secret, 'v1.' + payload)}`;
}

export function readSessionToken({ secret, token, users, now = Date.now() }) {
  const parts = String(token || '').split('.');
  if (parts.length !== 3 || parts[0] !== 'v1') return null;
  const expected = Buffer.from(sign(secret, 'v1.' + parts[1]));
  const given = Buffer.from(parts[2]);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  let data;
  try { data = JSON.parse(unb64(parts[1]).toString('utf8')); } catch { return null; }
  const user = users.get(data?.u);
  if (!user || typeof data.exp !== 'number' || data.exp * 1000 <= now) return null;
  if (data.pv !== passwordVersion(secret, user)) return null;
  return user;
}

export function parseCookies(header) {
  const out = {};
  for (const part of String(header || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = part.slice(i + 1).trim();
  }
  return out;
}

// Em HTTPS usa o prefixo __Host- (exige Secure, Path=/ e nenhum Domain).
// Sem HTTPS só é aceito em localhost, para testes locais.
export function cookieName(secure) {
  return secure ? '__Host-cms_sessao' : 'cms_sessao';
}

export function sessionCookie({ token, secure, maxAge }) {
  return [`${cookieName(secure)}=${token}`, 'Path=/', 'HttpOnly', 'SameSite=Strict', `Max-Age=${maxAge}`, secure && 'Secure']
    .filter(Boolean).join('; ');
}
