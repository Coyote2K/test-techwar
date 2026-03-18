// kubejs/server_scripts/hubs/30_hub_hp.js
// priority: 30

const PROTECTED_BLOCKS = new Set([
  "mekanism:creative_energy_cube",
  "mffs:projector",
  "mffs:fortron_capacitor"
]);

const PROTECTION_BREAK_TIMER_BASE_MS = 3 * 60 * 1000;
const HIT_COOLDOWN_BASE_MS = 1000;
const HIT_COOLDOWN_DEF_MS = 4000;
const HUB_HP_PRINCIPAL_PROTECTED_STAGE = "hub_principal_protected";

function HR() { return global.HubRegistry || null; }
function nowMs() { return Date.now(); }
function C(code, text) { return "\u00A7" + code + String(text); }

function sendMessageToTeam(server, targetTeamId, message) {
  if (!server || !targetTeamId || !message) return;

  const reg = HR();
  if (!reg) return;

  const players = server.players;
  if (!players) return;

  for (var pl of players) {
    if (!pl) continue;
    var playerTeamId = String(reg.teamOf(server, pl));
    if (playerTeamId === String(targetTeamId)) {
      pl.tell(String(message));
    }
  }
}

function broadcastHubHpAfterSuccessfulHit(server, attackerTeamId, ownerTeamId, hubType, hp, maxHp, dmg) {
  if (!server) return;

  var ownerMsg =
    C("c", "[ALERTE] Votre hub est attaque! ") +
    C("e", "PV restants: " + hp + "/" + maxHp) +
    C("7", " (-" + dmg + ")");

  var attackerMsg =
    C("b", "[HUB] ") +
    C("f", hubType + " ennemi PV: ") +
    C("e", hp + "/" + maxHp) +
    C("7", " (-" + dmg + ")");

  sendMessageToTeam(server, ownerTeamId, ownerMsg);
  sendMessageToTeam(server, attackerTeamId, attackerMsg);
}

function sanitizeId(s) {
  return String(s).toLowerCase().replace(/[^a-z0-9_./-]/g, "_");
}

function ensureHubProtectionFields(hub, type) {
  if (!hub) return hub;

  if (hub.invulnerableUntilMs == null) hub.invulnerableUntilMs = 0;
  if (hub.protectionUntilMs == null) hub.protectionUntilMs = 0;
  if (hub.protected == null) hub.protected = false;

  if (hub.protectionState == null) {
    if (String(type) === "PRINCIPAL") {
      hub.protectionState = "protected";
      hub.protected = true;
    } else {
      hub.protectionState = (hub.protected === true) ? "protected" : "not_protected";
    }
  }

  return hub;
}

function isHubCurrentlyProtected(hub, type) {
  if (!hub) return true;
  ensureHubProtectionFields(hub, type);

  if (String(type) === "PRINCIPAL") {
    return String(hub.protectionState) !== "not_protected";
  }

  return false;
}

function isHubProtectionArmed(hub, type) {
  if (!hub) return false;
  ensureHubProtectionFields(hub, type);

  if (String(type) === "PRINCIPAL") {
    return String(hub.protectionState) !== "not_protected";
  }

  return (hub.protected === true) || (String(hub.protectionState) === "protected");
}

function consumeHubProtectionAndStartInvuln(hub, type, durationMs) {
  if (!hub) return;
  ensureHubProtectionFields(hub, type);

  hub.protected = false;
  hub.protectionState = "not_protected";
  hub.protectionUntilMs = 0;
  hub.invulnerableUntilMs = nowMs() + Number(durationMs || PROTECTION_BREAK_TIMER_BASE_MS);
}

function isHubInPostShieldInvulnerability(hub, type) {
  if (!hub) return false;
  ensureHubProtectionFields(hub, type);
  return Number(hub.invulnerableUntilMs || 0) > nowMs();
}

function isReviveShieldActive(hub) {
  if (!hub) return false;
  return Number(hub.reviveShieldUntilMs || 0) > nowMs();
}

