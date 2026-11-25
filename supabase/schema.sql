-- =====================================================================
-- DISPO – schéma de base de données (Supabase / PostgreSQL)
-- À coller UNE FOIS dans Supabase > SQL Editor > New query > Run.
-- Principe de sécurité : tout est interdit par défaut (RLS), puis on
-- autorise uniquement : "mes propres données" et "les données de mes contacts".
-- =====================================================================

create extension if not exists pgcrypto with schema extensions;

-- ---------- Types ----------
do $$ begin
  create type public.availability as enum ('online', 'away', 'busy', 'offline');
exception when duplicate_object then null; end $$;

-- ---------- Génération de codes d'invitation (10 caractères, sans 0/O/1/I) ----------
create or replace function public.generate_invite_code()
returns text language plpgsql volatile set search_path = '' as $$
declare
  alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; -- 32 caractères
  bytes bytea := extensions.gen_random_bytes(10);
  result text := '';
  i int;
begin
  for i in 0..9 loop
    result := result || substr(alphabet, (get_byte(bytes, i) % 32) + 1, 1);
  end loop;
  return result;
end $$;

-- ---------- Tables ----------
create table if not exists public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  first_name  text not null default '' check (char_length(first_name) <= 50),
  last_name   text not null default '' check (char_length(last_name)  <= 50),
  avatar_path text check (avatar_path is null or char_length(avatar_path) <= 200),
  created_at  timestamptz not null default now()
);

-- Le code d'invitation est dans une table à part : visible UNIQUEMENT par son propriétaire
-- (même tes contacts ne peuvent pas le lire ni le re-partager).
create table if not exists public.invite_codes (
  user_id uuid primary key references auth.users(id) on delete cascade,
  code    text not null unique default public.generate_invite_code()
);

create table if not exists public.statuses (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  state      public.availability not null default 'offline',
  message    text check (message is null or char_length(message) <= 140),
  updated_at timestamptz not null default now()
);

-- Lien symétrique : si A est contact de B, il y a deux lignes (A,B) et (B,A).
create table if not exists public.connections (
  user_id    uuid not null references auth.users(id) on delete cascade,
  contact_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, contact_id),
  check (user_id <> contact_id)
);
create index if not exists connections_contact_idx on public.connections (contact_id);

-- Anti-devinette des codes d'invitation
create table if not exists public.invite_failures (
  user_id uuid not null references auth.users(id) on delete cascade,
  at      timestamptz not null default now()
);
create index if not exists invite_failures_idx on public.invite_failures (user_id, at);

-- ---------- Fonction utilitaire : "cette personne est-elle dans mon cercle ?" ----------
create or replace function public.is_contact(other uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.connections
    where user_id = (select auth.uid()) and contact_id = other
  );
$$;

-- ---------- Horodatage automatique du statut ----------
create or replace function public.touch_status()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  new.message := nullif(btrim(new.message), '');
  return new;
end $$;

drop trigger if exists statuses_touch on public.statuses;
create trigger statuses_touch before insert or update on public.statuses
  for each row execute function public.touch_status();

-- ---------- Création automatique du profil à l'inscription ----------
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, first_name, last_name)
  values (
    new.id,
    left(btrim(coalesce(new.raw_user_meta_data ->> 'first_name', '')), 50),
    left(btrim(coalesce(new.raw_user_meta_data ->> 'last_name',  '')), 50)
  );
  insert into public.invite_codes (user_id) values (new.id);
  insert into public.statuses (user_id) values (new.id);
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- =====================================================================
-- SÉCURITÉ : Row Level Security
-- =====================================================================
alter table public.profiles        enable row level security;
alter table public.invite_codes    enable row level security;
alter table public.statuses        enable row level security;
alter table public.connections     enable row level security;
alter table public.invite_failures enable row level security;  -- aucune policy = inaccessible

-- profiles : je vois le mien + ceux de mes contacts ; je modifie uniquement le mien
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles for select to authenticated
  using (id = (select auth.uid()) or public.is_contact(id));
drop policy if exists profiles_update on public.profiles;
create policy profiles_update on public.profiles for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));

-- invite_codes : je vois uniquement le mien (changement via la fonction dédiée)
drop policy if exists invite_codes_select on public.invite_codes;
create policy invite_codes_select on public.invite_codes for select to authenticated
  using (user_id = (select auth.uid()));

-- statuses : je vois le mien + ceux de mes contacts ; j'écris uniquement le mien
drop policy if exists statuses_select on public.statuses;
create policy statuses_select on public.statuses for select to authenticated
  using (user_id = (select auth.uid()) or public.is_contact(user_id));
