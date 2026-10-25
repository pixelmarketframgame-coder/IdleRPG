-- Central web game state API; returns a single authenticated state contract for the website and Phaser.
CREATE OR REPLACE FUNCTION public.get_player_game_state()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_uid uuid := auth.uid();
  p public.profiles%rowtype;
  ps public.player_stats%rowtype;
  s public.player_stage_progress%rowtype;
  cs public.player_combat_state%rowtype;
  m public.monsters%rowtype;
  v_atk integer;
  v_max_hp bigint;
  v_hard_def integer;
  v_soft_def integer;
  v_hit numeric;
  v_flee numeric;
  v_crit numeric;
  v_stage_status jsonb;
  v_monster jsonb;
  v_inventory jsonb;
  v_equipment jsonb;
  v_weapon_type text;
  v_theme text;
begin
  if v_uid is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  select * into p from public.profiles where id = v_uid;
  if p.id is null then raise exception 'PROFILE_NOT_FOUND'; end if;

  select * into ps from public.player_stats where player_id = v_uid;
  if ps.player_id is null then raise exception 'PLAYER_STATS_NOT_FOUND'; end if;

  insert into public.player_stage_progress(player_id)
  values (v_uid) on conflict (player_id) do nothing;
  insert into public.player_combat_state(player_id)
  values (v_uid) on conflict (player_id) do nothing;

  -- Keep target generation in the existing server-owned function.
  begin
    perform 1 from public.get_current_combat_target();
  exception when others then
    if sqlerrm <> 'CHALLENGE_REQUIRED' then raise; end if;
  end;

  select * into s from public.player_stage_progress where player_id = v_uid;
  select * into cs from public.player_combat_state where player_id = v_uid;

  v_max_hp := greatest(1, 100
    + ((greatest(1, ps.hp_level) - 1) * 20)
    + ((greatest(1, p.level) - 1) * 10)
    + (coalesce(ps.vit, 0) * 10));

  v_atk := greatest(1,
    round(10 * power(p.level, 1.20))
    + ((ps.atk_level - 1) * 5)
    + (coalesce(ps.str, 0) * 2)
    + public.equipped_atk_bonus(v_uid))::integer;

  v_hard_def := greatest(0, public.equipped_hard_def(v_uid));
  v_soft_def := greatest(0,
    coalesce(ps.vit, 0)
    + floor((greatest(1, p.level) - 1) / 2.0)::integer
    + public.equipped_soft_def_bonus(v_uid));

  v_hit := least(0.99, 0.90 + (coalesce(ps.dex, 0) * 0.01));
  v_flee := least(0.50, coalesce(ps.agi, 0) * 0.01);
  v_crit := least(0.50, 0.05 + (coalesce(ps.luk, 0) * 0.01));

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'id', pi.id,
      'item_template_id', it.id,
      'name', it.name,
      'mastery_type_id', it.mastery_type_id,
      'slot', case
        when it.mastery_type_id like 'left_accessory%' then 'left_accessory'
        when it.mastery_type_id like 'right_accessory%' then 'right_accessory'
        else split_part(it.mastery_type_id, '_', 1)
      end,
      'tier', it.tier,
      'element', it.element,
      'base_atk', coalesce(it.base_atk, 0),
      'base_def', coalesce(it.base_def, 0),
      'base_hp', coalesce(it.base_hp, 0),
      'sprite_key', it.sprite_key,
      'bonus_options', coalesce(pi.bonus_options, '[]'::jsonb),
      'equipped', pi.id = any(array[
        p.eq_weapon, p.eq_head, p.eq_armor, p.eq_legs,
        p.eq_wings, p.eq_left_accessory, p.eq_right_accessory
      ])
    ) order by pi.acquired_at desc
  ), '[]'::jsonb)
  into v_inventory
  from public.player_inventory pi
  join public.item_templates it on it.id = pi.item_template_id
  where pi.player_id = v_uid;

  select coalesce(it.mastery_type_id, 'weapon_bow')
  into v_weapon_type
  from public.player_inventory pi
  join public.item_templates it on it.id = pi.item_template_id
  where pi.id = p.eq_weapon and pi.player_id = v_uid;
  v_weapon_type := coalesce(v_weapon_type, 'weapon_bow');

  v_equipment := jsonb_build_object(
    'weapon', (select v from (
      select jsonb_build_object('id',pi.id,'item_template_id',it.id,'name',it.name,
        'base_atk',it.base_atk,'base_def',it.base_def,'base_hp',it.base_hp,
        'mastery_type_id',it.mastery_type_id,'bonus_options',pi.bonus_options) as v
      from public.player_inventory pi join public.item_templates it on it.id=pi.item_template_id
      where pi.id=p.eq_weapon and pi.player_id=v_uid
    ) q),
    'head', (select v from (
      select jsonb_build_object('id',pi.id,'item_template_id',it.id,'name',it.name,
        'base_atk',it.base_atk,'base_def',it.base_def,'base_hp',it.base_hp,
        'mastery_type_id',it.mastery_type_id,'bonus_options',pi.bonus_options) as v
      from public.player_inventory pi join public.item_templates it on it.id=pi.item_template_id
      where pi.id=p.eq_head and pi.player_id=v_uid
    ) q),
    'armor', (select v from (
      select jsonb_build_object('id',pi.id,'item_template_id',it.id,'name',it.name,
        'base_atk',it.base_atk,'base_def',it.base_def,'base_hp',it.base_hp,
        'mastery_type_id',it.mastery_type_id,'bonus_options',pi.bonus_options) as v
      from public.player_inventory pi join public.item_templates it on it.id=pi.item_template_id
      where pi.id=p.eq_armor and pi.player_id=v_uid
    ) q),
    'legs', (select v from (
      select jsonb_build_object('id',pi.id,'item_template_id',it.id,'name',it.name,
        'base_atk',it.base_atk,'base_def',it.base_def,'base_hp',it.base_hp,
        'mastery_type_id',it.mastery_type_id,'bonus_options',pi.bonus_options) as v
      from public.player_inventory pi join public.item_templates it on it.id=pi.item_template_id
      where pi.id=p.eq_legs and pi.player_id=v_uid
    ) q),
    'wings', (select v from (
      select jsonb_build_object('id',pi.id,'item_template_id',it.id,'name',it.name,
        'base_atk',it.base_atk,'base_def',it.base_def,'base_hp',it.base_hp,
        'mastery_type_id',it.mastery_type_id,'bonus_options',pi.bonus_options) as v
      from public.player_inventory pi join public.item_templates it on it.id=pi.item_template_id
      where pi.id=p.eq_wings and pi.player_id=v_uid
    ) q),
    'left_accessory', (select v from (
      select jsonb_build_object('id',pi.id,'item_template_id',it.id,'name',it.name,
        'base_atk',it.base_atk,'base_def',it.base_def,'base_hp',it.base_hp,
        'mastery_type_id',it.mastery_type_id,'bonus_options',pi.bonus_options) as v
      from public.player_inventory pi join public.item_templates it on it.id=pi.item_template_id
      where pi.id=p.eq_left_accessory and pi.player_id=v_uid
    ) q),
    'right_accessory', (select v from (
      select jsonb_build_object('id',pi.id,'item_template_id',it.id,'name',it.name,
        'base_atk',it.base_atk,'base_def',it.base_def,'base_hp',it.base_hp,
        'mastery_type_id',it.mastery_type_id,'bonus_options',pi.bonus_options) as v
      from public.player_inventory pi join public.item_templates it on it.id=pi.item_template_id
      where pi.id=p.eq_right_accessory and pi.player_id=v_uid
    ) q)
  );

  v_stage_status := public.get_stage_status();

  select * into m from public.monsters where id::text = cs.active_monster_id;
  if m.id is not null then
    v_monster := jsonb_build_object(
      'id', m.id::text,
      'name', m.name,
      'monster_name', m.name,
      'monster_type', m.monster_type,
      'type', m.monster_type,
      'monster_level', coalesce(cs.active_monster_level, m.monster_level),
      'is_boss', m.is_boss,
      'monster_hp', coalesce(cs.monster_hp,
        greatest(1, round(30 * power(coalesce(cs.active_monster_level,m.monster_level,1), 1.20)))::bigint
        * case when m.monster_type='elite' then 3 when m.monster_type='boss' then 8 else 1 end),
      'monster_max_hp', greatest(1, round(30 * power(coalesce(cs.active_monster_level,m.monster_level,1), 1.20)))::bigint
        * case when m.monster_type='elite' then 3 when m.monster_type='boss' then 8 else 1 end,
      'monster_atk', greatest(1, round(2 * power(coalesce(cs.active_monster_level,m.monster_level,1), 1.05)))::integer
        * case when m.monster_type='elite' then 2 when m.monster_type='boss' then 4 else 1 end
    );
  else
    v_monster := null;
  end if;

  select z.theme_key into v_theme
  from public.zones z
  where s.current_farm_stage between z.start_stage and z.end_stage
  order by z.start_stage desc limit 1;

  return jsonb_build_object(
    'success', true,
    'player', jsonb_build_object(
      'id', p.id, 'nickname', p.nickname, 'level', p.level, 'job_level', p.job_level,
      'exp', p.exp, 'gold', p.gold, 'gems', p.gems,
      'active_pet_skin', p.active_pet_skin, 'pet', p.active_pet_skin,
      'weapon_type', v_weapon_type, 'character_created', p.character_created
    ),
    'stats', jsonb_build_object(
      'atk', v_atk,
      'hard_def', v_hard_def,
      'soft_def', v_soft_def,
      'def', v_hard_def + v_soft_def,
      'hp', least(v_max_hp, greatest(0, coalesce(cs.player_hp, v_max_hp))),
      'max_hp', v_max_hp,
      'aspd', 1.0,
      'hit', round(v_hit * 100, 2),
      'flee', round(v_flee * 100, 2),
      'crit', round(v_crit * 100, 2),
      'str', coalesce(ps.str, 0), 'agi', coalesce(ps.agi, 0),
      'vit', coalesce(ps.vit, 0), 'dex', coalesce(ps.dex, 0),
      'luk', coalesce(ps.luk, 0), 'int', coalesce(ps.int_stat, 0),
      'stat_points', coalesce(ps.stat_points, 0)
    ),
    'equipment', v_equipment,
    'inventory', v_inventory,
    'map', jsonb_build_object('stageId', s.current_farm_stage, 'theme', coalesce(v_theme, 'forest')),
    'stageStatus', v_stage_status,
    'monster', v_monster,
    'combat', jsonb_build_object(
      'player_hp', least(v_max_hp, greatest(0, coalesce(cs.player_hp, v_max_hp))),
      'player_max_hp', v_max_hp,
      'monster_hp', cs.monster_hp, 'monster_max_hp', cs.monster_max_hp,
      'player_dead_until', cs.player_dead_until,
      'ultimate_ready_at', cs.ultimate_ready_at
    )
  );
end;
$function$;

revoke all on function public.get_player_game_state() from public, anon;
grant execute on function public.get_player_game_state() to authenticated;