function isDefMode(root, teamId) {
  if (!root || !teamId) return false;
  if (!root.teamMode) return false;
  var m = root.teamMode[String(teamId)];
  return String(m || "").toUpperCase() === "DEF";
}

function setAtqHeartsForPlayer(server, playerName, enable) {
  var reg = HR();
  if (!reg || !server || !playerName) return;

  if (enable) {
    // +4 hearts (8 HP) via Health Boost II (amplifier 1)
    reg.runCmdSilentWithServer(server, "effect give " + playerName + " minecraft:health_boost 1000000 1 true");
  } else {
    reg.runCmdSilentWithServer(server, "effect clear " + playerName + " minecraft:health_boost");
  }
}

function setAtqHeartsForTeamOnline(server, teamId, enable) {
  var reg = HR();
  if (!reg || !server || !teamId) return;

  var players = server.players;
  if (!players) return;

  for (var pl of players) {
    if (!pl) continue;
    var pid = String(reg.teamOf(server, pl));
    if (pid !== String(teamId)) continue;
    setAtqHeartsForPlayer(server, pl.username, enable);
  }
}

function setTeamMode(server, teamId, mode) {
  var reg = HR();
  if (!reg || !server || !teamId || !mode) return;
  var root = reg.getRoot(server);
  if (!root.teamMode) root.teamMode = {};
  var tid = String(teamId);
  var prev = root.teamMode[tid] ? String(root.teamMode[tid]).toUpperCase() : "PROD";
  var next = String(mode).toUpperCase();

  root.teamMode[tid] = next;

  if (prev !== "ATQ" && next === "ATQ") {
    setAtqHeartsForTeamOnline(server, tid, true);
  } else if (prev === "ATQ" && next !== "ATQ") {
    setAtqHeartsForTeamOnline(server, tid, false);
  }
}

function announceTeamModeChange(server, teamId, mode) {
  if (!server || !teamId || !mode) return;

  var m = String(mode).toUpperCase();
  var title = "";
  var subtitle = "";

  if (m === "DEF") {
    title = "§b🛡 MODE DEF";
    subtitle = "§7Votre base passe en mode Defense";
  } else if (m === "DEV") {
    title = "§a⚙ MODE DEV";
    subtitle = "§7Votre base passe en mode Developpement";
  } else if (m === "ATQ") {
    title = "§c⚔ MODE ATQ";
    subtitle = "§7Votre base passe en mode Attaque";
  } else {
    title = "§eMode " + m;
    subtitle = "§7Le mode de base a change";
  }

  sendTitleToOnlineTeamPlayers(server, teamId, title, subtitle, 10, 70, 20);
}

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

  ensureHubProtectionFields(hub, type);
  return hub;
}

function hitCooldownOk(hub, cooldownMs) {
  const t = nowMs();
  const last = (hub.lastHitMs != null) ? Number(hub.lastHitMs) : 0;
  if ((t - last) < cooldownMs) return false;
  hub.lastHitMs = t;
  return true;
}

function getAttackDamage(player) {
  var dmg = 1;

  try {
    if (player.getAttributeValue) {
      var base = Number(player.getAttributeValue("minecraft:generic.attack_damage"));
      if (!isNaN(base) && base > 0) dmg = base;
    }
  } catch (e) {}

  try {
    var item = player.mainHandItem;
    if (item && item.enchantments) {
      var sharp = item.enchantments["minecraft:sharpness"];
      if (sharp != null) dmg += 1.25 * Number(sharp);

      var smite = item.enchantments["minecraft:smite"];
      if (smite != null) dmg += 2.5 * Number(smite);
    }
  } catch (e2) {}

  if (player && player.stages && player.stages.has("soldat_1")) {
    dmg += 5;
  }

  return Math.max(1, Math.floor(dmg));
}

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
    reg.registerHub(server, teamId, type, dim, block.x, block.y, block.z);
    hub = root.hubsByTeam[teamId][type][k];
  }

  ensureHubHpFields(hub, type);
  return { root: root, teamId: teamId, dim: dim, key: k, hub: hub };
}

