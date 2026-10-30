# Painel administrativo (`/admin`)

Painel próprio para editar o conteúdo do site sem programar. Não usa serviço pago,
CMS externo nem banco de dados: o conteúdo fica em JSON no próprio repositório e
cada publicação é um commit no GitHub, que dispara o deploy automático da Netlify.

## Como funciona

```
navegador (/admin)  ──cookie HttpOnly──▶  Netlify Function /api/cms/*  ──token──▶  API do GitHub
   React 18 do site                       login, validação, geração            branch cms-rascunho  (rascunho)
   + CSS "Classical"                      do index.html                        branch main          (publicado → deploy)
```

| Ação no painel | O que acontece |
| --- | --- |
| **Salvar rascunho** | Grava `content/<seção>.json` no branch `cms-rascunho`. O site não muda e não há deploy. |
| **Pré-visualizar** | A função gera o `index.html` com o rascunho e o mostra no painel. Não há deploy. |
| **Publicar alterações** | Um único commit no `main` com os JSON e o `index.html` regenerado. A Netlify publica em cerca de 1 minuto. |
| **Descartar alterações** | Apaga o branch `cms-rascunho`. O site não muda. |

O `index.html` continua sendo o export do Claude Design. O painel só troca o que
está entre marcadores:

- `<!-- cms:biografia --> … <!-- /cms:biografia -->`: título e parágrafos da seção Trajetória (template);
- `/* cms:dados */ … /* /cms:dados */`: constante `CMS` lida pelo script do site (linha do tempo).

Com o conteúdo atual, o arquivo gerado é **idêntico byte a byte** ao do repositório
(há um teste para isso). O resto da página — layout, estilos, scripts — nunca é tocado.

### Arquivos

| Caminho | Papel |
| --- | --- |
| `admin/` | Painel: `index.html`, `app.js` (React sem build), `admin.css`, `classical.css` (cópia do design system do site) |
| `netlify/functions/cms.mjs` | Netlify Function (`/api/cms/*`) |
| `netlify/lib/` | `api.mjs` (rotas), `auth.mjs` (senhas e sessões), `content.mjs` (validação), `render.mjs` (geração do HTML), `github.mjs` (API do GitHub) |
| `content/biografia.json` | Conteúdo da biografia |
| `scripts/cms-senha.mjs` | Gera hash de senha e segredo de sessão |
| `scripts/dev-server.mjs` | Servidor local com GitHub simulado |
| `tests/` | Testes (`npm test`) e teste no navegador (`npm run test:e2e`) |
| `_headers`, `netlify.toml` | Cabeçalhos de segurança do `/admin`; o branch de rascunho não gera deploy |

## Configuração (uma vez)

### 1. Token do GitHub

Em GitHub → *Settings → Developer settings → Personal access tokens → Fine-grained tokens → Generate new token*:

- **Resource owner:** `d1000-oss`
- **Repository access:** *Only select repositories* → `pedrolutterbach`
- **Permissions → Repository → Contents:** *Read and write* (o *Metadata: Read* é automático)
- **Expiration:** até 1 ano. Anote a data e crie um token novo antes de vencer.

Se a organização exigir aprovação de tokens fine-grained, um dono da `d1000-oss` precisa aprovar.
Se o branch `main` tiver proteção que exige pull request, o painel não conseguirá publicar.

### 2. Senhas e segredo de sessão

No computador, dentro do repositório (precisa de Node 20 ou mais novo):

```bash
node scripts/cms-senha.mjs diogo
node scripts/cms-senha.mjs pedro
node scripts/cms-senha.mjs --segredo
```

Cada pessoa digita a **própria** senha (mínimo 12 caracteres; ela não aparece na tela
e não é salva). O comando imprime uma linha `usuario:scrypt$...`, que é só o hash:
a senha em si nunca vai para a Netlify.

### 3. Variáveis de ambiente na Netlify

*Site configuration → Environment variables → Add a variable*:

| Variável | Valor |
| --- | --- |
| `GITHUB_TOKEN` | o token do passo 1 |
| `GITHUB_REPO` | `d1000-oss/pedrolutterbach` |
| `CMS_PUBLISH_BRANCH` | `main` |
| `CMS_SESSION_SECRET` | o valor de `--segredo` |
| `CMS_USERS` | as linhas do passo 2 separadas por vírgula: `diogo:scrypt$...,pedro:scrypt$...` |
| `CMS_DRAFT_BRANCH` | opcional; padrão `cms-rascunho` (se mudar, ajuste também o `ignore` do `netlify.toml`) |

