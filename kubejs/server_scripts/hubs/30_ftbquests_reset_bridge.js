// kubejs/server_scripts/hubs/30_ftbquests_reset_bridge.js
// priority: 1

global.FTBQuestsBridge = global.FTBQuestsBridge || {};
function C(code, text) { return "\u00A7" + code + String(text); }

global.FTBQuestsBridge.resetQuest = function(player, questId) {
  if (!player || !questId) return false;

  const server = player.server;
  if (!server) return false;

  const raw = "ftbquests change_progress " + player.username + " reset " + questId;
  const cmd = String(raw).trim().replace(/^\//, "");

  try {
    server.runCommandSilent(cmd);
    return true;
  } catch (e) {
    console.log("[FTBQB] reset Quest failed cmd=/" + cmd + " err=" + e);
    return false;
  }
};

const QUEST_ID = "7BC3DD6540DEDE8F";
const HUB_TYPE = "ACADEMY";
const DROP_ITEM = "minecraft:iron_ingot";
const DROP_PERIOD_TICKS = 20 * 60;
const DROP_TOTAL_COUNT = 32;
const REVIVE_SHIELD_DURATION_MS = 24 * 60 * 60 * 1000;

global.__DROP_JOBS__ = global.__DROP_JOBS__ || [];

function getFreeStageByHubType(hubType) {
  if (String(hubType) === "ACADEMY") return "free_academy";
  if (String(hubType) === "FACTORY") return "free_factory";
  return null;
}

function hasActiveDropJob(teamId, hubType) {
  var jobs = global.__DROP_JOBS__ || [];
  for (var i = 0; i < jobs.length; i++) {
    var j = jobs[i];
    if (!j) continue;
    if (String(j.teamId) === String(teamId) && String(j.hubType) === String(hubType)) return true;
  }
  return false;
}

function dropOverTime(player, teamId, hubType, dimensionId, x, y, z, periodTicks, totalCount, itemId, stackSize) {
  if (!player || !player.level || !global.HubRegistry) return;
  if (stackSize == null) stackSize = 1;
  if (totalCount <= 0) return;

  global.__DROP_JOBS__.push({
    player: player,
    teamId: String(teamId),
    hubType: String(hubType),
    dim: String(dimensionId),
    x: x, y: y, z: z,
    periodTicks: periodTicks,
    ticksLeft: periodTicks,
    itemId: String(itemId),
    stackSize: stackSize,
    remaining: totalCount
  });
}

function startDropsForTeamHub(player, hubType, periodTicks, totalCount, itemId, stackSize) {
  if (!player || !player.server || !global.HubRegistry) return false;

  var server = player.server;
  var reg = global.HubRegistry;
  var root = reg.getRoot(server);
  var teamId = reg.teamOf(server, player);

  if (reg.isProductionLocked(server, teamId, hubType)) {
    player.tell(C("c", "[PROD] Production deja en cours pour ce hub."));
    return false;
  }

  reg.ensureTeamEntry(root.hubsByTeam, teamId);

  var hubsMap = (root.hubsByTeam[teamId] && root.hubsByTeam[teamId][hubType])
    ? root.hubsByTeam[teamId][hubType]
    : {};

  var keys = Object.keys(hubsMap);
  if (keys.length === 0) return false;

  reg.setProductionLock(server, teamId, hubType, true);

  for (var i = 0; i < keys.length; i++) {
    var hub = hubsMap[keys[i]];
    if (!hub) continue;

    var x = hub.x, y = hub.y, z = hub.z, dim = hub.dim;
    if (x == null || y == null || z == null || !dim) continue;

    dropOverTime(player, teamId, hubType, dim, x, y, z, periodTicks, totalCount, itemId, stackSize);
  }

  return true;
}

ServerEvents.tick(event => {
  var jobs = global.__DROP_JOBS__;
  var server = event.server;
  if (!jobs || jobs.length === 0) return;

  for (var i = jobs.length - 1; i >= 0; i--) {
    var j = jobs[i];

    j.ticksLeft--;
    if (j.ticksLeft > 0) continue;
    j.ticksLeft = j.periodTicks;

    var player = j.player;
    if (!player || !player.level) {
      jobs.splice(i, 1);
      continue;
    }

    var isInHub = global.HubRegistry.isPlayerNearType(server, player, j.teamId, j.hubType);
    if (!isInHub) continue;

    var level = server.getLevel(j.dim);
    if (!level) continue;

    var qtyNow = Math.min(j.stackSize, j.remaining);
    spawnItemStack(level, j.itemId, qtyNow, j.x + 0.5, j.y + 1.0, j.z + 0.5);
    j.remaining -= qtyNow;

    if (j.remaining > 0) continue;

    jobs.splice(i, 1);

    if (hasActiveDropJob(j.teamId, j.hubType)) continue;

    global.HubRegistry.setProductionLock(server, j.teamId, j.hubType, false);

    var freeStage = getFreeStageByHubType(j.hubType);
    if (freeStage) {
      global.HubRegistry.addStageCmd(server, player.username, freeStage);
    }
  }
});

FTBQuestsEvents.completed(event => {
  if (!global.HubRegistry) return;

  const obj = event.getObject();
  const objId = obj && obj.id ? String(obj.id) : "";
  if (objId !== QUEST_ID) return;

  const player = event.player;
  if (!player) return;

  startDropsForTeamHub(player, HUB_TYPE, DROP_PERIOD_TICKS, DROP_TOTAL_COUNT, DROP_ITEM, 1);
});

function reviveTeamHub(server, teamId, hubType, grantReviveShield) {
  var reg = global.HubRegistry;
  if (!reg || !server || !teamId || !hubType) return false;

  var root = reg.getRoot(server);
  reg.ensureTeamEntry(root.hubsByTeam, teamId);

  var hubsMap = (root.hubsByTeam[teamId] && root.hubsByTeam[teamId][hubType])
    ? root.hubsByTeam[teamId][hubType]
    : {};

  var keys = Object.keys(hubsMap);
  if (keys.length === 0) return false;

  var revived = false;

  for (var i = 0; i < keys.length; i++) {
    var key = keys[i];
    var hub = hubsMap[key];
    if (!hub) continue;

    var maxHp = (hub.maxHp != null)
      ? Number(hub.maxHp)
      : Number(reg.maxHpOfType(hubType));

    hub.maxHp = maxHp;
    hub.hp = maxHp;
    hub.dead = false;
    if (grantReviveShield === true) {
      hub.reviveShieldUntilMs = Date.now() + REVIVE_SHIELD_DURATION_MS;
    }

    if (hub.lastHitMs != null) hub.lastHitMs = 0;

    revived = true;
  }

  return revived;
}

function getTeamMode(root, teamId) {
  if (!root || !teamId) return "prod";
  if (!root.teamMode) return "prod";
  return root.teamMode[teamId] ? String(root.teamMode[teamId]) : "prod";
}

GameStageEvents.stageAdded(event => {
  var stage = String(event.stage || "");
  var player = event.entity;
  if (!player) return;

  var server = player.server;
  if (!server || !global.HubRegistry) return;

  if (stage === "academy_revive") {
    player.stages.remove("academy_revive");
    global.FTBQuestsBridge.resetQuest(player, "738AC2F34C7DA91E");

    var teamIdA = global.HubRegistry.teamOf(server, player);
    var okA = reviveTeamHub(server, teamIdA, "ACADEMY", true);

    if (okA) player.tell(C("a", "[HUB] Coeur Academy reactive. Bouclier absolu: 24h."));
    else player.tell(C("c", "[HUB] Aucun coeur Academy trouve pour votre equipe."));
    return;
  }

  if (stage === "factory_revive") {
    player.stages.remove("factory_revive");
    global.FTBQuestsBridge.resetQuest(player, "738AC2F34C7DA91E");

    var teamIdF = global.HubRegistry.teamOf(server, player);
    var okF = reviveTeamHub(server, teamIdF, "FACTORY", true);

    if (okF) player.tell(C("a", "[HUB] Coeur Factory reactive. Bouclier absolu: 24h."));
    else player.tell(C("c", "[HUB] Aucun coeur Factory trouve pour votre equipe."));
    return;
  }

  if (stage === "quest_drop_iron" || stage === "quest_drop_iron_1") {
    player.stages.remove("quest_drop_iron");
    player.stages.remove("quest_drop_iron_1");

    var teamId1 = global.HubRegistry.teamOf(server, player);
    var root1 = global.HubRegistry.getRoot(server);
    var mod1 = getTeamMode(root1, teamId1);

    var mulTime1 = (mod1 === "dev") ? 0.75 : 1.0;
    var mulCount1 = (mod1 === "dev") ? 1.25 : 1.0;

    if (player.stages.has("ingenieur_2") || player.stages.has("ingenieur_3")) {
      mulTime1 *= 0.9;
      mulCount1 *= 2.0;
    }

    var period1 = Math.ceil(20 * 60 * mulTime1);
    var total1 = Math.floor(32 * mulCount1);
    startDropsForTeamHub(player, HUB_TYPE, period1, total1, DROP_ITEM, 1);
    return;
  }

  if (stage === "quest_drop_iron_2") {
    player.stages.remove("quest_drop_iron_2");

    var teamId2 = global.HubRegistry.teamOf(server, player);
    var root2 = global.HubRegistry.getRoot(server);
    var mod2 = getTeamMode(root2, teamId2);

    var mulTime2 = (mod2 === "dev") ? 0.75 : 1.0;
    var mulCount2 = (mod2 === "dev") ? 1.25 : 1.0;

    if (player.stages.has("ingenieur_2") || player.stages.has("ingenieur_3")) {
      mulTime2 *= 0.9;
      mulCount2 *= 2.0;
    }

    var period2 = Math.ceil(20 * 5 * mulTime2);
    var total2 = Math.floor(64 * mulCount2);
    startDropsForTeamHub(player, HUB_TYPE, period2, total2, DROP_ITEM, 1);
    return;
  }

  if (stage === "quest_drop_iron_3") {
    player.stages.remove("quest_drop_iron_3");

    var teamId3 = global.HubRegistry.teamOf(server, player);
    var root3 = global.HubRegistry.getRoot(server);
    var mod3 = getTeamMode(root3, teamId3);

    var mulTime3 = (mod3 === "dev") ? 0.1 : 1.0;
    var mulCount3 = (mod3 === "dev") ? 1.25 : 1.0;

    if (player.stages.has("ingenieur_2") || player.stages.has("ingenieur_3")) {
      mulTime3 *= 0.8;
      mulCount3 *= 2.0;
    }

    var period3 = Math.ceil(20 * 1 * mulTime3);
    var total3 = Math.floor(128 * mulCount3);
    startDropsForTeamHub(player, HUB_TYPE, period3, total3, DROP_ITEM, 1);
    return;
  }
});

function spawnItemStack(level, itemId, count, x, y, z) {
  var ent = level.createEntity("minecraft:item");
  ent.item = Item.of(itemId, count);
  ent.x = x;
  ent.y = y;
  ent.z = z;
  ent.spawn();
}
