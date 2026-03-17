// kubejs/server_scripts/hubs/30_ftbquests_reset_bridge.js
// priority: 1
//
// Bridge minimal pour reset une quête via commande FTB Quests.

global.FTBQuestsBridge = global.FTBQuestsBridge || {};
global.HubDebug = global.HubDebug || {};
log("SCRIPT HUBS CHARGE")

function _normCmd(cmd) {
  const s = String(cmd || "").trim();
  if (!s) return "";
  return s.charAt(0) === "/" ? s.substring(1) : s;
}

global.FTBQuestsBridge.resetQuest = function(player, questId) {
  if (!player || !questId) return false;

  const server = player.server;
  if (!server) return false;

  // Commande FTB Quests : change_progress <player> reset <questId>
  // NB: selon versions, la syntaxe exacte peut varier, mais "change_progress ... reset ..." est la base.
  const cmd = _normCmd("ftbquests change_progress " + player.username + " reset " + questId);

  try {
    server.runCommandSilent(cmd);
    return true;
  } catch (e) {
    console.log("[FTBQB] reset Quest failed cmd=/" + cmd + " err=" + e);
    return false;
  }
};

const QUEST_ID = '7BC3DD6540DEDE8F'
const HUB_TYPE = 'ACADEMY'
const DROP_ITEM = 'minecraft:iron_ingot'

// Stockage en mémoire (pas persistant)
global.__DROP_JOBS__ = global.__DROP_JOBS__ || []

ServerEvents.tick(event => {
  var jobs = global.__DROP_JOBS__
  var server = event.server
  if (!jobs || jobs.length === 0) return

  for (var i = jobs.length - 1; i >= 0; i--) {
    var j = jobs[i]

    j.ticksLeft--
    if (j.ticksLeft > 0) continue
    j.ticksLeft = j.periodTicks

    // ✅ Vérifications de sécurité
    var player = j.player
    if (!player || !player.level) {
      log("[DROP] job supprimé: player invalide")
      jobs.splice(i, 1)
      continue
    }

    // ✅ Drop seulement si le joueur est DANS lsupprimée hub (radius config)
    var isInHub = global.HubRegistry.isPlayerNearType(server, player, j.teamId, j.hubType)
    if (!isInHub) {
      log("[DROP] joueur hors hub -> on ne drop pas (hubType=" + j.hubType + ")")
      continue
    }

    var level = server.getLevel(j.dim)
    if (!level) continue

    var qtyNow = Math.min(j.stackSize, j.remaining)
    spawnItemStack(level, j.itemId, qtyNow, j.x + 0.5, j.y + 1.0, j.z + 0.5)
    j.remaining -= qtyNow
    log("j.remaining = "+ j.remaining)

    if (j.remaining <= 0) {
      jobs.splice(i, 1)
      log("finit avec" + j.hubType)
      if (j.hubType == 'ACADEMY'){addStageCmd(server, player.username, 'free_academy')}
      log("[DROP] job terminé -> supprimé")
    }
  }
})

function dropOverTime(player, teamId, hubType, dimensionId, x, y, z, periodTicks, totalCount, itemId, stackSize) {
  if (!player || !player.level) return
  if (stackSize == null) stackSize = 1
  if (totalCount <= 0) return

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
  })
}



FTBQuestsEvents.completed(event => {
  log("QUEST COMPLETE CATCH"+ QUEST_ID)
  const obj = event.getObject()
  if (obj != "7BC3DD6540DEDE8F"){
    log("Cava oas dutout")
  }
  log("[FTBQ] completed -> type=" + obj.objectType + " id=" + obj.id)
  const server = event.server
  log("On a reconnu loe player " + server);
  const player = event.player
  log("On a reconnu loe player " + player);
  var root = global.HubRegistry.getRoot(server)
  
  global.HubRegistry.ensureTeamEntry(root.hubsByTeam, teamId)
  
  const hubsMap = root.hubsByTeam[teamId][HUB_TYPE] || {}
  
  const keys = Object.keys(hubsMap)
  log("On a catch l'event 3");
  for (var key of keys) {
    var hub = hubsMap[key]

    // on suppose que ton hub stocke x,y,z,dim
    var x = hub.x
    var y = hub.y
    var z = hub.z
    var dim = hub.dim

    if (x == null || y == null || z == null || !dim) continue

    dropOverTime(server, dim, x, y, z, PERIOD_TICKS, TOTAL_COUNT, DROP_ITEM, 1)
  }

})

