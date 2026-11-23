-- Encomenda cancelada (registro errado): sai de Pendentes, fica no histórico com motivo.
alter table public.encomendas drop constraint if exists encomendas_status_check;
alter table public.encomendas add constraint encomendas_status_check check (status in ('pendente', 'entregue', 'cancelada'));
alter table public.encomendas
  add column if not exists cancelado_em timestamptz,
  add column if not exists cancelado_por text,
  add column if not exists cancelado_motivo text;
