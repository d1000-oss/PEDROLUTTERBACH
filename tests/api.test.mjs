// Fluxo completo da API (login → rascunho → prévia → publicar/descartar),
// com o cliente real do GitHub falando com o GitHub simulado.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createApi } from '../netlify/lib/api.mjs';
import { createGitHub } from '../netlify/lib/github.mjs';
import { hashPassword } from '../netlify/lib/auth.mjs';
import { createFakeGitHub } from '../scripts/fake-github.mjs';

const INDEX = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const BIO_JSON = fs.readFileSync(new URL('../content/biografia.json', import.meta.url), 'utf8');
const BIO = JSON.parse(BIO_JSON);
const ORIGIN = 'https://pedrolutterbach.com';
const SENHA = 'senha-muito-segura';
const HASH = await hashPassword(SENHA, { N: 1024, r: 8, p: 1 });

function setup({ env = {}, wrapFetch } = {}) {
  const gh = createFakeGitHub({ files: { 'index.html': INDEX, 'content/biografia.json': BIO_JSON, 'outro.txt': 'x' }, repo: 'dono/site' });
  const logs = [];
  const handle = createApi({
    env: {
      GITHUB_TOKEN: gh.token, GITHUB_REPO: 'dono/site', CMS_PUBLISH_BRANCH: 'main',
      CMS_SESSION_SECRET: 'x'.repeat(40), CMS_USERS: `pedro:${HASH},diogo:${HASH}`, ...env,
    },
    makeGitHub: c => createGitHub({ token: c.token, repo: c.repo, fetchImpl: wrapFetch ? wrapFetch(gh) : gh.fetch }),
    log: { log: m => logs.push(m), warn: m => logs.push(m), error: (...m) => logs.push(m.join(' ')) },
  });
  let cookie = '';
  async function req(method, rota, body, { headers = {}, url = ORIGIN } = {}) {
    const h = {
      ...(cookie ? { cookie } : {}),
      ...(method !== 'GET' ? { origin: url } : {}),
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...headers,
    };
    const res = await handle(new Request(`${url}/api/cms/${rota}`, { method, headers: h, body: body !== undefined ? JSON.stringify(body) : undefined }), { ip: '1.2.3.4' });
    const setCookie = res.headers.get('set-cookie');
    if (setCookie) cookie = setCookie.split(';')[0].endsWith('=') ? '' : setCookie.split(';')[0];
    const text = await res.text();
    let data;
    try { data = JSON.parse(text); } catch { data = text; }
    return { status: res.status, data, headers: res.headers };
  }
  const login = (usuario = 'pedro', senha = SENHA) => req('POST', 'login', { usuario, senha });
  return { gh, req, login, logs, setCookie: c => { cookie = c; } };
}

const editada = { ...BIO, headingAccent: 'limites de tudo.', paragraphs: [...BIO.paragraphs, 'Novo parágrafo.'] };

test('sem configuração, responde 500 sem vazar detalhes', async () => {
  const { req, logs } = setup({ env: { GITHUB_TOKEN: '' } });
  const r = await req('GET', 'sessao');
  assert.equal(r.status, 500);
  assert.equal(r.data.erro, 'O painel ainda não foi configurado no servidor.');
  assert.match(logs.join(), /GITHUB_TOKEN/);
});

test('login: senha errada → 401; certa → cookie seguro', async () => {
  const { req, login } = setup();
  assert.equal((await login('pedro', 'errada')).status, 401);
  assert.equal((await login('ninguem', SENHA)).status, 401);
  assert.equal((await req('GET', 'conteudo')).status, 401);
  const r = await login();
  assert.equal(r.status, 200);
  assert.deepEqual(r.data.usuario, { id: 'pedro', nome: 'Pedro' });
  assert.match(r.headers.get('set-cookie'), /^__Host-cms_sessao=v1\.[^;]+; Path=\/; HttpOnly; SameSite=Strict; Max-Age=28800; Secure$/);
  assert.equal((await req('GET', 'sessao')).data.usuario.id, 'pedro');
  assert.equal(r.headers.get('cache-control'), 'no-store, private');
});

