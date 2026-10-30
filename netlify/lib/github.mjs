// Cliente mínimo da API do GitHub (REST), só com o que o CMS usa.
// Os commits usam a Git Data API para gravar vários arquivos em um único
// commit — um único deploy na Netlify.

export class GitHubError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

// O branch andou desde que o lemos (outra pessoa salvou/publicou antes).
export class ConflictError extends Error {}

export function createGitHub({ token, repo, fetchImpl = globalThis.fetch, apiUrl = 'https://api.github.com' }) {
  const base = `${apiUrl}/repos/${repo}`;
  const cache = new Map(); // conteúdo por sha: imutável, seguro manter em memória

  async function call(method, path, body, { allow = [] } = {}) {
    const res = await fetchImpl(base + path, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'pedrolutterbach-cms',
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (allow.includes(res.status)) return { status: res.status, data: null };
    const data = res.status === 204 ? null : await res.json().catch(() => null);
    if (!res.ok) {
      const msg = data?.message || res.statusText;
      if (res.status === 401) throw new GitHubError('Token do GitHub inválido ou expirado.', 401);
      if (res.status === 403) throw new GitHubError(`GitHub recusou o acesso: ${msg}`, 403);
      throw new GitHubError(`GitHub ${method} ${path}: ${res.status} ${msg}`, res.status);
    }
    return { status: res.status, data };
  }

  const refPath = branch => '/git/refs/heads/' + branch.split('/').map(encodeURIComponent).join('/');

  return {
    async getBranchHead(branch) {
      const { data } = await call('GET', '/git/ref/heads/' + branch.split('/').map(encodeURIComponent).join('/'), null, { allow: [404] });
      return data?.object?.sha ?? null;
    },

    // Conteúdo UTF-8 do arquivo em um commit (sha), ou null se não existir.
    async readFile(sha, path) {
      const key = sha + ':' + path;
      if (cache.has(key)) return cache.get(key);
      const p = '/contents/' + path.split('/').map(encodeURIComponent).join('/') + '?ref=' + encodeURIComponent(sha);
      const { data } = await call('GET', p, null, { allow: [404] });
      let text = null;
      if (data) {
        let b64 = data.content;
        if (data.encoding !== 'base64') ({ data: { content: b64 } } = await call('GET', '/git/blobs/' + data.sha));
        text = Buffer.from(b64, 'base64').toString('utf8');
      }
      if (cache.size > 100) cache.clear();
      cache.set(key, text);
      return text;
    },

    // Grava `files` ({caminho: texto}) em um commit sobre parentSha.
    // Sem `createBranch`, só avança o branch se ele ainda estiver em parentSha.
    async commit({ branch, parentSha, files, message, createBranch = false }) {
      const { data: parent } = await call('GET', '/git/commits/' + parentSha);
      const { data: tree } = await call('POST', '/git/trees', {
        base_tree: parent.tree.sha,
        tree: Object.entries(files).map(([path, content]) => ({ path, mode: '100644', type: 'blob', content })),
      });
      const { data: commit } = await call('POST', '/git/commits', { message, tree: tree.sha, parents: [parentSha] });
      try {
        if (createBranch) await call('POST', '/git/refs', { ref: 'refs/heads/' + branch, sha: commit.sha });
        else await call('PATCH', refPath(branch), { sha: commit.sha, force: false });
      } catch (e) {
        if (e.status === 422 || e.status === 409) throw new ConflictError(`O branch ${branch} mudou durante a gravação.`);
        throw e;
      }
      return commit.sha;
    },

    async deleteBranch(branch) {
      const { status } = await call('DELETE', refPath(branch), null, { allow: [404, 422] });
      return status === 204;
    },
  };
}
