import { MODE, backend, CARRIERS, TIPOS, DEFAULT_TPL } from './db.js';

const SHELVES = ['A', 'B', 'C', 'D', 'E', 'F', 'Balcão'];
const ALL_TABS = [['registrar', 'Registrar'], ['pendentes', 'Pendentes'], ['historico', 'Histórico'], ['moradores', 'Moradores'], ['relatorio', 'Relatório'], ['ajustes', 'Ajustes']];

const $ = (s, r) => (r || document).querySelector(s);
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

let S = { cfg: { condo: 'Condomínio', tpl: DEFAULT_TPL }, res: [], pkgs: [], demo: false };
let P = null; // perfil do usuário logado
let tab = 'registrar';

/* ---------------- utilidades ---------------- */
const ageH = (iso) => (Date.now() - new Date(iso).getTime()) / 36e5;
function waitLabel(iso, end) {
  const h = ((end ? new Date(end).getTime() : Date.now()) - new Date(iso).getTime()) / 36e5;
  if (h < 1) return 'agora há pouco';
  if (h < 24) return Math.floor(h) + ' h';
  const d = Math.floor(h / 24);
  return d + (d === 1 ? ' dia' : ' dias');
}
const ageClass = (p) => { const d = ageH(p.at) / 24; return d >= 7 ? 'bad' : d >= 3 ? 'warn' : ''; };
const fmtDT = (iso) => new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
const sameDay = (a, b) => new Date(a).toDateString() === new Date(b).toDateString();
const firstName = (n) => String(n || '').split(' ')[0];
const pending = () => S.pkgs.filter((p) => p.status === 'pendente');
const byId = (id) => S.pkgs.find((x) => x.id === id);
const isSindico = () => P && P.papel === 'sindico';

function msg(p, rem) {
  const t = (S.cfg.tpl || DEFAULT_TPL)
    .replace(/\{nome\}/g, firstName(p.nome) || 'morador').replace(/\{unidade\}/g, p.unit)
    .replace(/\{condominio\}/g, S.cfg.condo || 'condomínio').replace(/\{transportadora\}/g, p.carrier)
    .replace(/\{protocolo\}/g, p.code);
  return (rem ? 'Lembrete: ' : '') + t;
}
function waLink(p, rem) {
  const d = String(p.tel || '').replace(/\D/g, '');
  if (d.length < 10) return '';
  const num = d.indexOf('55') === 0 && d.length >= 12 ? d : '55' + d;
  return 'https://wa.me/' + num + '?text=' + encodeURIComponent(msg(p, rem));
}
function toast(t) {
  const e = $('#toast');
  e.innerHTML = '<div class="toast" role="status">' + esc(t) + '</div>';
  setTimeout(() => { e.innerHTML = ''; }, 3200);
}
function copy(text, ok) {
  try {
    navigator.clipboard.writeText(text).then(() => toast(ok || 'Copiado'), () => toast('Não foi possível copiar. Selecione o texto e copie.'));
  } catch (e) { toast('Não foi possível copiar. Selecione o texto e copie.'); }
}
async function run(fn, btn) {
  if (btn) btn.disabled = true;
  try { return await fn(); }
  catch (e) { toast(e.message || 'Algo deu errado.'); }
  finally { if (btn) btn.disabled = false; }
}
function qrSvg(text) {
  if (!window.qrcode) return '';
  const q = window.qrcode(0, 'M');
  q.addData(text);
  q.make();
  const n = q.getModuleCount();
  let d = '';
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (q.isDark(r, c)) d += 'M' + c + ' ' + r + 'h1v1h-1z';
  return '<svg viewBox="0 0 ' + n + ' ' + n + '" shape-rendering="crispEdges" role="img" aria-label="QR code ' + esc(text) + '"><path d="' + d + '" fill="#000"/></svg>';
}

/* ---------------- dados ---------------- */
async function refresh() {
  const d = await backend.loadAll();
  S.cfg = d.cfg; S.res = d.res; S.pkgs = d.pkgs; S.demo = !!d.demo;
}
let softBusy = false;
async function softRefresh() {
  if (softBusy || !P) return;
  softBusy = true;
  try {
    await refresh();
    renderChrome();
    if (tab === 'pendentes') drawPend();
    else if (tab === 'historico') drawHist();
    else if (tab === 'moradores') drawMor();
    else if (tab === 'relatorio') viewRelatorio();
    else if (tab === 'registrar' && !R.sel) drawMatches();
  } catch (e) { /* tenta de novo no próximo evento */ }
  softBusy = false;
}

