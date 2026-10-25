-- Include equipped gear ATK in server-authoritative normal attacks and Ultimate.
-- The helper sums base_atk and ATK bonus_options for all currently equipped items.
create or replace function public.equipped_atk_bonus(p_player_id uuid)
returns integer
language sql
stable
security definer
set search_path = ''
as $function$
  with equipped_ids as (
    select distinct u.item_id
    from public.profiles p
    cross join lateral unnest(array[
      p.eq_weapon, p.eq_head, p.eq_armor, p.eq_legs,
      p.eq_wings, p.eq_left_accessory, p.eq_right_accessory
    ]) as u(item_id)
    where p.id = p_player_id
      and u.item_id is not null
  )
  select coalesce(round(sum(
    coalesce(it.base_atk, 0)
    + coalesce((
        select sum(
          case
            when coalesce(opt->>'value', opt->>'amount', '') ~ '^-?[0-9]+([.][0-9]+)?$'
              then coalesce(opt->>'value', opt->>'amount')::numeric
            else 0
          end
        )
        from jsonb_array_elements(
          case when jsonb_typeof(pi.bonus_options) = 'array'
            then pi.bonus_options else '[]'::jsonb end
        ) as opt
        where lower(coalesce(opt->>'stat', opt->>'key', opt->>'type', '')) like '%atk%'
      ), 0)
    + case
        when jsonb_typeof(pi.bonus_options) = 'object'
          and coalesce(pi.bonus_options->>'atk', pi.bonus_options->>'base_atk', '') ~ '^-?[0-9]+([.][0-9]+)?$'
          then coalesce(pi.bonus_options->>'atk', pi.bonus_options->>'base_atk')::numeric
        else 0
      end
  )), 0)::integer
  from equipped_ids e
  join public.player_inventory pi
    on pi.id = e.item_id and pi.player_id = p_player_id
  join public.item_templates it on it.id = pi.item_template_id;
$function$;

-- This helper is internal to the SECURITY DEFINER combat RPCs.
revoke all on function public.equipped_atk_bonus(uuid) from public;
revoke all on function public.equipped_atk_bonus(uuid) from anon;
revoke all on function public.equipped_atk_bonus(uuid) from authenticated;

do $migration$
declare
  v_def text;
  v_old text;
  v_new text;
begin
  v_def := pg_get_functiondef('public.advance_combat(boolean,boolean)'::regprocedure);
  v_old := 'v_player_atk := greatest(1, round(10 * power(p.level,1.20)) + ((ps.atk_level-1)*5) + (coalesce(ps.str,0)*2))::integer;';
  v_new := 'v_player_atk := greatest(1, round(10 * power(p.level,1.20)) + ((ps.atk_level-1)*5) + (coalesce(ps.str,0)*2) + public.equipped_atk_bonus(v_uid))::integer;';
  if position(v_old in v_def) = 0 then
    raise exception 'Could not locate advance_combat ATK formula; migration stopped without replacing combat functions';
  end if;
  execute replace(v_def, v_old, v_new);

  v_def := pg_get_functiondef('public.use_ultimate(boolean)'::regprocedure);
  v_old := 'v_player_atk := greatest(1,round(10*power(p.level,1.20))+((ps.atk_level-1)*5)+(coalesce(ps.str,0)*2))::integer;';
  v_new := 'v_player_atk := greatest(1,round(10*power(p.level,1.20))+((ps.atk_level-1)*5)+(coalesce(ps.str,0)*2)+public.equipped_atk_bonus(v_uid))::integer;';
  if position(v_old in v_def) = 0 then
    raise exception 'Could not locate use_ultimate ATK formula; migration stopped without replacing combat functions';
  end if;
  execute replace(v_def, v_old, v_new);
end
$migration$;
