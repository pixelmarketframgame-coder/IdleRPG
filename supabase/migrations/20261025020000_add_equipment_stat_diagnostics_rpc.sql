create or replace function public.get_equipment_stat_diagnostics()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_uid uuid := auth.uid();
  v_atk_bonus integer := 0;
  v_normal_def text := '';
  v_ultimate_def text := '';
  v_equipment jsonb := '[]'::jsonb;
begin
  if v_uid is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  v_atk_bonus := public.equipped_atk_bonus(v_uid);

  select pg_get_functiondef(p.oid) into v_normal_def
  from pg_catalog.pg_proc p
  join pg_catalog.pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'advance_combat'
  order by p.oid desc limit 1;

  select pg_get_functiondef(p.oid) into v_ultimate_def
  from pg_catalog.pg_proc p
  join pg_catalog.pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'use_ultimate'
  order by p.oid desc limit 1;

  select coalesce(jsonb_agg(jsonb_build_object(
    'slot', e.slot,
    'inventory_id', pi.id,
    'template_id', it.id,
    'name', it.name,
    'base_atk', coalesce(it.base_atk,0),
    'base_def', coalesce(it.base_def,0),
    'base_hp', coalesce(it.base_hp,0),
    'bonus_options', coalesce(pi.bonus_options,'[]'::jsonb)
  ) order by e.slot), '[]'::jsonb)
  into v_equipment
  from public.profiles p
  cross join lateral (values
    ('eq_weapon',p.eq_weapon),('eq_head',p.eq_head),('eq_armor',p.eq_armor),
    ('eq_legs',p.eq_legs),('eq_wings',p.eq_wings),
    ('eq_left_accessory',p.eq_left_accessory),('eq_right_accessory',p.eq_right_accessory)
  ) as e(slot,item_id)
  join public.player_inventory pi on pi.id=e.item_id and pi.player_id=v_uid
  join public.item_templates it on it.id=pi.item_template_id
  where p.id=v_uid and e.item_id is not null;

  return jsonb_build_object(
    'success',true,
    'player_id',v_uid,
    'checked_at',now(),
    'equipped_atk_bonus',v_atk_bonus,
    'equipment',v_equipment,
    'server_combat',jsonb_build_object(
      'normal_attack_uses_equipment_atk',coalesce(position('equipped_atk_bonus(v_uid)' in v_normal_def)>0,false),
      'ultimate_uses_equipment_atk',coalesce(position('equipped_atk_bonus(v_uid)' in v_ultimate_def)>0,false),
      'normal_attack_uses_equipment_def',coalesce(position('equipped_def_bonus(v_uid)' in v_normal_def)>0,false),
      'monster_damage_reduces_by_equipment_def',coalesce(position('equipped_def_bonus(v_uid)' in v_normal_def)>0,false),
      'note','DEF equipment bonus is diagnostic-only until a server DEF formula is implemented.'
    )
  );
end;
$function$;

revoke all on function public.get_equipment_stat_diagnostics() from public, anon;
grant execute on function public.get_equipment_stat_diagnostics() to authenticated;
