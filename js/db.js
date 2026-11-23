// Camada de dados. Dois backends com a mesma interface:
//  - supabase: banco compartilhado entre os aparelhos, com login
//  - local: demonstração, tudo salvo no navegador
import { SUPABASE_URL, SUPABASE_KEY } from './config.js';

export const MODE = SUPABASE_URL && SUPABASE_KEY ? 'supabase' : 'local';
export const CARRIERS = ['Correios', 'Mercado Livre', 'Amazon', 'Shopee', 'Shein', 'Magalu', 'Outros'];
export const TIPOS = ['Caixa', 'Envelope', 'Volume grande', 'Refrigerado'];
export const DEFAULT_TPL =
  'Olá, {nome}! Chegou uma encomenda para o apto {unidade} na portaria do {condominio} ({transportadora}). Código de retirada: {protocolo}. Retire na portaria informando o código.';

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function newCode(pkgs) {
  let c, used;
  do {
    c = '';
    for (let i = 0; i < 4; i++) c += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
    used = pkgs.some((p) => p.code === c && p.status === 'pendente');
  } while (used);
  return c;
}
const uid = (p) => p + Date.now().toString(36) + Math.floor(Math.random() * 1e4).toString(36);

/* ------------------------------------------------------------------ */
/* Backend local (demonstração)                                        */
/* ------------------------------------------------------------------ */
function rng(seed) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function seedData() {
  const r = rng(160);
  const pick = (a) => a[Math.floor(r() * a.length)];
  const F = ['Ana', 'Carlos', 'Mariana', 'João', 'Fernanda', 'Ricardo', 'Patrícia', 'Lucas', 'Juliana', 'Marcos', 'Camila', 'Rafael', 'Beatriz', 'Paulo', 'Larissa', 'Gustavo', 'Aline', 'Diego', 'Renata', 'Felipe', 'Tatiane', 'Bruno', 'Vanessa', 'André', 'Luciana', 'Thiago', 'Carolina', 'Eduardo', 'Priscila', 'Rodrigo'];
  const L = ['Silva', 'Souza', 'Oliveira', 'Santos', 'Pereira', 'Costa', 'Rodrigues', 'Almeida', 'Nascimento', 'Lima', 'Araújo', 'Ribeiro', 'Carvalho', 'Gomes', 'Martins', 'Barbosa', 'Ferreira', 'Rocha', 'Dias', 'Moreira'];
  const res = [];
  let id = 1;
  for (let f = 1; f <= 10; f++)
    for (let n = 1; n <= 16; n++) {
      const k = r() < 0.4 ? 2 : 1;
      for (let i = 0; i < k; i++)
        res.push({ id: 'r' + id++, nome: pick(F) + ' ' + pick(L), unit: String(f * 100 + n), tel: '(65) 90000-' + String(Math.floor(r() * 10000)).padStart(4, '0') });
    }
  const now = Date.now();
  const pkgs = [];
  const mk = (hoursAgo, delivered) => {
    const rs = pick(res);
    const at = new Date(now - hoursAgo * 36e5);
    const p = { id: 'p' + (pkgs.length + 1), code: newCode(pkgs), resId: rs.id, unit: rs.unit, nome: rs.nome, tel: rs.tel, carrier: pick(CARRIERS), tipo: pick(TIPOS), track: r() < 0.5 ? 'BR' + Math.floor(r() * 1e9) + 'BR' : '', shelf: pick(['A', 'B', 'C', 'D', 'E', 'F', 'Balcão']), obs: '', at: at.toISOString(), notified: 1, status: 'pendente' };
    if (delivered) {
      const w = Math.min(hoursAgo - 0.5, 2 + r() * 70);
      p.status = 'entregue';
      p.outAt = new Date(at.getTime() + w * 36e5).toISOString();
      p.outBy = r() < 0.85 ? rs.nome : pick(F) + ' ' + pick(L) + ' (autorizado)';
    }
    pkgs.push(p);
  };
  [1, 2, 4, 6, 22, 28, 50, 54, 75, 99, 120, 150, 200, 260].forEach((h) => mk(h, false));
  for (let i = 0; i < 45; i++) mk(8 + Math.floor(r() * 680), true);
  return { demo: true, cfg: { condo: 'Edifício Exemplo', tpl: DEFAULT_TPL }, res, pkgs };
}

