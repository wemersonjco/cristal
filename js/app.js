import { MODE, backend, CARRIERS, TIPOS, DEFAULT_TPL, DEFAULT_BLOCOS } from './db.js';

const SHELVES = ['A', 'B', 'C', 'D', 'E', 'F', 'Balcão'];
const CANAIS = ['Interfone', 'Pessoalmente', 'Telefone', 'Outro'];
const ALL_TABS = [['registrar', 'Registrar'], ['pendentes', 'Pendentes'], ['historico', 'Histórico'], ['moradores', 'Moradores'], ['relatorio', 'Relatório'], ['ajustes', 'Ajustes']];

const $ = (s, r) => (r || document).querySelector(s);
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const digits = (s) => String(s || '').replace(/\D/g, '');

let S = { cfg: { condo: 'Condomínio', tpl: DEFAULT_TPL, blocos: DEFAULT_BLOCOS.slice() }, res: [], pkgs: [], demo: false };
let P = null; // perfil do usuário logado
let tab = 'registrar';

/* ---------------- apartamento = bloco + número ---------------- */
const apKey = (x) => (x.bloco || '') + '|' + x.unit;
const apLabel = (x) => (x.bloco ? x.bloco + '-' + x.unit : String(x.unit));
const apText = (x) => (x.bloco ? 'bloco ' + x.bloco + ', apto ' + x.unit : 'apto ' + x.unit);
const tokens = (q) => norm(q).replace(/[-_/.,]+/g, ' ').split(/\s+/).filter(Boolean);
const hayRes = (r) => norm(r.nome + ' ' + r.bloco + ' ' + r.unit + ' ' + r.bloco + r.unit);
const cmpAp = (a, b) => String(a.bloco || '').localeCompare(String(b.bloco || ''), undefined, { numeric: true }) || String(a.unit).localeCompare(String(b.unit), undefined, { numeric: true });

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
const whoName = () => (P && (P.nome || P.email)) || 'Portaria';

