// Gera os valores secretos do painel, para colar nas variáveis de ambiente da Netlify.
//
//   node scripts/cms-senha.mjs pedro      → pede a senha e imprime "pedro:scrypt$..." (CMS_USERS)
//   node scripts/cms-senha.mjs --segredo  → imprime um valor aleatório para CMS_SESSION_SECRET
//
// A senha digitada não aparece na tela e não é gravada em lugar nenhum.

import { randomBytes } from 'node:crypto';
import { hashPassword } from '../netlify/lib/auth.mjs';

const MIN = 12;

function ask(question) {
  return new Promise(resolve => {
    const { stdin, stdout } = process;
    stdout.write(question);
    if (!stdin.isTTY) {
      // Entrada por pipe: lê a primeira linha.
      let buf = '';
      stdin.setEncoding('utf8');
      stdin.on('data', d => { buf += d; });
      stdin.on('end', () => resolve(buf.split(/\r?\n/)[0]));
      return;
    }
    let value = '';
    stdin.setRawMode(true);
    stdin.setEncoding('utf8');
    const onData = ch => {
      if (ch === '\u0003') process.exit(130);
      if (ch === '\r' || ch === '\n') {
        stdin.setRawMode(false); stdin.pause(); stdin.off('data', onData);
        stdout.write('\n');
        resolve(value);
      } else if (ch === '\u007f' || ch === '\b') value = value.slice(0, -1);
      else value += ch;
    };
    stdin.resume();
    stdin.on('data', onData);
  });
}

const arg = process.argv[2];
if (arg === '--segredo') {
  console.log(randomBytes(48).toString('base64url'));
} else if (/^[a-z0-9._-]{2,32}$/.test(arg || '')) {
  const senha = await ask(`Senha para "${arg}" (mínimo ${MIN} caracteres): `);
  if ([...senha].length < MIN) { console.error(`A senha precisa de pelo menos ${MIN} caracteres.`); process.exit(1); }
  if (process.stdin.isTTY) {
    const again = await ask('Repita a senha: ');
    if (again !== senha) { console.error('As senhas não conferem.'); process.exit(1); }
  }
  console.log(`\n${arg}:${await hashPassword(senha)}`);
} else {
  console.error('Uso:\n  node scripts/cms-senha.mjs <usuario>   (letras minúsculas, números, . _ -)\n  node scripts/cms-senha.mjs --segredo');
  process.exit(1);
}