/* ---------------- estrutura: abas e totais ---------------- */
function visibleTabs() {
  return ALL_TABS.filter((t) => t[0] !== 'ajustes' || isSindico());
}
function setTab(t) {
  tab = visibleTabs().some((x) => x[0] === t) ? t : 'registrar';
  try { history.replaceState(null, '', '#' + tab); } catch (e) { try { location.hash = tab; } catch (e2) {} }
  render();
}
function renderChrome() {
  const pend = pending();
  $('#condoName').textContent = S.cfg.condo || '';
  $('#tabs').innerHTML = visibleTabs().map((t) =>
    '<button type="button" data-act="tab" data-tab="' + t[0] + '"' + (t[0] === tab ? ' aria-current="page"' : '') + '>' + t[1] +
    (t[0] === 'pendentes' ? '<span class="badge">' + pend.length + '</span>' : '') + '</button>').join('');
  $('#userbox').innerHTML = MODE === 'supabase' && P
    ? '<span>' + esc(P.nome || P.email) + ' · ' + (P.papel === 'sindico' ? 'síndico' : 'porteiro') + '</span><button type="button" class="btn small" data-act="logout">Sair</button>'
    : '<span class="pill warn">Demonstração</span>';
  const today = new Date().toISOString();
  const chegaram = S.pkgs.filter((p) => sameDay(p.at, today)).length;
  const entreg = S.pkgs.filter((p) => p.status === 'entregue' && p.outAt && sameDay(p.outAt, today)).length;
  const oldest = pend.length ? Math.floor(Math.max(...pend.map((p) => ageH(p.at))) / 24) : 0;
  $('#tiles').innerHTML =
    '<div class="tile"><b>' + pend.length + '</b><small>Pendentes na portaria</small></div>' +
    '<div class="tile"><b>' + chegaram + '</b><small>Chegaram hoje</small></div>' +
    '<div class="tile"><b>' + entreg + '</b><small>Entregues hoje</small></div>' +
    '<div class="tile' + (oldest >= 3 ? ' alert' : '') + '"><b>' + oldest + (oldest === 1 ? ' dia' : ' dias') + '</b><small>Encomenda mais antiga</small></div>';
  $('#banner').innerHTML = S.demo ? '<div class="banner">Dados de exemplo (160 apartamentos), salvos apenas neste navegador. Em Ajustes você apaga tudo e começa do zero.</div>' : '';
}

/* ---------------- login ---------------- */
function showShell(on) {
  $('#tabs').hidden = !on; $('#tiles').hidden = !on; $('#userbox').hidden = !on;
}
function showLogin(erro) {
  showShell(false);
  $('#banner').innerHTML = '';
  $('#condoName').textContent = '';
  $('#view').innerHTML = '<section class="panel login"><h2>Entrar</h2>' +
    (erro ? '<p class="err" role="alert">' + esc(erro) + '</p>' : '') +
    '<form id="lf"><label for="le">E-mail</label><input id="le" type="email" autocomplete="username" required>' +
    '<label for="lp">Senha</label><input id="lp" type="password" autocomplete="current-password" required>' +
    '<div style="margin-top:16px"><button class="btn primary" type="submit" style="width:100%">Entrar</button></div></form>' +
    '<p class="hint">Não tem acesso? Peça ao síndico para criar seu usuário.</p></section>';
  const e = $('#le'); if (e) e.focus();
}
function showPending() {
  showShell(false);
  $('#view').innerHTML = '<section class="panel login"><h2>Aguardando liberação</h2><p>Seu usuário foi criado, mas ainda não está ativo. Peça ao síndico para liberar o acesso e depois entre de novo.</p>' +
    '<button type="button" class="btn" data-act="logout">Sair</button></section>';
}

