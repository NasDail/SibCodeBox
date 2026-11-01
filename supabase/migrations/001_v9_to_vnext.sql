-- ============================================================
-- MIGRATION: legacy SCBB v9 -> vNext
-- Предполагается, что расширенная схема из scbb.txt уже применена.
-- Скрипт сохраняет config, tickets, records, incidents и старые поля.
-- Безопасно выполнять повторно.
-- ============================================================

begin;
set local app.scbb_migration_mode = 'on';

-- 1) Каталог из config.games_json переносится в games.
do $$
declare
  v_json jsonb;
  v_item jsonb;
  v_id text;
  v_title text;
  v_slug text;
  v_url text;
  v_icon text;
  v_desc text;
  v_genre text;
  v_developer text;
begin
  select value::jsonb into v_json from public.config where key = 'games_json';
  if v_json is null or jsonb_typeof(v_json) <> 'array' then return; end if;
  for v_item in select value from jsonb_array_elements(v_json) loop
    v_id := coalesce(nullif(v_item->>'id',''), 'legacy-' || md5(v_item::text));
    v_title := coalesce(nullif(v_item->>'title',''), 'Без названия');
    v_slug := coalesce(nullif(v_item->>'slug',''), nullif(v_item->>'id',''), v_id);
    if exists (select 1 from public.games g where g.slug = v_slug and g.id <> v_id) then
      v_slug := v_slug || '-' || substr(md5(v_id), 1, 6);
    end if;
    v_url := coalesce(nullif(v_item->>'url',''), nullif(v_item->>'entry_url',''));
    v_icon := coalesce(nullif(v_item->>'iconUrl',''), nullif(v_item->>'icon_url',''));
    v_desc := coalesce(nullif(v_item->>'description',''), nullif(v_item->>'desc',''), '');
    v_genre := coalesce(nullif(v_item->>'genre',''), 'Аркада');
    v_developer := coalesce(nullif(v_item->>'developer',''), nullif(v_item->>'author',''), 'Не указан');
    insert into public.games(id, slug, title, description, genre, developer, icon_url, repo_url, entry_url, files_json, legacy_json, is_active)
    values (
      v_id, v_slug, v_title, v_desc, v_genre, v_developer, v_icon,
      coalesce(nullif(v_item->>'repo_url',''), 'https://github.com/NasDail/SibCodeBox'),
      v_url,
      case when jsonb_typeof(v_item->'files_json') = 'array' then v_item->'files_json' else '[]'::jsonb end,
      v_item, true
    )
    on conflict (id) do update set
      slug = excluded.slug,
      title = excluded.title,
      description = excluded.description,
      genre = excluded.genre,
      developer = excluded.developer,
      icon_url = coalesce(excluded.icon_url, public.games.icon_url),
      repo_url = coalesce(excluded.repo_url, public.games.repo_url),
      entry_url = coalesce(excluded.entry_url, public.games.entry_url),
      files_json = case when excluded.files_json = '[]'::jsonb then public.games.files_json else excluded.files_json end,
      legacy_json = coalesce(public.games.legacy_json, '{}'::jsonb) || excluded.legacy_json,
      is_active = true,
      updated_at = now();
  end loop;
end $$;

-- 2) Существующие рекорды: player_name -> nick; не удаляем и не переписываем score/date.
update public.records
set nick = coalesce(nullif(trim(nick), ''), nullif(trim(player_name), ''), 'Игрок'),
    player_name = coalesce(nullif(trim(player_name), ''), nullif(trim(nick), ''), 'Игрок')
where nick is null or trim(nick) = '' or player_name is null or trim(player_name) = '';

-- 3) Обеспечиваем game row для старых рекордов; orphan FK станет согласованным.
insert into public.games(id, slug, title, description, genre, developer, is_active)
select distinct r.game_id,
       'legacy-' || substr(md5(r.game_id), 1, 12),
       'Старая игра (' || r.game_id || ')',
       'Создана миграцией для сохранения исторических рекордов.',
       'Архив', 'СибКодБокс', false
from public.records r
where r.game_id is not null
  and not exists (select 1 from public.games g where g.id = r.game_id)
on conflict (id) do nothing;

-- После создания placeholder игр можно проверить старую FK.
alter table public.records validate constraint records_game_id_fkey;

-- 4) Старые таблицы остаются. Добавляем индексы, если таблицы пришли из v9.
create index if not exists idx_tickets_created_at on public.tickets(created_at desc);
create index if not exists idx_incidents_created_at on public.incidents(created_at desc);

-- 5) В переходный период games_json остаётся для старых версий автомата.
-- Удаляем только секреты, которые не должны оставаться в config.
delete from public.config where lower(key) in ('github_token','github_pat','gh_token','teacher_token','service_role_key','supabase_service_role_key');

-- 6) Перестраиваем совместимый legacy JSON из таблицы games.
-- Все дополнительные поля старых карточек сохранены в games.legacy_json.
select public.scbb_refresh_games_json();

-- 7) Поднимаем catalog_sync_version: автоматы, которые слушают Realtime, увидят событие.
insert into public.config(key, value) values ('catalog_sync_version', extract(epoch from now())::text)
on conflict (key) do update set value = excluded.value;

commit;

-- games_json остаётся зеркалом таблицы games, пока работает хотя бы один старый автомат.
-- ПОСЛЕ проверки всех автоматов можно удалить mirror trigger и games_json отдельной миграцией.
-- Не делайте это, пока на площадке остаются старые версии index.html.
