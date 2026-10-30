import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { renderSite, renderInline, scriptJson, RenderError, MARKERS } from '../netlify/lib/render.mjs';
import { validateBiografia } from '../netlify/lib/content.mjs';

const INDEX = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const BIO = JSON.parse(fs.readFileSync(new URL('../content/biografia.json', import.meta.url), 'utf8'));

const region = (html, [open, close]) => html.slice(html.indexOf(open) + open.length, html.indexOf(close));
const cmsData = html => Function(region(html, MARKERS.dados) + '; return CMS;')();

test('com o conteúdo atual, o index.html gerado é idêntico ao do repositório', () => {
  assert.equal(renderSite(INDEX, { biografia: validateBiografia(BIO) }), INDEX);
});

test('content/biografia.json é válido e corresponde ao que o site mostra', () => {
  assert.deepEqual(validateBiografia(BIO), BIO);
  assert.deepEqual(cmsData(INDEX).biografia.timeline, BIO.timeline);
});

test('troca título, parágrafos e linha do tempo mantendo a estrutura', () => {
  const bio = { ...BIO, heading: 'Novo título', headingAccent: 'em destaque', paragraphs: ['Um.', 'Dois.', 'Três.'], timeline: [{ year: '2025', title: 'Novo marco', body: '' }] };
  const out = renderSite(INDEX, { biografia: bio });
  const html = region(out, MARKERS.biografia);
  assert.match(html, /data-mask="0" style="display:block;">Novo título<\/span>/);
  assert.match(html, /<em style="color:var\(--color-accent-700\);">em destaque<\/em>/);
  assert.deepEqual([...html.matchAll(/<p data-reveal="(\d+)" style="margin:0 0 (\d+)px;/g)].map(m => [m[1], m[2]]),
    [['160', '18'], ['220', '18'], ['280', '30']]);
  assert.deepEqual(cmsData(out).biografia.timeline, bio.timeline);
  // Fora das regiões marcadas, nada muda.
  const outside = h => h.replace(region(h, MARKERS.biografia), '').replace(region(h, MARKERS.dados), '');
  assert.equal(outside(out), outside(INDEX));
});

test('escapa HTML no template e no script', () => {
  const evil = '<script>alert(1)</script> & "aspas" */ </script><!--';
  const bio = { ...BIO, heading: evil, paragraphs: [evil], timeline: [{ year: '1', title: evil, body: evil }] };
  const out = renderSite(INDEX, { biografia: bio });
  const html = region(out, MARKERS.biografia);
  assert.ok(!html.includes('<script>'));
  assert.ok(html.includes('&lt;script&gt;alert(1)&lt;/script&gt; &amp; "aspas" */ &lt;/script&gt;&lt;!--'));
  const data = region(out, MARKERS.dados);
  assert.ok(!/[<>*]/.test(data.replace('const CMS = ', '')), 'sem < > * crus no bloco de dados');
  assert.equal(cmsData(out).biografia.timeline[0].title, evil);
  // O documento continua com um único fim para cada script.
  assert.equal(out.split('</script>').length, INDEX.split('</script>').length);
});

test('links [texto](url) viram <a>, com atributos escapados', () => {
  assert.equal(renderInline('Veja [o canal](https://youtube.com/c/x?a=1&b="2") agora'),
    'Veja <a href="https://youtube.com/c/x?a=1&amp;b=&quot;2&quot;" target="_blank">o canal</a> agora');
  assert.equal(renderInline('[x](javascript:alert)'), '[x](javascript:alert)');
  assert.equal(renderInline('sem <b>link</b>'), 'sem &lt;b&gt;link&lt;/b&gt;');
});

test('scriptJson escapa caracteres perigosos', () => {
  assert.equal(scriptJson('</script>*/\u2028'), '"\\u003c/script\\u003e\\u002a/\\u2028"');
});

test('falha se os marcadores sumirem (ex.: novo export do Claude Design)', () => {
  assert.throws(() => renderSite(INDEX.replace(MARKERS.biografia[0], ''), { biografia: BIO }), RenderError);
  assert.throws(() => renderSite(INDEX.replace(MARKERS.dados[1], ''), { biografia: BIO }), RenderError);
  assert.throws(() => renderSite(INDEX + MARKERS.dados[0], { biografia: BIO }), RenderError);
});

test('recusa {{ }} mesmo se a validação for contornada', () => {
  assert.throws(() => renderSite(INDEX, { biografia: { ...BIO, heading: '{{ x }}' } }), RenderError);
});