const LKEY = 'portaria-encomendas-v1';
const local = (() => {
  let st = null;
  const read = () => {
    try {
      const r = localStorage.getItem(LKEY);
      if (r) return JSON.parse(r);
    } catch (e) {}
    return null;
  };
  const write = () => {
    try {
      localStorage.setItem(LKEY, JSON.stringify(st));
    } catch (e) {}
  };
  const find = (id) => st.pkgs.find((p) => p.id === id);
  return {
    isLocal: true,
    async init() {
      st = read() || seedData();
      if (!st.cfg) st.cfg = { condo: 'Condomínio', tpl: DEFAULT_TPL };
      write();
      return { nome: 'Demonstração', papel: 'sindico', ativo: true, email: '' };
    },
    async signIn() {},
    async signOut() {},
    async loadAll() {
      return JSON.parse(JSON.stringify(st));
    },
    async addPkg(p) {
      const n = { ...p, id: uid('p'), code: newCode(st.pkgs), at: new Date().toISOString(), notified: 0, status: 'pendente' };
      st.pkgs.push(n);
      write();
      return n;
    },
    async deliver(id, { outBy, sig }) {
      const p = find(id);
      if (!p || p.status !== 'pendente') throw new Error('Esta encomenda já foi entregue.');
      p.status = 'entregue';
      p.outAt = new Date().toISOString();
      p.outBy = outBy;
      if (sig) p.sig = sig;
      write();
    },
    async undo(id) {
      const p = find(id);
      if (!p) return;
      p.status = 'pendente';
      delete p.outAt;
      delete p.outBy;
      delete p.sig;
      write();
    },
    async notify(id) {
      const p = find(id);
      if (p) {
        p.notified = (p.notified || 0) + 1;
        write();
      }
    },
    async addRes(r) {
      st.res.push({ ...r, id: uid('r') });
      write();
    },
    async addManyRes(list) {
      list.forEach((r) => st.res.push({ ...r, id: uid('r') }));
      write();
    },
    async delRes(id) {
      st.res = st.res.filter((x) => x.id !== id);
      write();
    },
    async saveCfg(cfg) {
      st.cfg = cfg;
      write();
    },
    subscribe() {},
    // extras só da demonstração
    exportJson: () => JSON.stringify(st),
    async importJson(text) {
      const d = JSON.parse(text);
      if (!d || !Array.isArray(d.res) || !Array.isArray(d.pkgs)) throw new Error('Backup inválido.');
      st = d;
      if (!st.cfg) st.cfg = { condo: 'Condomínio', tpl: DEFAULT_TPL };
      write();
    },
    async resetDemo() {
      st = seedData();
      write();
    },
    async wipe() {
      st = { demo: false, cfg: st.cfg, res: [], pkgs: [] };
      write();
    },
  };
})();

/* ------------------------------------------------------------------ */
/* Backend Supabase                                                    */
/* ------------------------------------------------------------------ */
const COLS = 'id,codigo,morador_id,unidade,nome,telefone,transportadora,tipo,rastreio,prateleira,obs,status,avisos,chegou_em,retirada_em,retirado_por';
const toPkg = (r) => ({
  id: r.id, code: r.codigo, resId: r.morador_id, unit: r.unidade, nome: r.nome || '', tel: r.telefone || '',
  carrier: r.transportadora || 'Outros', tipo: r.tipo || 'Caixa', track: r.rastreio || '', shelf: r.prateleira || '',
  obs: r.obs || '', at: r.chegou_em, notified: r.avisos || 0, status: r.status,
  outAt: r.retirada_em || undefined, outBy: r.retirado_por || undefined,
});
const toRes = (r) => ({ id: r.id, nome: r.nome, unit: r.unidade, tel: r.telefone || '' });
const fail = (e) => {
  if (e) throw new Error(e.message || 'Erro ao falar com o banco de dados.');
};

