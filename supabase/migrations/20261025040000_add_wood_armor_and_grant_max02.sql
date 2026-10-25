-- Add a basic wooden armor template and grant one copy to Max02 for DEF testing.
-- Idempotent: template stats are upserted and inventory grant is not duplicated.
insert into public.item_templates
  (id, name, mastery_type_id, tier, element, base_atk, base_def, base_hp, sprite_key)
values
  ('armor_wood', 'เกราะไม้', 'armor_strength', 1, 'neutral', 0, 25, 0, 'item_armor')
on conflict (id) do update set
  name = excluded.name,
  mastery_type_id = excluded.mastery_type_id,
  tier = excluded.tier,
  element = excluded.element,
  base_atk = excluded.base_atk,
  base_def = excluded.base_def,
  base_hp = excluded.base_hp,
  sprite_key = excluded.sprite_key;

insert into public.player_inventory (player_id, item_template_id, bonus_options)
select p.id, 'armor_wood', '[]'::jsonb
from public.profiles p
where lower(p.nickname) = lower('Max02')
  and not exists (
    select 1
    from public.player_inventory pi
    where pi.player_id = p.id
      and pi.item_template_id = 'armor_wood'
  );
