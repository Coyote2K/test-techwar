// kubejs/server_scripts/hubs/30_hub_hp.js
// priority: 30
//
// HUBS HP :
// - En survie : les blocs hub sont incassables (on tape pour enlever des PV)
// - En créatif : casse autorisée + unregisterHub (comme l'ancien broken du 10)
// - Dégâts = dégâts d'attaque du joueur (arme en main) via attribut attack_damage
//
// Dépend de global.HubRegistry (défini dans 10_hub_team_registry.js)

const PROTECTED_BLOCKS = new Set([
  // Mekanism Energy Cubes
  "mekanism:creative_energy_cube",

  // MFFS
  "mffs:projector",
  "mffs:fortron_capacitor"
]);

function HR() { return global.HubRegistry || null; }

function showBaseAttackedCmd(server, teamId) {
  if (!teamId) return;
  const reg = HR();
  reg.runCmdSilentWithServer(server, "ftbteams team message " + teamId + ' Base attaquée, préparez la défense.');
}

function sanitizeId(s) {
  return String(s).toLowerCase().replace(/[^a-z0-9_./-]/g, "_");
}
function nowMs() { return Date.now(); }

// Compatibilité hubs déjà existants (sans hp/maxHp)
function ensureHubHpFields(hub, type) {
  if (!hub) return hub;

  try {
    const reg = HR();
    const maxHp = (hub.maxHp != null) ? Number(hub.maxHp)
      : (reg && reg.maxHpOfType ? Number(reg.maxHpOfType(type)) : 200);

    if (hub.maxHp == null) hub.maxHp = maxHp;
    if (hub.hp == null) hub.hp = maxHp;
    if (hub.dead == null) hub.dead = false;
  } catch (e) {
    if (hub.maxHp == null) hub.maxHp = 200;
    if (hub.hp == null) hub.hp = 200;
    if (hub.dead == null) hub.dead = false;
  }

  return hub;
}

// Anti-spam : évite de vider les PV trop vite
function hitCooldownOk(hub, cooldownMs) {
  const t = nowMs();
  const last = (hub.lastHitMs != null) ? Number(hub.lastHitMs) : 0;
  if ((t - last) < cooldownMs) return false;
  hub.lastHitMs = t;
  return true;
}

// Dégâts = valeur de l’attribut d’attaque (arme + bonus)
function getAttackDamage(player) {
  var dmg = 1;

  try {
    if (player.getAttributeValue) {
      var base = Number(player.getAttributeValue("minecraft:generic.attack_damage"));
      if (!isNaN(base) && base > 0) dmg = base;
    }
  } catch (e) {}

  // ===== AJOUT ENCHANTEMENTS =====
  try {
    var item = player.mainHandItem;
    if (item && item.enchantments) {

      // Sharpness
      var sharp = item.enchantments["minecraft:sharpness"];
      if (sharp != null) {
        var level = Number(sharp);
        // Formule vanilla :
        // 1.25 × level
        dmg += 1.25 * level;
      }

      // Smite (optionnel)
      var smite = item.enchantments["minecraft:smite"];
      if (smite != null) {
        var level2 = Number(smite);
        dmg += 2.5 * level2;
      }
    }
  } catch (e2) {}

  return Math.max(1, Math.floor(dmg));
}
// Récupère l'objet hub correspondant au bloc (et le recrée si désync)
function getOrCreateHubForBlock(server, player, block, type) {
  const reg = HR();
  if (!reg) return null;

  const root = reg.getRoot(server);
  const teamId = reg.teamOf(server, player);
  const dim = reg.asStr(block.level.dimension);

  reg.ensureTeamEntry(root.hubsByTeam, teamId);
  if (!root.hubsByTeam[teamId][type]) root.hubsByTeam[teamId][type] = {};

  const k = reg.keyOf(dim, block.x, block.y, block.z);
  let hub = root.hubsByTeam[teamId][type][k];

  if (!hub) {
    // Désynchronisation : bloc présent mais pas en data -> on réenregistre
    reg.registerHub(server, teamId, type, dim, block.x, block.y, block.z);
    hub = root.hubsByTeam[teamId][type][k];
  }

  ensureHubHpFields(hub, type);

  return { root: root, teamId: teamId, dim: dim, key: k, hub: hub };
}

