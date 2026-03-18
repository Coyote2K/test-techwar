// kubejs/server_scripts/hubs/32_hub_hp_upgrade.js
// priority: 32

const HP_UPGRADE_AMOUNT = 50;

function increaseHubHpForTeam(server, teamId, type, amount) {
  if (!server || !teamId || !type || !global.HubRegistry) return 0;

  var reg = global.HubRegistry;
  var root = reg.getRoot(server);

  reg.ensureTeamEntry(root.hubsByTeam, teamId);

  var hubsMap = (root.hubsByTeam[teamId] && root.hubsByTeam[teamId][type])
    ? root.hubsByTeam[teamId][type]
    : {};

  var keys = Object.keys(hubsMap);
  if (keys.length === 0) {
    reg.log("[HP UPGRADE] Aucun hub trouvé type=" + type + " team=" + teamId);
    return 0;
  }

  var updated = 0;

  for (var i = 0; i < keys.length; i++) {
    var hub = hubsMap[keys[i]];
    if (!hub) continue;

    if (hub.maxHp == null) hub.maxHp = reg.maxHpOfType(type);
    if (hub.hp == null) hub.hp = hub.maxHp;

    hub.maxHp += amount;
    hub.hp += amount;

    if (hub.hp > hub.maxHp) {
      hub.hp = hub.maxHp;
    }

    reg.log(
      "[HP UPGRADE] team=" + teamId +
      " type=" + type +
      " newHp=" + hub.hp +
      " newMaxHp=" + hub.maxHp
    );

    updated++;
  }

  return updated;
}

GameStageEvents.stageAdded(event => {
  var player = event.entity;
  if (!player) return;

  var stage = String(event.stage || "");
  var server = player.server;
  if (!server || !global.HubRegistry) return;

  var reg = global.HubRegistry;
  var teamId = String(reg.teamOf(server, player));

  // =========================
  // ACADEMY
  // =========================
  if (stage === "add_hp_academy") {
    var countAcademy = increaseHubHpForTeam(server, teamId, "ACADEMY", HP_UPGRADE_AMOUNT);

    reg.removeStageCmd(server, player.username, stage);

    if (countAcademy > 0) {
      player.tell("§aVotre Academy gagne §e+" + HP_UPGRADE_AMOUNT + " HP§a.");
    } else {
      player.tell("§cAucune Academy trouvée.");
    }

    return;
  }

  // =========================
  // FACTORY
  // =========================
  if (stage === "add_hp_factory") {
    var countFactory = increaseHubHpForTeam(server, teamId, "FACTORY", HP_UPGRADE_AMOUNT);

    reg.removeStageCmd(server, player.username, stage);

    if (countFactory > 0) {
      player.tell("§aVotre Factory gagne §e+" + HP_UPGRADE_AMOUNT + " HP§a.");
    } else {
      player.tell("§cAucune Factory trouvée.");
    }

    return;
  }

  // =========================
  // PRINCIPAL
  // =========================
  if (stage === "add_hp_principal") {
    var countPrincipal = increaseHubHpForTeam(server, teamId, "PRINCIPAL", HP_UPGRADE_AMOUNT);

    reg.removeStageCmd(server, player.username, stage);

    if (countPrincipal > 0) {
      player.tell("§aVotre Principal gagne §e+" + HP_UPGRADE_AMOUNT + " HP§a.");
    } else {
      player.tell("§cAucun coeur Principal trouvé.");
    }

    return;
  }
});