function killerRewardStageForDestroyedHub(type, ownerTeamId) {
  if (!type || !ownerTeamId) return null;
  var safeType = sanitizeId(type);
  var safeOwnerTeamId = sanitizeId(ownerTeamId);
  return "hub_killed_" + safeType + "_" + safeOwnerTeamId;
}

function addStageToOnlineTeamPlayers(server, targetTeamId, stage) {
  if (!server || !targetTeamId || !stage) return 0;

  const reg = HR();
  if (!reg) return 0;

  const players = server.players;
  if (!players) return 0;

  var count = 0;
  for (var pl of players) {
    if (!pl) continue;

    var playerTeamId = String(reg.teamOf(server, pl));
    if (playerTeamId !== String(targetTeamId)) continue;

    reg.addStageCmd(server, pl.username, stage);
    count++;
  }

  return count;
}

function applyShieldToTeamHubs(server, teamId, hubType) {
  var reg = HR();
  if (!reg || !server || !teamId || !hubType) return 0;

  var root = reg.getRoot(server);
  reg.ensureTeamEntry(root.hubsByTeam, teamId);

  var hubsMap = (root.hubsByTeam[teamId] && root.hubsByTeam[teamId][hubType])
    ? root.hubsByTeam[teamId][hubType]
    : {};

  var keys = Object.keys(hubsMap);
  var updated = 0;

  for (var i = 0; i < keys.length; i++) {
    var hub = hubsMap[keys[i]];
    if (!hub) continue;

    ensureHubHpFields(hub, hubType);
    hub.protected = true;
    hub.protectionState = "protected";
    hub.protectionUntilMs = 0;
    hub.invulnerableUntilMs = 0;
    updated++;
  }

  return updated;
}

function clearAllReviveShields(server) {
  var reg = HR();
  if (!reg || !server) return 0;

  var root = reg.getRoot(server);
  var hubsByTeam = root.hubsByTeam || {};
  var teamIds = Object.keys(hubsByTeam);
  var cleared = 0;

  for (var i = 0; i < teamIds.length; i++) {
    var teamId = teamIds[i];
    var types = ["ACADEMY", "FACTORY"];

    for (var t = 0; t < types.length; t++) {
      var type = types[t];
      var hubsMap = (hubsByTeam[teamId] && hubsByTeam[teamId][type]) ? hubsByTeam[teamId][type] : {};
      var keys = Object.keys(hubsMap);

      for (var k = 0; k < keys.length; k++) {
        var hub = hubsMap[keys[k]];
        if (!hub) continue;

        if (Number(hub.reviveShieldUntilMs || 0) > 0) {
          hub.reviveShieldUntilMs = 0;
          cleared++;
        }
      }
    }
  }

  return cleared;
}

function tellCommandSource(source, text) {
  if (!source || !text) return;
  try {
    if (source.player) {
      source.player.tell(String(text));
      return;
    }
  } catch (e) {}

  try {
    source.server.tell(String(text));
  } catch (e2) {}
}

ServerEvents.commandRegistry(event => {
  const { commands: Commands } = event;

  event.register(
    Commands.literal("shieldbreak")
      .requires(src => src.hasPermission(2))
      .executes(ctx => {
        var source = ctx.source;
        var server = source.server;

        var cleared = clearAllReviveShields(server);
        tellCommandSource(source, C("c", "[ADMIN] ") + C("f", "Boucliers 24h retires: ") + C("e", String(cleared)));
        return cleared;
      })
  );
});

