-- Renewal-inspired DEF model for TBH Pixel Auto Battler.
-- Hard DEF = equipped item_templates.base_def (+ explicit hard_def bonus options).
-- Soft DEF = VIT + floor((player level - 1) / 2) + explicit DEF bonus options from gear.
-- Generic gear "def" options count as Soft DEF; base_def is counted only as Hard DEF.
-- Incoming damage is calculated server-side. Monster HP reset-on-death / stage rules are unchanged.

create or replace function public.equipped_hard_def(p_player_id uuid)
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
    where p.id = p_player_id and u.item_id is not null
  )
  select coalesce(round(sum(
    coalesce(it.base_def, 0)
    + coalesce((
        select sum(case
          when coalesce(opt->>'value', opt->>'amount', '') ~ '^-?[0-9]+([.][0-9]+)?$'
            then coalesce(opt->>'value', opt->>'amount')::numeric
          else 0
        end)
        from jsonb_array_elements(
          case when jsonb_typeof(pi.bonus_options) = 'array'
            then pi.bonus_options else '[]'::jsonb end
        ) as opt
        where lower(coalesce(opt->>'stat', opt->>'key', opt->>'type', '')) in ('hard_def','harddef')
      ), 0)
    + case
        when jsonb_typeof(pi.bonus_options) = 'object'
          and coalesce(pi.bonus_options->>'hard_def', pi.bonus_options->>'harddef', '') ~ '^-?[0-9]+([.][0-9]+)?$'
          then coalesce(pi.bonus_options->>'hard_def', pi.bonus_options->>'harddef')::numeric
        else 0
      end
  )), 0)::integer
  from equipped_ids e
  join public.player_inventory pi on pi.id = e.item_id and pi.player_id = p_player_id
  join public.item_templates it on it.id = pi.item_template_id;
$function$;

create or replace function public.equipped_soft_def_bonus(p_player_id uuid)
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
    where p.id = p_player_id and u.item_id is not null
  )
  select coalesce(round(sum(
    coalesce((
      select sum(case
        when coalesce(opt->>'value', opt->>'amount', '') ~ '^-?[0-9]+([.][0-9]+)?$'
          then coalesce(opt->>'value', opt->>'amount')::numeric
        else 0
      end)
      from jsonb_array_elements(
        case when jsonb_typeof(pi.bonus_options) = 'array'
          then pi.bonus_options else '[]'::jsonb end
      ) as opt
      where lower(coalesce(opt->>'stat', opt->>'key', opt->>'type', ''))
        in ('def','soft_def','softdef','def_flat','flat_def')
    ), 0)
    + case
        when jsonb_typeof(pi.bonus_options) = 'object'
          and coalesce(pi.bonus_options->>'soft_def', pi.bonus_options->>'softdef',
                       pi.bonus_options->>'def_flat', pi.bonus_options->>'flat_def',
                       pi.bonus_options->>'def', '') ~ '^-?[0-9]+([.][0-9]+)?$'
          then coalesce(pi.bonus_options->>'soft_def', pi.bonus_options->>'softdef',
                        pi.bonus_options->>'def_flat', pi.bonus_options->>'flat_def',
                        pi.bonus_options->>'def')::numeric
        else 0
      end
  )), 0)::integer
  from equipped_ids e
  join public.player_inventory pi on pi.id = e.item_id and pi.player_id = p_player_id;
$function$;

revoke all on function public.equipped_hard_def(uuid) from public, anon, authenticated;
revoke all on function public.equipped_soft_def_bonus(uuid) from public, anon, authenticated;

do $migration$
declare
  v_def text;
  v_old text;
  v_new text;
