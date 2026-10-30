// API do painel /admin. Roda dentro da Netlify Function (netlify/functions/cms.mjs)
// e também no servidor local de testes (scripts/dev-server.mjs).
//
// Rascunho: um branch próprio no GitHub (CMS_DRAFT_BRANCH) guarda os JSON
// editados. Publicar = um único commit no branch de produção com os JSON e o
// index.html regenerado; o deploy automático da Netlify faz o resto.

import { SECTIONS, SECTION_IDS, ValidationError, serialize, sameContent } from './content.mjs';
import { renderSite, RenderError } from './render.mjs';
import { parseUsers, verifyPassword, dummyVerify, createSessionToken, readSessionToken, parseCookies, cookieName, sessionCookie } from './auth.mjs';
import { ConflictError, GitHubError } from './github.mjs';

export class HttpError extends Error {
  constructor(status, message, detalhes) {
    super(message);
    this.status = status;
    this.detalhes = detalhes;
  }
}

const SESSION_TTL = 8 * 60 * 60;
const MAX_BODY = 100_000;
const LOGIN_WINDOW = 15 * 60 * 1000;
const LOGIN_MAX_PER_USER = 5;
const LOGIN_MAX_PER_IP = 20;
const BRANCH = /^[A-Za-z0-9._-]+(\/[A-Za-z0-9._-]+)*$/;

export function loadConfig(env) {
  const required = ['GITHUB_TOKEN', 'GITHUB_REPO', 'CMS_PUBLISH_BRANCH', 'CMS_SESSION_SECRET', 'CMS_USERS'];
  const missing = required.filter(k => !env[k]);
  if (missing.length) throw new Error('Variáveis de ambiente ausentes: ' + missing.join(', '));
  if (!/^[\w.-]+\/[\w.-]+$/.test(env.GITHUB_REPO)) throw new Error('GITHUB_REPO deve ser "dono/repositorio"');
  if (env.CMS_SESSION_SECRET.length < 32) throw new Error('CMS_SESSION_SECRET precisa de pelo menos 32 caracteres');
  const publishBranch = env.CMS_PUBLISH_BRANCH;
  const draftBranch = env.CMS_DRAFT_BRANCH || 'cms-rascunho';
  if (!BRANCH.test(publishBranch) || !BRANCH.test(draftBranch)) throw new Error('Nome de branch inválido');
  if (publishBranch === draftBranch) throw new Error('CMS_DRAFT_BRANCH deve ser diferente de CMS_PUBLISH_BRANCH');
  const users = parseUsers(env.CMS_USERS);
  if (!users.size) throw new Error('CMS_USERS não tem nenhum usuário');
  return { token: env.GITHUB_TOKEN, repo: env.GITHUB_REPO, publishBranch, draftBranch, secret: env.CMS_SESSION_SECRET, users };
}

const BASE_HEADERS = { 'Cache-Control': 'no-store, private', 'X-Content-Type-Options': 'nosniff', 'X-Robots-Tag': 'noindex, nofollow' };

function json(status, body, headers = {}) {
  return new Response(JSON.stringify(body), { status, headers: { ...BASE_HEADERS, 'Content-Type': 'application/json; charset=utf-8', ...headers } });
}

const publicUser = user => ({ id: user.id, nome: user.nome });

function isLocalhost(hostname) {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]';
}

async function readJson(request) {
  if (!/^application\/json\b/i.test(request.headers.get('content-type') || '')) throw new HttpError(415, 'Envie os dados como JSON.');
  if (Number(request.headers.get('content-length') || 0) > MAX_BODY) throw new HttpError(413, 'Dados grandes demais.');
  const text = await request.text();
  if (text.length > MAX_BODY) throw new HttpError(413, 'Dados grandes demais.');
  try {
    const data = JSON.parse(text);
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error();
    return data;
  } catch {
    throw new HttpError(400, 'JSON inválido.');
  }
}

