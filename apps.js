/* =========================================================
   Diário de Leituras - lógica do site
   Site estático: lê livros.json (publicado) e desenha tudo no navegador.
   Modo de edição: abrir com "?editar" na URL. Ele NÃO salva em servidor;
   apenas gera o livros.json atualizado para você substituir no repositório.
   ========================================================= */
'use strict';

/* ---------- 1. Configuração e estado ---------- */
const PARAMS = new URLSearchParams(location.search);
const EDITAR = PARAMS.has('editar');
const CHAVE_RASCUNHO = 'diario-leituras:rascunho:v1';
const CHAVE_TEMA = 'diario-leituras:tema';
const ANO_ATUAL = new Date().getFullYear();

const CONFIG_PADRAO = {
  titulo: 'Diário de Leituras',
  subtitulo: 'Registro pessoal de livros lidos, em andamento e desejados.',
  sobre: 'Escreva aqui um texto sobre você e sobre o seu hábito de leitura.',
  meta_anual: 52
};

const novoModelo = () => ({
  id: 0, exemplo: false, titulo: '', subtitulo: '', autores: [], serie: '', numero_na_serie: null,
  generos: [], tags: [], paginas: null, editora: '', ano_publicacao: null, idioma: '', formato: '',
  isbn: '', capa_url: '', capa_fonte: '', status: 'lido', ano_leitura: null,
  data_inicio: '', data_termino: '', nota: 0, notas_categorias: {}, favorito: false, releitura: false,
  progresso: 0, prioridade: '', motivo: '', resumo: '', review: '', frase_resumo: '', recomendaria: '',
  trechos: [], marcador_original: '', privado_notas: ''
});

const ROTULO_STATUS = { lido: 'Lido', lendo: 'Lendo agora', tbr: 'Quero ler (TBR)', abandonado: 'Abandonado' };
const ROTULO_PRI = { alta: 'Prioridade alta', media: 'Prioridade média', baixa: 'Prioridade baixa' };
const CATEGORIAS = { enredo: 'Enredo', personagens: 'Personagens', escrita: 'Escrita', ritmo: 'Ritmo', impacto: 'Impacto emocional' };
const AVISO_TRECHO = 'Cite apenas pequenos trechos, como apoio ao seu comentário.';

let DB = { versao: 1, config: { ...CONFIG_PADRAO }, livros: [] };
let alterado = false;
let resolvendo = false;
const CAPAS = {};