begin
  v_def := pg_get_functiondef('public.advance_combat(boolean,boolean)'::regprocedure);

  v_old := '  v_player_atk integer;';
  v_new := '  v_player_atk integer;
  v_player_hard_def integer;
  v_player_soft_def integer;
  v_damage_taken integer;';
  if position(v_old in v_def) = 0 then
    raise exception 'Could not locate advance_combat declarations; DEF migration stopped';
  end if;
  v_def := replace(v_def, v_old, v_new);

  v_old := '  v_player_atk := greatest(1, round(10 * power(p.level,1.20)) + ((ps.atk_level-1)*5) + (coalesce(ps.str,0)*2) + public.equipped_atk_bonus(v_uid))::integer;';
  v_new := v_old || E'\n  v_player_hard_def := greatest(0, public.equipped_hard_def(v_uid));\n  v_player_soft_def := greatest(0, coalesce(ps.vit,0) + floor((greatest(1,p.level)-1)/2.0)::integer + public.equipped_soft_def_bonus(v_uid));';
  if position(v_old in v_def) = 0 then
    raise exception 'Could not locate advance_combat ATK formula; DEF migration stopped';
  end if;
  v_def := replace(v_def, v_old, v_new);

  v_old := '      v_player_hp := greatest(0,v_player_hp-v_monster_atk);';
  v_new := '      v_damage_taken := greatest(1, floor((v_monster_atk::numeric * (4000 + v_player_hard_def)::numeric / (4000 + 10 * v_player_hard_def)::numeric) - v_player_soft_def)::integer);' || E'\n      v_player_hp := greatest(0,v_player_hp-v_damage_taken);';
  if position(v_old in v_def) = 0 then
    raise exception 'Could not locate incoming monster damage line; DEF migration stopped';
  end if;
  v_def := replace(v_def, v_old, v_new);
  execute v_def;

  v_def := pg_get_functiondef('public.get_equipment_stat_diagnostics()'::regprocedure);
  v_old := '  v_atk_bonus integer := 0;';
  v_new := '  v_atk_bonus integer := 0;
  v_hard_def_bonus integer := 0;
  v_soft_def_bonus integer := 0;';
  if position(v_old in v_def) = 0 then
    raise exception 'Could not locate diagnostics declarations; DEF migration stopped';
  end if;
  v_def := replace(v_def, v_old, v_new);

  v_old := '  v_atk_bonus := public.equipped_atk_bonus(v_uid);';
  v_new := v_old || E'\n  v_hard_def_bonus := public.equipped_hard_def(v_uid);\n  v_soft_def_bonus := public.equipped_soft_def_bonus(v_uid);';
  if position(v_old in v_def) = 0 then
    raise exception 'Could not locate diagnostics stat calls; DEF migration stopped';
  end if;
  v_def := replace(v_def, v_old, v_new);

  v_old := '    ''equipped_atk_bonus'',v_atk_bonus,';
  v_new := v_old || E'\n    ''equipped_hard_def_bonus'',v_hard_def_bonus,\n    ''equipped_soft_def_bonus'',v_soft_def_bonus,';
  if position(v_old in v_def) = 0 then
    raise exception 'Could not locate diagnostics result fields; DEF migration stopped';
  end if;
  v_def := replace(v_def, v_old, v_new);

  v_old := '      ''normal_attack_uses_equipment_def'',coalesce(position(''equipped_def_bonus(v_uid)'' in v_normal_def)>0,false),';
  v_new := '      ''normal_attack_uses_equipment_def'',false,';
  if position(v_old in v_def) = 0 then raise exception 'Could not locate diagnostics normal DEF flag'; end if;
  v_def := replace(v_def, v_old, v_new);

  v_old := '      ''monster_damage_reduces_by_equipment_def'',coalesce(position(''equipped_def_bonus(v_uid)'' in v_normal_def)>0,false),';
  v_new := '      ''monster_damage_reduces_by_equipment_def'',coalesce(position(''equipped_hard_def(v_uid)'' in v_normal_def)>0,false) and coalesce(position(''equipped_soft_def_bonus(v_uid)'' in v_normal_def)>0,false),';
  if position(v_old in v_def) = 0 then raise exception 'Could not locate diagnostics monster DEF flag'; end if;
  v_def := replace(v_def, v_old, v_new);

  v_old := '      ''note'',''DEF equipment bonus is diagnostic-only until a server DEF formula is implemented.''';
  v_new := '      ''hard_def_formula'',''Renewal-inspired: incoming damage * (4000 + Hard DEF) / (4000 + 10 * Hard DEF)'',
      ''soft_def_formula'',''VIT + floor((level - 1) / 2) + equipped Soft DEF bonus'',
      ''minimum_incoming_damage'',1,
      ''note'',''Equipment base_def is Hard DEF; generic DEF bonus options are Soft DEF. Combat damage is server-authoritative.''';
  if position(v_old in v_def) = 0 then raise exception 'Could not locate diagnostics note'; end if;
  execute replace(v_def, v_old, v_new);
end
$migration$;