GameStageEvents.stageAdded(event => {
  var player = event.entity;
  if (!player) return;

  var stage = String(event.stage || "");
  var server = player.server;
  var reg = HR();
  if (!server || !reg) return;

  var teamId = String(reg.teamOf(server, player));

  if (stage === "mod_def") {
    setTeamMode(server, teamId, "DEF");
    reg.removeStageCmd(server, player.username, "mod_def");
    announceTeamModeChange(server, teamId, "DEF");
    sendMessageToTeam(server, teamId, C("b", "[HUB] ") + C("f", "Mode de base: ") + C("e", "DEF"));
    return;
  }

  if (stage === "mod_dev") {
    setTeamMode(server, teamId, "DEV");
    reg.removeStageCmd(server, player.username, "mod_dev");
    announceTeamModeChange(server, teamId, "DEV");
    sendMessageToTeam(server, teamId, C("b", "[HUB] ") + C("f", "Mode de base: ") + C("a", "DEV"));
    return;
  }

  if (stage === "mod_atq") {
    setTeamMode(server, teamId, "ATQ");
    reg.removeStageCmd(server, player.username, "mod_atq");
    announceTeamModeChange(server, teamId, "ATQ");
    sendMessageToTeam(server, teamId, C("b", "[HUB] ") + C("f", "Mode de base: ") + C("c", "ATQ"));
    return;
  }

  if (stage === "factory_shield") {
    reg.removeStageCmd(server, player.username, "factory_shield");
    var countF = applyShieldToTeamHubs(server, teamId, "FACTORY");
    if (countF > 0) {
      sendMessageToTeam(server, teamId, C("b", "[HUB] ") + C("a", "Bouclier ") + C("6", "Factory") + C("a", " restaure."));
    } else {
      player.tell(C("c", "[HUB] Aucun coeur Factory trouve pour votre equipe."));
    }
    return;
  }

  if (stage === "academy_shield") {
    reg.removeStageCmd(server, player.username, "academy_shield");
    var countA = applyShieldToTeamHubs(server, teamId, "ACADEMY");
    if (countA > 0) {
      sendMessageToTeam(server, teamId, C("b", "[HUB] ") + C("a", "Bouclier ") + C("b", "Academy") + C("a", " restaure."));
    } else {
      player.tell(C("c", "[HUB] Aucun coeur Academy trouve pour votre equipe."));
    }
    return;
  }
});

PlayerEvents.loggedIn(event => {
  var player = event.player;
  if (!player) return;

  var server = event.server;
  var reg = HR();
  if (!server || !reg) return;

  var teamId = String(reg.teamOf(server, player));
  var root = reg.getRoot(server);
  var mode = (root.teamMode && root.teamMode[teamId]) ? String(root.teamMode[teamId]).toUpperCase() : "PROD";

  setAtqHeartsForPlayer(server, player.username, mode === "ATQ");
});

BlockEvents.broken(event => {
  const reg = HR();
  if (!reg) return;

  const b = event.block;
  const id = reg.asStr(b.id);
  if (!reg.isHubBlockId(id)) return;

  const p = event.player;
  if (!p) {
    event.cancel();
    return;
  }

  if (p.isCreative && p.isCreative()) {
    const type = reg.hubTypeOfBlockId(id);
    if (!type) return;

    const teamId = reg.teamOf(event.server, p);
    const dim = reg.asStr(b.level.dimension);

    reg.unregisterHub(event.server, teamId, type, dim, b.x, b.y, b.z);
    return;
  }

  p.tell(C("c", "[HUB] Ce coeur est incassable. Frappez-le pour lui enlever des PV."));
  event.cancel();
});

BlockEvents.broken(event => {
  const reg = HR();
  if (!reg) return;

  const b = event.block;
  const id = reg.asStr(b.id);

  if (PROTECTED_BLOCKS.has(id)) {
    const p = event.player;

    if (!p) {
      event.cancel();
      return;
    }

    if (p.isCreative && p.isCreative()) return;

    p.tell(C("c", "[HUB] Ce bloc est protege et ne peut pas etre casse."));
    event.cancel();
  }
});

