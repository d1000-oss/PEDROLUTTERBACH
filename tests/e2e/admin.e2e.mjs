// Teste ponta a ponta do painel no navegador (Playwright), contra o servidor
// local com GitHub simulado. Não toca no GitHub nem na Netlify.
//
//   node tests/e2e/admin.e2e.mjs
//   E2E_CAPTURAS=/tmp/capturas node tests/e2e/admin.e2e.mjs   (salva screenshots)

import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import { startDevServer, DEV_PASSWORD } from '../../scripts/dev-server.mjs';

const require = createRequire(import.meta.url);
let chromium;
try {
  ({ chromium } = require('playwright'));
} catch {
  console.error('Playwright não encontrado. Instale com: npm i -g playwright && npx playwright install chromium');
  process.exit(1);
}

const CAPTURAS = process.env.E2E_CAPTURAS;
const shot = (page, nome) => CAPTURAS && page.screenshot({ path: path.join(CAPTURAS, nome + '.png'), fullPage: true });
const EXTERNO = /tonejs|youtube|ytimg|googleapis|gstatic|spotify/;

const server = await startDevServer({ port: 0, quiet: true });
const browser = await chromium.launch();
const problemas = [];
let passo = '';

// Erro que já existia no site antes do painel: o dc-runtime chama
// componentDidUpdate(prevProps) sem o estado anterior e o script lê `prev.cat`.
// O runtime captura o erro e a página segue funcionando.
const ERRO_ANTIGO_DO_SITE = /reading 'cat'\)[\s\S]*Component\.componentDidUpdate/;

function vigiar(page, nome) {
  page.on('pageerror', e => problemas.push(`[${nome}] erro de JS: ${e.message}`));
  page.on('console', m => {
    if (m.type() !== 'error' || /ERR_FAILED|ERR_BLOCKED|Failed to load resource/.test(m.text()) || ERRO_ANTIGO_DO_SITE.test(m.text())) return;
    problemas.push(`[${nome}] console: ${m.text()}`);
  });
}

