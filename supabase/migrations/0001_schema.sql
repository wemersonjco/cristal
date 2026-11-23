-- Encomendas da Portaria: esquema inicial
-- Perfis: o primeiro usuário criado vira síndico ativo. Os demais entram inativos
-- e só acessam os dados depois que o síndico ativa (mesmo que o cadastro público esteja aberto).

create type public.papel_usuario as enum ('sindico', 'porteiro');

create table public.perfis (
  user_id uuid primary key references auth.users (id) on delete cascade,
  email text,
  nome text not null default '',
  papel public.papel_usuario not null default 'porteiro',
  ativo boolean not null default false,
  criado_em timestamptz not null default now()
);

create table public.moradores (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  unidade text not null,
  telefone text,
  criado_em timestamptz not null default now()
);
create index moradores_unidade_idx on public.moradores (unidade);

create table public.config (
  id int primary key default 1 check (id = 1),
  condominio text not null default 'Condomínio',
  modelo_aviso text not null default 'Olá, {nome}! Chegou uma encomenda para o apto {unidade} na portaria do {condominio} ({transportadora}). Código de retirada: {protocolo}. Retire na portaria informando o código.'
);
insert into public.config (id) values (1);

-- Código de retirada de 4 caracteres, sem letras e números parecidos (sem 0, O, 1, I)
create function public.gerar_codigo()
returns text
language plpgsql
volatile
set search_path = ''
as $$
declare
  alfabeto constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  r text := '';
  i int;
begin
  for i in 1..4 loop
    r := r || substr(alfabeto, 1 + floor(random() * 32)::int, 1);
  end loop;
  return r;
end;
$$;

create table public.encomendas (
  id uuid primary key default gen_random_uuid(),
  codigo text not null default public.gerar_codigo(),
  morador_id uuid references public.moradores (id) on delete set null,
  unidade text not null,
  nome text,
  telefone text,
  transportadora text,
  tipo text,
  rastreio text,
  prateleira text,
  obs text,
  status text not null default 'pendente' check (status in ('pendente', 'entregue')),
  avisos int not null default 0,
  chegou_em timestamptz not null default now(),
  retirada_em timestamptz,
  retirado_por text,
  assinatura text,
  registrado_por uuid default auth.uid() references auth.users (id) on delete set null
);
-- Dois pacotes pendentes nunca dividem o mesmo código
create unique index encomendas_codigo_pendente_idx on public.encomendas (codigo) where status = 'pendente';
create index encomendas_status_chegada_idx on public.encomendas (status, chegou_em desc);
create index encomendas_morador_idx on public.encomendas (morador_id);
create index encomendas_registrado_por_idx on public.encomendas (registrado_por);

-- Funções usadas nas políticas de segurança
create function public.sou_ativo()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.perfis where user_id = (select auth.uid()) and ativo);
$$;

create function public.sou_sindico()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.perfis
    where user_id = (select auth.uid()) and ativo and papel = 'sindico'
  );
$$;

revoke execute on function public.sou_ativo() from public, anon;
revoke execute on function public.sou_sindico() from public, anon;
grant execute on function public.sou_ativo() to authenticated;
grant execute on function public.sou_sindico() to authenticated;

-- Cria o perfil quando um usuário é criado no Supabase Auth
create function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  primeiro boolean;
begin
  select not exists (select 1 from public.perfis) into primeiro;
  insert into public.perfis (user_id, email, nome, papel, ativo)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'nome', split_part(new.email, '@', 1)),
    case when primeiro then 'sindico'::public.papel_usuario else 'porteiro'::public.papel_usuario end,
    primeiro
  );
  return new;
end;
$$;
revoke execute on function public.handle_new_user() from public, anon, authenticated;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Segurança por linha
alter table public.perfis enable row level security;
alter table public.moradores enable row level security;
alter table public.encomendas enable row level security;
alter table public.config enable row level security;

create policy perfis_select on public.perfis for select to authenticated
  using (user_id = (select auth.uid()) or public.sou_sindico());
create policy perfis_update on public.perfis for update to authenticated
  using (public.sou_sindico())
  with check (public.sou_sindico() and (user_id <> (select auth.uid()) or (ativo and papel = 'sindico')));

create policy moradores_select on public.moradores for select to authenticated using (public.sou_ativo());
create policy moradores_insert on public.moradores for insert to authenticated with check (public.sou_ativo());
create policy moradores_update on public.moradores for update to authenticated
  using (public.sou_ativo()) with check (public.sou_ativo());
create policy moradores_delete on public.moradores for delete to authenticated using (public.sou_sindico());

create policy encomendas_select on public.encomendas for select to authenticated using (public.sou_ativo());
create policy encomendas_insert on public.encomendas for insert to authenticated with check (public.sou_ativo());
create policy encomendas_update on public.encomendas for update to authenticated
  using (public.sou_ativo()) with check (public.sou_ativo());
create policy encomendas_delete on public.encomendas for delete to authenticated using (public.sou_sindico());

create policy config_select on public.config for select to authenticated using (public.sou_ativo());
create policy config_update on public.config for update to authenticated
  using (public.sou_sindico()) with check (public.sou_sindico());

-- Atualização ao vivo entre os aparelhos da portaria
alter publication supabase_realtime add table public.encomendas, public.moradores;