BlockEvents.leftClicked(event => {
  const reg = HR();
  if (!reg) return;

  const b = event.block;
  const id = reg.asStr(b.id);
  if (!reg.isHubBlockId(id)) return;

  const p = event.player;
  if (!p) return;
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

  const owner = root.hubIndexByPos ? root.hubIndexByPos[posKey] : null;
  if (!owner) {
    event.cancel();
    return;
  }

  const ownerTeam = String(owner.teamId);
  const ownerInDef = isDefMode(root, ownerTeam);
  const attackerTeam = reg.teamOf(server, p);

  // Bouclier de resurrection (Academy/Factory): incassable total pendant 24h
  if ((String(type) === "ACADEMY" || String(type) === "FACTORY") && isReviveShieldActive(hub)) {
    p.tell(C("c", "[HUB] Ce coeur est sous bouclier de resurrection (24h)."));
    event.cancel();
    return;
  }

  // 1) Principal: si stage de protection present ou coeur protege, on annule le coup.
  if (String(type) === "PRINCIPAL") {
    if (p.stages && p.stages.has(HUB_HP_PRINCIPAL_PROTECTED_STAGE)) {
      event.cancel();
      return;
    }

    if (isHubCurrentlyProtected(hub, type)) {
      event.cancel();
      return;
    }
  }

  // 2) Academy/Factory: si protection presente, on la consomme et on lance l'invulnerabilite temporaire.
  if (String(type) !== "PRINCIPAL" && isHubProtectionArmed(hub, type)) {
    var invulnMs = PROTECTION_BREAK_TIMER_BASE_MS * (ownerInDef ? 2 : 1);
    consumeHubProtectionAndStartInvuln(hub, type, invulnMs);

    p.tell(C("e", "[HUB] Protection consommee. Coeur attaquable dans " + Math.floor(invulnMs / 1000) + "s."));
    sendMessageToTeam(server, ownerTeam, C("e", "[HUB] Protection de coeur consommee."));

    event.cancel();
    return;
  }

  // 3) Academy/Factory: pendant timer d'invulnerabilite post-consommation, aucun degat.
  if (String(type) !== "PRINCIPAL" && isHubInPostShieldInvulnerability(hub, type)) {
    event.cancel();
    return;
  }

  if (hub.dead) {
    p.tell(C("7", "[HUB] Ce coeur est deja eteint."));
    event.cancel();
    return;
  }

  const cooldownMs = ownerInDef ? HIT_COOLDOWN_DEF_MS : HIT_COOLDOWN_BASE_MS;
  if (!hitCooldownOk(hub, cooldownMs)) {
    event.cancel();
    return;
  }

  const dmg = getAttackDamage(p);
  hub.hp = Math.max(0, Number(hub.hp) - dmg);

  broadcastHubHpAfterSuccessfulHit(server, attackerTeam, ownerTeam, type, hub.hp, hub.maxHp, dmg);

  if (hub.hp > 0) return;

  hub.dead = true;
  p.tell(C("4", "[HUB] Le coeur " + type + " est eteint !"));

  const killerTeamId = String(attackerTeam);
  const deadHubOwnerTeamId = String(ownerTeam);
  const rewardStage = killerRewardStageForDestroyedHub(type, deadHubOwnerTeamId);

  if (rewardStage) {
    addStageToOnlineTeamPlayers(server, killerTeamId, rewardStage);

    sendMessageToTeam(
      server,
      killerTeamId,
      C("a", "[HUB] Votre equipe a detruit le coeur " + type + " de l'equipe ") + C("f", deadHubOwnerTeamId) + C("a", ".")
    );
  }

  sendMessageToTeam(
    server,
    deadHubOwnerTeamId,
    C("4", "[HUB] Votre coeur " + type + " a ete detruit.")
  );
});

function getTeamNameByTeamId(root, teamId) {
  if (!root || !teamId) return null;

  const playerTeam = root.playerTeam || {};
  const playerTeamName = root.playerTeamName || {};
  const uuids = Object.keys(playerTeam);

  for (let i = 0; i < uuids.length; i++) {
    const uuid = uuids[i];

    if (String(playerTeam[uuid]) === String(teamId)) {
      const name = playerTeamName[uuid];
      if (name != null && String(name).length > 0) return String(name);
    }
  }

  return null;
}