try {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await ctx.route(EXTERNO, r => r.abort());
  const page = await ctx.newPage();
  vigiar(page, 'admin');

  passo = 'abrir /admin com CSP';
  const resp = await page.goto(server.url + '/admin/');
  assert.match(resp.headers()['content-security-policy'], /script-src 'self'/);
  assert.equal(resp.headers()['x-robots-tag'], 'noindex, nofollow');
  await page.getByRole('heading', { name: 'Pedro Lutterbach' }).waitFor();
  await shot(page, '01-login');

  passo = 'login com senha errada';
  await page.getByLabel('Usuário').fill('pedro');
  await page.getByLabel('Senha').fill('errada-errada');
  await page.getByRole('button', { name: 'Entrar' }).click();
  await page.getByText('Usuário ou senha incorretos.').waitFor();

  passo = 'login correto';
  await page.getByLabel('Senha').fill(DEV_PASSWORD);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await page.getByRole('heading', { name: 'Visão geral' }).waitFor();
  await page.getByText('Tudo publicado').waitFor();
  await shot(page, '02-visao-geral');

  passo = 'editar biografia';
  await page.getByRole('button', { name: 'Editar' }).click();
  await page.getByRole('heading', { name: 'Biografia', level: 1 }).waitFor();
  assert.equal(await page.getByLabel('Primeira linha').inputValue(), 'Música que sai dos');
  await page.getByLabel('Segunda linha').fill('limites de tudo.');
  const p1 = page.getByRole('textbox', { name: 'Parágrafo 1' });
  await p1.fill((await p1.inputValue()) + ' Frase acrescentada pelo painel.');
  await page.getByRole('button', { name: '+ Adicionar marco' }).click();
  await page.getByRole('textbox', { name: 'Ano' }).last().fill('2026');
  await page.getByRole('textbox', { name: 'Título', exact: true }).last().fill('Painel novo');
  await page.getByRole('textbox', { name: 'Texto', exact: true }).last().fill('Teste do CMS.');
  await page.getByText('Edições não salvas').waitFor();
  assert.ok(await page.getByRole('button', { name: 'Publicar alterações' }).count() === 0, 'sem rascunho ainda');

  passo = 'validação do servidor';
  const titulo = page.getByLabel('Primeira linha');
  await titulo.fill('');
  await page.getByRole('button', { name: 'Salvar rascunho' }).click();
  await page.getByText('Título — primeira linha: Não pode ficar vazio.').waitFor();
  assert.equal(await titulo.getAttribute('aria-invalid'), 'true');
  await titulo.fill('Música que sai dos');

  passo = 'salvar rascunho';
  await page.getByRole('button', { name: 'Salvar rascunho' }).click();
  await page.getByText('Rascunho salvo. O site público ainda não mudou.').waitFor();
  await page.getByText('Alterações não publicadas:').waitFor();
  assert.ok(!server.github.files('main')['index.html'].includes('limites de tudo.'), 'site não muda ao salvar');
  await shot(page, '03-editor-rascunho');

  passo = 'pré-visualizar';
  await page.locator('.acoes-editor').getByRole('button', { name: 'Pré-visualizar' }).click();
  const frame = page.frameLocator('.previa iframe');
  await frame.locator('#trajetoria').getByText('limites de tudo.').waitFor({ timeout: 15000 });
  await frame.locator('#trajetoria').getByText('Painel novo').waitFor();
  await frame.locator('#trajetoria').getByText('Frase acrescentada pelo painel.').waitFor();
  await page.waitForTimeout(800);
  await shot(page, '04-previa');
  await page.locator('.previa').getByText('Celular').click();
  await frame.locator('#trajetoria').getByText('Painel novo').waitFor({ timeout: 15000 });
  assert.equal(await page.locator('.previa iframe').evaluate(f => f.contentWindow.innerWidth), 390);
  await page.waitForTimeout(800);
  await shot(page, '05-previa-celular');
  await page.getByRole('button', { name: 'Fechar', exact: true }).click();

  passo = 'publicar';
  await page.getByRole('button', { name: 'Publicar alterações' }).click();
  await page.getByRole('dialog').getByText('Publicar alterações?').waitFor();
  await shot(page, '06-confirmar-publicacao');
  await page.getByRole('dialog').getByRole('button', { name: 'Publicar' }).click();
  await page.getByText('Publicado! O site será atualizado').waitFor();
  await page.getByText('Tudo publicado').waitFor();
  const publicado = server.github.files('main');
  assert.ok(publicado['index.html'].includes('limites de tudo.'));
  assert.equal(JSON.parse(publicado['content/biografia.json']).timeline.at(-1).title, 'Painel novo');
  assert.equal(server.github.head('cms-rascunho'), null);

  passo = 'site público mostra a alteração';
  const site = await ctx.newPage();
  vigiar(site, 'site');
  await site.goto(server.url + '/');
  await site.locator('#trajetoria').getByText('limites de tudo.').waitFor({ timeout: 15000 });
  await site.locator('#trajetoria').getByText('Painel novo').waitFor();
  await site.close();

  passo = 'descartar';
  await page.getByLabel('Primeira linha').fill('Título provisório');
  await page.getByRole('button', { name: 'Salvar rascunho' }).click();
  await page.getByText('Rascunho salvo.').waitFor();
  await page.getByRole('button', { name: 'Descartar alterações' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Descartar' }).click();
  await page.getByText('Alterações descartadas.').waitFor();
  assert.equal(await page.getByLabel('Primeira linha').inputValue(), 'Música que sai dos');
  assert.equal(server.github.head('cms-rascunho'), null);

  passo = 'sair';
  await page.getByRole('button', { name: '← Visão geral' }).click();
  await page.getByRole('button', { name: 'Sair' }).click();
  await page.getByRole('button', { name: 'Entrar' }).waitFor();
  await page.reload();
  await page.getByRole('button', { name: 'Entrar' }).waitFor();

  passo = 'celular';
  const mob = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true });
  await mob.route(EXTERNO, r => r.abort());
  const m = await mob.newPage();
  vigiar(m, 'celular');
  await m.goto(server.url + '/admin/');
  await m.getByLabel('Usuário').fill('diogo');
  await m.getByLabel('Senha').fill(DEV_PASSWORD);
  await m.getByRole('button', { name: 'Entrar' }).click();
  await m.getByRole('heading', { name: 'Visão geral' }).waitFor();
  await m.getByRole('button', { name: 'Editar' }).click();
  await m.getByLabel('Segunda linha').fill('outra linha');
  await m.getByRole('button', { name: 'Salvar rascunho' }).click();
  await m.getByText('Rascunho salvo.').waitFor();
  const largura = await m.evaluate(() => document.documentElement.scrollWidth);
  assert.ok(largura <= 390, `sem rolagem horizontal no celular (largura ${largura})`);
  await shot(m, '07-celular-editor');

  assert.deepEqual(problemas, [], 'sem erros de JavaScript nem violações de CSP');
  console.log('✔ e2e do painel: todos os passos passaram');
} catch (e) {
  console.error(`✖ falhou no passo "${passo}":`, e.message);
  if (problemas.length) console.error(problemas.join('\n'));
  process.exitCode = 1;
} finally {
  await browser.close();
  await server.close();
}
