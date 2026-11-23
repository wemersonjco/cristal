-- Blocos (apartamento = bloco + número) e controle de aviso ao morador.
-- Aplicada no projeto depois da 0002.

alter table public.moradores add column bloco text not null default '';
alter table public.encomendas
  add column bloco text not null default '',
  add column avisado_em timestamptz,   -- quando o porteiro confirmou o envio do último aviso
  add column avisado_por text,         -- quem confirmou
  add column aviso_canal text;         -- whatsapp, interfone, pessoalmente...
alter table public.config add column blocos text[] not null default array['A1','A2','A3','A4','A5'];

drop index public.moradores_unidade_idx;
create index moradores_bloco_unidade_idx on public.moradores (bloco, unidade);

update public.config
set modelo_aviso = 'Olá, {nome}! Chegou uma encomenda para o bloco {bloco}, apto {apto} na portaria do {condominio} ({transportadora}). Código de retirada: {protocolo}. Retire na portaria informando o código.'
where id = 1
  and modelo_aviso = 'Olá, {nome}! Chegou uma encomenda para o apto {unidade} na portaria do {condominio} ({transportadora}). Código de retirada: {protocolo}. Retire na portaria informando o código.';

alter table public.config alter column modelo_aviso set default 'Olá, {nome}! Chegou uma encomenda para o bloco {bloco}, apto {apto} na portaria do {condominio} ({transportadora}). Código de retirada: {protocolo}. Retire na portaria informando o código.';
