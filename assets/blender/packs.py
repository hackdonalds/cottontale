# Which pack each family ships in. The app loads 'core' when you sit down and fetches the
# others the first time a table shows something from them, so nobody downloads a dungeon
# to play in a meadow. Anything not listed here goes in 'core'.
PACKS = {
    'building': ['p_wall', 'p_wallwin', 'p_wallwood', 'p_woodwin', 'p_walldoor', 'p_post', 'p_door', 'p_gate', 'p_arch', 'p_stairs', 'p_ladder',
                 'p_fence', 'p_bridge', 'p_pillar', 'p_well', 'p_fountain', 'p_statue', 'p_tent', 'p_banner', 'p_tombstone', 'p_altar'],
    'nature': ['p_tree', 'p_birch', 'p_poplar', 'p_deadtree', 'p_pine', 'p_palm', 'p_rock', 'p_bush', 'p_reeds', 'p_flowers', 'p_mushroom', 'p_cactus',
               'p_log', 'p_stump', 'p_campfire'],  # a campfire belongs outdoors
    'furniture': ['p_table', 'p_chair', 'p_bench', 'p_bed', 'p_bookshelf', 'p_throne', 'p_rug', 'p_barrel', 'p_crate', 'p_sacks', 'p_cauldron', 'p_anvil', 'p_candles'],
    'heroes': ['m_knight', 'm_paladin', 'm_barbarian', 'm_mage', 'm_cleric', 'm_druid', 'm_rogue', 'm_ranger',
               'm_villager', 'm_merchant', 'm_guard', 'm_child', 'm_pirate', 'm_witch'],
    'creatures': ['m_bunny', 'm_dog', 'm_wolf', 'm_horse', 'm_rat', 'm_bat', 'm_snake', 'm_spider',
                  'm_ogre', 'm_troll', 'm_skeleton', 'm_zombie', 'm_ghost', 'm_imp', 'm_slime', 'm_mimic', 'm_dragon'],
    'dungeon': ['p_stalagmite', 'p_crystal', 'p_torch', 'p_chest', 'p_hoard', 'p_potion', 'p_cage', 'p_bones', 'p_spikes', 'p_coffin', 'p_portal'],
}


def pack_of(family):
    return next((name for name, families in PACKS.items() if family in families), 'core')
