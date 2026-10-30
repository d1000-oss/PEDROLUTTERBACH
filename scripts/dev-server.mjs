// Servidor local para testar o site e o painel sem tocar no GitHub nem na Netlify.
//
//   node scripts/dev-server.mjs            → http://localhost:8888/admin/
//
// Serve os arquivos do repositório (aplicando os cabeçalhos de _headers) e
// atende /api/cms/* com a mesma API da Netlify Function, ligada a um GitHub
// simulado em memória, semeado com o index.html e content/*.json locais.
// Usuários de teste: "pedro" e "diogo", senha em CMS_DEV_SENHA (padrão abaixo).

import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import { createApi } from '../netlify/lib/api.mjs';
import { createGitHub } from '../netlify/lib/github.mjs';
import { hashPassword } from '../netlify/lib/auth.mjs';
import { SECTIONS } from '../netlify/lib/content.mjs';
import { createFakeGitHub } from './fake-github.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const DEV_PASSWORD = process.env.CMS_DEV_SENHA || 'senha-local-de-teste';

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.woff2': 'font/woff2',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.ico': 'image/x-icon', '.xml': 'application/xml', '.txt': 'text/plain; charset=utf-8',
};

// Leitura simplificada do _headers da Netlify (caminho exato ou terminado em /*).
async function loadHeaderRules(root) {
  const text = await fs.readFile(path.join(root, '_headers'), 'utf8').catch(() => '');
  const rules = [];
  for (const line of text.split('\n')) {
    if (!line.trim() || line.trim().startsWith('#')) continue;
    if (!/^\s/.test(line)) rules.push({ pattern: line.trim(), headers: {} });
    else if (rules.length) {
      const i = line.indexOf(':');
      rules.at(-1).headers[line.slice(0, i).trim()] = line.slice(i + 1).trim();
    }
  }
  return pathname => Object.assign({}, ...rules
    .filter(r => r.pattern === pathname || (r.pattern.endsWith('/*') && pathname.startsWith(r.pattern.slice(0, -1))))
    .map(r => r.headers));
}

async function toWebRequest(req, origin) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const headers = new Headers();
  for (const [k, v] of Object.entries(req.headers)) headers.set(k, Array.isArray(v) ? v.join(', ') : v);
  const hasBody = !['GET', 'HEAD'].includes(req.method);
  return new Request(origin + req.url, { method: req.method, headers, body: hasBody ? Buffer.concat(chunks) : undefined });
}

async function sendWebResponse(res, response) {
  const headers = {};
  response.headers.forEach((v, k) => { if (k !== 'set-cookie') headers[k] = v; });
  const cookies = response.headers.getSetCookie();
  if (cookies.length) headers['set-cookie'] = cookies;
  res.writeHead(response.status, headers);
  res.end(Buffer.from(await response.arrayBuffer()));
}

export async function startDevServer({ port = 8888, root = ROOT, quiet = false } = {}) {
  const files = { 'index.html': await fs.readFile(path.join(root, 'index.html'), 'utf8') };
  for (const { path: p } of Object.values(SECTIONS)) files[p] = await fs.readFile(path.join(root, p), 'utf8');
  const github = createFakeGitHub({ files, branch: 'main', repo: 'local/site' });
  const users = [];
  for (const u of ['pedro', 'diogo']) users.push(`${u}:${await hashPassword(DEV_PASSWORD, { N: 16384, r: 8, p: 1 })}`);

  const handle = createApi({
    env: {
      GITHUB_TOKEN: github.token, GITHUB_REPO: github.repo, CMS_PUBLISH_BRANCH: 'main',
      CMS_SESSION_SECRET: randomBytes(32).toString('base64url'), CMS_USERS: users.join(','),
    },
    makeGitHub: config => createGitHub({ token: config.token, repo: config.repo, fetchImpl: github.fetch }),
    log: quiet ? { log() {}, warn() {}, error() {} } : console,
  });
  const headersFor = await loadHeaderRules(root);

  const server = http.createServer(async (req, res) => {
    try {
      const origin = `http://${req.headers.host}`;
      const { pathname } = new URL(req.url, origin);
      if (pathname.startsWith('/api/cms/')) return sendWebResponse(res, await handle(await toWebRequest(req, origin), { ip: req.socket.remoteAddress }));
      if (pathname === '/admin') { res.writeHead(301, { Location: '/admin/' }); return res.end(); }
      // O "site publicado" local é o index.html atual do branch main simulado.
      let body, file = path.normalize(path.join(root, decodeURIComponent(pathname)));
      if (pathname === '/' || pathname === '/index.html') body = github.files('main')['index.html'];
      else {
        if (pathname.endsWith('/')) file = path.join(file, 'index.html');
        if (!file.startsWith(root + path.sep) || file.split(path.sep).some(s => s.startsWith('.'))) throw Object.assign(new Error(), { code: 'ENOENT' });
        body = await fs.readFile(file);
      }
      res.writeHead(200, { 'Content-Type': TYPES[path.extname(file === root ? 'index.html' : file)] || 'text/html; charset=utf-8', ...headersFor(pathname) });
      res.end(body);
    } catch (e) {
      res.writeHead(e.code === 'ENOENT' || e.code === 'EISDIR' ? 404 : 500, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end(e.code === 'ENOENT' || e.code === 'EISDIR' ? 'Não encontrado' : 'Erro: ' + e.message);
    }
  });
  await new Promise(r => server.listen(port, '127.0.0.1', r));
  const url = `http://localhost:${server.address().port}`;
  return { url, github, close: () => new Promise(r => server.close(r)) };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const portArg = process.argv.indexOf('--porta');
  const { url } = await startDevServer({ port: portArg > 0 ? Number(process.argv[portArg + 1]) : 8888 });
  console.log(`Site:   ${url}/\nPainel: ${url}/admin/\nUsuários: pedro, diogo — senha: ${DEV_PASSWORD}\n(GitHub simulado em memória: nada é enviado ao GitHub real.)`);
}