// ======================================================
// 1) Casse : incassable en survie, cassable en créatif
// ======================================================
BlockEvents.broken(event => {
  const reg = HR();
  if (!reg) return;

  const b = event.block;
  const id = reg.asStr(b.id);
  if (!reg.isHubBlockId(id)) return;

  const p = event.player;

  // Si pas de joueur, on bloque par sécurité
  if (!p) {
    event.cancel();
    return;
  }

  // Créatif : on autorise la casse et on unregister (comportement ancien du 10)
  if (p.isCreative && p.isCreative()) {
    const type = reg.hubTypeOfBlockId(id);
    if (!type) return;

    const teamId = reg.teamOf(event.server, p);
    const dim = reg.asStr(b.level.dimension);

    reg.unregisterHub(event.server, teamId, type, dim, b.x, b.y, b.z);
    reg.log("CREATIVE BREAK hub unregistered team=" + teamId + " type=" + type + " at " + reg.keyOf(dim, b.x, b.y, b.z));

    // Important : on NE cancel PAS, pour que le bloc se casse réellement
    return;
  }

  // Survie (et autres) : on empêche la casse
  p.tell("§cCe coeur est incassable. Frappez-le pour lui enlever des PV.");
  event.cancel();
});

BlockEvents.broken(event => {
  const reg = HR();
  if (!reg) return;

  const b = event.block;
  const id = reg.asStr(b.id);

  // Vérifie si le bloc est dans la liste protégée
  if (PROTECTED_BLOCKS.has(id)) {
    const p = event.player;

    // sécurité
    if (!p) {
      event.cancel();
      return;
    }

    // autoriser en créatif (optionnel)
    if (p.isCreative && p.isCreative()) return;

    p.tell("§cCe bloc est protégé et ne peut pas être cassé.");
    event.cancel();
    return;
  }
});

// ======================================================
// 2) Coups : clic gauche sur bloc hub -> enlève des PV
// ======================================================
BlockEvents.leftClicked(event => {
  const reg = HR();
  if (!reg) return;

  const b = event.block;
  const id = reg.asStr(b.id);
  if (!reg.isHubBlockId(id)) return;

  const p = event.player;
  if (!p) return;

  // Optionnel : en créatif, on peut ignorer les PV (sinon vous pouvez “tuer” en créatif aussi)
  // Si vous voulez que le créatif fasse aussi des dégâts, supprimez ce if.
  if (p.isCreative && p.isCreative()) return;

  const server = event.server;
  const type = reg.hubTypeOfBlockId(id);
  if (!type) return;
  const root = reg.getRoot(server);
  const dim = reg.asStr(b.level.dimension);
  const posKey = reg.keyOf(dim, b.x, b.y, b.z);
  const info = getOrCreateHubForBlock(server, p, b, type);
  if (!info || !info.hub) return;
  var hub = info.hub;
  p.tell("On a la posKey" + posKey);
  p.tell("On a les infos sur le hub : " + hub);

  const attackerTeam = reg.teamOf(server, p);
  p.tell("On a les infos sur la team qui attaque : " + attackerTeam);
  // ✅ ICI : owner est défini
  const owner = root.hubIndexByPos ? root.hubIndexByPos[posKey] : null;

  if (!owner) {
    event.player.tell("§cDEBUG: owner introuvable pour " + posKey);
    return;
  }

  const ownerTeam = String(owner.teamId);
  showBaseAttackedCmd(server, ownerTeam)
  if (hub.dead) {
    p.tell("§7Ce coeur est déjà éteint.");
    return;
  }

  if (!hitCooldownOk(hub, 250)) return;

  const dmg = getAttackDamage(p);
  hub.hp = Math.max(0, Number(hub.hp) - dmg);

  p.tell("§c" + type + " §7PV: §f" + hub.hp + "§7/§f" + hub.maxHp + " §8(-" + dmg + ")");

  if (hub.hp <= 0) {
    hub.dead = true;
    p.tell("§4Le coeur " + type + " est éteint !");
    // Ici : vous choisirez la conséquence (désactivation zone, remplacement bloc, etc.)
  }
});