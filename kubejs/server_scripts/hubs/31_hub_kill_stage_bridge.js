// kubejs/server_scripts/hubs/31_hub_kill_stage_bridge.js
// priority: 31

function sanitizeStagePart(s) {
  return String(s || "").toLowerCase().replace(/[^a-z0-9_./-]/g, "_");
}

function buildKilledHubStage(hubType, ownerTeamId) {
  if (!hubType || !ownerTeamId) return null;
  return "hub_killed_" + sanitizeStagePart(hubType) + "_" + sanitizeStagePart(ownerTeamId);
}

function parseKilledHubStage(stage) {
  var s = String(stage || "");

  var prefixFactory = "hub_killed_factory_";
  var prefixAcademy = "hub_killed_academy_";
  var prefixPrincipal = "hub_killed_principal_";

  if (s.indexOf(prefixFactory) === 0) {
    return {
      hubType: "factory",
      ownerTeamId: s.substring(prefixFactory.length)
    };
  }

  if (s.indexOf(prefixAcademy) === 0) {
    return {
      hubType: "academy",
      ownerTeamId: s.substring(prefixAcademy.length)
    };
  }

  if (s.indexOf(prefixPrincipal) === 0) {
    return {
      hubType: "principal",
      ownerTeamId: s.substring(prefixPrincipal.length)
    };
  }

  return null;
}

function getOrCreatePrincipalConsumeState(root) {
  if (!root.principalStageConsumedByOwnerTeam) {
    root.principalStageConsumedByOwnerTeam = {};
  }
  return root.principalStageConsumedByOwnerTeam;
}

function ensurePrincipalProtectionFields(hub) {
  if (!hub) return hub;

  if (hub.protectionState == null) hub.protectionState = "protected";
  if (hub.protectionUntilMs == null) hub.protectionUntilMs = 0;

  return hub;
}

function maybeGrantPrincipalStage(player, stageJustAdded) {
  if (!player || !stageJustAdded) return false;

  var parsed = parseKilledHubStage(stageJustAdded);
  if (!parsed) return false;

  var ownerTeamId = parsed.ownerTeamId;
  if (!ownerTeamId) return false;

  var otherType = null;

  if (parsed.hubType === "factory") {
    otherType = "academy";
  } else if (parsed.hubType === "academy") {
    otherType = "factory";
  } else {
    return false;
  }

  var otherStage = buildKilledHubStage(otherType, ownerTeamId);
  var principalStage = buildKilledHubStage("principal", ownerTeamId);

  if (player.stages.has(principalStage)) return false;

  var server = player.server;
  if (!server || !global.HubRegistry) return false;

  var root = global.HubRegistry.getRoot(server);
  var consumeState = getOrCreatePrincipalConsumeState(root);

  // Si déjà consommé pour cette équipe, on ne redonne plus ce stage
  if (consumeState[String(ownerTeamId)] === true) {
    return false;
  }

  if (player.stages.has(otherStage)) {
    global.HubRegistry.addStageCmd(server, player.username, principalStage);
    player.tell("§dVous avez validé Academy + Factory pour cette équipe. Stage Principal accordé.");
    return true;
  }

  return false;
}

function unlockPrincipalHeartForOwnerTeam(server, ownerTeamId, durationMs) {
  if (!server || !ownerTeamId || !global.HubRegistry) return false;

  var reg = global.HubRegistry;
  var root = reg.getRoot(server);

  reg.ensureTeamEntry(root.hubsByTeam, String(ownerTeamId));

  var hubsMap = (root.hubsByTeam[String(ownerTeamId)] && root.hubsByTeam[String(ownerTeamId)]["PRINCIPAL"])
    ? root.hubsByTeam[String(ownerTeamId)]["PRINCIPAL"]
    : {};

  var keys = Object.keys(hubsMap);
  if (keys.length === 0) {
    reg.log("[PRINCIPAL UNLOCK] Aucun coeur PRINCIPAL trouvé pour ownerTeamId=" + ownerTeamId);
    return false;
  }

  var changed = false;
  var untilMs = Date.now() + Number(durationMs || 600);

  for (var i = 0; i < keys.length; i++) {
    var key = keys[i];
    var hub = hubsMap[key];
    if (!hub) continue;

    var x = hub.x;
    var y = hub.y;
    var z = hub.z;
    var dim = hub.dim;

    if (x == null || y == null || z == null || !dim) continue;

    ensurePrincipalProtectionFields(hub);

    // On retire le bloc 2 cases au-dessus du coeur principal
    reg.runCmdSilentWithServer(
      server,
      "execute in " + String(dim) + " run setblock " + x + " " + (y + 2) + " " + z + " minecraft:air replace"
    );

    // Le coeur reste avec ses hp / dead / maxHp, on ne change que la protection
    hub.protectionState = "not_protected";
    hub.protectionUntilMs = untilMs;

    reg.log(
      "[PRINCIPAL UNLOCK] team=" + ownerTeamId +
      " hubKey=" + key +
      " protectionState=" + hub.protectionState +
      " protectionUntilMs=" + hub.protectionUntilMs
    );

    changed = true;
  }

  return changed;
}