/* ---------------- REGISTRAR ---------------- */
const R = { sel: null, carrier: 'Correios', tipo: 'Caixa', shelf: 'A', last: null, q: '' };
function viewRegistrar() {
  let v = '';
  if (R.last) {
    const p = R.last, link = waLink(p, false);
    v += '<section class="done-box" aria-live="polite"><div><b>Encomenda registrada para o apto ' + esc(p.unit) + (p.nome ? ' · ' + esc(p.nome) : '') + '</b></div>' +
      '<div class="bigcode">' + esc(p.code) + '</div><div class="hint" style="margin-top:0">Código de retirada. Imprima a etiqueta ou escreva na encomenda e guarde na prateleira ' + esc(p.shelf) + '.</div>' +
      '<p style="margin:12px 0 6px;font-size:14px">' + esc(msg(p, false)) + '</p><div class="actions" style="justify-content:flex-start">' +
      (link ? '<a class="btn wa" data-act="notified" data-id="' + p.id + '" href="' + esc(link) + '" target="_blank" rel="noopener">Avisar no WhatsApp</a>' : '<span class="pill warn">Morador sem telefone cadastrado</span>') +
      '<button type="button" class="btn" data-act="label" data-id="' + p.id + '">Etiqueta com QR</button>' +
      '<button type="button" class="btn" data-act="copymsg" data-id="' + p.id + '">Copiar mensagem</button>' +
      '<button type="button" class="btn primary" data-act="newpkg">Nova encomenda</button></div></section>';
  }
  v += '<section class="panel"><h2>Nova encomenda</h2><label for="q">Morador ou apartamento</label>' +
    '<input id="q" type="search" autocomplete="off" placeholder="Digite o apto (302) ou o nome (ana)" value="' + esc(R.q) + '">' +
    '<div id="matches" class="matches"></div><div id="rform"></div></section>';
  $('#view').innerHTML = v;
  drawMatches(); drawForm();
  if (!R.sel && !R.last) { const q = $('#q'); if (q) q.focus(); }
}
function drawMatches() {
  const box = $('#matches'); if (!box) return;
  if (R.sel) { box.innerHTML = ''; return; }
  const q = R.q.trim(), t = norm(q).split(/\s+/).filter(Boolean);
  if (!t.length) { box.innerHTML = '<p class="hint">Digite pelo menos parte do apartamento ou do nome. Aceita as duas coisas juntas, como "ana 302".</p>'; return; }
  let list = S.res.filter((r) => { const h = norm(r.nome + ' ' + r.unit); return t.every((x) => h.indexOf(x) > -1); });
  list.sort((a, b) => (a.unit === q ? 0 : 1) - (b.unit === q ? 0 : 1) || a.unit.localeCompare(b.unit, undefined, { numeric: true }));
  const total = list.length; list = list.slice(0, 8);
  let h = list.map((r) => {
    const np = pending().filter((p) => p.unit === r.unit).length;
    return '<button type="button" class="match" data-act="pick" data-id="' + r.id + '"><span class="unit">' + esc(r.unit) + '</span><span><b>' + esc(r.nome) + '</b>' + (np ? ' <span class="pill warn">' + np + ' pendente' + (np > 1 ? 's' : '') + '</span>' : '') + '</span></button>';
  }).join('');
  if (/^\d{2,4}$/.test(q) && !S.res.some((r) => r.unit === q))
    h += '<button type="button" class="match" data-act="pickunit" data-unit="' + esc(q) + '"><span class="unit">' + esc(q) + '</span><span>Apto sem moradores cadastrados. Registrar mesmo assim</span></button>';
  if (!h) h = '<p class="hint">Ninguém encontrado. Confira a digitação ou cadastre o morador na aba Moradores.</p>';
  if (total > 8) h += '<p class="hint">Mostrando 8 de ' + total + '. Digite mais letras ou o número do apto.</p>';
  box.innerHTML = h;
}
function chipGroup(name, items, cur) {
  return '<div class="chips" role="radiogroup">' + items.map((i) => '<label><input type="radio" name="' + name + '" value="' + esc(i) + '"' + (i === cur ? ' checked' : '') + '><span>' + esc(i) + '</span></label>').join('') + '</div>';
}
function drawForm() {
  const box = $('#rform'); if (!box) return;
  if (!R.sel) { box.innerHTML = ''; return; }
  const s = R.sel, np = pending().filter((p) => p.unit === s.unit).length;
  box.innerHTML = '<div style="display:flex;gap:12px;align-items:center;flex-wrap:wrap;margin-top:12px"><span class="unit">' + esc(s.unit) + '</span><b>' + esc(s.nome || 'Apto sem cadastro') + '</b>' +
    (s.nome && !s.tel ? '<span class="pill warn">sem telefone</span>' : '') + (np ? '<span class="pill warn">' + np + ' já pendente' + (np > 1 ? 's' : '') + ' neste apto</span>' : '') +
    '<button type="button" class="btn small" data-act="unpick">Trocar</button></div><form id="pf" autocomplete="off">' +
    '<label>Transportadora</label>' + chipGroup('carrier', CARRIERS, R.carrier) +
    '<label>Tipo</label>' + chipGroup('tipo', TIPOS, R.tipo) +
    '<label>Prateleira</label>' + chipGroup('shelf', SHELVES, R.shelf) +
    '<div class="row"><div><label for="track">Código de rastreio (opcional)</label><input id="track" type="text"></div>' +
    '<div><label for="obs">Observação (opcional)</label><input id="obs" type="text" placeholder="Ex.: caixa amassada"></div></div>' +
    (s.nome ? '' : '<div class="row"><div><label for="ptel">Telefone para aviso (opcional)</label><input id="ptel" type="tel" placeholder="(65) 9 0000-0000"></div></div>') +
    '<div style="margin-top:16px"><button type="submit" class="btn primary" style="min-width:220px">Registrar encomenda</button></div></form>';
}
async function submitPkg(f) {
  const s = R.sel; if (!s) return;
  const g = (n) => { const e = f.querySelector('input[name="' + n + '"]:checked'); return e ? e.value : ''; };
  const val = (sel) => { const e = f.querySelector(sel); return e ? e.value.trim() : ''; };
  const p = { resId: s.id || null, unit: s.unit, nome: s.nome || '', tel: s.tel || val('#ptel'),
    carrier: g('carrier') || 'Outros', tipo: g('tipo') || 'Caixa', shelf: g('shelf') || 'A', track: val('#track'), obs: val('#obs') };
  const saved = await run(() => backend.addPkg(p), f.querySelector('button[type=submit]'));
  if (!saved) return;
  R.carrier = p.carrier; R.tipo = p.tipo; R.shelf = p.shelf;
  S.pkgs.push(saved);
  R.last = saved; R.sel = null; R.q = '';
  render(); window.scrollTo(0, 0);
}

