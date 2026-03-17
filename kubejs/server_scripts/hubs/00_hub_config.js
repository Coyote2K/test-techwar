// kubejs/server_scripts/hubs/00_hub_config.js

global.HUBS_PRINCIPAL_STRUCTURE = [
  { dx: 0, dy: 2, dz: 0, block: "mffs:projector", replace: true },
  { dx: 0, dy: -1, dz: 0, block: "minecraft:barrier", replace: true },
  { dx: 0, dy: 1, dz: 0, block: "minecraft:barrier", replace: true },
  { dx: 0, dy: -2, dz: 0, block: "mffs:fortron_capacitor", replace: true },
  { dx: 1, dy: -3, dz: 0, block: "mekanism:creative_energy_cube", replace: true },
  { dx: -1, dy: -1, dz: 0, block: "mffs:biometric_identifier", replace: true },
  { dx: 1, dy: -1, dz: 0, block: "mffs:coercion_deriver", replace: true },
  { dx: 1, dy: -2, dz: 0, block: "mekanism:advanced_universal_cable", replace: true },
];

global.HUBS_CONFIG = {
  DEBUG: true,
  DEBUG_PREFIX: "[HUBS]",
  RADIUS: 12,

  HUB_TYPES: {
    ACADEMY: {
      blockId: "kubejs:base_heart_academy_bloc",
      stage: "hub_academy_access",
      deadStage: "hub_academy_dead_access_lock",
      freeStage:"free_academy",
      freeQuestId : '4B9523489EA21D00',
      questId: "0E3B0E547E0A7F67",

      enterMessage: "§bBienvenue à l'Académie.",
      exitMessage:  "§7Vous quittez l'Académie.",
      maxHp: 200
    },

    FACTORY: {
      blockId: "kubejs:base_heart_factory_bloc",
      stage: "hub_factory_access",
      deadStage: "hub_factory_dead_access",
      freeStage:"free_factory",
      questId: "60AD4B7AFB0B6270",

      enterMessage: "§6Bienvenue à l'Usine.",
      exitMessage:  "§7Vous quittez l'Usine.",
      maxHp: 200
    },

    PRINCIPAL: {
      blockId: "kubejs:base_heart_principal_bloc",
      stage: "hub_principal_access",
      deadStage: "hub_principal_dead_access",
      freeStage:"free_principal",
      questId: "5D4A3EAE22F6C0C0",

      enterMessage: "§dBienvenue au Hub Principal.",
      exitMessage:  "§7Vous quittez le Hub Principal.",
      maxHp: 200
    }
  }
};