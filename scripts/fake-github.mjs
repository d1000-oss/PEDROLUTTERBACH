// GitHub simulado em memória, no nível do fetch: responde às mesmas rotas REST
// que netlify/lib/github.mjs usa, com a mesma semântica (refs, árvores, commits,
// recusa de atualização que não é fast-forward). Usado pelos testes e pelo
// servidor local — nada é enviado ao GitHub de verdade.

import { randomBytes } from 'node:crypto';

export function createFakeGitHub({ files, branch = 'main', repo = 'dono/site', token = 'token-de-teste' }) {
  const blobs = new Map(), trees = new Map(), commits = new Map(), refs = new Map();
  const id = () => randomBytes(20).toString('hex');
  const requests = [];

  function putBlob(text) { const sha = id(); blobs.set(sha, text); return sha; }
  function putTree(map) { const sha = id(); trees.set(sha, map); return sha; }
  function putCommit(tree, parents, message) { const sha = id(); commits.set(sha, { tree, parents, message }); return sha; }

  refs.set(branch, putCommit(putTree(new Map(Object.entries(files).map(([p, t]) => [p, putBlob(t)]))), [], 'inicial'));

  function isAncestor(ancestor, sha) {
    const stack = [sha];
    while (stack.length) {
      const s = stack.pop();
      if (s === ancestor) return true;
      stack.push(...(commits.get(s)?.parents || []));
    }
    return false;
  }

  const reply = (status, body) => new Response(status === 204 ? null : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  const notFound = () => reply(404, { message: 'Not Found' });
  // Como a API real: base64 com quebra de linha a cada 60 caracteres.
  const b64 = text => Buffer.from(text, 'utf8').toString('base64').replace(/.{60}/g, '$&\n');

  async function fetchImpl(url, init = {}) {
    const u = new URL(url);
    const method = (init.method || 'GET').toUpperCase();
    const body = init.body ? JSON.parse(init.body) : null;
    requests.push({ method, path: u.pathname + u.search, body });
    if (init.headers?.Authorization !== `Bearer ${token}`) return reply(401, { message: 'Bad credentials' });
    const prefix = `/repos/${repo}`;
    if (!u.pathname.startsWith(prefix + '/')) return notFound();
    const p = u.pathname.slice(prefix.length);
    const dec = s => s.split('/').map(decodeURIComponent).join('/');
    let m;

    if (method === 'GET' && (m = /^\/git\/ref\/heads\/(.+)$/.exec(p))) {
      const b = dec(m[1]);
      return refs.has(b) ? reply(200, { ref: 'refs/heads/' + b, object: { sha: refs.get(b), type: 'commit' } }) : notFound();
    }
    if (method === 'GET' && (m = /^\/contents\/(.+)$/.exec(p))) {
      const ref = u.searchParams.get('ref');
      const commit = commits.get(refs.get(ref) ?? ref);
      const blob = commit && trees.get(commit.tree).get(dec(m[1]));
      if (!blob) return notFound();
      const text = blobs.get(blob);
      const big = Buffer.byteLength(text) > 1_000_000;
      return reply(200, { type: 'file', sha: blob, encoding: big ? 'none' : 'base64', content: big ? '' : b64(text) });
    }
    if (method === 'GET' && (m = /^\/git\/blobs\/(\w+)$/.exec(p))) {
      return blobs.has(m[1]) ? reply(200, { sha: m[1], encoding: 'base64', content: b64(blobs.get(m[1])) }) : notFound();
    }
    if (method === 'GET' && (m = /^\/git\/commits\/(\w+)$/.exec(p))) {
      const c = commits.get(m[1]);
      return c ? reply(200, { sha: m[1], tree: { sha: c.tree }, parents: c.parents.map(sha => ({ sha })), message: c.message }) : notFound();
    }
    if (method === 'POST' && p === '/git/trees') {
      const base = trees.get(body.base_tree);
      if (!base) return reply(422, { message: 'Invalid tree' });
      const map = new Map(base);
      for (const e of body.tree) {
        if (e.content !== undefined) map.set(e.path, putBlob(e.content));
        else if (e.sha === null) map.delete(e.path);
        else map.set(e.path, e.sha);
      }
      return reply(201, { sha: putTree(map) });
    }
    if (method === 'POST' && p === '/git/commits') {
      if (!trees.has(body.tree) || !body.parents.every(s => commits.has(s))) return reply(422, { message: 'Invalid commit' });
      return reply(201, { sha: putCommit(body.tree, body.parents, body.message) });
    }
    if (method === 'POST' && p === '/git/refs') {
      const b = body.ref.replace(/^refs\/heads\//, '');
      if (refs.has(b)) return reply(422, { message: 'Reference already exists' });
      if (!commits.has(body.sha)) return reply(422, { message: 'Object does not exist' });
      refs.set(b, body.sha);
      return reply(201, { ref: body.ref, object: { sha: body.sha } });
    }
    if ((m = /^\/git\/refs\/heads\/(.+)$/.exec(p))) {
      const b = dec(m[1]);
      if (!refs.has(b)) return reply(422, { message: 'Reference does not exist' });
      if (method === 'DELETE') { refs.delete(b); return reply(204); }
      if (method === 'PATCH') {
        if (!body.force && !isAncestor(refs.get(b), body.sha)) return reply(422, { message: 'Update is not a fast forward' });
        refs.set(b, body.sha);
        return reply(200, { ref: 'refs/heads/' + b, object: { sha: body.sha } });
      }
    }
    return notFound();
  }

  return {
    fetch: fetchImpl,
    token,
    repo,
    requests,
    head: b => refs.get(b) ?? null,
    // Arquivos do branch como objeto {caminho: texto}, ou null se o branch não existe.
    files(b) {
      const sha = refs.get(b);
      if (!sha) return null;
      return Object.fromEntries([...trees.get(commits.get(sha).tree)].map(([path, blob]) => [path, blobs.get(blob)]));
    },
    log(b) {
      const out = [];
      for (let s = refs.get(b); s; s = commits.get(s).parents[0]) out.push(commits.get(s).message);
      return out;
    },
    // Simula alguém alterando o branch por fora do CMS (ex.: push manual).
    pushOutside(b, changes, message = 'alteração externa') {
      const parent = refs.get(b);
      const map = new Map(trees.get(commits.get(parent).tree));
      for (const [path, text] of Object.entries(changes)) map.set(path, putBlob(text));
      refs.set(b, putCommit(putTree(map), [parent], message));
    },
  };
}