drop policy if exists statuses_insert on public.statuses;
create policy statuses_insert on public.statuses for insert to authenticated
  with check (user_id = (select auth.uid()));
drop policy if exists statuses_update on public.statuses;
create policy statuses_update on public.statuses for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- connections : je ne vois que mes propres liens ; AUCUNE écriture directe (voir fonctions)
drop policy if exists connections_select on public.connections;
create policy connections_select on public.connections for select to authenticated
  using (user_id = (select auth.uid()));

-- Droits de table minimaux : les visiteurs non connectés (anon) n'ont accès à RIEN.
revoke all on public.profiles, public.invite_codes, public.statuses,
              public.connections, public.invite_failures from anon, authenticated;
grant select, update (first_name, last_name, avatar_path) on public.profiles to authenticated;
grant select on public.invite_codes to authenticated;
grant select, insert, update (state, message) on public.statuses to authenticated;
grant select on public.connections to authenticated;

-- =====================================================================
-- FONCTIONS MÉTIER (seul moyen de créer/supprimer des liens)
-- =====================================================================

-- Ajouter un contact avec son code. Renvoie l'id du contact, ou NULL si code invalide.
-- Limité à 10 essais ratés par heure (impossible de deviner un code par force brute).
create or replace function public.add_contact_by_code(p_code text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
  other uuid;
begin
  if me is null then raise exception 'not_authenticated'; end if;

  delete from public.invite_failures where at < now() - interval '1 day';
  if (select count(*) from public.invite_failures
      where user_id = me and at > now() - interval '1 hour') >= 10 then
    raise exception 'too_many_attempts';
  end if;

  select user_id into other from public.invite_codes
  where code = upper(btrim(p_code));

  if other is null then
    insert into public.invite_failures (user_id) values (me);
    return null;
  end if;
  if other = me then raise exception 'cannot_add_self'; end if;

  insert into public.connections (user_id, contact_id)
  values (me, other), (other, me)
  on conflict do nothing;
  return other;
end $$;

-- Supprimer un contact : coupe le lien dans les deux sens (il ne voit plus rien de toi, et inversement).
create or replace function public.remove_contact(p_contact uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare me uuid := auth.uid();
begin
  if me is null then raise exception 'not_authenticated'; end if;
  delete from public.connections
  where (user_id = me and contact_id = p_contact)
     or (user_id = p_contact and contact_id = me);
end $$;

-- Changer son code d'invitation (l'ancien cesse de fonctionner immédiatement).
create or replace function public.regenerate_invite_code()
returns text language plpgsql security definer set search_path = '' as $$
declare new_code text;
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  update public.invite_codes
     set code = public.generate_invite_code()
   where user_id = auth.uid()
   returning code into new_code;
  return new_code;
end $$;

revoke execute on function public.add_contact_by_code(text),
                           public.remove_contact(uuid),
                           public.regenerate_invite_code(),
                           public.is_contact(uuid),
                           public.generate_invite_code(),
                           public.handle_new_user()
  from public, anon;
grant execute on function public.add_contact_by_code(text),
                          public.remove_contact(uuid),
                          public.regenerate_invite_code(),
                          public.is_contact(uuid)
  to authenticated;

-- =====================================================================
-- PHOTOS DE PROFIL (stockage privé : visibles par soi + ses contacts uniquement)
-- Fichier attendu : avatars/<mon_id>/avatar.jpg  (max 1 Mo, jpeg/png/webp)
-- =====================================================================
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', false, 1048576, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
  set public = false, file_size_limit = 1048576,
      allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp'];

drop policy if exists avatars_select on storage.objects;
create policy avatars_select on storage.objects for select to authenticated
  using (
    bucket_id = 'avatars' and (
      (storage.foldername(name))[1] = (select auth.uid())::text
      or (storage.foldername(name))[1] in (
        select contact_id::text from public.connections where user_id = (select auth.uid())
      )
    )
  );
drop policy if exists avatars_insert on storage.objects;
create policy avatars_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);
drop policy if exists avatars_update on storage.objects;
create policy avatars_update on storage.objects for update to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);
drop policy if exists avatars_delete on storage.objects;
create policy avatars_delete on storage.objects for delete to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);

-- =====================================================================
-- TEMPS RÉEL (les statuts se mettent à jour chez les contacts instantanément)
-- Les règles RLS ci-dessus s'appliquent aussi au temps réel.
-- =====================================================================
do $$ begin
  alter publication supabase_realtime add table public.statuses;
exception when duplicate_object then null; end $$;
do $$ begin
  alter publication supabase_realtime add table public.connections;
exception when duplicate_object then null; end $$;
do $$ begin
  alter publication supabase_realtime add table public.profiles;
exception when duplicate_object then null; end $$;