function fillTpl(t, p) {
  return t
    .replace(/\{nome\}/g, firstName(p.nome) || 'morador').replace(/\{bloco\}/g, p.bloco || '')
    .replace(/\{apto\}/g, p.unit).replace(/\{unidade\}/g, p.unit)
    .replace(/\{condominio\}/g, S.cfg.condo || 'condomínio').replace(/\{transportadora\}/g, p.carrier)
    .replace(/\{protocolo\}/g, p.code)
    .replace(/bloco\s*,\s*/g, '');
}
// Uma mensagem por morador, listando todas as encomendas dele que estão pendentes
function msgGroup(pkgs, rem) {
  const p0 = pkgs[0], pre = rem ? 'Lembrete: ' : '';
  if (pkgs.length === 1) return pre + fillTpl(S.cfg.tpl || DEFAULT_TPL, p0);
  const list = pkgs.map((p) => p.code + ' (' + p.carrier + ')').join(', ');
  return pre + 'Olá, ' + (firstName(p0.nome) || 'morador') + '! Chegaram ' + pkgs.length + ' encomendas para ' + apText(p0) + ' na portaria do ' + (S.cfg.condo || 'condomínio') + ': ' + list + '. Retire na portaria informando o código de cada uma.';
}
function waLinkFor(pkgs, rem) {
  const d = digits(pkgs[0].tel);
  if (d.length < 10) return '';
  const num = d.indexOf('55') === 0 && d.length >= 12 ? d : '55' + d;
  return 'https://wa.me/' + num + '?text=' + encodeURIComponent(msgGroup(pkgs, rem));
}
// Encomendas pendentes de um apartamento, separadas por telefone (cada morador recebe o seu aviso)
function recipientsOf(pkgs) {
  const m = new Map();
  pkgs.forEach((p) => {
    const d = digits(p.tel), k = d.length >= 10 ? d : 'sem';
    if (!m.has(k)) m.set(k, { tel: k === 'sem' ? '' : p.tel, nome: p.nome, pkgs: [] });
    m.get(k).pkgs.push(p);
  });
  return [...m.values()];
}
function pendingOfRecipient(p) {
  const d = digits(p.tel);
  return pending().filter((x) => apKey(x) === apKey(p) && (d.length >= 10 ? digits(x.tel) === d : digits(x.tel).length < 10)).sort((a, b) => new Date(a.at) - new Date(b.at));
}
function avisoPill(p) {
  if (!p.avisadoEm) return '<span class="pill warn">Não avisado</span>';
  const canal = p.avisoCanal === 'whatsapp' ? 'WhatsApp' : (p.avisoCanal || '');
  return '<span class="pill ok">Avisado ' + fmtDT(p.avisadoEm) + (canal ? ' · ' + esc(canal) : '') + (p.avisadoPor ? ' · ' + esc(p.avisadoPor) : '') + (p.notified > 1 ? ' · ' + p.notified + ' avisos' : '') + '</span>';
}
function toast(t) {
  const e = $('#toast');
  e.innerHTML = '<div class="toast" role="status">' + esc(t) + '</div>';
  setTimeout(() => { e.innerHTML = ''; }, 3600);
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
  if (!S.cfg.blocos || !S.cfg.blocos.length) S.cfg.blocos = DEFAULT_BLOCOS.slice();
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
  const chegaram = S.pkgs.filter((p) => p.status !== 'cancelada' && sameDay(p.at, today)).length;
  const entreg = S.pkgs.filter((p) => p.status === 'entregue' && p.outAt && sameDay(p.outAt, today)).length;
  const semAviso = pend.filter((p) => !p.avisadoEm).length;
  const oldest = pend.length ? Math.floor(Math.max(...pend.map((p) => ageH(p.at))) / 24) : 0;
  $('#tiles').innerHTML =
    '<div class="tile"><b>' + pend.length + '</b><small>Pendentes na portaria</small></div>' +
    '<div class="tile' + (semAviso ? ' alert' : '') + '"><b>' + semAviso + '</b><small>Sem aviso ao morador</small></div>' +
    '<div class="tile"><b>' + chegaram + '</b><small>Chegaram hoje</small></div>' +
    '<div class="tile"><b>' + entreg + '</b><small>Entregues hoje</small></div>' +
    '<div class="tile' + (oldest >= 3 ? ' alert' : '') + '"><b>' + oldest + (oldest === 1 ? ' dia' : ' dias') + '</b><small>Encomenda mais antiga</small></div>';
  $('#banner').innerHTML = S.demo ? '<div class="banner">Dados de exemplo (5 blocos, 160 apartamentos), salvos apenas neste navegador. Em Ajustes você apaga tudo e começa do zero.</div>' : '';
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
const R = { sel: null, prevSel: null, carrier: 'Correios', tipo: 'Caixa', shelf: 'A', lastIds: [], q: '' };
const blocoOptions = (cur) => '<option value="">Bloco</option>' + S.cfg.blocos.map((b) => '<option value="' + esc(b) + '"' + (b === cur ? ' selected' : '') + '>' + esc(b) + '</option>').join('');

function viewRegistrar() {
  let v = '';
  const last = R.lastIds.map(byId).filter(Boolean);
  if (last.length) {
    const p0 = last[0];
    const group = pendingOfRecipient(p0);
    const link = group.length ? waLinkFor(group, group.every((p) => p.avisadoEm)) : '';
    const gids = group.map((p) => p.id).join(',');
    v += '<section class="done-box" aria-live="polite"><div><b>' + (last.length > 1 ? last.length + ' encomendas registradas' : 'Encomenda registrada') + ' para ' + esc(apLabel(p0)) + (p0.nome ? ' · ' + esc(p0.nome) : '') + '</b></div>' +
      '<div class="codes">' + last.map((p) => '<span class="codechip">' + esc(p.code) + '</span>').join('') + '</div>' +
      '<div class="hint" style="margin-top:0">' + (last.length > 1 ? 'Cada volume tem o seu código. Imprima as etiquetas ou escreva o código em cada um' : 'Código de retirada. Imprima a etiqueta ou escreva o código na encomenda') + ' e guarde na prateleira ' + esc(p0.shelf) + '.</div>' +
      (group.length > last.length ? '<p class="hint"><b>Este morador tem ' + group.length + ' encomendas pendentes no total.</b> O aviso abaixo lista todas.</p>' : '') +
      (group.length ? '<p style="margin:12px 0 6px;font-size:14px">' + esc(msgGroup(group, group.every((p) => p.avisadoEm))) + '</p>' : '') +
      '<div style="margin:6px 0 10px">' + avisoPill(p0) + '</div><div class="actions" style="justify-content:flex-start">' +
      (link ? '<a class="btn wa" data-act="wa" data-ids="' + gids + '" data-who="' + esc((p0.nome || 'morador') + ' (' + apLabel(p0) + ')') + '" href="' + esc(link) + '" target="_blank" rel="noopener">Avisar no WhatsApp</a>' : '<span class="pill warn">Morador sem telefone cadastrado</span>') +
      '<button type="button" class="btn" data-act="outroaviso" data-key="' + esc(apKey(p0)) + '">Avisei de outro jeito</button>' +
      '<button type="button" class="btn" data-act="label" data-ids="' + last.map((p) => p.id).join(',') + '">' + (last.length > 1 ? 'Etiquetas com QR' : 'Etiqueta com QR') + '</button>' +
      '<button type="button" class="btn" data-act="copymsg" data-ids="' + gids + '">Copiar mensagem</button>' +
      (R.prevSel ? '<button type="button" class="btn" data-act="again">Registrar outra para este apto</button>' : '') +
      '<button type="button" class="btn primary" data-act="newpkg">Nova encomenda</button></div></section>';
  }
  v += '<section class="panel"><h2>Nova encomenda</h2><label for="q">Morador ou apartamento</label>' +
    '<input id="q" type="search" autocomplete="off" placeholder="Ex.: A1 13, a1-13 ou o nome (ana)" value="' + esc(R.q) + '">' +
    '<div id="matches" class="matches"></div><div id="rform"></div></section>';
  $('#view').innerHTML = v;
  drawMatches(); drawForm();
  if (!R.sel && !last.length) { const q = $('#q'); if (q) q.focus(); }
}
function drawMatches() {
  const box = $('#matches'); if (!box) return;
  if (R.sel) { box.innerHTML = ''; return; }
  const t = tokens(R.q);
  if (!t.length) { box.innerHTML = '<p class="hint">Digite o bloco e o apartamento (A1 13) ou parte do nome. Aceita as duas coisas juntas, como "ana a1".</p>'; return; }
  let list = S.res.filter((r) => { const h = hayRes(r); return t.every((x) => h.indexOf(x) > -1); });
  list.sort(cmpAp);
  const total = list.length; list = list.slice(0, 8);
  let h = list.map((r) => {
    const np = pending().filter((p) => apKey(p) === apKey(r)).length;
    return '<button type="button" class="match" data-act="pick" data-id="' + r.id + '"><span class="unit">' + esc(apLabel(r)) + '</span><span><b>' + esc(r.nome) + '</b>' + (np ? ' <span class="pill warn">' + np + ' pendente' + (np > 1 ? 's' : '') + ' neste apto</span>' : '') + '</span></button>';
  }).join('');
  if (!h) h = '<p class="hint">Ninguém encontrado. Confira a digitação ou cadastre o morador na aba Moradores.</p>';
  if (total > 8) h += '<p class="hint">Mostrando 8 de ' + total + '. Digite mais letras ou o número do apto.</p>';
  h += '<button type="button" class="match" data-act="pickmanual"><span class="unit">+</span><span>Apartamento sem morador cadastrado. Registrar mesmo assim</span></button>';
  box.innerHTML = h;
}
function chipGroup(name, items, cur) {
  return '<div class="chips" role="radiogroup">' + items.map((i) => '<label><input type="radio" name="' + name + '" value="' + esc(i) + '"' + (i === cur ? ' checked' : '') + '><span>' + esc(i) + '</span></label>').join('') + '</div>';
}
function drawForm() {
  const box = $('#rform'); if (!box) return;
  if (!R.sel) { box.innerHTML = ''; return; }
  const s = R.sel;
  const already = s.manual ? [] : pending().filter((p) => apKey(p) === apKey(s));
  let head;
  if (s.manual) {
    head = '<div class="row" style="margin-top:12px"><div style="flex:0 1 120px"><label for="mb">Bloco</label><select id="mb">' + blocoOptions('') + '</select></div>' +
      '<div style="flex:0 1 120px"><label for="mu">Apto</label><input id="mu" type="text" placeholder="13"></div>' +
      '<div><label for="mn">Nome do destinatário (opcional)</label><input id="mn" type="text"></div>' +
      '<div><label for="ptel">Telefone para aviso (opcional)</label><input id="ptel" type="tel" placeholder="(65) 9 0000-0000"></div></div>' +
      '<div><button type="button" class="btn small" data-act="unpick">Cancelar</button></div>';
  } else {
    head = '<div style="display:flex;gap:12px;align-items:center;flex-wrap:wrap;margin-top:12px"><span class="unit">' + esc(apLabel(s)) + '</span><b>' + esc(s.nome) + '</b>' +
      (!s.tel ? '<span class="pill warn">sem telefone</span>' : '') + '<button type="button" class="btn small" data-act="unpick">Trocar</button></div>';
  }
  box.innerHTML = head +
    (already.length ? '<div class="already"><b>Já pendentes neste apartamento (' + already.length + '):</b> ' + already.map((p) => '<span class="code">' + esc(p.code) + '</span> ' + esc(p.carrier) + (p.nome ? ' (' + esc(firstName(p.nome)) + ')' : '')).join(' · ') + '</div>' : '') +
    '<form id="pf" autocomplete="off"><label>Transportadora</label>' + chipGroup('carrier', CARRIERS, R.carrier) +
    '<label>Tipo</label>' + chipGroup('tipo', TIPOS, R.tipo) +
    '<label>Prateleira</label>' + chipGroup('shelf', SHELVES, R.shelf) +
    '<div class="row"><div style="flex:0 1 160px"><label for="vol">Volumes</label><input id="vol" type="number" min="1" max="9" value="1" inputmode="numeric"></div>' +
    '<div><label for="obs">Observação (opcional)</label><input id="obs" type="text" placeholder="Ex.: caixa amassada"></div></div>' +
    '<div id="trackbox"></div>' +
    '<p class="hint" style="margin-top:6px">Mais de uma encomenda? Informe a quantidade: cada uma ganha o seu código de retirada, a sua etiqueta e o seu código de rastreio.</p>' +
    '<div style="margin-top:16px"><button type="submit" class="btn primary" style="min-width:220px">Registrar encomenda</button></div></form>';
  drawTracks();
}
function drawTracks() {
  const box = $('#trackbox'); if (!box) return;
  const n = Math.min(9, Math.max(1, parseInt(($('#vol') || {}).value, 10) || 1));
  const old = [...box.querySelectorAll('input')].map((i) => i.value);
  let h = '<div class="row">';
  for (let i = 0; i < n; i++) h += '<div><label for="track' + i + '">' + (n > 1 ? 'Rastreio da encomenda ' + (i + 1) + ' (opcional)' : 'Código de rastreio (opcional)') + '</label><input id="track' + i + '" class="trk" type="text" value="' + esc(old[i] || '') + '"></div>';
  box.innerHTML = h + '</div>';
}
async function submitPkg(f) {
  const s = R.sel; if (!s) return;
  const val = (sel) => { const e = $('#rform').querySelector(sel); return e ? e.value.trim() : ''; };
  const g = (n) => { const e = f.querySelector('input[name="' + n + '"]:checked'); return e ? e.value : ''; };
  let target;
  if (s.manual) {
    const b = val('#mb'), u = val('#mu');
    if (!b || !u) { toast('Escolha o bloco e informe o número do apartamento.'); return; }
    target = { resId: null, bloco: b, unit: u, nome: val('#mn'), tel: val('#ptel') };
  } else target = { resId: s.id, bloco: s.bloco, unit: s.unit, nome: s.nome, tel: s.tel };
  const n = Math.min(9, Math.max(1, parseInt(val('#vol'), 10) || 1));
  const base = { ...target, carrier: g('carrier') || 'Outros', tipo: g('tipo') || 'Caixa', shelf: g('shelf') || 'A', obs: val('#obs') };
  const tracks = [...f.querySelectorAll('.trk')].map((i) => i.value.trim());
  const btn = f.querySelector('button[type=submit]');
  const saved = [];
  await run(async () => {
    for (let i = 1; i <= n; i++) {
      const obs = n > 1 ? (base.obs ? base.obs + ' · ' : '') + 'Volume ' + i + '/' + n : base.obs;
      saved.push(await backend.addPkg({ ...base, obs, track: tracks[i - 1] || '' }));
    }
  }, btn);
  if (!saved.length) return;
  if (saved.length < n) toast('Só ' + saved.length + ' de ' + n + ' volumes foram registrados. Confira a lista antes de continuar.');
  R.carrier = base.carrier; R.tipo = base.tipo; R.shelf = base.shelf;
  saved.forEach((p) => S.pkgs.push(p));
  R.lastIds = saved.map((p) => p.id); R.prevSel = s.manual ? null : s; R.sel = null; R.q = '';
  render(); window.scrollTo(0, 0);
}

/* ---------------- PENDENTES (agrupadas por apartamento) ---------------- */
const PF = { q: '', age: 0, aviso: '' };
function groupsPending() {
  const m = new Map();
  pending().forEach((p) => {
    const k = apKey(p);
    if (!m.has(k)) m.set(k, { key: k, bloco: p.bloco, unit: p.unit, pkgs: [] });
    m.get(k).pkgs.push(p);
  });
  const arr = [...m.values()];
  arr.forEach((g) => g.pkgs.sort((a, b) => new Date(a.at) - new Date(b.at)));
  arr.sort((a, b) => new Date(a.pkgs[0].at) - new Date(b.pkgs[0].at));
  return arr;
}
const matchPkg = (p, q) => { const t = tokens(q); const h = norm([p.nome, p.bloco, p.unit, p.bloco + p.unit, p.code, p.track, p.carrier].join(' ')); return t.every((x) => h.indexOf(x) > -1); };
function rowHTML(p) {
  return '<div class="prow"><span class="code">' + esc(p.code) + '</span><div class="prow-main"><div><b>' + esc(p.carrier) + '</b> · ' + esc(p.tipo) + ' · prateleira ' + esc(p.shelf) + '</div>' +
    '<div class="meta"><span>Chegou ' + fmtDT(p.at) + ' (há ' + waitLabel(p.at) + ')</span>' + (p.nome ? '<span>Para ' + esc(p.nome) + '</span>' : '') +
    (p.track ? '<span>Rastreio ' + esc(p.track) + '</span>' : '') + (p.obs ? '<span>' + esc(p.obs) + '</span>' : '') + '</div></div>' +
    '<div class="prow-aviso">' + avisoPill(p) + '</div>' +
    '<div class="actions"><button type="button" class="btn primary small" data-act="deliver" data-id="' + p.id + '">Entregar</button>' +
    '<button type="button" class="btn small" data-act="label" data-ids="' + p.id + '">Etiqueta</button>' +
    '<button type="button" class="btn small" data-act="editpkg" data-id="' + p.id + '">Editar</button>' +
    '<button type="button" class="btn small danger" data-act="cancelpkg" data-id="' + p.id + '">Cancelar</button></div></div>';
}
function grpCard(g) {
  const cls = ageClass(g.pkgs[0]);
  const names = [...new Set(g.pkgs.map((p) => p.nome).filter(Boolean))];
  const recs = recipientsOf(g.pkgs);
  const foot = recs.map((r) => {
    if (!r.tel) return '<span class="pill warn">' + (r.nome ? esc(firstName(r.nome)) + ': ' : '') + 'sem telefone cadastrado</span>';
    const allAv = r.pkgs.every((p) => p.avisadoEm);
    const label = (allAv ? 'Avisar de novo' : 'Avisar') + (recs.length > 1 ? ' ' + esc(firstName(r.nome)) : ' no WhatsApp');
    return '<a class="btn wa small" data-act="wa" data-ids="' + r.pkgs.map((p) => p.id).join(',') + '" data-who="' + esc((r.nome || 'morador') + ' (' + apLabel(g) + ')') + '" href="' + esc(waLinkFor(r.pkgs, allAv)) + '" target="_blank" rel="noopener">' + label + '</a>';
  }).join('') +
    '<button type="button" class="btn small" data-act="outroaviso" data-key="' + esc(g.key) + '">Avisei de outro jeito</button>' +
    (g.pkgs.length > 1 ? '<button type="button" class="btn primary small" data-act="deliverall" data-key="' + esc(g.key) + '">Entregar todas (' + g.pkgs.length + ')</button>' : '');
  return '<article class="grp ' + cls + '"><header class="grp-h"><span class="unit">' + esc(apLabel(g)) + '</span>' +
    '<div class="grp-name"><b>' + (names.length ? names.map(esc).join(' · ') : 'Apto sem cadastro') + '</b><span class="grp-sub">' + esc(apText(g)) + '</span></div>' +
    '<span class="pill' + (cls ? ' ' + cls : '') + '">' + g.pkgs.length + (g.pkgs.length === 1 ? ' encomenda' : ' encomendas') + ' · a mais antiga há ' + waitLabel(g.pkgs[0].at) + '</span></header>' +
    '<div class="grp-rows">' + g.pkgs.map(rowHTML).join('') + '</div><footer class="grp-f">' + foot + '</footer></article>';
}
function viewPendentes() {
  $('#view').innerHTML = '<section class="panel"><h2>Pendentes por apartamento</h2><div class="row"><div style="flex:2 1 260px"><label for="pq">Buscar por nome, bloco, apto, código ou rastreio</label>' +
    '<input id="pq" type="search" autocomplete="off" value="' + esc(PF.q) + '" placeholder="Ex.: A1 13, ana, K7M2 (ou passe o leitor de QR)"></div>' +
    '<div><label>Tempo na portaria</label><div class="chips">' + [[0, 'Todas'], [3, '3+ dias'], [7, '7+ dias']].map((a) => '<label><input type="radio" name="age" value="' + a[0] + '"' + (PF.age === a[0] ? ' checked' : '') + '><span>' + a[1] + '</span></label>').join('') + '</div></div>' +
    '<div><label>Aviso</label><div class="chips">' + [['', 'Todos'], ['sem', 'Sem aviso']].map((a) => '<label><input type="radio" name="avs" value="' + a[0] + '"' + (PF.aviso === a[0] ? ' checked' : '') + '><span>' + a[1] + '</span></label>').join('') + '</div></div></div></section><div id="plist" class="list"></div>';
  drawPend();
}
function drawPend() {
  const b = $('#plist'); if (!b) return;
  const l = groupsPending().filter((g) =>
    (!PF.q || g.pkgs.some((p) => matchPkg(p, PF.q))) &&
    ageH(g.pkgs[0].at) / 24 >= PF.age &&
    (PF.aviso !== 'sem' || g.pkgs.some((p) => !p.avisadoEm)));
  b.innerHTML = l.length ? l.map(grpCard).join('') : '<div class="panel empty">Nenhuma encomenda pendente com esse filtro.</div>';
}

/* ---------------- HISTÓRICO ---------------- */
const HF = { q: '', st: 'todas', confirm: null };
function pkgCard(p) {
  const canc = p.status === 'cancelada';
  const cls = canc ? '' : p.status === 'entregue' ? 'done' : ageClass(p);
  const pill = canc ? '<span class="pill bad">Cancelada</span>' : p.status === 'entregue' ? '<span class="pill ok">Entregue após ' + waitLabel(p.at, p.outAt) + '</span>' : '<span class="pill' + (cls ? ' ' + cls : '') + '">há ' + waitLabel(p.at) + '</span>';
  return '<article class="pkg ' + cls + '"><span class="unit">' + esc(apLabel(p)) + '</span><div><div class="who">' + esc(p.nome || 'Apto sem cadastro') + ' <span class="code">' + esc(p.code) + '</span> ' + pill + '</div>' +
    '<div class="meta"><span>' + esc(p.carrier) + ' · ' + esc(p.tipo) + '</span><span>Prateleira ' + esc(p.shelf) + '</span><span>Chegou ' + fmtDT(p.at) + '</span>' +
    (p.track ? '<span>Rastreio ' + esc(p.track) + '</span>' : '') + (p.obs ? '<span>' + esc(p.obs) + '</span>' : '') +
    (p.status === 'entregue' ? '<span>Retirada ' + fmtDT(p.outAt) + ' por ' + esc(p.outBy || '') + '</span>' : '') + (canc ? '<span>Cancelada ' + fmtDT(p.cancelEm) + ' por ' + esc(p.cancelPor || '') + (p.cancelMotivo ? ' · ' + esc(p.cancelMotivo) : '') + '</span>' : '<span>' + avisoPill(p) + '</span>') + '</div></div>' +
    '<div class="actions">' + (p.status === 'entregue' ? '<button type="button" class="btn small" data-act="undo" data-id="' + p.id + '">Desfazer entrega</button>' : '') +
    (isSindico() ? '<button type="button" class="btn small danger" data-act="delpkg" data-id="' + p.id + '">' + (HF.confirm === p.id ? 'Confirmar exclusão' : 'Excluir') + '</button>' : '') + '</div></article>';
}
function viewHistorico() {
  $('#view').innerHTML = '<section class="panel"><h2>Histórico</h2><div class="row"><div style="flex:2 1 260px"><label for="hq">Buscar</label><input id="hq" type="search" autocomplete="off" value="' + esc(HF.q) + '" placeholder="Nome, bloco, apto, código ou rastreio"></div>' +
    '<div><label for="hs">Situação</label><select id="hs">' + [['todas', 'Todas'], ['entregue', 'Entregues'], ['pendente', 'Pendentes'], ['cancelada', 'Canceladas']].map((o) => '<option value="' + o[0] + '"' + (HF.st === o[0] ? ' selected' : '') + '>' + o[1] + '</option>').join('') + '</select></div></div>' +
    '<p class="hint">Mostra os últimos 90 dias.</p></section><div id="hlist" class="list"></div>';
  drawHist();
}
function drawHist() {
  const b = $('#hlist'); if (!b) return;
  let l = S.pkgs.filter((p) => (HF.st === 'todas' || p.status === HF.st) && (!HF.q || matchPkg(p, HF.q)));
  l.sort((a, b2) => new Date(b2.at) - new Date(a.at));
  const tot = l.length; l = l.slice(0, 60);
  b.innerHTML = (l.length ? l.map(pkgCard).join('') : '<div class="panel empty">Nada encontrado.</div>') + (tot > 60 ? '<p class="hint">Mostrando 60 de ' + tot + '. Use a busca para refinar.</p>' : '');
}

/* ---------------- MORADORES ---------------- */
const MF = { q: '', confirm: null };
function viewMoradores() {
  $('#view').innerHTML = '<section class="panel"><h2>Novo morador</h2><form id="rf" autocomplete="off"><div class="row"><div><label for="rn">Nome</label><input id="rn" type="text" required></div>' +
    '<div style="flex:0 1 120px"><label for="rbl">Bloco</label><select id="rbl" required>' + blocoOptions('') + '</select></div>' +
    '<div style="flex:0 1 120px"><label for="ru">Apto</label><input id="ru" type="text" required placeholder="13"></div>' +
    '<div><label for="rt">Telefone (WhatsApp)</label><input id="rt" type="tel" placeholder="(65) 9 0000-0000"></div></div>' +
    '<div style="margin-top:14px"><button class="btn primary" type="submit">Cadastrar</button></div></form></section>' +
    '<section class="panel"><h2>Importar lista</h2><p class="hint" style="margin-top:0">Uma linha por morador, no formato nome;bloco;apto;telefone. O bloco precisa ser um dos cadastrados em Ajustes (' + esc(S.cfg.blocos.join(', ')) + '). Dá para copiar de uma planilha com quatro colunas.</p>' +
    '<textarea id="imp" aria-label="Lista de moradores" placeholder="Maria Souza;A1;13;65999990000"></textarea><div style="margin-top:10px"><button type="button" class="btn" data-act="import">Importar</button></div></section>' +
    '<section class="panel"><h2>Moradores cadastrados <span class="pill" id="mcount"></span></h2><label for="mq">Buscar</label><input id="mq" type="search" autocomplete="off" value="' + esc(MF.q) + '" placeholder="Nome, bloco ou apto"><div class="tw" id="mlist" style="margin-top:10px"></div></section>';
  drawMor();
}
function drawMor() {
  const b = $('#mlist'); if (!b) return;
  const t = tokens(MF.q);
  let l = S.res.filter((r) => { const h = hayRes(r); return t.every((x) => h.indexOf(x) > -1); });
  l.sort(cmpAp);
  $('#mcount').textContent = S.res.length;
  const tot = l.length; l = l.slice(0, 60);
  b.innerHTML = l.length ? '<table><thead><tr><th>Apto</th><th>Nome</th><th>Telefone</th><th></th></tr></thead><tbody>' + l.map((r) =>
    '<tr><td><span class="unit">' + esc(apLabel(r)) + '</span></td><td>' + esc(r.nome) + '</td><td>' + esc(r.tel || '—') + '</td><td style="text-align:right">' +
    (isSindico() ? '<button type="button" class="btn small danger" data-act="delres" data-id="' + r.id + '">' + (MF.confirm === r.id ? 'Confirmar exclusão' : 'Excluir') + '</button>' : '') + '</td></tr>').join('') +
    '</tbody></table>' + (tot > 60 ? '<p class="hint">Mostrando 60 de ' + tot + '. Refine a busca.</p>' : '') : '<div class="empty">Nenhum morador encontrado.</div>';
}

/* ---------------- RELATÓRIO ---------------- */
function csv() {
  const q = (s) => '"' + String(s == null ? '' : s).replace(/"/g, '""') + '"';
  const rows = [['protocolo', 'bloco', 'apto', 'morador', 'transportadora', 'tipo', 'rastreio', 'prateleira', 'chegada', 'situacao', 'retirada', 'retirado_por', 'avisado_em', 'avisado_por', 'canal_aviso', 'qtd_avisos']];
  S.pkgs.slice().sort((a, b) => new Date(a.at) - new Date(b.at)).forEach((p) => rows.push([p.code, p.bloco, p.unit, p.nome, p.carrier, p.tipo, p.track, p.shelf, p.at, p.status, p.outAt || '', p.outBy || '', p.avisadoEm || '', p.avisadoPor || '', p.avisoCanal || '', p.notified || 0]));
  return rows.map((r) => r.map(q).join(';')).join('\n');
}
function bars(map, color) {
  const keys = Object.keys(map).sort((a, b) => map[b] - map[a]), max = keys.length ? map[keys[0]] : 1;
  return keys.length ? keys.map((k) => '<div class="bar"><span>' + esc(k) + '</span><i style="width:' + Math.max(3, map[k] / max * 100) + '%' + (color ? ';background:' + color : '') + '"></i><span class="n">' + map[k] + '</span></div>').join('') : '<p class="hint">Sem dados no período.</p>';
}
function viewRelatorio() {
  const since = Date.now() - 30 * 864e5;
  const rec = S.pkgs.filter((p) => p.status !== 'cancelada' && new Date(p.at).getTime() >= since);
  const ent = S.pkgs.filter((p) => p.status === 'entregue' && p.outAt && new Date(p.outAt).getTime() >= since);
  const avg = ent.length ? ent.reduce((a, p) => a + (new Date(p.outAt) - new Date(p.at)) / 36e5, 0) / ent.length : 0;
  const avgTxt = !ent.length ? '—' : avg < 24 ? avg.toFixed(1).replace('.', ',') + ' h' : (avg / 24).toFixed(1).replace('.', ',') + ' dias';
  const by = {}, bb = {};
  rec.forEach((p) => { by[p.carrier] = (by[p.carrier] || 0) + 1; const b = p.bloco || 'Sem bloco'; bb[b] = (bb[b] || 0) + 1; });
  const b = [0, 0, 0, 0];
  pending().forEach((p) => { const d = ageH(p.at) / 24; b[d < 1 ? 0 : d < 3 ? 1 : d < 7 ? 2 : 3]++; });
  const bl = [['Hoje', b[0]], ['1 a 2 dias', b[1]], ['3 a 6 dias', b[2]], ['7 dias ou mais', b[3]]], bmax = Math.max(...b, 1);
  const perDay = (rec.length / 30).toFixed(1).replace('.', ',');
  $('#view').innerHTML = '<section class="panel"><h2>Últimos 30 dias</h2><div class="tiles" style="margin:0 0 8px">' +
    '<div class="tile"><b>' + rec.length + '</b><small>Encomendas recebidas</small></div><div class="tile"><b>' + perDay + '</b><small>Média por dia</small></div>' +
    '<div class="tile"><b>' + ent.length + '</b><small>Entregues</small></div><div class="tile"><b>' + avgTxt + '</b><small>Tempo médio até a retirada</small></div></div>' +
    '<h3>Por transportadora</h3>' + bars(by) + '<h3>Por bloco</h3>' + bars(bb) + '</section>' +
    '<section class="panel"><h2>Pendentes por tempo de espera</h2>' + bl.map((x, i) => '<div class="bar"><span>' + x[0] + '</span><i style="width:' + Math.max(x[1] ? 3 : 0, x[1] / bmax * 100) + '%;' + (i === 3 ? 'background:var(--bad)' : i === 2 ? 'background:var(--warn)' : '') + '"></i><span class="n">' + x[1] + '</span></div>').join('') + '</section>' +
    '<section class="panel"><h2>Exportar</h2><p class="hint" style="margin-top:0">Copie e cole numa planilha (separador ponto e vírgula). Inclui quando, por quem e por qual canal cada aviso foi registrado.</p><button type="button" class="btn" data-act="copycsv">Copiar tudo em CSV</button></section>';
}

/* ---------------- AJUSTES ---------------- */
const AF = { demoC: false, wipeC: false };
async function viewAjustes() {
  let v = '<section class="panel"><h2>Condomínio e mensagem de aviso</h2><form id="cf"><label for="cn">Nome do condomínio</label><input id="cn" type="text" value="' + esc(S.cfg.condo) + '">' +
    '<label for="cb">Blocos (separados por vírgula)</label><input id="cb" type="text" value="' + esc(S.cfg.blocos.join(', ')) + '" placeholder="A1, A2, A3, A4, A5">' +
    '<p class="hint">Cada apartamento é identificado por bloco e número. Se um bloco for retirado da lista, os moradores já cadastrados nele continuam funcionando.</p>' +
    '<label for="ct">Texto do aviso no WhatsApp (uma encomenda)</label><textarea id="ct">' + esc(S.cfg.tpl) + '</textarea>' +
    '<p class="hint">Campos: {nome} {bloco} {apto} {condominio} {transportadora} {protocolo}. Quando o morador tem várias encomendas pendentes, o sistema envia uma única mensagem listando todos os códigos.</p>' +
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

/* ---------------- etiquetas com QR ---------------- */
function labelHTML(p) {
  return '<div class="label"><div class="label-top"><span class="label-unit">' + esc(apLabel(p)) + '</span><span>' + esc(S.cfg.condo || '') + '</span></div>' +
    '<div class="label-name">' + esc(p.nome || 'Sem cadastro') + '</div><div class="label-sub">' + esc(apText(p)) + '</div>' +
    '<div class="label-mid"><div class="qr">' + qrSvg(p.code) + '</div><div><div class="label-code">' + esc(p.code) + '</div><div class="label-meta">' + esc(p.carrier) + ' · prateleira ' + esc(p.shelf) + '<br>Chegou ' + fmtDT(p.at) + (p.obs ? '<br>' + esc(p.obs) : '') + '</div></div></div></div>';
}
function openLabel(ids) {
  const list = ids.map(byId).filter(Boolean); if (!list.length) return;
  $('#overlay').innerHTML = '<div class="overlay" data-act="closeov"><div class="modal" role="dialog" aria-modal="true" aria-label="Etiquetas">' +
    list.map(labelHTML).join('') +
    '<div class="row noprint" style="margin-top:14px"><span style="flex:1 1 0"></span><button type="button" class="btn" data-act="closeov" style="flex:0 0 auto">Fechar</button><button type="button" class="btn primary" data-act="printlabel" style="flex:0 0 auto">Imprimir</button></div></div></div>';
}

/* ---------------- confirmação de aviso ---------------- */
function openConfirmAviso(ids, who) {
  $('#overlay').innerHTML = '<div class="overlay" data-act="closeov"><div class="modal" role="dialog" aria-modal="true" aria-label="Confirmar aviso">' +
    '<h2 style="font-size:20px;margin-bottom:8px">O aviso foi enviado?</h2>' +
    '<p style="margin:0 0 6px">O WhatsApp abriu com a mensagem pronta para <b>' + esc(who) + '</b>. O sistema só consegue registrar o aviso depois que você confirmar aqui.</p>' +
    '<p class="hint" style="margin-top:0">Toque em "Sim, enviei" somente depois de apertar enviar no WhatsApp.</p>' +
    '<div class="row" style="margin-top:14px"><span style="flex:1 1 0"></span><button type="button" class="btn" data-act="closeov" style="flex:0 0 auto">Ainda não enviei</button>' +
    '<button type="button" class="btn primary" data-act="avisook" data-ids="' + esc(ids.join(',')) + '" data-canal="whatsapp" style="flex:0 0 auto">Sim, enviei</button></div></div></div>';
}
function openOutroAviso(key) {
  const pk = pending().filter((p) => apKey(p) === key); if (!pk.length) return;
  $('#overlay').innerHTML = '<div class="overlay" data-act="closeov"><div class="modal" role="dialog" aria-modal="true" aria-label="Avisar de outro jeito">' +
    '<h2 style="font-size:20px;margin-bottom:8px">Avisei ' + esc(apLabel(pk[0])) + ' de outro jeito</h2>' +
    '<p style="margin:0">Registra que o morador foi avisado das ' + pk.length + (pk.length === 1 ? ' encomenda' : ' encomendas') + ' deste apartamento.</p>' +
    '<label>Como foi o aviso</label><div class="chips">' + CANAIS.map((c, i) => '<label><input type="radio" name="canal" value="' + c + '"' + (i === 0 ? ' checked' : '') + '><span>' + c + '</span></label>').join('') + '</div>' +
    '<div class="row" style="margin-top:14px"><span style="flex:1 1 0"></span><button type="button" class="btn" data-act="closeov" style="flex:0 0 auto">Cancelar</button>' +
    '<button type="button" class="btn primary" data-act="outrook" data-ids="' + esc(pk.map((p) => p.id).join(',')) + '" style="flex:0 0 auto">Registrar aviso</button></div></div></div>';
}
async function registrarAviso(ids, canal, btn) {
  const pk = ids.map(byId).filter(Boolean); if (!pk.length) return;
  const por = whoName();
  const t = await run(() => backend.markAvisado(pk.map((p) => ({ id: p.id, avisos: p.notified || 0 })), { por, canal }), btn);
  if (!t) return;
  pk.forEach((p) => { p.notified = (p.notified || 0) + 1; p.avisadoEm = t; p.avisadoPor = por; p.avisoCanal = canal; });
  $('#overlay').innerHTML = '';
  toast('Aviso registrado: ' + (pk[0].nome || apLabel(pk[0])) + ' · ' + (canal === 'whatsapp' ? 'WhatsApp' : canal));
  render();
}

/* ---------------- entrega (uma ou várias) com assinatura ---------------- */
let drawn = false, deliverNames = [];
function openDeliver(ids) {
  const pk = ids.map(byId).filter((p) => p && p.status === 'pendente'); if (!pk.length) return;
  drawn = false;
  deliverNames = [...new Set(pk.map((p) => p.nome).filter(Boolean))];
  const whoOpts = (deliverNames.length ? deliverNames : ['O morador']).map((n, i) => '<label><input type="radio" name="who" value="n' + i + '"' + (i === 0 ? ' checked' : '') + '><span>' + esc(n) + '</span></label>').join('') +
    '<label><input type="radio" name="who" value="out"><span>Outra pessoa</span></label>';
  const list = pk.length > 1
    ? '<label>Encomendas a entregar</label><div class="checks">' + pk.map((p) => '<label class="chk"><input type="checkbox" name="pk" value="' + p.id + '" checked><span><span class="code">' + esc(p.code) + '</span> ' + esc(p.carrier) + ' · ' + esc(p.tipo) + ' · prateleira ' + esc(p.shelf) + '</span></label>').join('') + '</div>'
    : '<div style="color:var(--muted);margin-top:4px"><span class="code">' + esc(pk[0].code) + '</span> · ' + esc(pk[0].carrier) + ' · ' + esc(pk[0].tipo) + ' · prateleira ' + esc(pk[0].shelf) + '</div>';
  $('#overlay').innerHTML = '<div class="overlay" data-act="closeov"><div class="modal" role="dialog" aria-modal="true" aria-label="Entregar" data-ids="' + esc(pk.map((p) => p.id).join(',')) + '">' +
    '<h2 style="font-size:20px;margin-bottom:4px">Entregar ' + (pk.length > 1 ? 'encomendas' : 'encomenda') + ' · ' + esc(apLabel(pk[0])) + '</h2>' + list +
    '<label>Quem está retirando</label><div class="chips">' + whoOpts + '</div>' +
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
  const hasList = !!m.querySelector('input[name=pk]');
  const ids = hasList ? [...m.querySelectorAll('input[name=pk]:checked')].map((x) => x.value) : m.getAttribute('data-ids').split(',');
  if (!ids.length) { toast('Marque pelo menos uma encomenda.'); return; }
  const who = $('#overlay input[name=who]:checked').value, other = $('#other').value.trim();
  if (who === 'out' && !other) { toast('Informe o nome de quem retirou'); $('#other').focus(); return; }
  const outBy = who === 'out' ? other + ' (autorizado)' : (deliverNames[parseInt(who.slice(1), 10)] || 'Morador');
  let sig = null;
  if (drawn) { try { sig = $('#sig').toDataURL('image/png'); } catch (e) {} }
  const n = await run(() => backend.deliverMany(ids, { outBy, sig }), btn);
  if (!n) { softRefresh(); return; }
  const now = new Date().toISOString();
  ids.forEach((id) => { const p = byId(id); if (p) { p.status = 'entregue'; p.outAt = now; p.outBy = outBy; } });
  $('#overlay').innerHTML = '';
  toast(n + (n === 1 ? ' encomenda entregue' : ' encomendas entregues'));
  render();
}


/* ---------------- editar / cancelar / excluir encomenda ---------------- */
function openEdit(id) {
  const p = byId(id); if (!p || p.status !== 'pendente') return;
  const blocos = S.cfg.blocos.indexOf(p.bloco) > -1 || !p.bloco ? S.cfg.blocos : S.cfg.blocos.concat([p.bloco]);
  const opts = '<option value="">Bloco</option>' + blocos.map((b) => '<option value="' + esc(b) + '"' + (b === p.bloco ? ' selected' : '') + '>' + esc(b) + '</option>').join('');
  $('#overlay').innerHTML = '<div class="overlay" data-act="closeov"><div class="modal" role="dialog" aria-modal="true" aria-label="Editar encomenda" data-id="' + esc(p.id) + '">' +
    '<h2 style="font-size:20px;margin-bottom:4px">Editar encomenda <span class="code">' + esc(p.code) + '</span></h2>' +
    '<p class="hint" style="margin-top:0">O código de retirada não muda, então a etiqueta já impressa continua valendo.</p>' +
    '<label for="eq">Trocar o morador (busque por nome ou apto)</label><input id="eq" type="search" autocomplete="off" placeholder="Ex.: A2 21 ou nome">' +
    '<div id="ematches" class="matches"></div>' +
    '<div class="row"><div style="flex:0 1 120px"><label for="eb">Bloco</label><select id="eb">' + opts + '</select></div>' +
    '<div style="flex:0 1 120px"><label for="eu">Apto</label><input id="eu" type="text" value="' + esc(p.unit) + '"></div>' +
    '<div><label for="en">Nome</label><input id="en" type="text" value="' + esc(p.nome) + '"></div>' +
    '<div><label for="et">Telefone</label><input id="et" type="tel" value="' + esc(p.tel) + '"></div></div>' +
    '<label>Transportadora</label>' + chipGroup('ecarrier', CARRIERS, p.carrier) + '<label>Tipo</label>' + chipGroup('etipo', TIPOS, p.tipo) + '<label>Prateleira</label>' + chipGroup('eshelf', SHELVES, p.shelf) +
    '<div class="row"><div><label for="etrack">Rastreio</label><input id="etrack" type="text" value="' + esc(p.track) + '"></div><div><label for="eobs">Observação</label><input id="eobs" type="text" value="' + esc(p.obs) + '"></div></div>' +
    '<div class="row" style="margin-top:14px"><span style="flex:1 1 0"></span><button type="button" class="btn" data-act="closeov" style="flex:0 0 auto">Cancelar</button><button type="button" class="btn primary" data-act="saveedit" style="flex:0 0 auto">Salvar alterações</button></div></div></div>';
}
let editResId = undefined;
function drawEditMatches() {
  const box = $('#ematches'); if (!box) return;
  const t = tokens(($('#eq') || {}).value);
  if (!t.length) { box.innerHTML = ''; return; }
  const list = S.res.filter((r) => { const h = hayRes(r); return t.every((x) => h.indexOf(x) > -1); }).sort(cmpAp).slice(0, 5);
  box.innerHTML = list.map((r) => '<button type="button" class="match" data-act="epick" data-id="' + r.id + '"><span class="unit">' + esc(apLabel(r)) + '</span><span><b>' + esc(r.nome) + '</b></span></button>').join('') || '<p class="hint">Ninguém encontrado. Você pode digitar bloco, apto e nome abaixo.</p>';
}
async function saveEdit(btn) {
  const m = $('#overlay .modal'); if (!m) return;
  const p = byId(m.getAttribute('data-id')); if (!p) return;
  const v = (i) => $(i).value.trim(), g = (n) => { const e = m.querySelector('input[name="' + n + '"]:checked'); return e ? e.value : ''; };
  const bloco = v('#eb'), unit = v('#eu');
  if (!bloco || !unit) { toast('Informe o bloco e o apartamento.'); return; }
  const fields = {
    resId: editResId !== undefined ? editResId : p.resId, bloco, unit, nome: v('#en'), tel: v('#et'),
    carrier: g('ecarrier') || p.carrier, tipo: g('etipo') || p.tipo, shelf: g('eshelf') || p.shelf, track: v('#etrack'), obs: v('#eobs'),
  };
  const aptoMudou = apKey(fields) !== apKey(p);
  if (aptoMudou && editResId === undefined) fields.resId = null;
  const telMudou = digits(fields.tel) !== digits(p.tel);
  const resetAviso = !!p.avisadoEm && (aptoMudou || telMudou);
  if (await run(async () => { await backend.updatePkg(p.id, { fields, resetAviso }); return true; }, btn)) {
    Object.assign(p, fields);
    if (resetAviso) { p.notified = 0; p.avisadoEm = undefined; p.avisadoPor = undefined; p.avisoCanal = undefined; }
    editResId = undefined;
    $('#overlay').innerHTML = '';
    toast('Encomenda corrigida' + (resetAviso ? '. Como o destinatário mudou, o aviso foi zerado.' : ''));
    render();
  }
}
function openCancel(id) {
  const p = byId(id); if (!p || p.status !== 'pendente') return;
  $('#overlay').innerHTML = '<div class="overlay" data-act="closeov"><div class="modal" role="dialog" aria-modal="true" aria-label="Cancelar registro" data-id="' + esc(p.id) + '">' +
    '<h2 style="font-size:20px;margin-bottom:4px">Cancelar o registro ' + esc(p.code) + '?</h2>' +
    '<p style="margin:0">' + esc(apLabel(p)) + ' · ' + esc(p.nome || 'sem cadastro') + ' · ' + esc(p.carrier) + '. A encomenda sai de Pendentes e fica no Histórico como cancelada.</p>' +
    '<label>Motivo</label><div class="chips">' + ['Apartamento errado', 'Registrada em duplicidade', 'Volume a mais', 'Outro'].map((c, i) => '<label><input type="radio" name="motivo" value="' + c + '"' + (i === 0 ? ' checked' : '') + '><span>' + c + '</span></label>').join('') + '</div>' +
    '<div class="row" style="margin-top:14px"><span style="flex:1 1 0"></span><button type="button" class="btn" data-act="closeov" style="flex:0 0 auto">Voltar</button><button type="button" class="btn danger" data-act="confirmcancel" style="flex:0 0 auto">Cancelar registro</button></div></div></div>';
}
async function confirmCancel(btn) {
  const m = $('#overlay .modal'); if (!m) return;
  const p = byId(m.getAttribute('data-id')); if (!p) return;
  const c = m.querySelector('input[name=motivo]:checked'), motivo = c ? c.value : '', por = whoName();
  if (await run(async () => { await backend.cancelPkg(p.id, { por, motivo }); return true; }, btn)) {
    p.status = 'cancelada'; p.cancelEm = new Date().toISOString(); p.cancelPor = por; p.cancelMotivo = motivo;
    $('#overlay').innerHTML = '';
    toast('Registro cancelado');
    render();
  } else softRefresh();
}

/* ---------------- render e eventos ---------------- */
function render() {
  renderChrome();
  ({ registrar: viewRegistrar, pendentes: viewPendentes, historico: viewHistorico, moradores: viewMoradores, relatorio: viewRelatorio, ajustes: viewAjustes })[tab]();
}
const idsOf = (el) => String(el.getAttribute('data-ids') || '').split(',').filter(Boolean);

document.addEventListener('click', async (e) => {
  const el = e.target.closest('[data-act]'); if (!el) return;
  const a = el.getAttribute('data-act'), id = el.getAttribute('data-id');
  if (a === 'closeov') { if (el.classList.contains('overlay') && e.target !== el) return; $('#overlay').innerHTML = ''; return; }
  if (a === 'tab') { setTab(el.getAttribute('data-tab')); return; }
  if (a === 'logout') { await run(() => backend.signOut()); P = null; showLogin(); return; }
  if (a === 'pick') { const r = S.res.find((x) => x.id === id); if (r) { R.sel = r; R.lastIds = []; R.prevSel = null; viewRegistrar(); const t = $('#track0'); if (t) t.focus(); } return; }
  if (a === 'pickmanual') { R.sel = { manual: true }; R.lastIds = []; R.prevSel = null; viewRegistrar(); const m = $('#mb'); if (m) m.focus(); return; }
  if (a === 'unpick') { R.sel = null; viewRegistrar(); return; }
  if (a === 'newpkg') { R.lastIds = []; R.sel = null; R.prevSel = null; R.q = ''; viewRegistrar(); return; }
  if (a === 'again') { R.sel = R.prevSel; R.lastIds = []; viewRegistrar(); const t = $('#track0'); if (t) t.focus(); return; }
  if (a === 'wa') {
    const ids = idsOf(el), who = el.getAttribute('data-who') || 'o morador';
    setTimeout(() => openConfirmAviso(ids, who), 600); // o link abre o WhatsApp; a confirmação espera aqui
    return;
  }
  if (a === 'avisook') { registrarAviso(idsOf(el), el.getAttribute('data-canal') || 'whatsapp', el); return; }
  if (a === 'outroaviso') { openOutroAviso(el.getAttribute('data-key')); return; }
  if (a === 'outrook') { const c = $('#overlay input[name=canal]:checked'); registrarAviso(idsOf(el), c ? c.value : 'Outro', el); return; }
  if (a === 'copymsg') { const pk = idsOf(el).map(byId).filter(Boolean); if (pk.length) copy(msgGroup(pk, pk.every((p) => p.avisadoEm)), 'Mensagem copiada'); return; }
  if (a === 'label') { openLabel(idsOf(el)); return; }
  if (a === 'printlabel') { try { window.print(); } catch (x) { toast('Não foi possível abrir a impressão.'); } return; }
  if (a === 'editpkg') { editResId = undefined; openEdit(id); return; }
  if (a === 'epick') { const r = S.res.find((x) => x.id === id); if (r) { editResId = r.id; $('#eb').value = r.bloco; $('#eu').value = r.unit; $('#en').value = r.nome; $('#et').value = r.tel || ''; $('#eq').value = ''; $('#ematches').innerHTML = ''; } return; }
  if (a === 'saveedit') { saveEdit(el); return; }
  if (a === 'cancelpkg') { openCancel(id); return; }
  if (a === 'confirmcancel') { confirmCancel(el); return; }
  if (a === 'delpkg') {
    if (HF.confirm === id) { if (await run(async () => { await backend.deletePkg(id); return true; })) { HF.confirm = null; S.pkgs = S.pkgs.filter((x) => x.id !== id); toast('Registro excluído'); render(); } }
    else { HF.confirm = id; drawHist(); }
    return;
  }
  if (a === 'deliver') { openDeliver([id]); return; }
  if (a === 'deliverall') { openDeliver(pending().filter((p) => apKey(p) === el.getAttribute('data-key')).sort((x, y) => new Date(x.at) - new Date(y.at)).map((p) => p.id)); return; }
  if (a === 'sigclear') { const c = $('#sig'); if (c) { c.getContext('2d').clearRect(0, 0, c.width, c.height); drawn = false; } return; }
  if (a === 'confirmdeliver') { confirmDeliver(el); return; }
  if (a === 'undo') { if (await run(async () => { await backend.undo(id); return true; })) { await softRefresh(); toast('Entrega desfeita'); } return; }
  if (a === 'delres') {
    if (MF.confirm === id) { if (await run(async () => { await backend.delRes(id); return true; })) { MF.confirm = null; await refresh(); toast('Morador excluído'); render(); } }
    else { MF.confirm = id; drawMor(); }
    return;
  }
  if (a === 'import') {
    const bmap = new Map(S.cfg.blocos.map((b) => [norm(b), b]));
    let bad = 0;
    const list = [];
    $('#imp').value.split(/\n/).map((s) => s.trim()).filter(Boolean).forEach((l) => {
      const c = l.split(/[;\t]/).map((s) => s.trim());
      const bloco = bmap.get(norm(c[1]));
      if (c.length >= 4 && c[0] && c[2] && bloco) list.push({ nome: c[0], bloco, unit: c[2], tel: c[3] || '' }); else bad++;
    });
    if (!list.length) { toast('Nenhuma linha válida. Use nome;bloco;apto;telefone, com um bloco cadastrado.'); return; }
    if (await run(async () => { await backend.addManyRes(list); return true; }, el)) {
      await refresh();
      toast(list.length + ' morador' + (list.length === 1 ? '' : 'es') + ' importado' + (list.length === 1 ? '' : 's') + (bad ? '. ' + bad + ' linha' + (bad === 1 ? '' : 's') + ' ignorada' + (bad === 1 ? '' : 's') + ' (bloco inválido ou campos faltando)' : ''));
      render();
    }
    return;
  }
  if (a === 'copycsv') { copy(csv(), 'CSV copiado'); return; }
  if (a === 'tplreset') { if (await run(async () => { await backend.saveCfg({ ...S.cfg, tpl: DEFAULT_TPL }); return true; })) { await refresh(); render(); } return; }
  if (a === 'backup') { copy(backend.exportJson(), 'Backup copiado'); return; }
  if (a === 'restore') { if (await run(async () => { await backend.importJson($('#rb').value); return true; })) { await refresh(); toast('Backup restaurado'); render(); } return; }
  if (a === 'demo') { if (AF.demoC) { AF.demoC = false; await backend.resetDemo(); await refresh(); toast('Dados de exemplo carregados'); render(); } else { AF.demoC = true; viewAjustes(); } return; }
  if (a === 'wipe') { if (AF.wipeC) { AF.wipeC = false; await backend.wipe(); await refresh(); R.sel = null; R.lastIds = []; toast('Tudo apagado'); render(); } else { AF.wipeC = true; viewAjustes(); } return; }
});
document.addEventListener('input', (e) => {
  const t = e.target;
  if (t.id === 'q') { R.q = t.value; drawMatches(); }
  else if (t.id === 'vol') drawTracks();
  else if (t.id === 'eq') drawEditMatches();
  else if (t.id === 'pq') { PF.q = t.value; drawPend(); }
  else if (t.id === 'hq') { HF.q = t.value; drawHist(); }
  else if (t.id === 'mq') { MF.q = t.value; MF.confirm = null; drawMor(); }
});
document.addEventListener('change', async (e) => {
  const t = e.target;
  if (t.name === 'age') { PF.age = parseInt(t.value, 10) || 0; drawPend(); }
  else if (t.name === 'avs') { PF.aviso = t.value; drawPend(); }
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
    const n = $('#rn').value.trim(), b = $('#rbl').value, u = $('#ru').value.trim();
    if (!n || !u) return;
    if (!b) { toast('Escolha o bloco do morador.'); return; }
    if (await run(async () => { await backend.addRes({ nome: n, bloco: b, unit: u, tel: $('#rt').value.trim() }); return true; }, btn)) { await refresh(); toast('Morador cadastrado'); render(); }
  } else if (f.id === 'cf') {
    const blocos = [...new Set($('#cb').value.split(/[,;\n]/).map((s) => s.trim()).filter(Boolean))];
    const cfg = { condo: $('#cn').value.trim() || 'Condomínio', tpl: $('#ct').value.trim() || DEFAULT_TPL, blocos: blocos.length ? blocos : DEFAULT_BLOCOS.slice() };
    if (await run(async () => { await backend.saveCfg(cfg); return true; }, btn)) { await refresh(); toast('Ajustes salvos'); render(); }
  }
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') $('#overlay').innerHTML = '';
  // leitor de QR/código de barras digita o código e envia Enter: abre a entrega direto
  if (e.key === 'Enter' && e.target.id === 'pq') {
    const code = e.target.value.trim().toUpperCase();
    const p = pending().find((x) => x.code === code);
    if (p) { e.preventDefault(); openDeliver([p.id]); }
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
