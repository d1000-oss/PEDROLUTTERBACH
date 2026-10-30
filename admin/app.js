// Painel administrativo do site (React 18, sem etapa de build).
// Nenhuma credencial fica aqui: o login gera um cookie HttpOnly e todas as
// operações passam pela Netlify Function em /api/cms/*.
(() => {
  'use strict';
  const { useState, useEffect, useRef, useCallback } = React;
  const h = React.createElement;

  // ——— API ———
  class ApiError extends Error {
    constructor(message, status, detalhes) { super(message); this.status = status; this.detalhes = detalhes; }
  }

  async function api(rota, { metodo = 'GET', dados } = {}) {
    let res;
    try {
      res = await fetch('/api/cms/' + rota, {
        method: metodo,
        credentials: 'same-origin',
        headers: dados ? { 'Content-Type': 'application/json' } : {},
        body: dados ? JSON.stringify(dados) : undefined,
      });
    } catch {
      throw new ApiError('Sem conexão com o servidor. Verifique a internet e tente de novo.', 0);
    }
    const corpo = await res.json().catch(() => null);
    if (!res.ok) throw new ApiError(corpo?.erro || `Erro ${res.status}`, res.status, corpo?.detalhes);
    return corpo;
  }

  // ——— utilidades ———
  const igual = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const mover = (lista, i, d) => {
    const j = i + d;
    if (j < 0 || j >= lista.length) return lista;
    const nova = lista.slice();
    [nova[i], nova[j]] = [nova[j], nova[i]];
    return nova;
  };
  const remover = (lista, i) => lista.filter((_, k) => k !== i);
  const trocar = (lista, i, valor) => lista.map((x, k) => (k === i ? valor : x));

  const ROTULOS_SECAO = { biografia: 'Biografia' };
  const CAMPOS_TEMPO = { year: 'ano', title: 'título', body: 'texto' };

  function rotuloCampo(campo) {
    let m;
    if (campo === 'heading') return 'Título — primeira linha';
    if (campo === 'headingAccent') return 'Título — linha em destaque';
    if (campo === 'paragraphs') return 'Parágrafos';
    if (campo === 'timeline') return 'Linha do tempo';
    if ((m = /^paragraphs\[(\d+)\]$/.exec(campo))) return `Parágrafo ${+m[1] + 1}`;
    if ((m = /^timeline\[(\d+)\]\.(\w+)$/.exec(campo))) return `Linha do tempo, marco ${+m[1] + 1} — ${CAMPOS_TEMPO[m[2]] || m[2]}`;
    return campo;
  }

  function telaDaUrl() {
    return location.hash === '#/biografia' ? 'biografia' : 'inicio';
  }

  // ——— componentes básicos ———
  function Campo({ id, rotulo, ajuda, erro, children }) {
    return h('div', { className: 'field campo' + (erro ? ' com-erro' : '') },
      h('label', { htmlFor: id }, rotulo),
      children,
      ajuda && h('p', { className: 'ajuda' }, ajuda),
      erro && h('p', { className: 'erro-campo', role: 'alert' }, erro));
  }

  function Texto({ id, valor, onChange, max, multilinha, linhas, erro, ...resto }) {
    return h(multilinha ? 'textarea' : 'input', {
      id, className: 'input', value: valor, maxLength: max, rows: linhas,
      'aria-invalid': erro ? 'true' : undefined,
      onChange: e => onChange(e.target.value),
      ...resto,
    });
  }

  function BotoesItem({ indice, total, onMover, onRemover, nome }) {
    return h('div', { className: 'botoes-item' },
      h('button', { type: 'button', className: 'btn btn-ghost', disabled: indice === 0, onClick: () => onMover(-1), 'aria-label': `Subir ${nome}` }, '↑'),
      h('button', { type: 'button', className: 'btn btn-ghost', disabled: indice === total - 1, onClick: () => onMover(1), 'aria-label': `Descer ${nome}` }, '↓'),
      h('button', { type: 'button', className: 'btn btn-ghost perigo', disabled: total === 1, onClick: onRemover }, 'Remover'));
  }

  function Dialogo({ titulo, texto, rotulo, perigo, onConfirmar, onCancelar }) {
    const ref = useRef(null);
    useEffect(() => {
      ref.current && ref.current.focus();
      const esc = e => { if (e.key === 'Escape') onCancelar(); };
      window.addEventListener('keydown', esc);
      return () => window.removeEventListener('keydown', esc);
    }, [onCancelar]);
    return h('div', { className: 'dialog-backdrop', onClick: e => { if (e.target === e.currentTarget) onCancelar(); } },
      h('div', { className: 'dialog', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'dialogo-titulo' },
        h('div', { className: 'dialog-title', id: 'dialogo-titulo' }, titulo),
        h('div', { className: 'dialog-body' }, texto),
        h('div', { className: 'dialog-actions' },
          h('button', { type: 'button', className: 'btn btn-secondary', onClick: onCancelar }, 'Cancelar'),
          h('button', { type: 'button', ref, className: 'btn btn-primary' + (perigo ? ' perigo' : ''), onClick: onConfirmar }, rotulo))));
  }

  // ——— login ———
  function Login({ aviso, onEntrar }) {
    const [usuario, setUsuario] = useState('');
    const [senha, setSenha] = useState('');
    const [erro, setErro] = useState(aviso || '');
    const [enviando, setEnviando] = useState(false);

    async function enviar(e) {
      e.preventDefault();
      setEnviando(true); setErro('');
      try {
        const r = await api('login', { metodo: 'POST', dados: { usuario, senha } });
        onEntrar(r.usuario);
      } catch (err) {
        setErro(err.message);
        setSenha('');
        setEnviando(false);
      }
    }

    return h('main', { className: 'login' },
      h('form', { className: 'login-caixa', onSubmit: enviar },
        h('p', { className: 'kicker' }, 'Painel administrativo'),
        h('h1', null, 'Pedro ', h('em', null, 'Lutterbach')),
        h(Campo, { id: 'usuario', rotulo: 'Usuário' },
          h('input', { id: 'usuario', className: 'input', autoComplete: 'username', autoCapitalize: 'none', spellCheck: false, required: true, maxLength: 32, value: usuario, onChange: e => setUsuario(e.target.value) })),
        h(Campo, { id: 'senha', rotulo: 'Senha' },
          h('input', { id: 'senha', type: 'password', className: 'input', autoComplete: 'current-password', required: true, maxLength: 200, value: senha, onChange: e => setSenha(e.target.value) })),
        erro && h('p', { className: 'erro-campo', role: 'alert' }, erro),
        h('button', { type: 'submit', className: 'btn btn-primary btn-block', disabled: enviando }, enviando ? 'Entrando…' : 'Entrar'),
        h('a', { className: 'voltar-site', href: '/' }, '← Voltar ao site')));
  }

  // ——— editor da biografia ———
  function EditorBiografia({ inicial, ocupado, onSujo, salvar, previsualizar, voltar }) {
    const [form, setForm] = useState(inicial);
    const [erros, setErros] = useState({});
    useEffect(() => { setForm(inicial); setErros({}); }, [inicial]);

    const sujo = !igual(form, inicial);
    useEffect(() => { onSujo(sujo); }, [sujo, onSujo]);
    useEffect(() => () => onSujo(false), [onSujo]);

    const set = (campo, valor) => setForm(f => ({ ...f, [campo]: valor }));
    const erroDe = campo => erros[campo];

    async function gravar() {
      setErros({});
      try {
        await salvar(form);
        return true;
      } catch (e) {
        if (e.detalhes) setErros(Object.fromEntries(e.detalhes.map(d => [d.campo, d.mensagem])));
        return false;
      }
    }

    async function verPrevia() {
      if (sujo && !(await gravar())) return;
      previsualizar('trajetoria');
    }

    const listaErros = Object.entries(erros);

    return h('div', { className: 'editor' },
      h('button', { type: 'button', className: 'btn btn-ghost voltar', onClick: voltar }, '← Visão geral'),
      h('header', { className: 'editor-topo' },
        h('p', { className: 'kicker' }, 'Seção “Trajetória” do site'),
        h('h1', null, 'Biografia'),
        h('p', { className: 'text-muted' }, 'As alterações ficam guardadas como rascunho. O site só muda quando você clicar em “Publicar alterações”.')),

      listaErros.length > 0 && h('div', { className: 'alerta erro', role: 'alert' },
        h('strong', null, 'Corrija antes de salvar:'),
        h('ul', null, listaErros.map(([campo, msg]) => h('li', { key: campo }, `${rotuloCampo(campo)}: ${msg}`)))),

      h('section', { className: 'bloco' },
        h('h2', null, 'Título'),
        h(Campo, { id: 'bio-titulo', rotulo: 'Primeira linha', erro: erroDe('heading') },
          h(Texto, { id: 'bio-titulo', valor: form.heading, max: 80, erro: erroDe('heading'), onChange: v => set('heading', v) })),
        h(Campo, { id: 'bio-destaque', rotulo: 'Segunda linha (aparece em itálico dourado)', erro: erroDe('headingAccent') },
          h(Texto, { id: 'bio-destaque', valor: form.headingAccent, max: 80, erro: erroDe('headingAccent'), onChange: v => set('headingAccent', v) }))),

      h('section', { className: 'bloco' },
        h('h2', null, 'Texto'),
        h('p', { className: 'ajuda' }, 'Para criar um link, escreva [texto do link](https://endereço). Exemplo: [Piano Brasileiro](https://www.youtube.com/c/Pedrolutterbachpianobr).'),
        form.paragraphs.map((p, i) => h('div', { className: 'item', key: i },
          h(Campo, { id: 'bio-p' + i, rotulo: `Parágrafo ${i + 1}`, erro: erroDe(`paragraphs[${i}]`) },
            h(Texto, { id: 'bio-p' + i, valor: p, max: 1500, multilinha: true, linhas: 5, erro: erroDe(`paragraphs[${i}]`), onChange: v => set('paragraphs', trocar(form.paragraphs, i, v.replace(/\n+/g, ' '))) })),
          h(BotoesItem, { indice: i, total: form.paragraphs.length, nome: `parágrafo ${i + 1}`,
            onMover: d => set('paragraphs', mover(form.paragraphs, i, d)),
            onRemover: () => set('paragraphs', remover(form.paragraphs, i)) }))),
        form.paragraphs.length < 8 && h('button', { type: 'button', className: 'btn btn-secondary', onClick: () => set('paragraphs', [...form.paragraphs, '']) }, '+ Adicionar parágrafo')),

      h('section', { className: 'bloco' },
        h('h2', null, 'Linha do tempo'),
        h('p', { className: 'ajuda' }, 'Os marcos aparecem na ordem desta lista.'),
        form.timeline.map((t, i) => {
          const muda = (campo, v) => set('timeline', trocar(form.timeline, i, { ...t, [campo]: v }));
          return h('div', { className: 'item marco', key: i },
            h('div', { className: 'marco-linha' },
              h(Campo, { id: `tl-ano-${i}`, rotulo: 'Ano', erro: erroDe(`timeline[${i}].year`) },
                h(Texto, { id: `tl-ano-${i}`, valor: t.year, max: 16, erro: erroDe(`timeline[${i}].year`), inputMode: 'numeric', onChange: v => muda('year', v) })),
              h(Campo, { id: `tl-titulo-${i}`, rotulo: 'Título', erro: erroDe(`timeline[${i}].title`) },
                h(Texto, { id: `tl-titulo-${i}`, valor: t.title, max: 120, erro: erroDe(`timeline[${i}].title`), onChange: v => muda('title', v) }))),
            h(Campo, { id: `tl-texto-${i}`, rotulo: 'Texto', erro: erroDe(`timeline[${i}].body`) },
              h(Texto, { id: `tl-texto-${i}`, valor: t.body, max: 600, multilinha: true, linhas: 2, erro: erroDe(`timeline[${i}].body`), onChange: v => muda('body', v.replace(/\n+/g, ' ')) })),
            h(BotoesItem, { indice: i, total: form.timeline.length, nome: `marco ${t.year || i + 1}`,
              onMover: d => set('timeline', mover(form.timeline, i, d)),
              onRemover: () => set('timeline', remover(form.timeline, i)) }));
        }),
        form.timeline.length < 40 && h('button', { type: 'button', className: 'btn btn-secondary', onClick: () => set('timeline', [...form.timeline, { year: '', title: '', body: '' }]) }, '+ Adicionar marco')),

      h('div', { className: 'acoes-editor' },
        h('span', { className: 'estado-edicao' }, sujo ? 'Edições não salvas' : 'Sem edições pendentes nesta página'),
        h('button', { type: 'button', className: 'btn btn-secondary', disabled: !sujo || !!ocupado, onClick: () => setForm(inicial) }, 'Desfazer edições'),
        h('button', { type: 'button', className: 'btn btn-secondary', disabled: !!ocupado, onClick: verPrevia }, 'Pré-visualizar'),
        h('button', { type: 'button', className: 'btn btn-primary', disabled: !sujo || !!ocupado, onClick: gravar }, ocupado === 'salvar' ? 'Salvando…' : 'Salvar rascunho')));
  }

  // ——— visão geral ———
  const FUTURAS = [
    ['Fotos', 'Enviar, substituir e excluir fotos'],
    ['Aulas', 'Modalidades, material e perguntas frequentes'],
    ['Vídeos', 'Vídeos do YouTube em destaque'],
    ['Publicações', 'Livros, partituras e discos'],
    ['Contato', 'WhatsApp, YouTube e Instagram'],
  ];

  function VisaoGeral({ estado, abrir }) {
    const pendente = estado.pendentes.includes('biografia');
    return h('div', null,
      h('h1', null, 'Visão geral'),
      h('p', { className: 'text-muted' }, 'Escolha a seção do site que deseja editar.'),
      h('div', { className: 'grade' },
        h('article', { className: 'card cartao' },
          h('div', { className: 'card-kicker' }, 'Trajetória'),
          h('div', { className: 'card-title' }, 'Biografia'),
          h('p', { className: 'card-body' }, 'Título, texto de apresentação e linha do tempo.'),
          h('div', { className: 'card-meta' }, pendente ? h('span', { className: 'tag tag-accent' }, 'Rascunho não publicado') : h('span', { className: 'tag tag-neutral' }, 'Publicado')),
          h('button', { type: 'button', className: 'btn btn-primary', onClick: () => abrir('biografia') }, 'Editar')),
        FUTURAS.map(([titulo, desc]) => h('article', { className: 'card cartao inativo', key: titulo, 'aria-disabled': 'true' },
          h('div', { className: 'card-kicker' }, 'Próxima etapa'),
          h('div', { className: 'card-title' }, titulo),
          h('p', { className: 'card-body' }, desc),
          h('div', { className: 'card-meta' }, h('span', { className: 'tag tag-outline' }, 'Em breve'))))));
  }

  // ——— pré-visualização ———
  function Previa({ url, fechar }) {
    const [largura, setLargura] = useState('computador');
    useEffect(() => {
      const esc = e => { if (e.key === 'Escape') fechar(); };
      window.addEventListener('keydown', esc);
      return () => window.removeEventListener('keydown', esc);
    }, [fechar]);
    return h('div', { className: 'previa', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Pré-visualização' },
      h('div', { className: 'previa-barra' },
        h('strong', null, 'Pré-visualização'),
        h('span', { className: 'tag tag-accent' }, 'Ainda não publicada'),
        h('div', { className: 'seg', role: 'radiogroup', 'aria-label': 'Tamanho da tela' },
          ['computador', 'celular'].map(op => h('label', { className: 'seg-opt', key: op },
            h('input', { type: 'radio', name: 'largura', checked: largura === op, onChange: () => setLargura(op) }),
            op === 'computador' ? 'Computador' : 'Celular'))),
        h('a', { className: 'btn btn-secondary', href: url, target: '_blank', rel: 'noopener' }, 'Abrir em nova aba ↗'),
        h('button', { type: 'button', className: 'btn btn-primary', onClick: fechar }, 'Fechar')),
      h('div', { className: 'previa-palco' },
        // key: recarrega a página ao trocar o tamanho, para o site abrir já no layout certo.
        h('iframe', { key: largura, src: url, title: 'Pré-visualização do site', className: largura === 'celular' ? 'celular' : '' })));
  }

  // ——— painel ———
  function Painel({ usuario, onSair, onExpirou }) {
    const [estado, setEstado] = useState(null);
    const [erroCarga, setErroCarga] = useState('');
    const [tela, setTela] = useState(telaDaUrl);
    const [sujo, setSujo] = useState(false);
    const [ocupado, setOcupado] = useState('');
    const [mensagem, setMensagem] = useState(null);
    const [previa, setPrevia] = useState(null);
    const [dialogo, setDialogo] = useState(null);
    const sujoRef = useRef(false);
    sujoRef.current = sujo;

    const chamar = useCallback(async (rota, opcoes) => {
      try {
        return await api(rota, opcoes);
      } catch (e) {
        if (e.status === 401) onExpirou();
        throw e;
      }
    }, [onExpirou]);

    const carregar = useCallback(() => {
      setErroCarga('');
      chamar('conteudo').then(setEstado).catch(e => setErroCarga(e.message));
    }, [chamar]);
    useEffect(carregar, [carregar]);

    // Navegação por #/secao, com aviso se houver edições não salvas.
    useEffect(() => {
      const mudou = () => {
        const nova = telaDaUrl();
        if (sujoRef.current && !confirm('Há edições não salvas nesta página. Sair mesmo assim?')) {
          history.replaceState(null, '', '#/' + tela);
          return;
        }
        setTela(nova);
      };
      window.addEventListener('hashchange', mudou);
      return () => window.removeEventListener('hashchange', mudou);
    }, [tela]);
    useEffect(() => {
      const antes = e => { if (sujoRef.current) { e.preventDefault(); e.returnValue = ''; } };
      window.addEventListener('beforeunload', antes);
      return () => window.removeEventListener('beforeunload', antes);
    }, []);
    const ir = destino => { location.hash = destino === 'inicio' ? '#/' : '#/' + destino; };

    async function acao(nome, fn, sucesso) {
      setOcupado(nome); setMensagem(null);
      try {
        const r = await fn();
        if (r && r.secoes) setEstado(r);
        if (sucesso) setMensagem({ tipo: 'ok', texto: sucesso });
        return r;
      } catch (e) {
        setMensagem({ tipo: 'erro', texto: e.message });
        throw e;
      } finally {
        setOcupado('');
      }
    }

    const salvar = secao => dados => acao('salvar',
      () => chamar('rascunho/' + secao, { metodo: 'PUT', dados: { dados, versaoRascunho: estado.versaoRascunho } }),
      'Rascunho salvo. O site público ainda não mudou.');

    // `ancora`: seção do site onde a prévia já abre rolada (ex.: 'trajetoria').
    const previsualizar = useCallback(ancora => {
      setPrevia('/api/cms/previa?t=' + Date.now() + (typeof ancora === 'string' ? '#' + ancora : ''));
    }, []);

    function publicar() {
      setDialogo({
        titulo: 'Publicar alterações?',
        texto: `As alterações em ${estado.pendentes.map(s => ROTULOS_SECAO[s] || s).join(', ')} vão para o site público. A atualização leva cerca de um minuto. Dica: junte várias alterações em uma só publicação — cada uma gera um deploy na Netlify.`,
        rotulo: 'Publicar',
        onConfirmar: () => {
          setDialogo(null);
          acao('publicar', () => chamar('publicar', { metodo: 'POST', dados: { versaoRascunho: estado.versaoRascunho } }),
            'Publicado! O site será atualizado automaticamente em cerca de um minuto.').catch(() => {});
        },
      });
    }

    function descartar() {
      setDialogo({
        titulo: 'Descartar alterações?',
        texto: 'Todas as alterações salvas como rascunho e ainda não publicadas serão apagadas. O site público não muda.',
        rotulo: 'Descartar',
        perigo: true,
        onConfirmar: () => {
          setDialogo(null);
          acao('descartar', () => chamar('descartar', { metodo: 'POST', dados: { versaoRascunho: estado.versaoRascunho } }),
            'Alterações descartadas. O rascunho voltou a ser igual ao site publicado.').catch(() => {});
        },
      });
    }

    function sair() {
      if (sujo && !confirm('Há edições não salvas nesta página. Sair mesmo assim?')) return;
      setSujo(false);
      api('sair', { metodo: 'POST', dados: {} }).catch(() => {}).finally(onSair);
    }

    const fecharDialogo = useCallback(() => setDialogo(null), []);
    const fecharPrevia = useCallback(() => setPrevia(null), []);

    const pendentes = estado ? estado.pendentes : [];
    const bio = estado && estado.secoes.biografia;

    return h('div', { className: 'painel' },
      h('header', { className: 'cabecalho' },
        h('div', { className: 'topo' },
          h('a', { className: 'marca', href: '#/' }, 'Pedro ', h('em', null, 'Lutterbach'), h('span', null, ' · painel')),
          h('a', { className: 'link-topo', href: '/', target: '_blank', rel: 'noopener' }, 'Ver site ↗'),
          h('span', { className: 'usuario' }, usuario.nome),
          h('button', { type: 'button', className: 'btn btn-secondary', onClick: sair }, 'Sair')),
        estado && h('div', { className: 'barra' + (pendentes.length ? ' pendente' : '') },
          h('p', { className: 'barra-texto' }, pendentes.length
            ? ['Alterações não publicadas: ', h('strong', { key: 's' }, pendentes.map(s => ROTULOS_SECAO[s] || s).join(', '))]
            : 'Tudo publicado. O site está igual ao conteúdo salvo.'),
          pendentes.length > 0 && h('div', { className: 'barra-acoes' },
            h('button', { type: 'button', className: 'btn btn-secondary', disabled: !!ocupado, onClick: previsualizar }, 'Pré-visualizar'),
            h('button', { type: 'button', className: 'btn btn-secondary perigo', disabled: !!ocupado || sujo, title: sujo ? 'Salve ou desfaça as edições desta página primeiro' : undefined, onClick: descartar }, ocupado === 'descartar' ? 'Descartando…' : 'Descartar alterações'),
            h('button', { type: 'button', className: 'btn btn-primary destaque', disabled: !!ocupado || sujo, title: sujo ? 'Salve o rascunho antes de publicar' : undefined, onClick: publicar }, ocupado === 'publicar' ? 'Publicando…' : 'Publicar alterações')))),

      h('div', { className: 'mensagens', 'aria-live': 'polite' },
        mensagem && h('div', { className: 'alerta ' + mensagem.tipo },
          h('span', null, mensagem.texto),
          h('button', { type: 'button', className: 'btn btn-ghost', onClick: () => setMensagem(null), 'aria-label': 'Fechar mensagem' }, '×'))),

      h('main', { className: 'conteudo' },
        erroCarga ? h('div', { className: 'alerta erro' }, h('span', null, erroCarga), h('button', { type: 'button', className: 'btn btn-secondary', onClick: carregar }, 'Tentar de novo'))
          : !estado ? h('p', { className: 'carregando' }, 'Carregando conteúdo…')
            : tela === 'biografia'
              ? h(EditorBiografia, { inicial: bio.rascunho || bio.publicado, ocupado, onSujo: setSujo, salvar: salvar('biografia'), previsualizar, voltar: () => ir('inicio') })
              : h(VisaoGeral, { estado, abrir: ir })),

      previa && h(Previa, { url: previa, fechar: fecharPrevia }),
      dialogo && h(Dialogo, { ...dialogo, onCancelar: fecharDialogo }));
  }

  // ——— raiz ———
  function App() {
    const [usuario, setUsuario] = useState(undefined);
    const [aviso, setAviso] = useState('');
    useEffect(() => {
      api('sessao').then(r => setUsuario(r.usuario)).catch(() => setUsuario(null));
    }, []);
    const expirou = useCallback(() => { setAviso('Sua sessão expirou. Entre novamente.'); setUsuario(null); }, []);
    const saiu = useCallback(() => { setAviso(''); setUsuario(null); }, []);

    if (usuario === undefined) return h('p', { className: 'carregando' }, 'Carregando…');
    if (!usuario) return h(Login, { aviso, onEntrar: u => { setAviso(''); setUsuario(u); } });
    return h(Painel, { usuario, onSair: saiu, onExpirou: expirou });
  }

  ReactDOM.createRoot(document.getElementById('app')).render(h(App));
})();
