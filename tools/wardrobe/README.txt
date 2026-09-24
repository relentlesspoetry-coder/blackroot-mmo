BlackRoot: RealmFall -- Male base MODULAR WARDROBE: 50 outfits, every piece its own item

Slots: shirt, pants, hat, boots, gloves, cape.  Object names: <Slot>_<Style>_<Colour>  (e.g. Shirt_Doublet_Crimson,
Boots_Cuffed_Black, Cape_Royal_Royal).  A pair of boots or gloves is ONE item.  All pieces are skinned to the same
83-bone skeleton (80 deform joints) as the male base, so any piece can be shown/hidden or swapped on the base at runtime
and every animation clip works on every combination.

outfits/NN_Title/   BlackRoot_Fighter_LowPoly_Rigged_wardrobe_N.blend/.glb = the male base wearing outfit N,
                    checks.txt (152 checks), stress_metrics.txt (28 poses), object_manifest.txt, renders/ (rest views, skeleton, 9 key poses)
library/            BlackRoot_Fighter_LowPoly_Rigged_wardrobe_all.blend/.glb = the male base wearing EVERY unique piece at once,
                    one skin: the asset library to pull individual pieces from
wardrobe_manifest.json   outfit index/title -> slot -> {object name, style, colour, trim, metal}
Wardrobe_Sheet_1..7.png  front / three-quarter / back / head of every outfit;  Wardrobe_Poses_1..5.png  key poses of every outfit

Rebuild any outfit:  blender -b -P BlackRoot_Fighter_LowPoly_Rigged.py -- --out <dir> --outfit wardrobe_N   (N = 1..50, or wardrobe_all)
Styles (see WARDROBE / w_* in the script):
  shirts  tunic vest tabard jerkin coat doublet mail cuirass brigandine robe poncho scale_vest harness long_tunic padded_jack wrap apron half_plate kimono fur_vest surcoat
  pants   trousers shorts baggy breeches striped patched kilt plate wrapped puffed hakama sarong hose torn banded scale_legs loincloth
  hats    cap hood wide_brim kettle nasal_helm great_helm morion bandana crown turban straw wizard beret fur_cap headband coif circlet skull_mask barbute
          plumed_cap sallet conical cowl laurel horned_helm tricorne jester_cap spiked_helm domino_mask veil_helm skullcap
  boots   shoes tall cuffed fur sabatons strapped sandals riding wraps greaves curled buckled moccasins thigh_high spiked bone_shin plated_tall
  gloves  cloth leather gauntlet long wraps fingerless bracers spiked clawed mail armrings elbow bone wrapped_gauntlet
  capes   cloak tattered short half fur_collar royal feathered scarf sash fur_mantle banner shawl long_scarf torn_short chain_mantle leaf_mantle patterned hooded_cloak
  27 palette colours (cloth + leather), 6 metals, bone.
