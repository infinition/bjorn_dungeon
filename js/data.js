export const GameData = {
    "items": [
        {
            "id": "rusty_sword",
            "name": "Epee Rouille",
            "type": "weapon",
            "damage": 5,
            "icon": "🗡️",
            "sprite": "assets/items/sword.png",
            "rarity": "common",
            "spawnChance": 0.5
        },
        {
            "id": "potion_heal",
            "name": "Potion",
            "type": "consumable",
            "heal": 20,
            "icon": "🧪",
            "sprite": "assets/items/potion.png",
            "rarity": "common",
            "spawnChance": 0.3
        }
    ],
    "monsters": [
        {
            "id": "skeleton",
            "name": "Squelette",
            "hp": 30,
            "damage": 5,
            "color": "#dddddd",
            "scale": 1,
            "sprite": "assets/sprites/skeleton.png",
            "sound": "bones",
            "spawnChance": 0.6
        },
        {
            "id": "goblin",
            "name": "Gobelin",
            "hp": 20,
            "damage": 5,
            "color": "#dddddd",
            "scale": 1,
            "sprite": "assets/sprites/gobelin.png",
            "sound": "bones",
            "spawnChance": 0.6
        },
        {
            "id": "slime",
            "name": "Slime",
            "hp": 20,
            "damage": 3,
            "color": "#00ff00",
            "scale": 0.8,
            "sprite": "assets/sprites/slime.png",
            "sound": "squish",
            "spawnChance": 0.4
        }
    ],
    "boss": {
        "id": "guardian",
        "name": "Gardien",
        "hp": 200,
        "damage": 15,
        "color": "#ffffff",
        "scale": 1.5,
        "sprite": "assets/sprites/mob1.png",
        "sound": "roar"
    },
    "spells": [
        {
            "id": "rune",
            "name": "Rune",
            "damage": 10,
            "color": "#ffffff",
            "cooldown": 0.5,
            "sound": "zap"
        },
        {
            "id": "void",
            "name": "Void",
            "damage": 15,
            "color": "#aa00ff",
            "cooldown": 1,
            "sound": "woosh"
        },
        {
            "id": "fire",
            "name": "Fire",
            "damage": 20,
            "color": "#ffaa00",
            "cooldown": 1.5,
            "sound": "burn"
        }
    ],
    "environment": {
        "floor": "assets/textures/floor.png",
        "wall": "assets/textures/wall.png",
        "skyColor": "#050505"
    },
    "objects": [
        {
            "id": "chest_common",
            "name": "Coffre",
            "type": "chest",
            "sprite": "assets/sprites/chest_closed.png",
            "spriteOpen": "assets/sprites/chest_opened.png",
            "scale": 0.8,
            "lootTable": ["rusty_sword", "potion_heal"],
            "spawnChance": 0.1
        }
    ]
};