test('login: bloqueia após 5 tentativas erradas, mesmo com a senha certa', async () => {
  const { login } = setup();
  for (let i = 0; i < 5; i++) assert.equal((await login('pedro', 'errada' + i)).status, 401);
  assert.equal((await login()).status, 429);
  assert.equal((await login('diogo')).status, 200, 'outro usuário não é afetado');
});

test('proteção contra CSRF e requisições malformadas', async () => {
  const { req, login } = setup();
  await login();
  const dados = { dados: editada, versaoRascunho: null };
  assert.equal((await req('PUT', 'rascunho/biografia', dados, { headers: { origin: 'https://evil.example' } })).status, 403);
  assert.equal((await req('PUT', 'rascunho/biografia', dados, { headers: { origin: '' } })).status, 403);
  assert.equal((await req('PUT', 'rascunho/biografia', dados, { headers: { 'sec-fetch-site': 'cross-site' } })).status, 403);
  assert.equal((await req('PUT', 'rascunho/biografia', dados, { headers: { 'content-type': 'text/plain' } })).status, 415);
  assert.equal((await req('PUT', 'rascunho/biografia', { dados: { ...editada, paragraphs: ['x'.repeat(100_001)] } })).status, 413);
  assert.equal((await req('GET', 'rascunho/biografia')).status, 405);
  assert.equal((await req('PUT', 'rascunho/fotos', dados)).status, 404);
  assert.equal((await req('GET', 'nada')).status, 404);
  assert.equal((await req('GET', 'sessao', undefined, { url: 'http://pedrolutterbach.com' })).status, 403, 'exige HTTPS fora de localhost');
});

test('usuário removido de CMS_USERS perde a sessão', async () => {
  const a = setup();
  const r = await a.login('diogo');
  const cookie = r.headers.get('set-cookie').split(';')[0];
  const b = setup({ env: { CMS_USERS: `pedro:${HASH}` } });
  b.setCookie(cookie);
  assert.equal((await b.req('GET', 'sessao')).status, 401);
});

test('rascunho → prévia → publicar', async () => {
  const { gh, req, login, logs } = setup();
  await login();
  let r = await req('GET', 'conteudo');
  assert.equal(r.status, 200);
  assert.deepEqual(r.data.secoes.biografia, { publicado: BIO, rascunho: null, pendente: false });
  assert.equal(r.data.versaoRascunho, null);

  // inválido: nada é gravado
  r = await req('PUT', 'rascunho/biografia', { dados: { ...editada, heading: '' }, versaoRascunho: null });
  assert.equal(r.status, 422);
  assert.deepEqual(r.data.detalhes, [{ campo: 'heading', mensagem: 'Não pode ficar vazio.' }]);
  assert.equal(gh.head('cms-rascunho'), null);

  r = await req('PUT', 'rascunho/biografia', { dados: editada, versaoRascunho: null });
  assert.equal(r.status, 200);
  assert.deepEqual(r.data.pendentes, ['biografia']);
  const versao = r.data.versaoRascunho;
  assert.equal(versao, gh.head('cms-rascunho'));
  assert.deepEqual(JSON.parse(gh.files('cms-rascunho')['content/biografia.json']), editada);
  assert.equal(gh.files('main')['index.html'], INDEX, 'site publicado não muda ao salvar rascunho');

  // versão desatualizada (outra aba) → conflito
  assert.equal((await req('PUT', 'rascunho/biografia', { dados: BIO, versaoRascunho: null })).status, 409);

  const previa = await req('GET', 'previa');
  assert.equal(previa.status, 200);
  assert.match(previa.headers.get('content-type'), /text\/html/);
  assert.equal(previa.headers.get('content-security-policy'), "frame-ancestors 'self'");
  assert.ok(previa.data.includes('limites de tudo.') && previa.data.includes('Novo parágrafo.'));

  assert.equal((await req('POST', 'publicar', { versaoRascunho: 'antiga' })).status, 409);
  r = await req('POST', 'publicar', { versaoRascunho: versao });
  assert.equal(r.status, 200);
  assert.deepEqual(r.data.pendentes, []);
  assert.equal(r.data.versaoRascunho, null);
  assert.equal(gh.head('cms-rascunho'), null, 'rascunho apagado após publicar');
  const main = gh.files('main');
  assert.equal(main['index.html'], previa.data, 'publica exatamente o que foi pré-visualizado');
  assert.deepEqual(JSON.parse(main['content/biografia.json']), editada);
  assert.equal(main['outro.txt'], 'x');
  assert.deepEqual(gh.log('main'), ['CMS: publica biografia (por pedro)', 'inicial'], 'um único commit');
  assert.ok(logs.some(l => String(l).includes('"cms":"publicar"')));

  assert.equal((await req('POST', 'publicar', { versaoRascunho: null })).status, 409, 'nada mais a publicar');
});

