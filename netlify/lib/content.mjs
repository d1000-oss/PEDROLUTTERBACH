// Seções editáveis pelo painel /admin e a validação de cada uma.
// Tudo que chega do navegador passa por aqui antes de virar commit.

export class ValidationError extends Error {
  constructor(detalhes) {
    super('Dados inválidos');
    this.detalhes = detalhes;
  }
}

// Caracteres de controle (exceto \n e \t) e separadores de linha Unicode.
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\u2028\u2029]/;

// [texto do link](https://endereco) — único formato aceito dentro dos parágrafos.
export const LINK = /\[([^\[\]\n]{1,200})\]\(([^()\s]{1,500})\)/g;

export function isSafeUrl(value) {
  try {
    const url = new URL(value);
    return (url.protocol === 'https:' || url.protocol === 'http:') && !!url.hostname;
  } catch {
    return false;
  }
}

class Checker {
  constructor() { this.erros = []; }

  fail(campo, mensagem) { this.erros.push({ campo, mensagem }); }

  text(value, campo, { max, min = 1, multiline = false } = {}) {
    if (typeof value !== 'string') { this.fail(campo, 'Deve ser um texto.'); return ''; }
    const s = value.normalize('NFC').replace(/\r\n?/g, '\n').trim();
    const len = [...s].length;
    if (len < min) this.fail(campo, min === 1 ? 'Não pode ficar vazio.' : `Mínimo de ${min} caracteres.`);
    if (len > max) this.fail(campo, `Máximo de ${max} caracteres (tem ${len}).`);
    if (!multiline && s.includes('\n')) this.fail(campo, 'Não pode ter quebra de linha.');
    if (CONTROL.test(s)) this.fail(campo, 'Contém caracteres inválidos.');
    // {{ }} é a sintaxe de variáveis do template do site.
    if (s.includes('{{') || s.includes('}}')) this.fail(campo, 'Não pode conter "{{" ou "}}".');
    return s;
  }

  links(value, campo) {
    for (const [, , url] of value.matchAll(LINK)) {
      if (!isSafeUrl(url)) this.fail(campo, `Link inválido: ${url} (use um endereço começando com https://).`);
    }
  }

  list(value, campo, { min, max }) {
    if (!Array.isArray(value)) { this.fail(campo, 'Deve ser uma lista.'); return []; }
    if (value.length < min) this.fail(campo, `Precisa de pelo menos ${min} ${min === 1 ? 'item' : 'itens'}.`);
    if (value.length > max) this.fail(campo, `Máximo de ${max} itens.`);
    return value.slice(0, max);
  }

  object(value, campo) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) { this.fail(campo, 'Formato inválido.'); return {}; }
    return value;
  }

  done(value) {
    if (this.erros.length) throw new ValidationError(this.erros);
    return value;
  }
}

export function validateBiografia(input) {
  const c = new Checker();
  const o = c.object(input, 'biografia');
  const value = {
    heading: c.text(o.heading, 'heading', { max: 80 }),
    headingAccent: c.text(o.headingAccent, 'headingAccent', { max: 80 }),
    paragraphs: c.list(o.paragraphs, 'paragraphs', { min: 1, max: 8 }).map((p, i) => {
      const s = c.text(p, `paragraphs[${i}]`, { max: 1500 });
      c.links(s, `paragraphs[${i}]`);
      return s;
    }),
    timeline: c.list(o.timeline, 'timeline', { min: 1, max: 40 }).map((t, i) => {
      const item = c.object(t, `timeline[${i}]`);
      return {
        year: c.text(item.year, `timeline[${i}].year`, { max: 16 }),
        title: c.text(item.title, `timeline[${i}].title`, { max: 120 }),
        body: c.text(item.body, `timeline[${i}].body`, { max: 600, min: 0 }),
      };
    }),
  };
  return c.done(value);
}

export const SECTIONS = {
  biografia: { label: 'Biografia', path: 'content/biografia.json', validate: validateBiografia },
};

export const SECTION_IDS = Object.keys(SECTIONS);

// Formato gravado no repositório (estável, para diffs limpos).
export function serialize(value) {
  return JSON.stringify(value, null, 2) + '\n';
}

export function sameContent(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}
