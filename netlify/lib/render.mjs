// Gera o index.html publicado a partir do index.html atual + conteúdo em JSON.
// Só troca as regiões delimitadas por marcadores; o resto da página (layout,
// estilos, scripts) passa intacto. Com o conteúdo atual, o resultado é
// byte a byte igual ao arquivo de entrada.

import { LINK, isSafeUrl } from './content.mjs';

export class RenderError extends Error {}

export function escapeText(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function escapeAttr(s) {
  return escapeText(s).replace(/"/g, '&quot;');
}

function guard(s) {
  // Defesa extra: a validação já recusa {{ }}, que o template interpretaria.
  if (s.includes('{{') || s.includes('}}')) throw new RenderError('Conteúdo com "{{" ou "}}"');
  return s;
}

// Texto simples com links no formato [texto](https://...).
export function renderInline(text) {
  let out = '', last = 0;
  for (const m of text.matchAll(LINK)) {
    const [whole, label, url] = m;
    if (!isSafeUrl(url)) continue;
    out += escapeText(text.slice(last, m.index));
    out += `<a href="${escapeAttr(url)}" target="_blank">${escapeText(label)}</a>`;
    last = m.index + whole.length;
  }
  return guard(out + escapeText(text.slice(last)));
}

const P_STYLE = 'font-size:17px; line-height:1.75; text-align:justify; hyphens:auto; color:color-mix(in srgb, var(--color-text) 80%, transparent);';

function renderBiografiaHtml(bio) {
  const heading = guard(escapeText(bio.heading));
  const accent = guard(escapeText(bio.headingAccent));
  const last = bio.paragraphs.length - 1;
  const paragraphs = bio.paragraphs.map((p, i) =>
    `      <p data-reveal="${160 + i * 60}" style="margin:0 0 ${i === last ? 30 : 18}px; ${P_STYLE}">${renderInline(p)}</p>`);
  return `<h2 style="margin:0 0 28px; font-family:var(--font-heading); font-weight:400; font-size:clamp(40px,5vw,66px); line-height:1.04; letter-spacing:-0.02em;">
        <span style="display:block; overflow:hidden;"><span data-mask="0" style="display:block;">${heading}</span></span>
        <span style="display:block; overflow:hidden; padding-bottom:.08em;"><span data-mask="120" style="display:block;"><em style="color:var(--color-accent-700);">${accent}</em></span></span>
      </h2>
${paragraphs.join('\n')}`;
}

// Dados lidos pelo script do site (class Component) através da constante CMS.
function scriptData(content) {
  return { biografia: { timeline: content.biografia.timeline } };
}

// JSON seguro dentro de <script>: sem "<" (impede </script>), sem "*" (impede
// fechar o comentário marcador) e sem separadores de linha Unicode.
export function scriptJson(value) {
  return JSON.stringify(value, null, 2).replace(/[<>&*\u2028\u2029]/g,
    c => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'));
}

function replaceRegion(html, open, close, body) {
  const start = html.indexOf(open);
  if (start === -1 || html.indexOf(open, start + 1) !== -1) {
    throw new RenderError(`Marcador ${open} ausente ou repetido no index.html`);
  }
  const end = html.indexOf(close, start);
  if (end === -1 || html.indexOf(close, end + 1) !== -1) {
    throw new RenderError(`Marcador ${close} ausente ou repetido no index.html`);
  }
  return html.slice(0, start + open.length) + body + html.slice(end);
}

export const MARKERS = {
  biografia: ['<!-- cms:biografia -->', '<!-- /cms:biografia -->'],
  dados: ['/* cms:dados */', '/* /cms:dados */'],
};

export function renderSite(html, content) {
  let out = replaceRegion(html, ...MARKERS.biografia, renderBiografiaHtml(content.biografia));
  out = replaceRegion(out, ...MARKERS.dados, `\nconst CMS = ${scriptJson(scriptData(content))};\n`);
  return out;
}