test('descartar apaga o rascunho e não toca no site', async () => {
  const { gh, req, login } = setup();
  await login('diogo');
  const { data } = await req('PUT', 'rascunho/biografia', { dados: editada, versaoRascunho: null });
  assert.equal((await req('POST', 'descartar', { versaoRascunho: 'outra' })).status, 409);
  const r = await req('POST', 'descartar', { versaoRascunho: data.versaoRascunho });
  assert.equal(r.status, 200);
  assert.equal(r.data.secoes.biografia.rascunho, null);
  assert.equal(gh.head('cms-rascunho'), null);
  assert.deepEqual(gh.log('main'), ['inicial']);
});

test('salvar um rascunho igual ao publicado não deixa rascunho', async () => {
  const { gh, req, login } = setup();
  await login();
  const { data } = await req('PUT', 'rascunho/biografia', { dados: editada, versaoRascunho: null });
  const r = await req('PUT', 'rascunho/biografia', { dados: BIO, versaoRascunho: data.versaoRascunho });
  assert.deepEqual(r.data.pendentes, []);
  assert.equal(gh.head('cms-rascunho'), null);
});

test('publicar preserva alterações feitas por fora no branch principal', async () => {
  const { gh, req, login } = setup();
  await login();
  const { data } = await req('PUT', 'rascunho/biografia', { dados: editada, versaoRascunho: null });
  gh.pushOutside('main', { 'outro.txt': 'mudou' });
  const r = await req('POST', 'publicar', { versaoRascunho: data.versaoRascunho });
  assert.equal(r.status, 200);
  assert.equal(gh.files('main')['outro.txt'], 'mudou');
  assert.ok(gh.files('main')['index.html'].includes('limites de tudo.'));
});

test('se o branch principal mudar durante a publicação, nada é sobrescrito', async () => {
  // Simula um push externo exatamente entre a criação do commit e a atualização do branch.
  const { gh, req, login } = setup({
    wrapFetch: fake => async (url, init) => {
      if (init.method === 'PATCH' && url.endsWith('/git/refs/heads/main')) fake.pushOutside('main', { 'outro.txt': 'corrida' });
      return fake.fetch(url, init);
    },
  });
  await login();
  const { data } = await req('PUT', 'rascunho/biografia', { dados: editada, versaoRascunho: null });
  const r = await req('POST', 'publicar', { versaoRascunho: data.versaoRascunho });
  assert.equal(r.status, 409);
  assert.equal(gh.files('main')['outro.txt'], 'corrida');
  assert.equal(gh.files('main')['index.html'], INDEX);
  assert.ok(gh.head('cms-rascunho'), 'rascunho preservado para tentar de novo');
});

test('index.html sem marcadores: publicar falha com mensagem clara', async () => {
  const { gh, req, login } = setup();
  await login();
  const { data } = await req('PUT', 'rascunho/biografia', { dados: editada, versaoRascunho: null });
  gh.pushOutside('main', { 'index.html': INDEX.replace('<!-- cms:biografia -->', '') });
  const r = await req('POST', 'publicar', { versaoRascunho: data.versaoRascunho });
  assert.equal(r.status, 500);
  assert.match(r.data.erro, /Marcador <!-- cms:biografia -->/);
});

test('sair apaga o cookie', async () => {
  const { req, login } = setup();
  await login();
  const r = await req('POST', 'sair', {});
  assert.match(r.headers.get('set-cookie'), /^__Host-cms_sessao=; .*Max-Age=0/);
  assert.equal((await req('GET', 'sessao')).status, 401);
});

test('token do GitHub inválido vira erro 502 compreensível', async () => {
  const { req, login } = setup({ env: { GITHUB_TOKEN: 'errado' } });
  await login();
  const r = await req('GET', 'conteudo');
  assert.equal(r.status, 502);
  assert.match(r.data.erro, /Token do GitHub inválido/);
});
