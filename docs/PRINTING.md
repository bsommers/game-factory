# Printing RAT OPS models

All files live in `dist/print/{characters,weapons,props,levels}/` as `.obj` (+ `.mtl`, per-material colours) and `.stl`.
**Units are millimetres (1 file unit = 1 mm), Z up.** Scale is in the file name (`_h75mm_1to26` = 75 mm tall, 1:26;
`_1to35` = 1:35). Every file is ONE watertight manifold shell (no loose parts, positive volume), on a small plinth for
characters/props. Beds: everything fits 220x220x250 mm.

General-purpose generation, conversion, validation and print prep for any model (STL, 3MF, OBJ, GLB, PLY): see `docs/MODELS.md` (`models.verify`, `models.print-prep`).

## Scales
- Characters: hero 75 mm; rats in proportion to in-game height (mouse 1.4 m ... boss 3.2 m, boss scaled to its 3.2 m spec and
  capped to the bed). Squad plate: hero + 6 rats on 200x200 mm base.
- Weapons and props: nominal 1:35 (small items enlarged to be printable, ratio in name).
- Level dioramas (walls 2.5 mm min, floor slab >= 2.5 mm, open roof, doorways cut, wall height x2 exaggerated for legibility):
  - `e1m6_castle_full_1to640`: whole castle level (e1m6, the most castle-like) on one 200x200 plate.
  - `e1m6_castle_tile_r{0,1}c{0,1}_1to320`: the same level at 2x scale split in 4 tiles. Each tile has a tab on its east/south
    edge and a matching slot on its west/north edge (6.25 mm overhang): print all four and push together (glue optional).
  - `e1m1_room_cellar_1to250`, `e1m5_room_vault_1to250`: room-scale sections for tabletop use.
- Regenerate: `node tools/print_levels.mjs`; `blender -b -P tools/blender/print_export.py -- build|verify|contact`;
  test: `python3 game/tests/test_print_models.py`. Contact sheets: `out/previews/print-models/`.

## Print advice
Characters: 0.1 mm layers, supports for arms/weapons, resin preferred (fine detail). Min wall below is an estimate by
ray sampling; items under 1.2 mm (rat whiskers, tail tips) were thickened or dropped. Boss is the weakest model:
its rest pose is hunched and a rig-bind artefact leaves thin blades (rocket-launcher/spikes), check in the slicer.