/* ---------------- PENDENTES ---------------- */
const PF = { q: '', age: 0 };
const matchPkg = (p, q) => { const t = norm(q).split(/\s+/).filter(Boolean); const h = norm([p.nome, p.unit, p.code, p.track, p.carrier].join(' ')); return t.every((x) => h.indexOf(x) > -1); };
function pkgCard(p, mode) {
  const link = waLink(p, true), cls = p.status === 'entregue' ? 'done' : ageClass(p);
  const wait = p.status === 'entregue' ? 'retirada após ' + waitLabel(p.at, p.outAt) : 'há ' + waitLabel(p.at);
  const pill = p.status === 'entregue' ? '<span class="pill ok">Entregue</span>' : '<span class="pill' + (cls ? ' ' + cls : '') + '">' + esc(wait) + '</span>';
  let act = '';
  if (p.status === 'pendente') {
    act = '<button type="button" class="btn primary small" data-act="deliver" data-id="' + p.id + '">Entregar</button>' +
      (link ? '<a class="btn small" data-act="notified" data-id="' + p.id + '" href="' + esc(link) + '" target="_blank" rel="noopener">Reavisar</a>' : '') +
      '<button type="button" class="btn small" data-act="label" data-id="' + p.id + '">Etiqueta</button>' +
      '<button type="button" class="btn small" data-act="copymsg" data-id="' + p.id + '">Copiar aviso</button>';
  } else if (mode === 'hist') {
    act = '<button type="button" class="btn small" data-act="undo" data-id="' + p.id + '">Desfazer entrega</button>';
  }
  return '<article class="pkg ' + cls + '"><span class="unit">' + esc(p.unit) + '</span><div><div class="who">' + esc(p.nome || 'Apto sem cadastro') + ' <span class="code">' + esc(p.code) + '</span> ' + pill + '</div>' +
    '<div class="meta"><span>' + esc(p.carrier) + ' · ' + esc(p.tipo) + '</span><span>Prateleira ' + esc(p.shelf) + '</span><span>Chegou ' + fmtDT(p.at) + '</span>' +
    (p.track ? '<span>Rastreio ' + esc(p.track) + '</span>' : '') + (p.obs ? '<span>' + esc(p.obs) + '</span>' : '') +
    (p.status === 'entregue' ? '<span>Retirada ' + fmtDT(p.outAt) + ' por ' + esc(p.outBy || '') + '</span>' : '') +
    (p.status === 'pendente' && !p.notified ? '<span class="pill warn">Morador ainda não avisado</span>' : '') + '</div></div><div class="actions">' + act + '</div></article>';
}
function viewPendentes() {
  $('#view').innerHTML = '<section class="panel"><h2>Pendentes na portaria</h2><div class="row"><div style="flex:2 1 260px"><label for="pq">Buscar por nome, apto, código ou rastreio</label>' +
    '<input id="pq" type="search" autocomplete="off" value="' + esc(PF.q) + '" placeholder="Ex.: 302, ana, K7M2 (ou passe o leitor de QR)"></div>' +
    '<div><label>Tempo na portaria</label><div class="chips">' + [[0, 'Todas'], [3, '3+ dias'], [7, '7+ dias']].map((a) => '<label><input type="radio" name="age" value="' + a[0] + '"' + (PF.age === a[0] ? ' checked' : '') + '><span>' + a[1] + '</span></label>').join('') + '</div></div></div></section><div id="plist" class="list"></div>';
  drawPend();
}
function drawPend() {
  const b = $('#plist'); if (!b) return;
  const l = pending().filter((p) => (!PF.q || matchPkg(p, PF.q)) && ageH(p.at) / 24 >= PF.age);
  l.sort((a, b2) => new Date(a.at) - new Date(b2.at));
  b.innerHTML = l.length ? l.map((p) => pkgCard(p, 'pend')).join('') : '<div class="panel empty">Nenhuma encomenda pendente com esse filtro.</div>';
}

/* ---------------- HISTÓRICO ---------------- */
const HF = { q: '', st: 'todas' };
function viewHistorico() {
  $('#view').innerHTML = '<section class="panel"><h2>Histórico</h2><div class="row"><div style="flex:2 1 260px"><label for="hq">Buscar</label><input id="hq" type="search" autocomplete="off" value="' + esc(HF.q) + '" placeholder="Nome, apto, código ou rastreio"></div>' +
    '<div><label for="hs">Situação</label><select id="hs">' + [['todas', 'Todas'], ['entregue', 'Entregues'], ['pendente', 'Pendentes']].map((o) => '<option value="' + o[0] + '"' + (HF.st === o[0] ? ' selected' : '') + '>' + o[1] + '</option>').join('') + '</select></div></div>' +
    '<p class="hint">Mostra os últimos 90 dias.</p></section><div id="hlist" class="list"></div>';
  drawHist();
}
function drawHist() {
  const b = $('#hlist'); if (!b) return;
  let l = S.pkgs.filter((p) => (HF.st === 'todas' || p.status === HF.st) && (!HF.q || matchPkg(p, HF.q)));
  l.sort((a, b2) => new Date(b2.at) - new Date(a.at));
  const tot = l.length; l = l.slice(0, 60);
  b.innerHTML = (l.length ? l.map((p) => pkgCard(p, 'hist')).join('') : '<div class="panel empty">Nada encontrado.</div>') + (tot > 60 ? '<p class="hint">Mostrando 60 de ' + tot + '. Use a busca para refinar.</p>' : '');
}

