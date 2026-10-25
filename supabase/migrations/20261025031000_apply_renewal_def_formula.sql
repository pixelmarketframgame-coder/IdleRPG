-- Apply the Renewal-inspired incoming DEF formula to advance_combat.
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
  if position(v_old in v_def) = 0 then raise exception 'Could not locate combat declarations'; end if;
  v_def := replace(v_def, v_old, v_new);

  v_old := '  v_player_atk := greatest(1, round(10 * power(p.level,1.20)) + ((ps.atk_level-1)*5) + (coalesce(ps.str,0)*2) + public.equipped_atk_bonus(v_uid))::integer;';
  v_new := v_old || E'\n  v_player_hard_def := greatest(0, public.equipped_hard_def(v_uid));\n  v_player_soft_def := greatest(0, coalesce(ps.vit,0) + floor((greatest(1,p.level)-1)/2.0)::integer + public.equipped_soft_def_bonus(v_uid));';
  if position(v_old in v_def) = 0 then raise exception 'Could not locate combat ATK formula'; end if;
  v_def := replace(v_def, v_old, v_new);

  v_old := '      v_player_hp := greatest(0,v_player_hp-v_monster_atk);';
  v_new := '      v_damage_taken := greatest(1, floor((v_monster_atk::numeric * (4000 + v_player_hard_def)::numeric / (4000 + 10 * v_player_hard_def)::numeric) - v_player_soft_def)::integer);' || E'\n      v_player_hp := greatest(0,v_player_hp-v_damage_taken);';
  if position(v_old in v_def) = 0 then raise exception 'Could not locate incoming monster damage formula'; end if;
  v_def := replace(v_def, v_old, v_new);
  execute v_def;
end
$migration$;