## Verification table (re-imported in Blender headless)
| file | triangles | bbox mm (x y z) | volume mm3 | manifold | min wall mm (est) | STL MB |
|---|---|---|---|---|---|---|
| characters/hero_h75mm_1to26.obj | 68684 | 56.8 x 42.8 x 76.5 | 14897 | yes | 2.52 | 3.4 |
| characters/rat_boss_h125mm_1to27.obj | 440104 | 83.3 x 150.1 x 128.5 | 133496 | yes | 1.70 | 22.0 |
| characters/rat_mouse_h59mm_1to26.obj | 58160 | 40.3 x 48.2 x 59.7 | 9210 | yes | 1.17 | 2.9 |
| characters/rat_officer_h71mm_1to26.obj | 89788 | 45.4 x 60.9 x 73.4 | 15278 | yes | 1.06 | 4.5 |
| characters/rat_panzer_h91mm_1to26.obj | 180496 | 58.2 x 101.0 x 93.1 | 46935 | yes | 2.23 | 9.0 |
| characters/rat_sewer_h62mm_1to26.obj | 61524 | 40.6 x 54.4 x 62.4 | 10106 | yes | 2.33 | 3.1 |
| characters/rat_trooper_h69mm_1to26.obj | 93012 | 47.5 x 58.7 x 70.4 | 16255 | yes | 1.03 | 4.7 |
| characters/squad_plate_200x200mm_1to32.obj | 434016 | 200.7 x 200.7 x 101.5 | 240521 | yes | 0.62 | 21.7 |
| levels/e1m1_room_cellar_1to250.obj | 105600 | 192.0 x 192.0 x 51.2 | 614400 | yes | 3.20 | 5.3 |
| levels/e1m5_room_vault_1to250.obj | 119072 | 192.0 x 208.0 x 51.2 | 741507 | yes | 3.20 | 6.0 |
| levels/e1m6_castle_full_1to640.obj | 156440 | 200.0 x 200.0 x 21.2 | 341992 | yes | 2.50 | 7.8 |
| levels/e1m6_castle_tile_r0c0_1to320.obj | 144336 | 206.2 x 206.2 x 40.0 | 665344 | yes | 2.50 | 7.2 |
| levels/e1m6_castle_tile_r0c1_1to320.obj | 147376 | 200.0 x 206.2 x 40.0 | 670338 | yes | 2.50 | 7.4 |
| levels/e1m6_castle_tile_r1c0_1to320.obj | 183496 | 206.2 x 200.0 x 40.0 | 548434 | yes | 2.50 | 9.2 |
| levels/e1m6_castle_tile_r1c1_1to320.obj | 174224 | 200.0 x 200.0 x 40.0 | 452652 | yes | 2.50 | 8.7 |
| props/prop_ammo_box_1to21.obj | 16860 | 24.8 x 18.0 x 15.4 | 5066 | yes | 4.51 | 0.8 |
| props/prop_ammo_clip_1to7.obj | 28100 | 28.0 x 28.0 x 23.3 | 9112 | yes | 3.18 | 1.4 |
| props/prop_barrel_1to35.obj | 20856 | 20.2 x 20.4 x 26.1 | 7043 | yes | 17.64 | 1.0 |
| props/prop_battery_1to10.obj | 14556 | 15.1 x 15.1 x 25.0 | 4623 | yes | 3.63 | 0.7 |
| props/prop_brie_wheel_1to28.obj | 11708 | 24.3 x 24.3 x 5.3 | 1957 | yes | 1.92 | 0.6 |
| props/prop_candelabra_1to35.obj | 10196 | 15.0 x 14.2 x 41.5 | 882 | yes | 1.27 | 0.5 |
| props/prop_catnip_1to19.obj | 12468 | 15.2 x 15.1 x 26.1 | 1520 | yes | 0.75 | 0.6 |
| props/prop_cauldron_1to35.obj | 31296 | 32.0 x 28.5 x 24.0 | 10444 | yes | 2.40 | 1.6 |
| props/prop_chair_1to35.obj | 12084 | 13.7 x 13.7 x 28.7 | 1029 | yes | 0.88 | 0.6 |
| props/prop_cheese_crown_1to18.obj | 25588 | 24.9 x 24.9 x 14.9 | 3516 | yes | 2.24 | 1.3 |
| props/prop_cheese_stack_1to34.obj | 20536 | 24.9 x 24.9 x 17.0 | 7292 | yes | 13.62 | 1.0 |
| props/prop_cheese_wedge_1to26.obj | 17028 | 28.0 x 28.0 x 7.7 | 2856 | yes | 3.18 | 0.8 |
| props/prop_cheese_wheel_1to23.obj | 13996 | 24.9 x 24.9 x 8.2 | 3581 | yes | 7.67 | 0.7 |
| props/prop_crate_1to35.obj | 33524 | 26.1 x 28.1 x 25.8 | 17347 | yes | 22.20 | 1.7 |
| props/prop_fish_treat_1to12.obj | 16288 | 26.3 x 24.6 x 10.8 | 2965 | yes | 2.79 | 0.8 |
| props/prop_key_gold_1to13.obj | 8148 | 26.1 x 8.9 x 9.7 | 996 | yes | 2.09 | 0.4 |
| props/prop_key_silver_1to14.obj | 6644 | 28.0 x 7.2 x 7.5 | 740 | yes | 1.95 | 0.3 |
| props/prop_lamp_1to35.obj | 11476 | 15.3 x 15.3 x 50.3 | 1190 | yes | 1.89 | 0.6 |
| props/prop_mousetrap_1to9.obj | 12480 | 28.0 x 17.2 x 7.4 | 2247 | yes | 3.49 | 0.6 |
| props/prop_pillar_1to35.obj | 110140 | 34.1 x 34.1 x 103.4 | 36080 | yes | 0.87 | 5.5 |
| props/prop_sandbags_1to35.obj | 40328 | 71.3 x 10.7 x 18.2 | 7168 | yes | 6.07 | 2.0 |
| props/prop_shelf_1to35.obj | 99588 | 45.9 x 12.3 x 57.1 | 11536 | yes | 1.66 | 5.0 |
| props/prop_statue_1to35.obj | 48640 | 30.0 x 29.4 x 61.4 | 14519 | yes | 2.05 | 2.4 |
| props/prop_table_1to35.obj | 26512 | 31.8 x 31.8 x 25.8 | 3048 | yes | 2.39 | 1.3 |
| props/prop_torch_1to26.obj | 5716 | 8.5 x 11.1 x 26.2 | 555 | yes | 3.08 | 0.3 |
| props/prop_tuna_1to8.obj | 26472 | 27.4 x 27.4 x 19.6 | 7966 | yes | 3.17 | 1.3 |
| props/prop_yarn_ammo_1to21.obj | 34656 | 24.6 x 25.6 x 16.3 | 4805 | yes | 2.14 | 1.7 |
| weapons/weapon_claws_1to18.obj | 7072 | 10.5 x 23.6 x 8.8 | 1012 | yes | 0.79 | 0.3 |
| weapons/weapon_gatling_1to35.obj | 9112 | 18.0 x 27.9 x 11.7 | 1105 | yes | 1.17 | 0.5 |
| weapons/weapon_laser_1to17.obj | 5708 | 7.2 x 28.0 x 4.7 | 655 | yes | 3.15 | 0.3 |
| weapons/weapon_pistol_1to14.obj | 6728 | 7.2 x 26.2 x 18.1 | 712 | yes | 1.26 | 0.3 |
| weapons/weapon_yarn_1to35.obj | 6920 | 7.2 x 29.9 x 10.3 | 775 | yes | 3.46 | 0.3 |