/* ---------------- MORADORES ---------------- */
const MF = { q: '', confirm: null };
function viewMoradores() {
  $('#view').innerHTML = '<section class="panel"><h2>Novo morador</h2><form id="rf" autocomplete="off"><div class="row"><div><label for="rn">Nome</label><input id="rn" type="text" required></div>' +
    '<div style="flex:0 1 120px"><label for="ru">Apto</label><input id="ru" type="text" required placeholder="302"></div>' +
    '<div><label for="rt">Telefone (WhatsApp)</label><input id="rt" type="tel" placeholder="(65) 9 0000-0000"></div></div>' +
    '<div style="margin-top:14px"><button class="btn primary" type="submit">Cadastrar</button></div></form></section>' +
    '<section class="panel"><h2>Importar lista</h2><p class="hint" style="margin-top:0">Cole uma linha por morador no formato nome;apto;telefone. Dá para copiar de uma planilha com três colunas (nome, apto, telefone).</p>' +
    '<textarea id="imp" aria-label="Lista de moradores" placeholder="Maria Souza;302;65999990000"></textarea><div style="margin-top:10px"><button type="button" class="btn" data-act="import">Importar</button></div></section>' +
    '<section class="panel"><h2>Moradores cadastrados <span class="pill" id="mcount"></span></h2><label for="mq">Buscar</label><input id="mq" type="search" autocomplete="off" value="' + esc(MF.q) + '" placeholder="Nome ou apto"><div class="tw" id="mlist" style="margin-top:10px"></div></section>';
  drawMor();
}
function drawMor() {
  const b = $('#mlist'); if (!b) return;
  const t = norm(MF.q).split(/\s+/).filter(Boolean);
  let l = S.res.filter((r) => { const h = norm(r.nome + ' ' + r.unit); return t.every((x) => h.indexOf(x) > -1); });
  l.sort((a, b2) => a.unit.localeCompare(b2.unit, undefined, { numeric: true }));
  $('#mcount').textContent = S.res.length;
  const tot = l.length; l = l.slice(0, 60);
  b.innerHTML = l.length ? '<table><thead><tr><th>Apto</th><th>Nome</th><th>Telefone</th><th></th></tr></thead><tbody>' + l.map((r) =>
    '<tr><td><span class="unit">' + esc(r.unit) + '</span></td><td>' + esc(r.nome) + '</td><td>' + esc(r.tel || '—') + '</td><td style="text-align:right">' +
    (isSindico() ? '<button type="button" class="btn small danger" data-act="delres" data-id="' + r.id + '">' + (MF.confirm === r.id ? 'Confirmar exclusão' : 'Excluir') + '</button>' : '') + '</td></tr>').join('') +
    '</tbody></table>' + (tot > 60 ? '<p class="hint">Mostrando 60 de ' + tot + '. Refine a busca.</p>' : '') : '<div class="empty">Nenhum morador encontrado.</div>';
}

