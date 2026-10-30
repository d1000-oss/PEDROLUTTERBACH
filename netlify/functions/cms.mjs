// Netlify Function do painel /admin: atende /api/cms/*.
// Todas as credenciais vêm das variáveis de ambiente da Netlify (ver docs/CMS.md).

import { createApi } from '../lib/api.mjs';
import { createGitHub } from '../lib/github.mjs';

let handle;

export default async (request, context) => {
  handle ??= createApi({
    env: process.env,
    makeGitHub: config => createGitHub({ token: config.token, repo: config.repo }),
  });
  return handle(request, context);
};

export const config = { path: '/api/cms/*' };