/* ---------- 2. Utilidades ---------- */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&', '<': '<', '>': '>', '"': '&quot;', "'": '&#39;' }[c]));
const norm = s => String(s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
const esperar = ms => new Promise(r => setTimeout(r, ms));
const nt = n => String(n).replace('.', ',');
const achar = id => DB.livros.find(b => b.id === Number(id));
const autoresTxt = b => b.autores.join(', ');
const limparIsbn = s => String(s || '').replace(/[^0-9Xx]/g, '');
const cmpTexto = (a, b) => String(a).localeCompare(String(b), 'pt-BR');
const novoId = () => DB.livros.reduce((m, b) => Math.max(m, b.id), 0) + 1;

function dataBR(iso) {
  if (!iso) return '';
  const [y, m, d] = iso.split('-');
  return d ? `${d}/${m}/${y}` : (m ? `${m}/${y}` : y);
}
function anoLeitura(b) {
  if (b.data_termino) return b.data_termino.slice(0, 4);
  return b.ano_leitura ? String(b.ano_leitura) : '';
}
function chaveLeitura(b) {
  const d = b.data_termino || (b.ano_leitura ? b.ano_leitura + '-00-00' : '0000-00-00');
  return d + '|' + String(b.id).padStart(6, '0');
}

/* Texto rico: parágrafos por linha em branco e spoilers com ||texto|| */
function textoRico(s) {
  if (!s || !s.trim()) return '';
  return esc(s).split(/\n{2,}/).map(p =>
    '<p>' + p.replace(/\n/g, '<br>').replace(/\|\|([\s\S]+?)\|\|/g,
      '<span class="spoiler" role="button" tabindex="0" aria-label="Spoiler escondido. Pressione para revelar.">$1</span>') + '</p>'
  ).join('');
}

function estrelas(n) {
  const v = Number(n) || 0;
  return `<span class="estrelas" role="img" aria-label="Nota ${nt(v)} de 5" style="--p:${v * 20}%"></span>`;
}

const ICONE_LIVRO = `<svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" aria-hidden="true"><path d="M4 5a2 2 0 0 1 2-2h12v16H6a2 2 0 0 0-2 2z"/><path d="M18 19v2H6"/></svg>`;
const estadoVazio = (msg, extra = '') => `<div class="vazio">${ICONE_LIVRO}<p>${msg}</p>${extra}</div>`;

/* ---------- 3. Capas ---------- */
const urlOL = isbn => `https://covers.openlibrary.org/b/isbn/${isbn}-M.jpg?default=false`;

function fonteDe(url, b) {
  if (b && b.capa_fonte) return 'Capa via ' + b.capa_fonte;
  if (/openlibrary|archive\.org/i.test(url)) return 'Capa via Open Library';
  if (/google|gstatic|googleusercontent/i.test(url)) return 'Capa via Google Books';
  return 'Capa: endereço informado manualmente';
}
function creditoCapa(b) {
  const u = (CAPAS[b.id] && CAPAS[b.id].url) || b.capa_url;
  if (!u) return b.isbn ? 'Capa: buscando fonte…' : 'Capa tipográfica gerada pelo site';
  return fonteDe(u, b);
}
function atualizarCredito(id, texto) {
  $$(`[data-credito="${id}"]`).forEach(el => { el.textContent = texto; });
}

function candidatosCapa(b) {
  const l = [];
  if (CAPAS[b.id]) l.push(CAPAS[b.id].url);
  if (b.capa_url) l.push(b.capa_url);
  const isbn = limparIsbn(b.isbn);
  if (isbn) l.push(urlOL(isbn));
  return [...new Set(l)];
}

const capaTipo = b => `<div class="capa-tipo" aria-hidden="true"><span class="t">${esc(b.titulo)}</span><span class="fio"></span><span class="a">${esc(autoresTxt(b))}</span></div>`;

function capaHTML(b, { eager = false } = {}) {
  const c = candidatosCapa(b);
  const alt = `Capa de ${b.titulo}, de ${autoresTxt(b)}`;
  const img = c.length
    ? `<img src="${esc(c[0])}" alt="${esc(alt)}" ${eager ? '' : 'loading="lazy"'} decoding="async" referrerpolicy="no-referrer" data-id="${b.id}" data-i="0">`
    : '';
  return `<div class="capa"${img ? '' : ` role="img" aria-label="${esc(alt)}"`}>${capaTipo(b)}${img}</div>`;
}

document.addEventListener('load', e => {
  const img = e.target;
  if (!(img instanceof HTMLImageElement) || !img.dataset.id) return;
  const b = achar(img.dataset.id);
  if (!b || img.naturalWidth < 2) return;
  img.classList.add('ok');
  const url = img.currentSrc || img.src;
  CAPAS[b.id] = { url };
  atualizarCredito(b.id, fonteDe(url, b.capa_url === url ? b : null));
}, true);

document.addEventListener('error', e => {
  const img = e.target;
  if (img instanceof HTMLImageElement && img.dataset.id) falhaCapa(img);
}, true);

async function falhaCapa(img) {
  const b = achar(img.dataset.id);
  if (!b) return;
  delete CAPAS[b.id];
  const c = candidatosCapa(b);
  const i = Number(img.dataset.i) + 1;
  if (i < c.length) { img.dataset.i = i; img.src = c[i]; return; }
  const isbn = limparIsbn(b.isbn);
  if (isbn && !img.dataset.g) {
    img.dataset.g = '1';
    const url = await googleBusca('isbn:' + isbn);
    if (url) { img.src = url; return; }
  }
  const pai = img.parentElement;
  if (pai) {
    pai.setAttribute('role', 'img');
    pai.setAttribute('aria-label', img.alt);
    img.remove();
  }
  atualizarCredito(b.id, 'Capa tipográfica gerada pelo site');
}

async function googleBusca(q) {
  try {
    const r = await fetch('https://www.googleapis.com/books/v1/volumes?maxResults=3&q=' + encodeURIComponent(q));
    if (!r.ok) return null;
    const j = await r.json();
    for (const it of (j.items || [])) {
      const l = it.volumeInfo && it.volumeInfo.imageLinks;
      const u = l && (l.thumbnail || l.smallThumbnail);
      if (u) return u.replace(/^http:/, 'https:').replace('&edge=curl', '');
    }
  } catch (e) { /* sem rede: segue o fallback */ }
  return null;
}
async function openLibraryPorTitulo(titulo, autor) {
  try {
    const u = `https://openlibrary.org/search.json?limit=1&fields=cover_i&title=${encodeURIComponent(titulo)}&author=${encodeURIComponent(autor || '')}`;
    const r = await fetch(u);
    if (!r.ok) return null;
    const j = await r.json();
    const id = j.docs && j.docs[0] && j.docs[0].cover_i;
    return id ? `https://covers.openlibrary.org/b/id/${id}-M.jpg?default=false` : null;
  } catch (e) { return null; }
}
function imagemOk(url) {
  return new Promise(res => {
    const im = new Image();
    const t = setTimeout(() => res(false), 8000);
    im.onload = () => { clearTimeout(t); res(im.naturalWidth > 10); };
    im.onerror = () => { clearTimeout(t); res(false); };
    im.src = url;
  });
}

async function resolverCapa(b) {
  const isbn = limparIsbn(b.isbn);
  if (isbn) {
    const ol = urlOL(isbn);
    if (await imagemOk(ol)) return { url: ol, fonte: 'Open Library' };
    const g = await googleBusca('isbn:' + isbn);
    if (g && await imagemOk(g)) return { url: g, fonte: 'Google Books' };
  }
  const autor = b.autores[0] || '';
  const g2 = await googleBusca(`intitle:${b.titulo} inauthor:${autor}`);
  if (g2 && await imagemOk(g2)) return { url: g2, fonte: 'Google Books' };
  const ol2 = await openLibraryPorTitulo(b.titulo, autor);
  if (ol2 && await imagemOk(ol2)) return { url: ol2, fonte: 'Open Library' };
  return null;
}

/* ---------- 4. Carregamento dos dados ---------- */
function normalizar(b) {
  const l = { ...novoModelo(), ...b };
  l.id = Number(l.id);
  const lista = v => Array.isArray(v) ? v.filter(Boolean) : String(v || '').split(';').map(s => s.trim()).filter(Boolean);
  l.autores = lista(l.autores);
  l.generos = lista(l.generos);
  l.tags = lista(l.tags);
  l.trechos = Array.isArray(l.trechos) ? l.trechos : [];
  l.notas_categorias = { ...(b.notas_categorias || {}) };
  l.nota = Number(l.nota) || 0;
  l.progresso = Number(l.progresso) || 0;
  return l;
}

async function carregar() {
  let dados = null;
  try {
    const r = await fetch('livros.json', { cache: 'no-cache' });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    dados = await r.json();
  } catch (e) { console.error('Falha ao ler livros.json:', e); }

  if (EDITAR) {
    let rasc = null;
    try { rasc = localStorage.getItem(CHAVE_RASCUNHO); } catch (e) {}
    if (rasc) { try { dados = JSON.parse(rasc); } catch (e) {} }
  }
  if (!dados) {
    if (!EDITAR) {
      $('#conteudo').innerHTML = estadoVazio('Não foi possível carregar a biblioteca (livros.json). Confira se o arquivo está na raiz do repositório, com esse nome exato, e se o JSON é válido.');
      return false;
    }
    dados = { versao: 1, config: {}, livros: [] };
  }
  DB.versao = dados.versao || 1;
  DB.config = { ...CONFIG_PADRAO, ...(dados.config || {}) };
  DB.livros = (dados.livros || []).map(normalizar);
  if (!EDITAR) DB.livros.forEach(l => { l.privado_notas = ''; });
  return true;
}

/* ---------- 5. Componentes de listagem ---------- */
function cartao(b, { sub = '' } = {}) {
  const selos =
    (b.favorito ? '<span class="selo">Favorito</span>' : '') +
    (b.status === 'abandonado' ? '<span class="selo selo-cinza">Abandonado</span>' : '') +
    (b.exemplo ? '<span class="selo selo-exemplo">Exemplo</span>' : '');
  const nota = b.nota ? estrelas(b.nota) : '';
  return `<div class="item">
    <a class="item-link" href="#/livro/${b.id}">
      <div class="capa-wrap">${capaHTML(b)}${selos}</div>
      <div class="leg"><span class="leg-t">${esc(b.titulo)}</span><span class="leg-a">${esc(autoresTxt(b))}</span>${nota}${sub}</div>
    </a>
    ${EDITAR ? `<button type="button" class="btn-mini" data-editar="${b.id}">Editar</button>` : ''}
  </div>`;
}
const grade = lista => `<div class="estante"><div class="grade">${lista.map(b => cartao(b)).join('')}</div></div>`;
const fileira = (lista, rotulo) => `<div class="fileira" tabindex="0" role="region" aria-label="${esc(rotulo)}">${lista.map(b => cartao(b)).join('')}</div>`;

/* ---------- 6. Páginas ---------- */
const PAGINAS = {};
const LIGAR = {};

function graficoMeses(lidos) {
  const m = Array(12).fill(0);
  lidos.forEach(b => { if (b.data_termino && b.data_termino.startsWith(String(ANO_ATUAL))) m[Number(b.data_termino.slice(5, 7)) - 1]++; });
  const max = Math.max(...m);
  if (!max) return `<p class="sem-nota">Preencha as datas de término para ver os livros por mês em ${ANO_ATUAL}.</p>`;
  const rot = ['J', 'F', 'M', 'A', 'M', 'J', 'J', 'A', 'S', 'O', 'N', 'D'];
  const barras = m.map((v, i) => {
    const h = Math.round(v / max * 90), x = 12 + i * 28;
    return `<rect class="b" x="${x}" y="${115 - h}" width="18" height="${h}" rx="2"/>` +
      (v ? `<text class="valor" x="${x + 9}" y="${111 - h}" text-anchor="middle">${v}</text>` : '') +
      `<text x="${x + 9}" y="130" text-anchor="middle">${rot[i]}</text>`;
  }).join('');
  return `<svg viewBox="0 0 360 140" role="img" aria-label="Livros lidos por mês em ${ANO_ATUAL}: ${m.join(', ')}"><line x1="8" y1="116" x2="352" y2="116" stroke="#B8C0CC"/>${barras}</svg>`;
}
function graficoGeneros(lidos) {
  const cont = {};
  lidos.forEach(b => b.generos.forEach(g => { cont[g] = (cont[g] || 0) + 1; }));
  const top = Object.entries(cont).sort((a, b) => b[1] - a[1]).slice(0, 8);
  if (!top.length) return '<p class="sem-nota">Preencha os gêneros dos livros para ver este gráfico.</p>';
  const max = top[0][1];
  const linhas = top.map(([g, v], i) => {
    const y = 8 + i * 22, w = Math.round(v / max * 170);
    return `<text x="0" y="${y + 11}">${esc(g.length > 18 ? g.slice(0, 17) + '…' : g)}</text><rect class="b2" x="110" y="${y}" width="${w}" height="14" rx="2"/><text class="valor" x="${116 + w}" y="${y + 11}">${v}</text>`;
  }).join('');
  return `<svg viewBox="0 0 360 ${top.length * 22 + 12}" role="img" aria-label="Livros por gênero">${linhas}</svg>`;
}

PAGINAS.inicio = () => {
  const c = DB.config;
  const lidos = DB.livros.filter(b => b.status === 'lido');
  const lendo = DB.livros.filter(b => b.status === 'lendo');
  const ult = [...lidos].sort((a, b) => chaveLeitura(b).localeCompare(chaveLeitura(a))).slice(0, 12);
  const favs = lidos.filter(b => b.favorito).sort((a, b) => chaveLeitura(b).localeCompare(chaveLeitura(a)));

  const noAno = lidos.filter(b => anoLeitura(b) === String(ANO_ATUAL)).length;
  const meta = Number(c.meta_anual) || 0;
  const pct = meta ? Math.min(100, Math.round(noAno / meta * 100)) : 0;
  const pags = lidos.reduce((s, b) => s + (b.paginas || 0), 0);
  const comPag = lidos.filter(b => b.paginas).length;
  const notas = lidos.filter(b => b.nota > 0);
  const media = notas.length ? notas.reduce((s, b) => s + b.nota, 0) / notas.length : 0;
  const tbr = DB.livros.filter(b => b.status === 'tbr').length;

  const faixaLendo = lendo.length ? lendo.map(b => `
    <article class="lendo">
      <a href="#/livro/${b.id}" aria-label="Abrir ${esc(b.titulo)}">${capaHTML(b, { eager: true })}</a>
      <div>
        <p class="sobretitulo">Lendo agora</p>
        <h2><a href="#/livro/${b.id}">${esc(b.titulo)}</a></h2>
        <p class="autor">${esc(autoresTxt(b))}</p>
        <div class="barra" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${b.progresso}" aria-label="Progresso da leitura"><i style="width:${b.progresso}%"></i></div>
        <p>${b.progresso}% lido${b.data_inicio ? ' · início em ' + dataBR(b.data_inicio) : ''}</p>
      </div>
    </article>`).join('')
    : '<div class="lendo-vazio">Nenhuma leitura em andamento no momento.</div>';

  return `
    <section class="hero"><h1>${esc(c.titulo)}</h1><p>${esc(c.subtitulo)}</p></section>
    <section class="secao" aria-label="Lendo agora">${faixaLendo}</section>
    <section class="secao"><h2>Últimas leituras <a href="#/estante">Ver toda a estante</a></h2>
      ${ult.length ? fileira(ult, 'Últimas leituras') : estadoVazio('Nenhum livro lido catalogado ainda.')}</section>
    <section class="secao"><h2>Favoritos</h2>
      ${favs.length ? fileira(favs, 'Favoritos') : estadoVazio('Nenhum favorito marcado ainda.')}</section>
    <section class="secao"><h2>Em números</h2>
      <dl class="stats">
        <div><dt>Lidos no total</dt><dd>${lidos.length}</dd></div>
        <div><dt>Lidos em ${ANO_ATUAL}</dt><dd>${noAno}</dd></div>
        <div><dt>Meta anual</dt><dd>${noAno}/${meta || '—'}</dd>${meta ? `<div class="barra" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct}" aria-label="Progresso da meta anual"><i style="width:${pct}%"></i></div>` : ''}</div>
        <div><dt>Páginas lidas</dt><dd>${pags ? pags.toLocaleString('pt-BR') : '—'}${pags && comPag < lidos.length ? `<small>${comPag} de ${lidos.length} livros com páginas informadas</small>` : ''}</dd></div>
        <div><dt>Nota média</dt><dd>${media ? nt(media.toFixed(2)) : '—'}</dd></div>
        <div><dt>Tamanho da TBR</dt><dd>${tbr}</dd></div>
      </dl>
      <div class="graficos">
        <div class="grafico"><h3>Livros por mês (${ANO_ATUAL})</h3>${graficoMeses(lidos)}</div>
        <div class="grafico"><h3>Livros por gênero</h3>${graficoGeneros(lidos)}</div>
      </div>
    </section>`;
};

/* ----- Estante ----- */
const F = { q: '', ano: '', genero: '', nota: '', autor: '', serie: '', formato: '', idioma: '', fav: false, ord: 'data-desc', vista: 'grade' };
const ORDENS = {
  'data-desc': (a, b) => chaveLeitura(b).localeCompare(chaveLeitura(a)),
  'data-asc': (a, b) => chaveLeitura(a).localeCompare(chaveLeitura(b)),
  'nota-desc': (a, b) => b.nota - a.nota || cmpTexto(a.titulo, b.titulo),
  'titulo': (a, b) => cmpTexto(a.titulo, b.titulo),
  'autor': (a, b) => cmpTexto(autoresTxt(a), autoresTxt(b)) || cmpTexto(a.titulo, b.titulo),
  'paginas-desc': (a, b) => (b.paginas || 0) - (a.paginas || 0)
};
const baseEstante = () => DB.livros.filter(b => b.status === 'lido' || b.status === 'abandonado');

function aplicarFiltros(lista) {
  const termos = norm(F.q.trim()).split(/\s+/).filter(Boolean);
  return lista.filter(b => {
    if (termos.length) {
      const alvo = norm([b.titulo, b.subtitulo, autoresTxt(b), b.serie, b.review, b.resumo, b.frase_resumo, b.tags.join(' ')].join(' '));
      if (!termos.every(t => alvo.includes(t))) return false;
    }
    if (F.ano && anoLeitura(b) !== F.ano) return false;
    if (F.genero && !b.generos.includes(F.genero)) return false;
    if (F.nota && b.nota < Number(F.nota)) return false;
    if (F.autor && !b.autores.includes(F.autor)) return false;
    if (F.serie && b.serie !== F.serie) return false;
    if (F.formato && b.formato !== F.formato) return false;
    if (F.idioma && b.idioma !== F.idioma) return false;
    if (F.fav && !b.favorito) return false;
    return true;
  });
}

function seletor(nome, rotulo, valores, atual, todos = 'Todos') {
  if (!valores.length) return '';
  return `<label class="campo"><span>${rotulo}</span><select name="${nome}"><option value="">${todos}</option>${
    valores.map(v => `<option value="${esc(v)}" ${String(atual) === String(v) ? 'selected' : ''}>${esc(v)}</option>`).join('')}</select></label>`;
}

PAGINAS.estante = () => {
  const base = baseEstante();
  const un = fn => [...new Set(base.flatMap(fn).filter(Boolean))].sort(cmpTexto);
  const anos = [...new Set(base.map(anoLeitura).filter(Boolean))].sort().reverse();
  const ord = [['data-desc', 'Data de leitura (recentes)'], ['data-asc', 'Data de leitura (antigos)'], ['nota-desc', 'Nota (maior)'], ['titulo', 'Título (A-Z)'], ['autor', 'Autor (A-Z)'], ['paginas-desc', 'Páginas (maior)']];
  const notas = ['5', '4.5', '4', '3.5', '3'];
  return `
    <div class="pagina-topo"><h1>Estante</h1><p>Livros lidos, em ordem e com filtros combináveis.</p></div>
    <form class="filtros" id="filtros" role="search" aria-label="Buscar e filtrar livros">
      <label class="campo"><span>Buscar por título, autor, série ou palavras do review</span>
        <input type="search" name="q" value="${esc(F.q)}" placeholder="Digite para buscar…" autocomplete="off"></label>
      <div class="filtros-grade">
        ${seletor('ano', 'Ano de leitura', anos, F.ano)}
        ${seletor('genero', 'Gênero', un(b => b.generos), F.genero)}
        <label class="campo"><span>Nota mínima</span><select name="nota"><option value="">Qualquer</option>${notas.map(n => `<option value="${n}" ${F.nota === n ? 'selected' : ''}>${nt(n)} ou mais</option>`).join('')}</select></label>
        ${seletor('autor', 'Autor', un(b => b.autores), F.autor)}
        ${seletor('serie', 'Série', un(b => [b.serie]), F.serie)}
        ${seletor('formato', 'Formato', un(b => [b.formato]), F.formato)}
        ${seletor('idioma', 'Idioma', un(b => [b.idioma]), F.idioma)}
        <label class="campo"><span>Ordenar por</span><select name="ord">${ord.map(([v, t]) => `<option value="${v}" ${F.ord === v ? 'selected' : ''}>${t}</option>`).join('')}</select></label>
      </div>
      <div class="filtros-acoes">
        <label class="linha-check"><input type="checkbox" name="fav" ${F.fav ? 'checked' : ''}> Somente favoritos</label>
        <button type="button" class="btn btn-sec" data-limpar>Limpar filtros</button>
        <span class="vista" role="group" aria-label="Modo de exibição">
          <button type="button" data-vista="grade" aria-pressed="${F.vista === 'grade'}">Capas</button>
          <button type="button" data-vista="lista" aria-pressed="${F.vista === 'lista'}">Lista</button>
        </span>
      </div>
    </form>
    <div id="resultado" aria-live="polite"></div>`;
};

function pintarEstante() {
  const alvo = $('#resultado');
  if (!alvo) return;
  const base = baseEstante();
  const lista = aplicarFiltros(base).sort(ORDENS[F.ord] || ORDENS['data-desc']);
  let html = `<p class="contagem">${lista.length} ${lista.length === 1 ? 'livro' : 'livros'}${lista.length !== base.length ? ' (de ' + base.length + ')' : ''}</p>`;
  if (!base.length) html += estadoVazio('A estante ainda está vazia.');
  else if (!lista.length) html += estadoVazio('Nenhum livro encontrado com esses filtros.', '<button type="button" class="btn" data-limpar>Limpar filtros</button>');
  else if (F.vista === 'lista') {
    html += `<div class="lista">${lista.map(b => `
      <a class="linha" href="#/livro/${b.id}">
        ${capaHTML(b)}
        <div><strong>${esc(b.titulo)}</strong>${b.favorito ? ' <span class="chip chip-ativo">Favorito</span>' : ''}<br><span class="leg-a">${esc(autoresTxt(b))}${b.serie ? ' · ' + esc(b.serie) + (b.numero_na_serie ? ' #' + b.numero_na_serie : '') : ''}</span></div>
        <div class="meta-dir">${b.nota ? estrelas(b.nota) : ''}<br>${dataBR(b.data_termino) || anoLeitura(b)}${b.paginas ? ' · ' + b.paginas + ' p.' : ''}</div>
      </a>`).join('')}</div>`;
  } else html += grade(lista);
  alvo.innerHTML = html;
}

LIGAR.estante = () => {
  const f = $('#filtros');
  const ler = () => {
    const d = new FormData(f);
    ['q', 'ano', 'genero', 'nota', 'autor', 'serie', 'formato', 'idioma', 'ord'].forEach(k => { if (d.has(k)) F[k] = d.get(k); });
    F.fav = f.elements.fav.checked;
    pintarEstante();
  };
  f.addEventListener('input', ler);
  f.addEventListener('change', ler);
  f.addEventListener('submit', e => e.preventDefault());
  pintarEstante();
};

/* ----- TBR ----- */
const T = { pri: '' };
const ORDEM_PRI = { alta: 1, media: 2, baixa: 3, '': 4 };
const listaTbr = () => DB.livros.filter(b => b.status === 'tbr' && (!T.pri || b.prioridade === T.pri))
  .sort((a, b) => ORDEM_PRI[a.prioridade] - ORDEM_PRI[b.prioridade] || cmpTexto(a.titulo, b.titulo));

PAGINAS.tbr = () => {
  const todos = DB.livros.filter(b => b.status === 'tbr');
  const lista = listaTbr();
  const sub = b => (b.prioridade ? `<span class="pri pri-${b.prioridade}">${ROTULO_PRI[b.prioridade]}</span>` : '') + (b.motivo ? `<span class="motivo">${esc(b.motivo)}</span>` : '');
  return `
    <div class="pagina-topo"><h1>TBR</h1><p>Lista de livros que quero ler (${todos.length}).</p></div>
    <div class="filtros-acoes" style="margin-bottom:1.2rem">
      <label class="campo" style="min-width:200px"><span>Prioridade</span><select id="f-pri">
        <option value="">Todas</option>
        ${['alta', 'media', 'baixa'].map(p => `<option value="${p}" ${T.pri === p ? 'selected' : ''}>${ROTULO_PRI[p]}</option>`).join('')}</select></label>
      <button type="button" class="btn" id="sortear" ${lista.length ? '' : 'disabled'}>Sortear um livro da TBR</button>
    </div>
    ${lista.length ? `<div class="estante"><div class="grade">${lista.map(b => cartao(b, { sub: sub(b) })).join('')}</div></div>`
      : estadoVazio(todos.length ? 'Nenhum livro com essa prioridade.' : 'Sua lista de desejos está vazia.')}`;
};
function sortear() {
  const l = listaTbr();
  if (!l.length) return;
  const b = l[Math.floor(Math.random() * l.length)];
  abrirModal(`<div class="sorteio">
    <div>${capaHTML(b, { eager: true })}</div>
    <div><p style="color:var(--sec);text-transform:uppercase;letter-spacing:.15em;font-size:.75rem">O sorteio escolheu</p>
      <h2>${esc(b.titulo)}</h2><p>${esc(autoresTxt(b))}</p>
      ${b.motivo ? `<p class="motivo">${esc(b.motivo)}</p>` : ''}
      <div class="acoes-ficha"><a class="btn" href="#/livro/${b.id}" data-fechar>Ver ficha</a>
      <button type="button" class="btn btn-sec" data-sortear-outro>Sortear outro</button></div></div></div>`);
}
LIGAR.tbr = () => {
  $('#f-pri').addEventListener('change', e => { T.pri = e.target.value; render({ foco: false }); });
  $('#sortear').addEventListener('click', sortear);
};

/* ----- Reviews ----- */
PAGINAS.reviews = () => {
  const l = DB.livros.filter(b => b.review.trim()).sort((a, b) => chaveLeitura(b).localeCompare(chaveLeitura(a)));
  return `<div class="pagina-topo"><h1>Reviews</h1><p>Minhas impressões, com calma. Trechos marcados como spoiler ficam borrados até o clique.</p></div>
    ${l.length ? l.map(b => `
      <article class="review">
        <a class="review-capa" href="#/livro/${b.id}" aria-label="Abrir ${esc(b.titulo)}">${capaHTML(b)}</a>
        <div>
          <h2><a href="#/livro/${b.id}">${esc(b.titulo)}</a></h2>
          <p class="meta"><span>${esc(autoresTxt(b))}</span>${b.nota ? estrelas(b.nota) : ''}${b.data_termino ? `<span>Lido em ${dataBR(b.data_termino)}</span>` : ''}</p>
          ${b.frase_resumo ? `<p class="frase">${esc(b.frase_resumo)}</p>` : ''}
          <div class="texto">${textoRico(b.review)}</div>
        </div>
      </article>`).join('') : estadoVazio('Ainda não há reviews publicados.')}`;
};

/* ----- Séries e Autores ----- */
PAGINAS.series = () => {
  const grupos = {};
  DB.livros.filter(b => b.serie).forEach(b => { (grupos[b.serie] = grupos[b.serie] || []).push(b); });
  const nomes = Object.keys(grupos).sort(cmpTexto);
  const blocoSerie = nome => {
    const l = grupos[nome].sort((a, b) => (a.numero_na_serie ?? 999) - (b.numero_na_serie ?? 999));
    const nums = l.map(b => b.numero_na_serie).filter(n => n != null);
    const max = nums.length ? Math.max(...nums) : 0;
    const itens = [];
    for (let n = 1; n <= max; n++) {
      const b = l.find(x => x.numero_na_serie === n);
      itens.push(b ? cartao(b, { sub: `<span class="motivo">Volume ${n} · ${ROTULO_STATUS[b.status]}</span>` })
        : `<div class="item"><div class="faltante"><strong>Volume ${n}</strong>Faltante: ainda não catalogado</div></div>`);
    }
    l.filter(b => b.numero_na_serie == null).forEach(b => itens.push(cartao(b)));
    const lidos = l.filter(b => b.status === 'lido').length;
    return `<div class="serie"><h3>${esc(nome)} <small>${lidos} de ${l.length} lidos</small></h3><div class="estante"><div class="grade">${itens.join('')}</div></div></div>`;
  };
  const autores = {};
  DB.livros.forEach(b => b.autores.forEach(a => { autores[a] = (autores[a] || 0) + 1; }));
  const nomesAut = Object.keys(autores).sort(cmpTexto);
  return `<div class="pagina-topo"><h1>Séries e Autores</h1></div>
    <section class="secao"><h2>Séries</h2>${nomes.length ? nomes.map(blocoSerie).join('') : estadoVazio('Nenhuma série cadastrada. Preencha "série" e "número na série" na ficha do livro.')}</section>
    <section class="secao"><h2>Autores</h2>${nomesAut.length ? `<div class="chips">${nomesAut.map(a => `<a class="chip" href="#/autor/${encodeURIComponent(a)}">${esc(a)} (${autores[a]})</a>`).join('')}</div>` : estadoVazio('Nenhum autor cadastrado.')}</section>`;
};
PAGINAS.autor = nome => {
  const l = DB.livros.filter(b => b.autores.includes(nome)).sort(ORDENS['data-desc']);
  return `<a class="voltar" href="#/series">← Séries e Autores</a>
    <div class="pagina-topo"><h1>${esc(nome)}</h1><p>${l.length} ${l.length === 1 ? 'livro' : 'livros'} no diário.</p></div>
    ${l.length ? grade(l) : estadoVazio('Nenhum livro deste autor.')}`;
};

/* ----- Sobre ----- */
PAGINAS.sobre = () => `<div class="pagina-topo"><h1>Sobre</h1></div><div class="texto">${textoRico(DB.config.sobre) || '<p>Em breve.</p>'}</div>`;

/* ----- Ficha do livro ----- */
PAGINAS.livro = id => {
  const b = achar(id);
  if (!b) return `<a class="voltar" href="#/estante">← Estante</a>${estadoVazio('Livro não encontrado.')}`;
  const dados = [['Páginas', b.paginas], ['Editora', b.editora], ['Ano de publicação', b.ano_publicacao], ['Idioma', b.idioma], ['Formato', b.formato], ['ISBN', b.isbn],
    ['Início da leitura', dataBR(b.data_inicio)], ['Término da leitura', dataBR(b.data_termino)], ['Releitura', b.releitura ? 'Sim' : '']].filter(([, v]) => v);
  const cats = Object.entries(CATEGORIAS).filter(([k]) => Number(b.notas_categorias[k]) > 0);
  const trechos = b.trechos.filter(t => t.texto);
  return `
    <a class="voltar" href="#/estante">← Estante</a>
    <article class="ficha">
      <div class="ficha-capa">
        <button type="button" class="capa-btn" data-ampliar="${b.id}" aria-label="Ampliar a capa de ${esc(b.titulo)}">${capaHTML(b, { eager: true })}</button>
        <p class="credito" data-credito="${b.id}">${esc(creditoCapa(b))}</p>
      </div>
      <div>
        <h1>${esc(b.titulo)}</h1>
        ${b.subtitulo ? `<p class="subtitulo">${esc(b.subtitulo)}</p>` : ''}
        <p class="autores">${b.autores.map(a => `<a href="#/autor/${encodeURIComponent(a)}">${esc(a)}</a>`).join(', ')}</p>
        ${b.serie ? `<p>Série: <a href="#/series" style="color:var(--acento-texto)">${esc(b.serie)}</a>${b.numero_na_serie ? ', volume ' + b.numero_na_serie : ''}</p>` : ''}
        <div class="chips">
          <span class="chip chip-ativo">${ROTULO_STATUS[b.status] || b.status}</span>
          ${b.favorito ? '<span class="chip chip-ativo">Favorito</span>' : ''}
          ${b.releitura ? '<span class="chip">Releitura</span>' : ''}
          ${b.exemplo ? '<span class="chip">Exemplo</span>' : ''}
          ${b.status === 'tbr' && b.prioridade ? `<span class="chip">${ROTULO_PRI[b.prioridade]}</span>` : ''}
        </div>
        ${b.nota ? `<p>${estrelas(b.nota)} <span class="leg-a">${nt(b.nota)} de 5</span></p>` : (b.status === 'lido' ? '<p class="sem-nota">Sem nota</p>' : '')}
        ${cats.length ? `<div class="cats">${cats.map(([k, r]) => `<div><span>${r}</span>${estrelas(b.notas_categorias[k])}</div>`).join('')}</div>` : ''}
        ${b.status === 'lendo' ? `<div class="barra" style="background:var(--linha)" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${b.progresso}" aria-label="Progresso"><i style="width:${b.progresso}%;background:var(--esmeralda)"></i></div><p class="leg-a">${b.progresso}% lido</p>` : ''}
        ${b.status === 'tbr' && b.motivo ? `<p><strong>Por que quero ler:</strong> ${esc(b.motivo)}</p>` : ''}
        ${(b.generos.length || b.tags.length) ? `<div class="chips">${b.generos.map(g => `<span class="chip">${esc(g)}</span>`).join('')}${b.tags.map(g => `<span class="chip">#${esc(g)}</span>`).join('')}</div>` : ''}
        ${EDITAR ? `<div class="acoes-ficha"><button type="button" class="btn" data-editar="${b.id}">Editar livro</button><button type="button" class="btn btn-perigo" data-excluir="${b.id}">Excluir</button></div>` : ''}
        ${dados.length ? `<dl class="dados">${dados.map(([k, v]) => `<div><dt>${k}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl>` : ''}
        ${b.frase_resumo ? `<p class="frase">${esc(b.frase_resumo)}</p>` : ''}
        ${b.resumo ? `<h3>Resumo</h3><div class="texto">${textoRico(b.resumo)}</div>` : ''}
        <h3>Review</h3>
        ${b.review.trim() ? `<div class="texto">${textoRico(b.review)}</div>` : '<p class="sem-nota">Review ainda não escrito.</p>'}
        ${b.recomendaria ? `<h3>Recomendaria para quem?</h3><div class="texto">${textoRico(b.recomendaria)}</div>` : ''}
        ${trechos.length ? `<h3>Trechos citados</h3>${trechos.map(t => `<blockquote class="trecho"><p>“${esc(t.texto)}”</p><footer>${esc(t.autor)}, <cite>${esc(t.titulo)}</cite>, p. ${esc(t.pagina)}</footer></blockquote>`).join('')}` : ''}
        ${EDITAR && b.privado_notas ? `<h3>Notas privadas</h3><div class="notas-privadas texto"><p class="leg-a">Visível só no modo de edição; não vai para o livros.json.</p>${textoRico(b.privado_notas)}</div>` : ''}
      </div>
    </article>`;
};

/* ---------- 7. Roteador ---------- */
function rotaAtual() {
  const p = location.hash.replace(/^#\/?/, '').split('/').map(decodeURIComponent);
  return { nome: p[0] || 'inicio', arg: p[1] };
}
function render({ foco = true } = {}) {
  let { nome, arg } = rotaAtual();
  if (!PAGINAS[nome]) nome = 'inicio';
  const main = $('#conteudo');
  main.innerHTML = PAGINAS[nome](arg);
  main.classList.remove('fade'); void main.offsetWidth; main.classList.add('fade');
  if (LIGAR[nome]) LIGAR[nome](arg);
  const ativo = nome === 'livro' ? 'estante' : nome === 'autor' ? 'series' : nome;
  $$('#menu a').forEach(a => {
    if (a.dataset.rota === ativo) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  });
  const titulo = DB.config.titulo;
  const b = nome === 'livro' ? achar(arg) : null;
  document.title = b ? `${b.titulo} · ${titulo}` : titulo;
  $('#marca-texto').textContent = titulo;
  if (foco) { window.scrollTo(0, 0); main.focus({ preventScroll: true }); }
  atualizarPainel();
}
window.addEventListener('hashchange', () => render());

/* ---------- 8. Diálogos, lightbox, tema e eventos globais ---------- */
function abrirModal(html, { largo = false } = {}) {
  const m = $('#modal');
  m.className = largo ? 'largo' : '';
  $('#modal-corpo').innerHTML = html;
  if (!m.open) m.showModal();
}
function fecharModal() { const m = $('#modal'); if (m.open) m.close(); }

const urlGrande = u => /openlibrary/i.test(u) ? u.replace('-M.jpg', '-L.jpg') : u.replace('zoom=1', 'zoom=0');
function ampliar(id) {
  const b = achar(id);
  if (!b) return;
  const u = (CAPAS[b.id] && CAPAS[b.id].url) || b.capa_url;
  const alt = `Capa de ${b.titulo}, de ${autoresTxt(b)}`;
  const corpo = u
    ? `<img src="${esc(urlGrande(u))}" alt="${esc(alt)}" onerror="if(this.dataset.f!=='1'){this.dataset.f='1';this.src='${esc(u)}'}">`
    : `<div class="capa" role="img" aria-label="${esc(alt)}">${capaTipo(b)}</div>`;
  $('#lightbox-corpo').innerHTML = `${corpo}<figcaption><strong>${esc(b.titulo)}</strong><br>${esc(creditoCapa(b))}</figcaption>`;
  const l = $('#lightbox');
  if (!l.open) l.showModal();
}

function aplicarTema(t) {
  document.documentElement.setAttribute('data-theme', t);
  const btn = $('#btn-tema');
  btn.textContent = t === 'dark' ? 'Modo claro' : 'Modo escuro';
  btn.setAttribute('aria-pressed', String(t === 'dark'));
}

document.addEventListener('click', e => {
  const q = sel => e.target.closest(sel);
  let el;
  if ((el = q('[data-pular]'))) { e.preventDefault(); $('#conteudo').focus(); return; }
  if ((el = q('[data-ampliar]'))) { ampliar(el.dataset.ampliar); return; }
  if ((el = q('[data-fechar]'))) { const d = el.closest('dialog'); if (d) d.close(); return; }
  if ((el = q('.spoiler'))) { revelar(el); return; }
  if ((el = q('[data-limpar]'))) { Object.assign(F, { q: '', ano: '', genero: '', nota: '', autor: '', serie: '', formato: '', idioma: '', fav: false }); render({ foco: false }); return; }
  if ((el = q('[data-vista]'))) { F.vista = el.dataset.vista; $$('[data-vista]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.vista === F.vista))); pintarEstante(); return; }
  if ((el = q('[data-sortear-outro]'))) { sortear(); return; }
  if (EDITAR) {
    if ((el = q('[data-editar]'))) { abrirFormLivro(achar(el.dataset.editar)); return; }
    if ((el = q('[data-excluir]'))) { excluirLivro(Number(el.dataset.excluir)); return; }
  }
});
document.addEventListener('keydown', e => {
  if ((e.key === 'Enter' || e.key === ' ') && e.target.classList && e.target.classList.contains('spoiler')) { e.preventDefault(); revelar(e.target); }
});
function revelar(el) {
  el.classList.add('revelado');
  el.removeAttribute('aria-label');
  el.removeAttribute('role');
}
['lightbox', 'modal'].forEach(id => {
  $('#' + id).addEventListener('click', e => {
    if (e.target.id === id && !e.target.classList.contains('largo')) e.target.close();
  });
});
$('#btn-tema').addEventListener('click', () => {
  const novo = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
  try { localStorage.setItem(CHAVE_TEMA, novo); } catch (e) {}
  aplicarTema(novo);
});

/* ---------- 9. MODO DE EDIÇÃO (?editar): gera o livros.json, não salva em servidor ---------- */
function persistir() {
  alterado = true;
  try { localStorage.setItem(CHAVE_RASCUNHO, JSON.stringify(DB)); } catch (e) {}
  atualizarPainel();
}
function gerarJSON({ completo = false } = {}) {
  const saida = {
    versao: DB.versao,
    config: DB.config,
    livros: DB.livros.map(l => { const c = { ...l }; if (!completo) c.privado_notas = ''; return c; })
  };
  return JSON.stringify(saida, null, 2);
}
function baixar(nome, conteudo) {
  const url = URL.createObjectURL(new Blob([conteudo], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url; a.download = nome;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
async function copiarJSON() {
  const txt = gerarJSON();
  try { await navigator.clipboard.writeText(txt); }
  catch (e) {
    const ta = document.createElement('textarea');
    ta.value = txt; document.body.appendChild(ta); ta.select();
    document.execCommand('copy'); ta.remove();
  }
  alterado = false;
  $('#prog').textContent = 'JSON copiado. Cole no livros.json do repositório.';
}

function montarPainel() {
  const faixa = document.createElement('div');
  faixa.className = 'faixa-edicao'; faixa.setAttribute('role', 'status');
  faixa.textContent = 'Modo de edição: este painel é apenas um gerador de JSON. Nada é salvo em servidor; baixe o livros.json e substitua o arquivo no repositório.';
  document.body.prepend(faixa);

  const btn = document.createElement('button');
  btn.type = 'button'; btn.className = 'btn btn-painel'; btn.id = 'btn-painel';
  btn.setAttribute('aria-expanded', 'false'); btn.setAttribute('aria-controls', 'painel');
  btn.textContent = 'Painel de edição';

  const p = document.createElement('aside');
  p.id = 'painel'; p.className = 'painel'; p.hidden = true; p.setAttribute('aria-label', 'Painel de edição');
  p.innerHTML = `
    <h2 style="font-size:1.4rem">Edição local</h2>
    <p id="estado-edicao"></p>
    <button type="button" class="btn" id="p-novo">Novo livro</button>
    <button type="button" class="btn btn-sec" id="p-capas">Resolver capas faltantes</button>
    <button type="button" class="btn btn-sec" id="p-config">Configurações do site</button>
    <button type="button" class="btn" id="p-copiar">Copiar JSON</button>
    <button type="button" class="btn" id="p-baixar">Baixar livros.json</button>
    <button type="button" class="btn btn-sec" id="p-backup">Baixar backup completo (com notas privadas)</button>
    <button type="button" class="btn btn-perigo" id="p-descartar">Descartar rascunho local</button>
    <p id="prog" role="status"></p>
    <p>O livros.json gerado não inclui as notas privadas. Elas ficam só neste navegador (rascunho); use o backup completo para guardá-las. Capas buscadas por título podem estar erradas: confira-as e, se preciso, informe o ISBN ou o capa_url.</p>`;
  document.body.append(p, btn);

  btn.addEventListener('click', () => {
    p.hidden = !p.hidden;
    btn.setAttribute('aria-expanded', String(!p.hidden));
  });
  $('#p-novo').addEventListener('click', () => abrirFormLivro(null));
  $('#p-config').addEventListener('click', abrirFormConfig);
  $('#p-copiar').addEventListener('click', copiarJSON);
  $('#p-baixar').addEventListener('click', () => { baixar('livros.json', gerarJSON()); alterado = false; });
  $('#p-backup').addEventListener('click', () => baixar('livros-backup-completo.json', gerarJSON({ completo: true })));
  $('#p-capas').addEventListener('click', resolverTodas);
  $('#p-descartar').addEventListener('click', () => {
    if (!confirm('Descartar o rascunho local (inclui notas privadas) e recarregar do livros.json publicado?')) return;
    try { localStorage.removeItem(CHAVE_RASCUNHO); } catch (e) {}
    alterado = false; location.reload();
  });
  window.addEventListener('beforeunload', e => { if (alterado) { e.preventDefault(); e.returnValue = ''; } });
}
function atualizarPainel() {
  const el = $('#estado-edicao');
  if (el) el.textContent = `${DB.livros.length} livros no rascunho. ${alterado ? 'Há alterações ainda não baixadas.' : 'Sem alterações pendentes.'}`;
}

async function resolverTodas() {
  if (resolvendo) return;
  const falt = DB.livros.filter(b => !b.capa_url);
  const prog = $('#prog');
  if (!falt.length) { prog.textContent = 'Todos os livros já têm capa_url.'; return; }
  resolvendo = true;
  let ok = 0;
  for (let i = 0; i < falt.length; i++) {
    prog.textContent = `Buscando capas… ${i + 1}/${falt.length} (${ok} encontradas)`;
    const r = await resolverCapa(falt[i]);
    if (r) { falt[i].capa_url = r.url; falt[i].capa_fonte = r.fonte; delete CAPAS[falt[i].id]; ok++; persistir(); }
    await esperar(450);
  }
  resolvendo = false;
  prog.textContent = `Concluído: ${ok} de ${falt.length} capas encontradas. Confira e baixe o livros.json.`;
  render({ foco: false });
}

/* ----- Formulário de livro ----- */
const inp = (rot, nome, val, tipo = 'text', attr = '') => `<label class="campo"><span>${rot}</span><input type="${tipo}" name="${nome}" value="${esc(val ?? '')}" ${attr}></label>`;
const area = (rot, nome, val, linhas = 4) => `<label class="campo largura"><span>${rot}</span><textarea name="${nome}" rows="${linhas}">${esc(val ?? '')}</textarea></label>`;
const opc = (rot, nome, val, ops) => `<label class="campo"><span>${rot}</span><select name="${nome}">${ops.map(([v, t]) => `<option value="${v}" ${String(val) === String(v) ? 'selected' : ''}>${t}</option>`).join('')}</select></label>`;
const OPCOES_NOTA = [['0', 'Sem nota'], ...[0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5].map(n => [String(n), nt(n) + ' de 5'])];

function linhaTrecho(t = {}) {
  return `<div class="trecho-edit">
    <label class="campo"><span>Trecho (máx. 300 caracteres)</span><textarea data-t="texto" rows="3">${esc(t.texto || '')}</textarea></label>
    <span class="contador"><span data-cont>${(t.texto || '').length}</span>/300</span>
    <span class="aviso" data-aviso role="alert"></span>
    <div class="form-grade">
      <label class="campo"><span>Autor (obrigatório)</span><input data-t="autor" value="${esc(t.autor || '')}"></label>
      <label class="campo"><span>Título da obra (obrigatório)</span><input data-t="titulo" value="${esc(t.titulo || '')}"></label>
      <label class="campo"><span>Página (obrigatório)</span><input data-t="pagina" value="${esc(t.pagina || '')}"></label>
    </div>
    <button type="button" class="btn-mini" data-rm-trecho>Remover trecho</button>
  </div>`;
}

function abrirFormLivro(livro) {
  const novo = !livro;
  const b = novo ? { ...novoModelo(), id: novoId(), status: 'lido', ano_leitura: ANO_ATUAL } : livro;
  const nc = b.notas_categorias || {};
  abrirModal(`
    <h2>${novo ? 'Novo livro' : 'Editar livro'}</h2>
    <form id="form-livro" novalidate>
      <fieldset><legend>Identificação</legend><div class="form-grade">
        ${inp('Título *', 'titulo', b.titulo, 'text', 'required')}
        ${inp('Subtítulo', 'subtitulo', b.subtitulo)}
        ${inp('Autor(es) * (separe por ponto e vírgula)', 'autores', b.autores.join('; '))}
        ${inp('Série', 'serie', b.serie)}
        ${inp('Número na série', 'numero_na_serie', b.numero_na_serie ?? '', 'number', 'min="0" step="1"')}
        ${inp('Gênero(s) (separe por vírgula)', 'generos', b.generos.join(', '))}
        ${inp('Tags (separe por vírgula)', 'tags', b.tags.join(', '))}
        ${inp('Páginas', 'paginas', b.paginas ?? '', 'number', 'min="1"')}
        ${inp('Editora', 'editora', b.editora)}
        ${inp('Ano de publicação', 'ano_publicacao', b.ano_publicacao ?? '', 'number')}
        ${inp('Idioma', 'idioma', b.idioma)}
        ${opc('Formato', 'formato', b.formato, [['', 'Não informado'], ['físico', 'Físico'], ['e-book', 'E-book'], ['audiobook', 'Audiobook']])}
      </div></fieldset>

      <fieldset><legend>Capa</legend><div class="form-grade">
        ${inp('ISBN', 'isbn', b.isbn)}
        ${inp('capa_url (preencha à mão ou use o botão)', 'capa_url', b.capa_url, 'url')}
        <input type="hidden" name="capa_fonte" value="${esc(b.capa_fonte)}">
        <div class="largura"><button type="button" class="btn btn-sec" id="f-resolver">Resolver capa agora</button> <span id="f-capa-msg" class="contador" role="status"></span></div>
      </div></fieldset>

      <fieldset><legend>Leitura</legend><div class="form-grade">
        ${opc('Status', 'status', b.status, [['lido', 'Lido'], ['lendo', 'Lendo'], ['tbr', 'TBR'], ['abandonado', 'Abandonado']])}
        ${inp('Ano de leitura', 'ano_leitura', b.ano_leitura ?? '', 'number')}
        ${inp('Data de início', 'data_inicio', b.data_inicio, 'date')}
        ${inp('Data de término', 'data_termino', b.data_termino, 'date')}
        ${inp('Progresso (%) se estiver lendo', 'progresso', b.progresso, 'number', 'min="0" max="100"')}
        ${opc('Prioridade (TBR)', 'prioridade', b.prioridade, [['', 'Sem prioridade'], ['alta', 'Alta'], ['media', 'Média'], ['baixa', 'Baixa']])}
        ${inp('Motivo (TBR)', 'motivo', b.motivo)}
        <label class="linha-check"><input type="checkbox" name="favorito" ${b.favorito ? 'checked' : ''}> Favorito</label>
        <label class="linha-check"><input type="checkbox" name="releitura" ${b.releitura ? 'checked' : ''}> Releitura</label>
        <label class="linha-check"><input type="checkbox" name="exemplo" ${b.exemplo ? 'checked' : ''}> Marcar como exemplo</label>
      </div></fieldset>

      <fieldset><legend>Notas</legend><div class="form-grade">
        ${opc('Nota geral', 'nota', String(b.nota || 0), OPCOES_NOTA)}
        ${Object.entries(CATEGORIAS).map(([k, r]) => opc(r + ' (opcional)', 'cat_' + k, String(nc[k] || 0), OPCOES_NOTA)).join('')}
      </div></fieldset>

      <fieldset><legend>Texto</legend><div class="form-grade">
        ${area('Frase que resume o livro', 'frase_resumo', b.frase_resumo, 2)}
        ${area('Resumo do livro', 'resumo', b.resumo, 4)}
        ${area('Review completo (use ||texto|| para marcar spoilers; linha em branco separa parágrafos)', 'review', b.review, 10)}
        ${area('Recomendaria para quem?', 'recomendaria', b.recomendaria, 2)}
      </div></fieldset>

      <fieldset><legend>Trechos citados (opcional)</legend>
        <p class="contador">${AVISO_TRECHO}</p>
        <div id="lista-trechos">${b.trechos.map(linhaTrecho).join('')}</div>
        <button type="button" class="btn btn-sec" id="f-add-trecho">Adicionar trecho</button>
      </fieldset>

      <fieldset><legend>Notas privadas</legend><div class="form-grade">
        ${area('Só aparecem neste modo de edição; não vão para o livros.json público.', 'privado_notas', b.privado_notas, 4)}
      </div></fieldset>

      <p class="aviso" id="f-erro" role="alert"></p>
      <div class="form-acoes">
        <button type="submit" class="btn">Salvar no rascunho</button>
        <button type="button" class="btn btn-sec" data-fechar>Cancelar</button>
        ${novo ? '' : `<button type="button" class="btn btn-perigo" data-excluir="${b.id}">Excluir livro</button>`}
      </div>
    </form>`, { largo: true });

  const form = $('#form-livro');

  form.addEventListener('input', e => {
    const ta = e.target;
    if (ta.dataset && ta.dataset.t === 'texto') {
      const bloco = ta.closest('.trecho-edit');
      if (ta.value.length > 300) { ta.value = ta.value.slice(0, 300); bloco.querySelector('[data-aviso]').textContent = AVISO_TRECHO; }
      else bloco.querySelector('[data-aviso]').textContent = '';
      bloco.querySelector('[data-cont]').textContent = ta.value.length;
    }
  });
  form.addEventListener('click', e => {
    if (e.target.closest('[data-rm-trecho]')) e.target.closest('.trecho-edit').remove();
  });
  $('#f-add-trecho').addEventListener('click', () => $('#lista-trechos').insertAdjacentHTML('beforeend', linhaTrecho()));

  $('#f-resolver').addEventListener('click', async () => {
    const msg = $('#f-capa-msg');
    const temp = { titulo: form.titulo.value.trim(), isbn: form.isbn.value, autores: form.autores.value.split(/[;\n]/).map(s => s.trim()).filter(Boolean) };
    if (!temp.titulo) { msg.textContent = 'Informe o título primeiro.'; return; }
    msg.textContent = 'Buscando…';
    const r = await resolverCapa(temp);
    if (r) { form.capa_url.value = r.url; form.capa_fonte.value = r.fonte; msg.textContent = `Encontrada (${r.fonte}). Confira se é a capa certa.`; }
    else msg.textContent = 'Nenhuma capa encontrada. Será usada a capa tipográfica.';
  });

  form.addEventListener('submit', e => { e.preventDefault(); salvarLivro(form, b, novo); });
}

function salvarLivro(form, original, novo) {
  const erro = $('#f-erro');
  const g = n => (form.elements[n].value || '').trim();
  const num = n => g(n) === '' ? null : Number(g(n).replace(',', '.'));
  const lista = (s, sep) => s.split(sep).map(x => x.trim()).filter(Boolean);

  const titulo = g('titulo');
  const autores = lista(g('autores'), /[;\n]/);
  if (!titulo) { erro.textContent = 'Informe o título.'; form.titulo.focus(); return; }
  if (!autores.length) { erro.textContent = 'Informe ao menos um autor.'; form.autores.focus(); return; }

  const trechos = [];
  for (const bloco of $$('.trecho-edit', form)) {
    const v = k => bloco.querySelector(`[data-t="${k}"]`).value.trim();
    if (!v('texto') && !v('autor') && !v('titulo') && !v('pagina')) continue;
    if (v('texto').length > 300) { erro.textContent = AVISO_TRECHO; return; }
    if (!v('texto') || !v('autor') || !v('titulo') || !v('pagina')) {
      erro.textContent = 'Em cada trecho, preencha texto, autor, título e página.';
      return;
    }
    trechos.push({ texto: v('texto'), autor: v('autor'), titulo: v('titulo'), pagina: v('pagina') });
  }

  const cats = {};
  Object.keys(CATEGORIAS).forEach(k => { const v = Number(g('cat_' + k)); if (v > 0) cats[k] = v; });

  const dataTermino = g('data_termino');
  let anoL = num('ano_leitura');
  if (dataTermino) anoL = Number(dataTermino.slice(0, 4));

  const capaUrl = g('capa_url');
  let capaFonte = g('capa_fonte');
  if (!capaUrl || (capaUrl !== original.capa_url && capaFonte === original.capa_fonte)) capaFonte = '';

  const dados = {
    titulo,
    subtitulo: g('subtitulo'),
    autores,
    serie: g('serie'),
    numero_na_serie: num('numero_na_serie'),
    generos: lista(g('generos'), ','),
    tags: lista(g('tags'), ','),
    paginas: num('paginas'),
    editora: g('editora'),
    ano_publicacao: num('ano_publicacao'),
    idioma: g('idioma'),
    formato: g('formato'),
    isbn: g('isbn'),
    capa_url: capaUrl,
    capa_fonte: capaFonte,
    status: g('status'),
    ano_leitura: anoL,
    data_inicio: g('data_inicio'),
    data_termino: dataTermino,
    progresso: Math.min(100, Math.max(0, num('progresso') || 0)),
    prioridade: g('prioridade'),
    motivo: g('motivo'),
    favorito: form.elements.favorito.checked,
    releitura: form.elements.releitura.checked,
    exemplo: form.elements.exemplo.checked,
    nota: Number(g('nota')) || 0,
    notas_categorias: cats,
    frase_resumo: g('frase_resumo'),
    resumo: g('resumo'),
    review: form.elements.review.value.trim(),
    recomendaria: g('recomendaria'),
    trechos,
    privado_notas: form.elements.privado_notas.value.trim()
  };

  if (novo) DB.livros.push({ ...original, ...dados });
  else Object.assign(original, dados);

  delete CAPAS[original.id];
  persistir();
  fecharModal();
  render({ foco: false });
}

function excluirLivro(id) {
  const b = achar(id);
  if (!b) return;
  if (!confirm(`Excluir "${b.titulo}" do rascunho? Esta ação não pode ser desfeita.`)) return;
  DB.livros = DB.livros.filter(l => l.id !== id);
  delete CAPAS[id];
  persistir();
  fecharModal();
  if (rotaAtual().nome === 'livro') location.hash = '#/estante';
  else render({ foco: false });
}

/* ----- Configurações do site ----- */
function abrirFormConfig() {
  const c = DB.config;
  abrirModal(`
    <h2>Configurações do site</h2>
    <form id="form-config">
      <div class="form-grade">
        ${inp('Título do site', 'titulo', c.titulo)}
        ${inp('Subtítulo', 'subtitulo', c.subtitulo)}
        ${inp('Meta anual (livros)', 'meta_anual', c.meta_anual, 'number', 'min="0"')}
        ${area('Texto da página Sobre (linha em branco separa parágrafos)', 'sobre', c.sobre, 8)}
      </div>
      <div class="form-acoes">
        <button type="submit" class="btn">Salvar no rascunho</button>
        <button type="button" class="btn btn-sec" data-fechar>Cancelar</button>
      </div>
    </form>`, { largo: true });
  const f = $('#form-config');
  f.addEventListener('submit', e => {
    e.preventDefault();
    DB.config.titulo = f.titulo.value.trim() || CONFIG_PADRAO.titulo;
    DB.config.subtitulo = f.subtitulo.value.trim();
    DB.config.meta_anual = Number(f.meta_anual.value) || 0;
    DB.config.sobre = f.sobre.value.trim();
    persistir();
    fecharModal();
    render({ foco: false });
  });
}

/* ---------- 10. Inicialização ---------- */
(async function iniciar() {
  try {
    aplicarTema(document.documentElement.getAttribute('data-theme') || 'light');
    if (EDITAR) montarPainel();
    if (await carregar()) render({ foco: false });
  } catch (err) {
    console.error(err);
    $('#conteudo').innerHTML = estadoVazio('Ocorreu um erro ao montar a página: ' + esc(err.message) + '. Abra o Console (F12) para ver detalhes.');
  }
})();