/* ---------------- RELATÓRIO ---------------- */
function csv() {
  const q = (s) => '"' + String(s == null ? '' : s).replace(/"/g, '""') + '"';
  const rows = [['protocolo', 'apto', 'morador', 'transportadora', 'tipo', 'rastreio', 'prateleira', 'chegada', 'situacao', 'retirada', 'retirado_por']];
  S.pkgs.slice().sort((a, b) => new Date(a.at) - new Date(b.at)).forEach((p) => rows.push([p.code, p.unit, p.nome, p.carrier, p.tipo, p.track, p.shelf, p.at, p.status, p.outAt || '', p.outBy || '']));
  return rows.map((r) => r.map(q).join(';')).join('\n');
}
function viewRelatorio() {
  const since = Date.now() - 30 * 864e5;
  const rec = S.pkgs.filter((p) => new Date(p.at).getTime() >= since);
  const ent = S.pkgs.filter((p) => p.status === 'entregue' && p.outAt && new Date(p.outAt).getTime() >= since);
  const avg = ent.length ? ent.reduce((a, p) => a + (new Date(p.outAt) - new Date(p.at)) / 36e5, 0) / ent.length : 0;
  const avgTxt = !ent.length ? '—' : avg < 24 ? avg.toFixed(1).replace('.', ',') + ' h' : (avg / 24).toFixed(1).replace('.', ',') + ' dias';
  const by = {}; rec.forEach((p) => { by[p.carrier] = (by[p.carrier] || 0) + 1; });
  const keys = Object.keys(by).sort((a, b) => by[b] - by[a]), max = keys.length ? by[keys[0]] : 1;
  const b = [0, 0, 0, 0];
  pending().forEach((p) => { const d = ageH(p.at) / 24; b[d < 1 ? 0 : d < 3 ? 1 : d < 7 ? 2 : 3]++; });
  const bl = [['Hoje', b[0]], ['1 a 2 dias', b[1]], ['3 a 6 dias', b[2]], ['7 dias ou mais', b[3]]], bmax = Math.max(...b, 1);
  const perDay = (rec.length / 30).toFixed(1).replace('.', ',');
  $('#view').innerHTML = '<section class="panel"><h2>Últimos 30 dias</h2><div class="tiles" style="margin:0 0 8px">' +
    '<div class="tile"><b>' + rec.length + '</b><small>Encomendas recebidas</small></div><div class="tile"><b>' + perDay + '</b><small>Média por dia</small></div>' +
    '<div class="tile"><b>' + ent.length + '</b><small>Entregues</small></div><div class="tile"><b>' + avgTxt + '</b><small>Tempo médio até a retirada</small></div></div>' +
    '<h3>Por transportadora</h3>' + (keys.length ? keys.map((k) => '<div class="bar"><span>' + esc(k) + '</span><i style="width:' + Math.max(3, by[k] / max * 100) + '%"></i><span class="n">' + by[k] + '</span></div>').join('') : '<p class="hint">Sem dados no período.</p>') + '</section>' +
    '<section class="panel"><h2>Pendentes por tempo de espera</h2>' + bl.map((x, i) => '<div class="bar"><span>' + x[0] + '</span><i style="width:' + Math.max(x[1] ? 3 : 0, x[1] / bmax * 100) + '%;' + (i === 3 ? 'background:var(--bad)' : i === 2 ? 'background:var(--warn)' : '') + '"></i><span class="n">' + x[1] + '</span></div>').join('') + '</section>' +
    '<section class="panel"><h2>Exportar</h2><p class="hint" style="margin-top:0">Copie e cole numa planilha (separador ponto e vírgula).</p><button type="button" class="btn" data-act="copycsv">Copiar tudo em CSV</button></section>';
}

/* ---------------- AJUSTES ---------------- */
const AF = { demoC: false, wipeC: false };
async function viewAjustes() {
  let v = '<section class="panel"><h2>Condomínio e mensagem de aviso</h2><form id="cf"><label for="cn">Nome do condomínio</label><input id="cn" type="text" value="' + esc(S.cfg.condo) + '">' +
    '<label for="ct">Texto do aviso no WhatsApp</label><textarea id="ct">' + esc(S.cfg.tpl) + '</textarea>' +
    '<p class="hint">Campos disponíveis: {nome} {unidade} {condominio} {transportadora} {protocolo}</p>' +
    '<div class="row" style="margin-top:12px"><button class="btn primary" type="submit" style="flex:0 0 auto">Salvar</button><button type="button" class="btn" data-act="tplreset" style="flex:0 0 auto">Voltar ao texto padrão</button></div></form></section>';
  if (MODE === 'supabase') {
    v += '<section class="panel"><h2>Equipe</h2><p class="hint" style="margin-top:0">Crie o usuário no painel do Supabase (Authentication, Users). Ele aparece aqui inativo e só entra depois que você ativar.</p><div class="tw" id="team"><div class="empty">Carregando…</div></div></section>';
  } else {
    v += '<section class="panel"><h2>Backup</h2><p class="hint" style="margin-top:0">Os dados da demonstração ficam só neste navegador. Copie o backup para guardar.</p>' +
      '<button type="button" class="btn" data-act="backup">Copiar backup</button><label for="rb">Restaurar backup</label><textarea id="rb" placeholder="Cole aqui o backup copiado"></textarea><div style="margin-top:10px"><button type="button" class="btn" data-act="restore">Restaurar</button></div></section>' +
      '<section class="panel"><h2>Dados</h2><div class="row"><button type="button" class="btn" data-act="demo" style="flex:0 0 auto">' + (AF.demoC ? 'Confirmar: trocar tudo pelos dados de exemplo' : 'Carregar dados de exemplo') + '</button>' +
      '<button type="button" class="btn danger" data-act="wipe" style="flex:0 0 auto">' + (AF.wipeC ? 'Confirmar: apagar tudo' : 'Apagar tudo e começar do zero') + '</button></div></section>';
  }
  $('#view').innerHTML = v;
  if (MODE === 'supabase') {
    try {
      const list = await backend.listPerfis();
      const box = $('#team'); if (!box) return;
      box.innerHTML = '<table><thead><tr><th>Nome</th><th>E-mail</th><th>Papel</th><th>Ativo</th></tr></thead><tbody>' + list.map((u) =>
        '<tr><td>' + esc(u.nome) + '</td><td>' + esc(u.email) + '</td><td><select data-perfil="' + u.user_id + '" data-campo="papel" aria-label="Papel de ' + esc(u.nome) + '"><option value="porteiro"' + (u.papel === 'porteiro' ? ' selected' : '') + '>Porteiro</option><option value="sindico"' + (u.papel === 'sindico' ? ' selected' : '') + '>Síndico</option></select></td>' +
        '<td><input type="checkbox" data-perfil="' + u.user_id + '" data-campo="ativo" aria-label="Ativo: ' + esc(u.nome) + '"' + (u.ativo ? ' checked' : '') + '></td></tr>').join('') + '</tbody></table>';
    } catch (e) { const box = $('#team'); if (box) box.innerHTML = '<div class="empty">' + esc(e.message) + '</div>'; }
  }
}

/* ---------------- etiqueta com QR ---------------- */
function openLabel(id) {
  const p = byId(id); if (!p) return;
  $('#overlay').innerHTML = '<div class="overlay" data-act="closeov"><div class="modal" role="dialog" aria-modal="true" aria-label="Etiqueta">' +
    '<div class="label"><div class="label-top"><span class="label-unit">Apto ' + esc(p.unit) + '</span><span>' + esc(S.cfg.condo || '') + '</span></div>' +
    '<div class="label-name">' + esc(p.nome || 'Sem cadastro') + '</div>' +
    '<div class="label-mid"><div class="qr">' + qrSvg(p.code) + '</div><div><div class="label-code">' + esc(p.code) + '</div><div class="label-meta">' + esc(p.carrier) + ' · prateleira ' + esc(p.shelf) + '<br>Chegou ' + fmtDT(p.at) + '</div></div></div></div>' +
    '<div class="row noprint" style="margin-top:14px"><span style="flex:1 1 0"></span><button type="button" class="btn" data-act="closeov" style="flex:0 0 auto">Fechar</button><button type="button" class="btn primary" data-act="printlabel" style="flex:0 0 auto">Imprimir</button></div></div></div>';
}

/* ---------------- entrega com assinatura ---------------- */
let drawn = false;
function openDeliver(id) {
  const p = byId(id); if (!p) return;
  drawn = false;
  $('#overlay').innerHTML = '<div class="overlay" data-act="closeov"><div class="modal" role="dialog" aria-modal="true" aria-label="Entregar encomenda" data-id="' + p.id + '">' +
    '<h2 style="font-size:20px;margin-bottom:4px">Entregar ao apto ' + esc(p.unit) + '</h2><div style="color:var(--muted)">' + esc(p.nome || 'Apto sem cadastro') + ' · código <span class="code">' + esc(p.code) + '</span> · ' + esc(p.carrier) + ' · prateleira ' + esc(p.shelf) + '</div>' +
    '<label>Quem está retirando</label><div class="chips"><label><input type="radio" name="who" value="mor" checked><span>O próprio morador</span></label><label><input type="radio" name="who" value="out"><span>Outra pessoa</span></label></div>' +
    '<div id="otherbox" hidden><label for="other">Nome de quem retirou</label><input id="other" type="text"></div>' +
    '<label>Assinatura (opcional)</label><canvas class="sig" id="sig" width="600" height="160"></canvas>' +
    '<div class="row" style="margin-top:14px"><button type="button" class="btn" data-act="sigclear" style="flex:0 0 auto">Limpar assinatura</button><span style="flex:1 1 0"></span>' +
    '<button type="button" class="btn" data-act="closeov" style="flex:0 0 auto">Cancelar</button><button type="button" class="btn primary" data-act="confirmdeliver" style="flex:0 0 auto">Confirmar entrega</button></div></div></div>';
  const c = $('#sig'), ctx = c.getContext('2d');
  let down = false;
  ctx.lineWidth = 3; ctx.lineCap = 'round'; ctx.strokeStyle = '#14232b';
  const pos = (e) => { const r = c.getBoundingClientRect(); return [(e.clientX - r.left) * c.width / r.width, (e.clientY - r.top) * c.height / r.height]; };
  c.addEventListener('pointerdown', (e) => { down = true; drawn = true; const q = pos(e); ctx.beginPath(); ctx.moveTo(q[0], q[1]); try { c.setPointerCapture(e.pointerId); } catch (x) {} e.preventDefault(); });
  c.addEventListener('pointermove', (e) => { if (!down) return; const q = pos(e); ctx.lineTo(q[0], q[1]); ctx.stroke(); });
  const up = () => { down = false; };
  c.addEventListener('pointerup', up); c.addEventListener('pointercancel', up);
  $('#overlay').querySelectorAll('input[name=who]').forEach((i) => i.addEventListener('change', () => {
    $('#otherbox').hidden = $('#overlay input[name=who]:checked').value !== 'out';
    if (!$('#otherbox').hidden) $('#other').focus();
  }));
}
async function confirmDeliver(btn) {
  const m = $('#overlay .modal'); if (!m) return;
  const p = byId(m.getAttribute('data-id')); if (!p) return;
  const who = $('#overlay input[name=who]:checked').value, other = $('#other').value.trim();
  if (who === 'out' && !other) { toast('Informe o nome de quem retirou'); $('#other').focus(); return; }
  const outBy = who === 'out' ? other + ' (autorizado)' : (p.nome || 'Morador');
  let sig = null;
  if (drawn) { try { sig = $('#sig').toDataURL('image/png'); } catch (e) {} }
  const ok = await run(async () => { await backend.deliver(p.id, { outBy, sig }); return true; }, btn);
  if (!ok) { softRefresh(); return; }
  p.status = 'entregue'; p.outAt = new Date().toISOString(); p.outBy = outBy;
  $('#overlay').innerHTML = '';
  toast('Entrega registrada: apto ' + p.unit);
  render();
}

/* ---------------- render e eventos ---------------- */
function render() {
  renderChrome();
  ({ registrar: viewRegistrar, pendentes: viewPendentes, historico: viewHistorico, moradores: viewMoradores, relatorio: viewRelatorio, ajustes: viewAjustes })[tab]();
}

document.addEventListener('click', async (e) => {
  const el = e.target.closest('[data-act]'); if (!el) return;
  const a = el.getAttribute('data-act'), id = el.getAttribute('data-id');
  let p;
  if (a === 'closeov') { if (el.classList.contains('overlay') && e.target !== el) return; $('#overlay').innerHTML = ''; return; }
  if (a === 'tab') { setTab(el.getAttribute('data-tab')); return; }
  if (a === 'logout') { await run(() => backend.signOut()); P = null; showLogin(); return; }
  if (a === 'pick') { const r = S.res.find((x) => x.id === id); if (r) { R.sel = r; R.last = null; viewRegistrar(); const t = $('#track'); if (t) t.focus(); } return; }
  if (a === 'pickunit') { R.sel = { unit: el.getAttribute('data-unit'), nome: '', tel: '' }; R.last = null; viewRegistrar(); return; }
  if (a === 'unpick') { R.sel = null; viewRegistrar(); return; }
  if (a === 'newpkg') { R.last = null; R.sel = null; R.q = ''; viewRegistrar(); return; }
  if (a === 'notified') { p = byId(id); if (p) { p.notified = (p.notified || 0) + 1; backend.notify(id, p.notified - 1).catch(() => {}); setTimeout(renderChrome, 300); } return; }
  if (a === 'copymsg') { p = byId(id); if (p) copy(msg(p, p.status === 'pendente' && p.notified > 0), 'Mensagem copiada'); return; }
  if (a === 'label') { openLabel(id); return; }
  if (a === 'printlabel') { try { window.print(); } catch (x) { toast('Não foi possível abrir a impressão.'); } return; }
  if (a === 'deliver') { openDeliver(id); return; }
  if (a === 'sigclear') { const c = $('#sig'); if (c) { c.getContext('2d').clearRect(0, 0, c.width, c.height); drawn = false; } return; }
  if (a === 'confirmdeliver') { confirmDeliver(el); return; }
  if (a === 'undo') { if (await run(async () => { await backend.undo(id); return true; })) { await softRefresh(); toast('Entrega desfeita'); } return; }
  if (a === 'delres') {
    if (MF.confirm === id) { if (await run(async () => { await backend.delRes(id); return true; })) { MF.confirm = null; await refresh(); toast('Morador excluído'); render(); } }
    else { MF.confirm = id; drawMor(); }
    return;
  }
  if (a === 'import') {
    const list = $('#imp').value.split(/\n/).map((s) => s.trim()).filter(Boolean).map((l) => l.split(/[;\t]/).map((s) => s.trim())).filter((c) => c[0] && c[1]).map((c) => ({ nome: c[0], unit: c[1], tel: c[2] || '' }));
    if (!list.length) { toast('Nenhuma linha válida. Use nome;apto;telefone.'); return; }
    if (await run(async () => { await backend.addManyRes(list); return true; }, el)) { await refresh(); toast(list.length + ' morador' + (list.length === 1 ? '' : 'es') + ' importado' + (list.length === 1 ? '' : 's')); render(); }
    return;
  }
  if (a === 'copycsv') { copy(csv(), 'CSV copiado'); return; }
  if (a === 'tplreset') { if (await run(async () => { await backend.saveCfg({ condo: S.cfg.condo, tpl: DEFAULT_TPL }); return true; })) { await refresh(); render(); } return; }
  if (a === 'backup') { copy(backend.exportJson(), 'Backup copiado'); return; }
  if (a === 'restore') { if (await run(async () => { await backend.importJson($('#rb').value); return true; })) { await refresh(); toast('Backup restaurado'); render(); } return; }
  if (a === 'demo') { if (AF.demoC) { AF.demoC = false; await backend.resetDemo(); await refresh(); toast('Dados de exemplo carregados'); render(); } else { AF.demoC = true; viewAjustes(); } return; }
  if (a === 'wipe') { if (AF.wipeC) { AF.wipeC = false; await backend.wipe(); await refresh(); R.sel = null; R.last = null; toast('Tudo apagado'); render(); } else { AF.wipeC = true; viewAjustes(); } return; }
});
document.addEventListener('input', (e) => {
  const t = e.target;
  if (t.id === 'q') { R.q = t.value; drawMatches(); }
  else if (t.id === 'pq') { PF.q = t.value; drawPend(); }
  else if (t.id === 'hq') { HF.q = t.value; drawHist(); }
  else if (t.id === 'mq') { MF.q = t.value; MF.confirm = null; drawMor(); }
});
document.addEventListener('change', async (e) => {
  const t = e.target;
  if (t.name === 'age') { PF.age = parseInt(t.value, 10) || 0; drawPend(); }
  else if (t.id === 'hs') { HF.st = t.value; drawHist(); }
  else if (t.getAttribute && t.getAttribute('data-perfil')) {
    const patch = {}; patch[t.getAttribute('data-campo')] = t.type === 'checkbox' ? t.checked : t.value;
    const ok = await run(async () => { await backend.setPerfil(t.getAttribute('data-perfil'), patch); return true; });
    if (ok) toast('Equipe atualizada'); else viewAjustes();
  }
});
document.addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.target, btn = f.querySelector('button[type=submit]');
  if (f.id === 'pf') submitPkg(f);
  else if (f.id === 'lf') {
    const ok = await run(async () => { await backend.signIn($('#le').value.trim(), $('#lp').value); return true; }, btn);
    if (ok) boot(); else { const pw = $('#lp'); if (pw) { pw.value = ''; pw.focus(); } }
  } else if (f.id === 'rf') {
    const n = $('#rn').value.trim(), u = $('#ru').value.trim(); if (!n || !u) return;
    if (await run(async () => { await backend.addRes({ nome: n, unit: u, tel: $('#rt').value.trim() }); return true; }, btn)) { await refresh(); toast('Morador cadastrado'); render(); }
  } else if (f.id === 'cf') {
    const cfg = { condo: $('#cn').value.trim() || 'Condomínio', tpl: $('#ct').value.trim() || DEFAULT_TPL };
    if (await run(async () => { await backend.saveCfg(cfg); return true; }, btn)) { await refresh(); toast('Ajustes salvos'); render(); }
  }
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') $('#overlay').innerHTML = '';
  // leitor de QR/código de barras digita o código e envia Enter: abre a entrega direto
  if (e.key === 'Enter' && e.target.id === 'pq') {
    const code = e.target.value.trim().toUpperCase();
    const p = pending().find((x) => x.code === code);
    if (p) { e.preventDefault(); openDeliver(p.id); }
  }
});
window.addEventListener('hashchange', () => { const h = location.hash.replace('#', ''); if (P && h && h !== tab) setTab(h); });

/* ---------------- início ---------------- */
async function boot() {
  try {
    const perfil = await backend.init();
    if (!perfil) { showLogin(); return; }
    if (!perfil.ativo) { P = perfil; showPending(); return; }
    P = perfil;
    await refresh();
    showShell(true);
    const h0 = (location.hash || '').replace('#', '');
    tab = visibleTabs().some((x) => x[0] === h0) ? h0 : 'registrar';
    render();
    backend.subscribe(softRefresh);
  } catch (e) {
    showShell(false);
    $('#view').innerHTML = '<section class="panel login"><h2>Não foi possível abrir o sistema</h2><p class="err">' + esc(e.message || e) + '</p><button type="button" class="btn" onclick="location.reload()">Tentar de novo</button></section>';
  }
}
boot();
// reconferir os dados quando o aparelho volta a ficar visível (tablet que dormiu)
document.addEventListener('visibilitychange', () => { if (!document.hidden) softRefresh(); });