function stripAfterHash(text) {
  if (!text) return text;
  var s = String(text);
  var i = s.indexOf("#");
  if (i === -1) return s;
  return s.substring(0, i);
}

BlockEvents.rightClicked(event => {
  const reg = HR();
  if (!reg) return;
  if (event.hand != "MAIN_HAND") return;

  const b = event.block;
  const id = reg.asStr(b.id);
  if (!reg.isHubBlockId(id)) return;

  const p = event.player;
  if (!p) return;
  if (p.isCrouching && p.isCrouching()) return;

  const server = event.server;
  const type = reg.hubTypeOfBlockId(id);
  if (!type) return;

  const root = reg.getRoot(server);
  const dim = reg.asStr(b.level.dimension);
  const posKey = reg.keyOf(dim, b.x, b.y, b.z);

  const owner = root.hubIndexByPos ? root.hubIndexByPos[posKey] : null;
  if (!owner) {
    p.tell(C("c", "[HUB] Impossible de retrouver le proprietaire de ce coeur."));
    return;
  }

  const ownerTeamId = String(owner.teamId);
  var ownerTeamName = stripAfterHash(getTeamNameByTeamId(root, ownerTeamId));
  if (!ownerTeamName) ownerTeamName = ownerTeamId;

  const hub = root.hubsByTeam[ownerTeamId] &&
              root.hubsByTeam[ownerTeamId][type] &&
              root.hubsByTeam[ownerTeamId][type][posKey];

  if (!hub) {
    p.tell(C("c", "[HUB] Impossible de retrouver les donnees du coeur."));
    return;
  }

  ensureHubHpFields(hub, type);
  var protectedNow = (String(type) === "PRINCIPAL")
    ? isHubCurrentlyProtected(hub, type)
    : isHubProtectionArmed(hub, type);
  var reviveShieldNow = (String(type) === "ACADEMY" || String(type) === "FACTORY") && isReviveShieldActive(hub);

  p.tell(C("6", "=== Informations du coeur ==="));
  p.tell(C("e", "Type: ") + C("f", type));
  p.tell(C("e", "Equipe proprietaire: ") + C("f", ownerTeamName));
  p.tell(C("e", "Points de vie: ") + C("f", hub.hp + "/" + hub.maxHp));
  p.tell(C("e", "Protection: ") + (protectedNow ? C("a", "active") : C("c", "inactive")));
  if (String(type) === "ACADEMY" || String(type) === "FACTORY") {
    p.tell(C("e", "Bouclier resurrection: ") + (reviveShieldNow ? C("a", "actif") : C("c", "inactif")));
  }

  if (hub.dead) p.tell(C("e", "Statut: ") + C("c", "eteint"));
  else p.tell(C("e", "Statut: ") + C("a", "actif"));
});

function sendTitleToOnlineTeamPlayers(server, targetTeamId, titleText, subtitleText, fadeIn, stay, fadeOut) {
  if (!server || !targetTeamId) return 0;
  if (!global.HubRegistry) return 0;

  var reg = global.HubRegistry;
  var players = server.players;
  if (!players) return 0;

  var count = 0;
  var fi = (fadeIn != null) ? Number(fadeIn) : 10;
  var st = (stay != null) ? Number(stay) : 60;
  var fo = (fadeOut != null) ? Number(fadeOut) : 20;

  for (var pl of players) {
    if (!pl) continue;

    var playerTeamId = String(reg.teamOf(server, pl));
    if (playerTeamId !== String(targetTeamId)) continue;

    reg.runCmdSilentWithServer(server, "title " + pl.username + " times " + fi + " " + st + " " + fo);

    if (titleText && String(titleText).length > 0) {
      reg.runCmdSilentWithServer(server, "title " + pl.username + " title " + JSON.stringify(String(titleText)));
    }

    if (subtitleText && String(subtitleText).length > 0) {
      reg.runCmdSilentWithServer(server, "title " + pl.username + " subtitle " + JSON.stringify(String(subtitleText)));
    }

    count++;
  }

  return count;
}
