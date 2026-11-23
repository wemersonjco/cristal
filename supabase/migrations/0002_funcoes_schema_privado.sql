-- Move as funções auxiliares de permissão para um schema privado (não exposto pela API),
-- eliminando o alerta de segurança "SECURITY DEFINER executável por usuários logados".
-- Aplicada no projeto depois da 0001.

drop policy perfis_select on public.perfis;
drop policy perfis_update on public.perfis;
drop policy moradores_select on public.moradores;
drop policy moradores_insert on public.moradores;
drop policy moradores_update on public.moradores;
drop policy moradores_delete on public.moradores;
drop policy encomendas_select on public.encomendas;
drop policy encomendas_insert on public.encomendas;
drop policy encomendas_update on public.encomendas;
drop policy encomendas_delete on public.encomendas;
drop policy config_select on public.config;
drop policy config_update on public.config;

drop function public.sou_ativo();
drop function public.sou_sindico();

create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated;

create function private.sou_ativo()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.perfis where user_id = (select auth.uid()) and ativo);
$$;

create function private.sou_sindico()
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

revoke execute on function private.sou_ativo() from public, anon;
revoke execute on function private.sou_sindico() from public, anon;
grant execute on function private.sou_ativo() to authenticated;
grant execute on function private.sou_sindico() to authenticated;

create policy perfis_select on public.perfis for select to authenticated
  using (user_id = (select auth.uid()) or private.sou_sindico());
create policy perfis_update on public.perfis for update to authenticated
  using (private.sou_sindico())
  with check (private.sou_sindico() and (user_id <> (select auth.uid()) or (ativo and papel = 'sindico')));

create policy moradores_select on public.moradores for select to authenticated using (private.sou_ativo());
create policy moradores_insert on public.moradores for insert to authenticated with check (private.sou_ativo());
create policy moradores_update on public.moradores for update to authenticated
  using (private.sou_ativo()) with check (private.sou_ativo());
create policy moradores_delete on public.moradores for delete to authenticated using (private.sou_sindico());

create policy encomendas_select on public.encomendas for select to authenticated using (private.sou_ativo());
create policy encomendas_insert on public.encomendas for insert to authenticated with check (private.sou_ativo());
create policy encomendas_update on public.encomendas for update to authenticated
  using (private.sou_ativo()) with check (private.sou_ativo());
create policy encomendas_delete on public.encomendas for delete to authenticated using (private.sou_sindico());

create policy config_select on public.config for select to authenticated using (private.sou_ativo());
create policy config_update on public.config for update to authenticated
  using (private.sou_sindico()) with check (private.sou_sindico());