export function createApi({ env, makeGitHub, now = () => Date.now(), log = console }) {
  let config, gh, configError;
  try {
    config = loadConfig(env);
    gh = makeGitHub(config);
  } catch (e) {
    configError = e;
  }
  const failures = new Map();

  // ——— limite de tentativas de login (por instância da função) ———
  function throttled(key, max) {
    const f = failures.get(key);
    return !!f && f.until > now() && f.n >= max;
  }
  function recordFailure(key) {
    const f = failures.get(key);
    if (!f || f.until <= now()) failures.set(key, { n: 1, until: now() + LOGIN_WINDOW });
    else f.n++;
    if (failures.size > 5000) failures.clear();
  }

  // ——— estado do conteúdo (publicado × rascunho) ———
  async function readJsonFile(sha, path, branch) {
    const text = await gh.readFile(sha, path);
    if (text == null) return null;
    try { return JSON.parse(text); } catch { throw new HttpError(500, `${path} no branch ${branch} não é um JSON válido.`); }
  }

  async function loadState() {
    const [mainSha, draftSha] = await Promise.all([gh.getBranchHead(config.publishBranch), gh.getBranchHead(config.draftBranch)]);
    if (!mainSha) throw new HttpError(500, `Branch ${config.publishBranch} não encontrado no GitHub.`);
    const secoes = {};
    await Promise.all(SECTION_IDS.map(async id => {
      const { path } = SECTIONS[id];
      const [publicado, rascunho] = await Promise.all([
        readJsonFile(mainSha, path, config.publishBranch),
        draftSha ? readJsonFile(draftSha, path, config.draftBranch) : null,
      ]);
      if (publicado == null) throw new HttpError(500, `${path} não existe no branch ${config.publishBranch}.`);
      secoes[id] = { publicado, rascunho, pendente: rascunho != null && !sameContent(publicado, rascunho) };
    }));
    return { mainSha, draftSha, secoes };
  }

  function view(state, user) {
    return {
      usuario: publicUser(user),
      versaoRascunho: state.draftSha,
      pendentes: SECTION_IDS.filter(id => state.secoes[id].pendente),
      secoes: state.secoes,
    };
  }

  // Conteúdo final (rascunho onde houver, senão publicado), revalidado.
  function mergedContent(state) {
    const out = {};
    for (const id of SECTION_IDS) {
      const s = state.secoes[id];
      try {
        out[id] = SECTIONS[id].validate(s.pendente ? s.rascunho : s.publicado);
      } catch (e) {
        if (e instanceof ValidationError) throw new HttpError(500, `Conteúdo gravado em ${SECTIONS[id].path} é inválido.`, e.detalhes);
        throw e;
      }
    }
    return out;
  }

  async function renderFrom(state) {
    const html = await gh.readFile(state.mainSha, 'index.html');
    if (html == null) throw new HttpError(500, `index.html não existe no branch ${config.publishBranch}.`);
    return renderSite(html, mergedContent(state));
  }

  function audit(acao, user, extra = {}) {
    log.log(JSON.stringify({ cms: acao, usuario: user.id, ...extra }));
  }

  // ——— rotas ———
  async function login(request, secure, ip) {
    const body = await readJson(request);
    const id = typeof body.usuario === 'string' ? body.usuario.trim().toLowerCase().slice(0, 64) : '';
    const senha = typeof body.senha === 'string' ? body.senha.slice(0, 200) : '';
    if (throttled('ip:' + ip, LOGIN_MAX_PER_IP) || throttled('u:' + id, LOGIN_MAX_PER_USER)) {
      throw new HttpError(429, 'Muitas tentativas. Aguarde 15 minutos e tente de novo.');
    }
    const user = config.users.get(id);
    const ok = user ? await verifyPassword(senha, user.hash) : await dummyVerify(senha);
    if (!ok) {
      recordFailure('ip:' + ip);
      recordFailure('u:' + id);
      log.warn(JSON.stringify({ cms: 'login-falhou', usuario: id.replace(/[^a-z0-9._-]/g, '?'), ip }));
      throw new HttpError(401, 'Usuário ou senha incorretos.');
    }
    failures.delete('u:' + id);
    audit('login', user, { ip });
    const token = createSessionToken({ secret: config.secret, user, ttlSeconds: SESSION_TTL, now: now() });
    return json(200, { usuario: publicUser(user) }, { 'Set-Cookie': sessionCookie({ token, secure, maxAge: SESSION_TTL }) });
  }

  async function saveDraft(request, user, id) {
    const sec = SECTIONS[id];
    if (!sec) throw new HttpError(404, 'Seção desconhecida.');
    const body = await readJson(request);
    const value = sec.validate(body.dados);
    const state = await loadState();
    if ((body.versaoRascunho ?? null) !== state.draftSha) {
      throw new HttpError(409, 'O rascunho foi alterado em outra aba ou por outra pessoa. Recarregue a página para ver a versão atual.');
    }
    const pendingAfter = SECTION_IDS.filter(s => s === id ? !sameContent(value, state.secoes[s].publicado) : state.secoes[s].pendente);
    if (!pendingAfter.length) {
      // Voltou a ficar igual ao publicado: não há mais rascunho.
      if (state.draftSha) await gh.deleteBranch(config.draftBranch);
    } else if (!(state.draftSha && sameContent(value, state.secoes[id].rascunho))) {
      const sha = await gh.commit({
        branch: config.draftBranch,
        parentSha: state.draftSha ?? state.mainSha,
        createBranch: !state.draftSha,
        files: { [sec.path]: serialize(value) },
        message: `CMS: rascunho de ${sec.label.toLowerCase()} (por ${user.id})`,
      });
      audit('rascunho', user, { secao: id, sha });
    }
    return json(200, view(await loadState(), user));
  }

  async function discard(request, user) {
    const body = await readJson(request);
    const draftSha = await gh.getBranchHead(config.draftBranch);
    if (draftSha && body.versaoRascunho !== draftSha) {
      throw new HttpError(409, 'O rascunho mudou desde que você abriu a página. Recarregue antes de descartar.');
    }
    if (draftSha) {
      await gh.deleteBranch(config.draftBranch);
      audit('descartar', user, { sha: draftSha });
    }
    return json(200, view(await loadState(), user));
  }

  async function publish(request, user) {
    const body = await readJson(request);
    const state = await loadState();
    const pend = SECTION_IDS.filter(id => state.secoes[id].pendente);
    if (!state.draftSha || !pend.length) throw new HttpError(409, 'Não há alterações para publicar.');
    if (body.versaoRascunho !== state.draftSha) {
      throw new HttpError(409, 'O rascunho mudou desde a última vez que você o viu. Recarregue e confira antes de publicar.');
    }
    const content = mergedContent(state);
    const files = { 'index.html': await renderFrom(state) };
    for (const id of pend) files[SECTIONS[id].path] = serialize(content[id]);
    const labels = pend.map(id => SECTIONS[id].label.toLowerCase()).join(', ');
    let sha;
    try {
      sha = await gh.commit({ branch: config.publishBranch, parentSha: state.mainSha, files, message: `CMS: publica ${labels} (por ${user.id})` });
    } catch (e) {
      if (e instanceof ConflictError) throw new HttpError(409, 'O site foi alterado no GitHub durante a publicação. Recarregue e tente de novo.');
      throw e;
    }
    audit('publicar', user, { secoes: pend, sha });
    try { await gh.deleteBranch(config.draftBranch); } catch (e) { log.error('Falha ao apagar rascunho após publicar', e); }
    return json(200, { ...view(await loadState(), user), commit: sha });
  }

  async function preview(user) {
    const html = await renderFrom(await loadState());
    audit('previa', user);
    return new Response(html, {
      status: 200,
      headers: {
        ...BASE_HEADERS,
        'Content-Type': 'text/html; charset=utf-8',
        'Content-Security-Policy': "frame-ancestors 'self'",
        'Referrer-Policy': 'same-origin',
      },
    });
  }

  async function route(request, context) {
    const url = new URL(request.url);
    const path = url.pathname.replace(/^\/api\/cms\/?/, '').replace(/\/$/, '');
    const method = request.method.toUpperCase();
    const secure = url.protocol === 'https:';
    if (!secure && !isLocalhost(url.hostname)) throw new HttpError(403, 'Use HTTPS.');

    if (method !== 'GET' && method !== 'HEAD') {
      // Proteção contra CSRF: só aceita requisições vindas do próprio site.
      if (request.headers.get('origin') !== url.origin) throw new HttpError(403, 'Origem não permitida.');
      const site = request.headers.get('sec-fetch-site');
      if (site && site !== 'same-origin') throw new HttpError(403, 'Origem não permitida.');
    }

    const routes = { login: 'POST', sair: 'POST', sessao: 'GET', conteudo: 'GET', previa: 'GET', publicar: 'POST', descartar: 'POST' };
    const draftMatch = /^rascunho\/([a-z]+)$/.exec(path);
    const allowed = draftMatch ? 'PUT' : routes[path];
    if (!allowed) throw new HttpError(404, 'Rota não encontrada.');
    if (method !== allowed) throw new HttpError(405, 'Método não permitido.');

    if (path === 'login') return login(request, secure, context?.ip || request.headers.get('x-nf-client-connection-ip') || 'local');
    if (path === 'sair') return json(200, { ok: true }, { 'Set-Cookie': sessionCookie({ token: '', secure, maxAge: 0 }) });

    // Daqui em diante, todas as rotas exigem sessão válida.
    const token = parseCookies(request.headers.get('cookie'))[cookieName(secure)];
    const user = readSessionToken({ secret: config.secret, token, users: config.users, now: now() });
    if (!user) throw new HttpError(401, 'Sessão expirada. Entre novamente.');

    if (path === 'sessao') return json(200, { usuario: publicUser(user) });
    if (path === 'conteudo') return json(200, view(await loadState(), user));
    if (path === 'previa') return preview(user);
    if (path === 'publicar') return publish(request, user);
    if (path === 'descartar') return discard(request, user);
    return saveDraft(request, user, draftMatch[1]);
  }

  return async function handle(request, context) {
    if (configError) {
      log.error('CMS não configurado:', configError.message);
      return json(500, { erro: 'O painel ainda não foi configurado no servidor.' });
    }
    try {
      return await route(request, context);
    } catch (e) {
      if (e instanceof HttpError) return json(e.status, { erro: e.message, ...(e.detalhes ? { detalhes: e.detalhes } : {}) });
      if (e instanceof ValidationError) return json(422, { erro: 'Confira os campos indicados.', detalhes: e.detalhes });
      if (e instanceof ConflictError) return json(409, { erro: 'Outra alteração foi gravada ao mesmo tempo. Recarregue a página.' });
      if (e instanceof GitHubError) { log.error(e); return json(502, { erro: 'Falha ao falar com o GitHub: ' + e.message }); }
      if (e instanceof RenderError) { log.error(e); return json(500, { erro: e.message }); }
      log.error(e);
      return json(500, { erro: 'Erro interno.' });
    }
  };
}