GameStageEvents.stageAdded(event => {
  // stage ajouté
  var stage = String(event.stage)

  // joueur (l'entité qui reçoit le stage)
  var player = event.entity
  if (!player) return

  var server = player.server
  console.info("[HUBS] stage reçu=" + stage + " par " + player.username + " uuid=" + player.uuid)
  if (stage === "academy_revive") {
  player.stages.remove("academy_revive")
  var questId = "738AC2F34C7DA91E"
  global.FTBQuestsBridge.resetQuest(player, questId)
  var reg = global.HubRegistry
  var root = reg.getRoot(server)
  var teamId = reg.teamOf(server, player)

  var ok = reviveTeamHub(server, teamId, "ACADEMY")

  if (ok) {
    player.tell("§aLe coeur de l'Académie a été réactivé.")
  } else {
    player.tell("§cAucun coeur Académie trouvé pour votre équipe.")
  }

  return
}
  // =====================================================
  // STAGE : quest_drop_iron
  // =====================================================
  if (stage === "quest_drop_iron_1") {

    // Suppression immédiate pour permettre un retrigger plus tard
    player.stages.remove("quest_drop_iron_1")

    // --- votre code existant ---
    var root = global.HubRegistry.getRoot(server)
    var teamId = global.HubRegistry.teamOf(server, player)

    global.HubRegistry.ensureTeamEntry(root.hubsByTeam, teamId)

    var hubsMap = (root.hubsByTeam[teamId] && root.hubsByTeam[teamId][HUB_TYPE])
      ? root.hubsByTeam[teamId][HUB_TYPE]
      : {}

    log("On arrive avant le for " + hubsMap)

    var keys = Object.keys(hubsMap)
    log("On arrive avant le for " + keys)

    for (var i = 0; i < keys.length; i++) {
      log("On est dans le for")
      var hub = hubsMap[keys[i]]
      log("On est dans le for")
      var x = hub.x, y = hub.y, z = hub.z, dim = hub.dim
      if (x == null || y == null || z == null || !dim) continue
    if (mod === 'dev'){
      multiplicateur_time = 0.75
      multiplicateur_count = 1.25
    }
    var hasIngenieur = player.stages.has("ingenieur_2") || player.stages.has("ingenieur_3")
    let multiplicateur_time = 1.0
    let multiplicateur_count = 1.0
    if (hasIngenieur) {
      multiplicateur_time *= 0.9
      multiplicateur_count *= 2.0
    }
    var period_ticks = Math.ceil(20 * 60 * multiplicateur_time)
    log("period tick = " + period_ticks)
    var total_count = Math.floor(32 * multiplicateur_count)
    log-("count item = " + total_count)
    dropOverTime(player, teamId, HUB_TYPE, dim, x, y, z, period_ticks, total_count, DROP_ITEM, 1)
  }

  return
  }

  // =====================================================
  // STAGE : (placeholder) autre stage 1
  // =====================================================
  if (stage === "quest_drop_iron_2") {

    // Suppression immédiate du stage
    player.stages.remove("quest_drop_iron_2")
  var root = global.HubRegistry.getRoot(server)
  var teamId = global.HubRegistry.teamOf(server, player)
  global.HubRegistry.ensureTeamEntry(root.hubsByTeam, teamId)

  var hubsMap = (root.hubsByTeam[teamId] && root.hubsByTeam[teamId][HUB_TYPE])
    ? root.hubsByTeam[teamId][HUB_TYPE]
    : {}

  var keys = Object.keys(hubsMap)

  for (var i = 0; i < keys.length; i++) {
    var hub = hubsMap[keys[i]]
    var x = hub.x, y = hub.y, z = hub.z, dim = hub.dim
    if (x == null || y == null || z == null || !dim) continue
    var mod = getTeamMode(root, teamId)
    let multiplicateur_time = 1.0
    let multiplicateur_count = 1.0
    if (mod === 'dev'){
      multiplicateur_time = 0.75
      multiplicateur_count = 1.25
    }
  var hasIngenieur = player.stages.has("ingenieur_2") || player.stages.has("ingenieur_3")
  
  if (hasIngenieur) {
    log("")
    multiplicateur_time *= 0.9
    multiplicateur_count *= 2.0
  }
    var period_ticks = Math.ceil(20 * 5 * multiplicateur_time)
    log("period tick = " + period_ticks)
    var total_count = Math.floor(64 * multiplicateur_count)
    log-("count item = " + total_count)
    dropOverTime(player, teamId, HUB_TYPE, dim, x, y, z, period_ticks, total_count, DROP_ITEM, 1)
  }

  return
  }

  // =====================================================
  // STAGE : (placeholder) autre stage 2
  // =====================================================
 if (stage === "quest_drop_iron_3") {
  player.stages.remove("quest_drop_iron_3")
  log("on rentre dans drop iron 3")

  var root = global.HubRegistry.getRoot(server)
  var teamId = global.HubRegistry.teamOf(server, player)
  global.HubRegistry.ensureTeamEntry(root.hubsByTeam, teamId)

  var hubsMap = (root.hubsByTeam[teamId] && root.hubsByTeam[teamId][HUB_TYPE])
    ? root.hubsByTeam[teamId][HUB_TYPE]
    : {}

  var keys = Object.keys(hubsMap)

  for (var i = 0; i < keys.length; i++) {
    var hub = hubsMap[keys[i]]
    var x = hub.x, y = hub.y, z = hub.z, dim = hub.dim
    if (x == null || y == null || z == null || !dim) continue
    var mod = getTeamMode(root, teamId)
    let multiplicateur_time = 1.0
    let multiplicateur_count = 1.0
    if (mod === 'dev'){
      multiplicateur_time = 0.1
      multiplicateur_count = 1.25
    }
  var hasIngenieur = player.stages.has("ingenieur_2") || player.stages.has("ingenieur_3")

  if (hasIngenieur) {
    multiplicateur_time *= 0.8
    multiplicateur_count *= 2.0
  }
    var period_ticks = Math.ceil(20 * 1 * multiplicateur_time)
    log("multiplication_time = " + multiplicateur_time)
    log("period tick = " + period_ticks)
    var total_count = Math.floor(128 * multiplicateur_count)
    log-("count item = " + total_count)
    dropOverTime(player, teamId, HUB_TYPE, dim, x, y, z, period_ticks, total_count, DROP_ITEM, 1)
  }

  return
}}

  // Si ce n'est aucun stage géré, on ne fait rien
)

function spawnItemStack(level, itemId, count, x, y, z) {
  var ent = level.createEntity("minecraft:item")
  ent.item = Item.of(itemId, count)     // pile d'items dans l'entité
  ent.x = x
  ent.y = y
  ent.z = z
  ent.spawn()
}