const remote = (() => {
  let sb = null;
  let channel = null;
  let uidNow = null;
  return {
    isLocal: false,
    async init() {
      const { createClient } = await import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm');
      sb = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: true, autoRefreshToken: true } });
      const { data } = await sb.auth.getSession();
      if (!data.session) return null;
      uidNow = data.session.user.id;
      const { data: perfil, error } = await sb.from('perfis').select('nome,papel,ativo,email').eq('user_id', uidNow).maybeSingle();
      fail(error);
      if (!perfil) throw new Error('Perfil não encontrado. Peça ao síndico para conferir seu cadastro.');
      return perfil;
    },
    async signIn(email, senha) {
      const { error } = await sb.auth.signInWithPassword({ email, password: senha });
      if (error) throw new Error('E-mail ou senha incorretos.');
    },
    async signOut() {
      if (channel) {
        await sb.removeChannel(channel);
        channel = null;
      }
      await sb.auth.signOut();
    },
    async loadAll() {
      const since = new Date(Date.now() - 90 * 864e5).toISOString();
      const [c, m, p] = await Promise.all([
        sb.from('config').select('condominio,modelo_aviso').eq('id', 1).maybeSingle(),
        sb.from('moradores').select('id,nome,unidade,telefone').order('unidade').limit(5000),
        sb.from('encomendas').select(COLS).or('status.eq.pendente,chegou_em.gte.' + since).order('chegou_em', { ascending: false }).limit(5000),
      ]);
      fail(c.error); fail(m.error); fail(p.error);
      return {
        demo: false,
        cfg: { condo: (c.data && c.data.condominio) || 'Condomínio', tpl: (c.data && c.data.modelo_aviso) || DEFAULT_TPL },
        res: m.data.map(toRes),
        pkgs: p.data.map(toPkg),
      };
    },
    async addPkg(p) {
      const row = {
        morador_id: p.resId || null, unidade: p.unit, nome: p.nome || null, telefone: p.tel || null,
        transportadora: p.carrier, tipo: p.tipo, rastreio: p.track || null, prateleira: p.shelf, obs: p.obs || null,
      };
      for (let i = 0; i < 4; i++) {
        const { data, error } = await sb.from('encomendas').insert(row).select(COLS).single();
        if (!error) return toPkg(data);
        if (error.code !== '23505') fail(error); // 23505 = código repetido, tenta outro
      }
      throw new Error('Não foi possível gerar um código único. Tente de novo.');
    },
    async deliver(id, { outBy, sig }) {
      const { data, error } = await sb.from('encomendas')
        .update({ status: 'entregue', retirada_em: new Date().toISOString(), retirado_por: outBy, assinatura: sig || null })
        .eq('id', id).eq('status', 'pendente').select('id');
      fail(error);
      if (!data || !data.length) throw new Error('Esta encomenda já foi entregue em outro aparelho.');
    },
    async undo(id) {
      const { error } = await sb.from('encomendas').update({ status: 'pendente', retirada_em: null, retirado_por: null, assinatura: null }).eq('id', id);
      fail(error);
    },
    async notify(id, atual) {
      const { error } = await sb.from('encomendas').update({ avisos: (atual || 0) + 1 }).eq('id', id);
      fail(error);
    },
    async addRes(r) {
      const { error } = await sb.from('moradores').insert({ nome: r.nome, unidade: r.unit, telefone: r.tel || null });
      fail(error);
    },
    async addManyRes(list) {
      const rows = list.map((r) => ({ nome: r.nome, unidade: r.unit, telefone: r.tel || null }));
      for (let i = 0; i < rows.length; i += 500) {
        const { error } = await sb.from('moradores').insert(rows.slice(i, i + 500));
        fail(error);
      }
    },
    async delRes(id) {
      const { error } = await sb.from('moradores').delete().eq('id', id);
      fail(error);
    },
    async saveCfg(cfg) {
      const { error } = await sb.from('config').update({ condominio: cfg.condo, modelo_aviso: cfg.tpl }).eq('id', 1);
      fail(error);
    },
    async listPerfis() {
      const { data, error } = await sb.from('perfis').select('user_id,nome,email,papel,ativo').order('criado_em');
      fail(error);
      return data;
    },
    async setPerfil(userId, patch) {
      const { error } = await sb.from('perfis').update(patch).eq('user_id', userId);
      fail(error);
    },
    subscribe(cb) {
      if (channel) return;
      let t = null;
      const kick = () => {
        clearTimeout(t);
        t = setTimeout(cb, 400);
      };
      channel = sb.channel('mudancas')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'encomendas' }, kick)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'moradores' }, kick)
        .subscribe();
    },
  };
})();

export const backend = MODE === 'supabase' ? remote : local;