function consumePrincipalStageAndUnlock(player, ownerTeamId) {
  if (!player || !ownerTeamId) return false;
  if (!global.HubRegistry) return false;

  var server = player.server;
  if (!server) return false;

  var reg = global.HubRegistry;
  var root = reg.getRoot(server);
  var consumeState = getOrCreatePrincipalConsumeState(root);
  var safeOwnerTeamId = String(ownerTeamId);

  if (consumeState[safeOwnerTeamId] === true) {
    return false;
  }

  var ok = unlockPrincipalHeartForOwnerTeam(server, safeOwnerTeamId, 60000);
  if (!ok) return false;

  consumeState[safeOwnerTeamId] = true;

  var principalStage = buildKilledHubStage("principal", safeOwnerTeamId);
  reg.removeStageCmd(server, player.username, principalStage);

  var attackerTeamId = String(reg.teamOf(server, player));
  var defenderTeamId = safeOwnerTeamId;

  // Titre pour l'équipe attaquante
  sendTitleToOnlineTeamPlayers(
    server,
    attackerTeamId,
    "§6PROTECTION BRISÉE",
    "§cBraiche de 3H dans le Force Field ennemie !",
    10, 70, 20
  );

  // Titre pour l'équipe attaquée
  sendTitleToOnlineTeamPlayers(
    server,
    defenderTeamId,
    "§4ALERTE BASE",
    "§cForce Field Désactivé : 3H",
    10, 70, 20
  );

  player.tell("§dLe coeur principal ennemi n'est plus protégé pendant 1 minute.");
  return true;
}

function restoreExpiredPrincipalProtections(server) {
  if (!server || !global.HubRegistry) return 0;
log("ON RESTAUREE PROTECTION")
  var reg = global.HubRegistry;
  var root = reg.getRoot(server);
  var hubsByTeam = root.hubsByTeam || {};
  var teamIds = Object.keys(hubsByTeam);
  var now = Date.now();
  var restored = 0;

  for (var i = 0; i < teamIds.length; i++) {
    var teamId = teamIds[i];
    var principalMap = (hubsByTeam[teamId] && hubsByTeam[teamId]["PRINCIPAL"])
      ? hubsByTeam[teamId]["PRINCIPAL"]
      : {};

    var keys = Object.keys(principalMap);

    for (var j = 0; j < keys.length; j++) {
      var key = keys[j];
      var hub = principalMap[key];
      if (!hub) continue;

      ensurePrincipalProtectionFields(hub);

      if (String(hub.protectionState) !== "not_protected") continue;
      if (Number(hub.protectionUntilMs || 0) > now) continue;

      hub.protectionState = "protected";
      hub.protectionUntilMs = 0;

      reg.log("[PRINCIPAL REPROTECT] team=" + teamId + " hubKey=" + key + " protectionState=protected");
      restored++;
    }
  }

  return restored;
}

GameStageEvents.stageAdded(event => {
  var player = event.entity;
  if (!player) return;

  var stage = String(event.stage || "");

  // 1) Si le joueur reçoit academy/factory, on vérifie si principal doit être donné
  maybeGrantPrincipalStage(player, stage);

  // 2) Si le joueur reçoit principal, on consomme le stage et on déprotège le coeur principal
  var parsed = parseKilledHubStage(stage);
  if (!parsed) return;

  if (parsed.hubType === "principal") {
    consumePrincipalStageAndUnlock(player, parsed.ownerTeamId);
  }
});

ServerEvents.tick(event => {
  var server = event.server;
  if (!server) return;

  var root = global.HubRegistry ? global.HubRegistry.getRoot(server) : null;
  if (!root) return;

  root.__principalProtectionTick__ = Number(root.__principalProtectionTick__ || 0) + 1;

  // Vérification toutes les 20 ticks ≈ 1 seconde
  if ((root.__principalProtectionTick__ % 20) !== 0) return;

  restoreExpiredPrincipalProtections(server);
});