Variáveis novas ou alteradas só valem depois de um novo deploy.

### 4. Testar antes de publicar em produção

1. Crie no GitHub um branch `cms-teste` a partir do branch desta mudança.
2. Na Netlify, defina valores **só para o contexto *Deploy Previews***:
   `CMS_PUBLISH_BRANCH=cms-teste` e `CMS_DRAFT_BRANCH=cms-teste-rascunho`.
3. Abra o pull request: a Netlify cria um Deploy Preview (sem custo de créditos).
   Em `https://deploy-preview-N--<site>.netlify.app/admin/`, publicar grava no `cms-teste`,
   não no site real.
4. Conferido, faça o merge no `main`. O painel passa a funcionar em
   `https://pedrolutterbach.com/admin/`.

Também é possível testar tudo localmente, sem GitHub nem Netlify (veja *Testes*).

## Uso no dia a dia

1. Acesse `pedrolutterbach.com/admin` e entre com usuário e senha.
2. Em **Visão geral**, clique em **Editar** na seção desejada.
3. Edite e clique em **Salvar rascunho**. Para links no texto: `[texto do link](https://endereço)`.
4. **Pré-visualizar** mostra o site com as alterações (computador ou celular).
5. **Publicar alterações** leva tudo ao site em cerca de 1 minuto.
   **Descartar alterações** apaga o rascunho.

O rascunho é compartilhado entre os administradores. Se duas pessoas editarem ao mesmo
tempo, quem salvar depois recebe um aviso para recarregar a página e nada é sobrescrito.

**Custos:** no plano gratuito por créditos da Netlify, cada deploy de produção consome
15 dos 300 créditos mensais. Por isso o rascunho e a pré-visualização não fazem deploy.
Junte várias alterações em uma única publicação.

## Segurança

- Senhas guardadas só como hash **scrypt**, nas variáveis de ambiente da Netlify. O token do GitHub também fica só no servidor.
- Sessão em cookie `__Host-`, `HttpOnly`, `Secure`, `SameSite=Strict`, assinado com HMAC-SHA256 e válido por 8 horas.
- Trocar a senha de alguém derruba as sessões dessa pessoa. Para derrubar todas, troque `CMS_SESSION_SECRET`.
- Para tirar o acesso de alguém, remova a pessoa de `CMS_USERS` e faça um novo deploy.
- Requisições que alteram dados só são aceitas vindas do próprio site (checagem de `Origin`/`Sec-Fetch-Site`, só JSON, limite de 100 KB).
- Todo texto é validado no servidor e escapado na geração do HTML. Links só `http(s)`; `{{ }}` (sintaxe do template) é recusado.
- Login: 5 tentativas erradas por usuário (20 por IP) bloqueiam por 15 minutos. O contador fica na memória da função, então é uma proteção de melhor esforço: use senhas fortes.
- O `/admin` tem CSP restritiva, `noindex` e não pode ser embutido em outros sites.
- Os logs da função registram quem fez login, salvou, publicou ou descartou. O histórico de commits mostra `CMS: publica … (por usuario)`.
- Os arquivos de código, testes e documentação ficam acessíveis pela URL (o site publica a raiz do repositório). Nenhum deles contém segredos.

## Testes

```bash
npm test            # unidade + integração da API (GitHub simulado), sem dependências
npm run test:e2e    # painel no navegador real (precisa do Playwright instalado)
npm run dev         # http://localhost:8888/admin/ — usuários pedro/diogo, senha "senha-local-de-teste"
```

O servidor local usa um GitHub simulado em memória, semeado com os arquivos locais.
Nada é enviado ao GitHub real.

## Manutenção

**Se o site for exportado de novo pelo Claude Design**, os marcadores somem. O painel
recusa publicar, com a mensagem "Marcador … ausente", e nada quebra. Para reativar:

1. Volte a pôr `<!-- cms:biografia -->` antes do `<h2>` da seção Trajetória e
   `<!-- /cms:biografia -->` logo depois do último `</p>` antes da foto.
2. No início do `<script type="text/x-dc">`, adicione as linhas `/* cms:dados */` e `/* /cms:dados */`.
3. Troque o array da linha do tempo em `renderVals()` por `timeline: CMS.biografia.timeline,`.
4. Rode `npm test`: o teste de idempotência indica se ficou igual.

## Próximas etapas

Fotos (envio, troca e exclusão), aulas, vídeos, publicações e contato, no mesmo modelo
de seção: um JSON, um validador em `content.mjs`, uma região em `render.mjs` e um editor em `app.js`.
