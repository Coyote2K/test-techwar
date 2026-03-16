// kubejs/server_scripts/hubs/10_hub_team_registry.js
// priority: 10
//
// HUBS : enregistrement des coeurs + détection proximité + GameStages (+ reset quêtes optionnel)
// MC 1.20.1 Forge / KubeJS (Rhino compatible)
//
// IMPORTANT : Toute la config (blocs, radius, messages, questId, stage, etc.) vient de global.HUBS_CONFIG
// -> Ne dupliquez pas ces valeurs ici.

// ----- HYPERPARAMS -----
const ENERGY_CUBE_REL = { dx: 1, dy: -3, dz: 0 };   // ex: cube juste au-dessus -> {dx:0,dy:1,dz:0}
const ENERGY_STORED   = "53000";

// =========================
// FTB Teams
// =========================

// =========================
// FTB Teams - leave party/team (selon versions)
// =========================

try {
  FTBTeamsEvents.playerLeftParty(event => {
    const p = event.player;

    console.log("[FTBTeams] playerLeftParty player=" + p.username)
    console.log("[FTBTeams] event=" + event)

    // On tente de récupérer l'équipe quittée si dispo
    let leftTeamId = null;
    let leftTeamName = null;

    try {
      const t = event.team ? event.team : (event.currentTeam ? event.currentTeam : null);
      if (t) {
        leftTeamId = t.id ? String(t.id) : (t.getId ? String(t.getId()) : null);
        leftTeamName = t.name ? String(t.name) : null;
      }
    } catch (e) {}

    // Après avoir quitté, le joueur est potentiellement "solo" ou dans une autre team
    // On recalcule via teamOf() (qui utilise TeamUtils si dispo)
    const newTeamId = teamOf(event.server, p);

    // Important : on met le cache sur la nouvelle team
    // teamName : si on ne sait pas, on laisse null
    setPlayerTeamCache(event.server, p, newTeamId, null);

    event.server.tell(`§7${p.username} a quitté une équipe (cache mis à jour).`);
  })
} catch (e) {
  console.log("[FTBTeams] Hook playerLeftParty indisponible: " + e)
}

FTBTeamsEvents.playerJoinedParty(event => {
  var server = event.server;
  var p = event.player;

  console.log("[FTBTeams] playerJoinedParty player=" + p.username);

  try {
    (function () {
      var root = getRoot(server);
      var uuid = String(p.uuid);

      var oldTeam = root.playerTeam[uuid] ? String(root.playerTeam[uuid]) : null;

      // Nouvelle team via la règle unique
      var newTeam = String(teamOf(server, p));

      // Optionnel : nom (pour info)
      var teamName = null;
      try {
        if (event.currentTeam && event.currentTeam.name != null) teamName = String(event.currentTeam.name);
      } catch (eN) {}

      if (oldTeam && oldTeam !== newTeam) {
        // pas de fusion => perte des hubs
        wipeHubsForTeam(root, oldTeam);
        removeAllHubStages(p);
        resetNearStateForPlayer(root, uuid);
        log("TEAM SWITCH (join) player=" + p.username + " " + oldTeam + " -> " + newTeam + " hubs wiped");
      }

      root.playerTeam[uuid] = newTeam;
      if (teamName != null) root.playerTeamName[uuid] = teamName;

      log("PERSIST UPDATE (JOIN) player=" + p.username + " uuid=" + uuid + " teamId=" + newTeam + " teamName=" + teamName);
    })();
  } catch (e) {
    console.log("[FTBTeams] joinedParty: cache write failed: " + e);
  }
});

// =========================
// OUTILS / HELPERS (Rhino safe)
// =========================
function asStr(x) {
  return String(x);
}

function log(msg) {
  // Log conditionnel via HUBS_CONFIG.DEBUG
  try {
    const cfg = global.HUBS_CONFIG || {};
    if (cfg.DEBUG) console.log((cfg.DEBUG_PREFIX || "[HUBS]") + " " + msg);
  } catch (e) {
    console.log("[HUBS] " + msg);
  }
}

function getCfg() {
  // Fallback minimal si HUBS_CONFIG absent
  const cfg = global.HUBS_CONFIG || {};
  if (!cfg.HUB_TYPES) cfg.HUB_TYPES = {};
  return cfg;
}

// Clé unique position hub (dimension + coords)
function keyOf(dim, x, y, z) {
  return asStr(dim) + "|" + asStr(x) + "|" + asStr(y) + "|" + asStr(z);
}

function distSq(ax, ay, az, bx, by, bz) {
  const dx = ax - bx, dy = ay - by, dz = az - bz;
  return dx*dx + dy*dy + dz*dz;
}


// =========================
// STOCKAGE PERSISTANT
// =========================
// server.persistentData.__HUBS__ = { hubsByTeam, playerTeam, nearState, tickCounter }
function getRoot(server) {
  if (!server.persistentData.__HUBS__) server.persistentData.__HUBS__ = {};
  const r = server.persistentData.__HUBS__;
  if (!r.hubsByTeam) r.hubsByTeam = {};     
  if (!r.playerTeam) r.playerTeam = {};     // playerUuid -> teamId (inchangé)
  if (!r.playerTeamName) r.playerTeamName = {}; // playerUuid -> teamName (nouveau)
  if (!r.nearState)  r.nearState  = {};
  if (!r.hubIndexByPos) r.hubIndexByPos = {};
  if (!r.teamMode) r.teamMode = {};  
  if (r.tickCounter == null) r.tickCounter = 0;
  return r;
}
function ensureTeamEntry(hubsByTeam, teamId) {
  if (!hubsByTeam[teamId]) hubsByTeam[teamId] = {};
  const cfg = getCfg();
  const types = Object.keys(cfg.HUB_TYPES || {});
  // Si la config est vide, fallback standard
  var keysToUse = (types.length > 0) ? types : ["ACADEMY", "FACTORY", "PRINCIPAL"];

  for (let i = 0; i < keysToUse.length; i++) {
    var t = keysToUse[i];
    if (!hubsByTeam[teamId][t]) hubsByTeam[teamId][t] = {};
  }
}

function ensurePlayerNearEntry(nearState, playerUuid) {
  if (!nearState[playerUuid]) nearState[playerUuid] = {};
  const cfg = getCfg();
  const types = Object.keys(cfg.HUB_TYPES || {});
  var keysToUse = (types.length > 0) ? types : ["ACADEMY", "FACTORY", "PRINCIPAL"];

  for (let i = 0; i < keysToUse.length; i++) {
    var t = keysToUse[i];
    if (nearState[playerUuid][t] == null) nearState[playerUuid][t] = false;
  }
}

// =========================
// TEAM CACHE UPDATE + RESET
// =========================

// Retire tous les GameStages "hub_*_access" d'un joueur (propre lors d'un changement d'équipe)
function removeAllHubStages(player) {
  if (!player) return;
  const types = typesList();
  for (let i = 0; i < types.length; i++) {
    const stage = stageOfType(types[i]);
    if (stage) removeStageCmd(player.server, player.username, stage);
  }
}

// Reset nearState à false (pour forcer un recalcul propre ensuite)
function resetNearStateForPlayer(root, playerUuid) {
  ensurePlayerNearEntry(root.nearState, playerUuid);
  const types = typesList();
  for (let i = 0; i < types.length; i++) {
    root.nearState[playerUuid][types[i]] = false;
  }
}

// Applique une mise à jour atomique du cache "playerTeam / playerTeamName"
function setPlayerTeamCache(server, player, newTeamId, newTeamName) {
  const root = getRoot(server);
  const uuid = asStr(player.uuid);

  // Valeurs avant
  const oldTeamId = root.playerTeam[uuid] ? asStr(root.playerTeam[uuid]) : null;
  const oldTeamName = root.playerTeamName[uuid] ? asStr(root.playerTeamName[uuid]) : null;

  // Normalisation
  const tid = (newTeamId != null && String(newTeamId).length > 0) ? asStr(newTeamId) : asStr(player.username);
  const tname = (newTeamName != null && String(newTeamName).length > 0) ? asStr(newTeamName) : null;

  // Si pas de changement, on évite le bruit
  if (oldTeamId === tid && oldTeamName === tname) return;

  // >>> IMPORTANT : pas de fusion, perte des hubs
  if (oldTeamId && oldTeamId !== tid) {
    var n = wipeHubsForTeam(root, oldTeamId);
    log("TEAM SWITCH => hubs lost: " + n + " removed from oldTeamId=" + oldTeamId);
  }

  root.playerTeam[uuid] = tid;
  if (tname != null) root.playerTeamName[uuid] = tname;

  removeAllHubStages(player);
  resetNearStateForPlayer(root, uuid);

  log("TEAM CHANGE player=" + asStr(player.username) +
      " uuid=" + uuid +
      " oldTeamId=" + oldTeamId + " -> newTeamId=" + tid +
      " oldTeamName=" + oldTeamName + " -> newTeamName=" + tname);
}

// =========================
// RESOLUTION TEAM (FTBTeams si dispo)
// =========================
function teamOf(server, player) {
  if (!player) return "NO_PLAYER";

  // 1) FTB Teams via TeamUtils (si dispo)
  try {
    if (global.TeamUtils && global.TeamUtils.getTeamId) {
      var t = global.TeamUtils.getTeamId(player);
      if (t != null && String(t).length > 0) return String(t);
    }
  } catch (e) {player.tell("On a pas trouve de team avec TeamID")}

  // 2) Cache persistant (si présent)
  try {
    if (server) {
      var root = getRoot(server);
      var uuid = player.uuid ? String(player.uuid) : null;
      if (uuid && root.playerTeam && root.playerTeam[uuid]) {
        return String(root.playerTeam[uuid]);
      }
    }
  } catch (e2) {}

  // 3) Fallback STABLE : UUID (PAS le pseudo)
  return String(player.uuid);
}


// =========================
// GAMESTAGES VIA COMMANDE SERVEUR
// =========================
function normalizeCmd(cmd) {
  const s = String(cmd || "").trim();
  if (s.length === 0) return "";
  return (s.charAt(0) === "/") ? s.substring(1) : s;
}

function runCmdSilentWithServer(server, cmd) {
  if (!server) {
    log("ERROR: server null, cannot run: " + cmd);
    return false;
  }

  const normalized = normalizeCmd(cmd);
  if (!normalized) return false;

  try {
    // IMPORTANT : pas de "r" (ni const/let/var r)
    server.runCommandSilent(normalized);
    log("CMD OK: /" + normalized);
    return true;
  } catch (e) {
    log("ERROR: runCommandSilent failed for cmd=/" + normalized + " err=" + e);
    return false;
  }
}

function addStageCmd(server, playerName, stage) {
  if (!playerName || !stage) return;
  runCmdSilentWithServer(server, "gamestage add " + playerName + " " + stage);
}

function removeStageCmd(server, playerName, stage) {
  if (!playerName || !stage) return;
  runCmdSilentWithServer(server, "gamestage remove " + playerName + " " + stage);
}

function setBlockCmd(server, x, y, z, blockId, mode) {
  // mode: "replace" ou "keep"
  const m = mode ? String(mode) : "replace";
  return runCmdSilentWithServer(server, "setblock " + x + " " + y + " " + z + " " + blockId + " " + m);
}

// =========================
// FTB QUESTS RESET (OPTIONNEL)
// =========================
// Ici : reset au moment de sortir de zone si vous implémentez ce bridge global.
function resetQuestIfConfigured(player, questId) {
  if (!questId) return;

  try {
    if (global.FTBQuestsBridge && global.FTBQuestsBridge.resetQuest) {
      global.FTBQuestsBridge.resetQuest(player, questId);
      return;
    }
  } catch (e) {}

  log("SKIP quest reset (bridge absent) questId=" + questId);
}


// =========================
// UTILITAIRES SUR HUB_TYPES (CONFIG)
// =========================

function getTeamMode(root, teamId) {
  log("On check bien le team mode" + root.teamMode[teamId])
  return root.teamMode[teamId] ? root.teamMode[teamId] : "prod"
}

function typesList() {
  const cfg = getCfg();
  const types = Object.keys(cfg.HUB_TYPES || {});
  return (types.length > 0) ? types : ["ACADEMY", "FACTORY", "PRINCIPAL"];
}

function isHubBlockId(blockId) {
  const cfg = getCfg();
  const types = typesList();

  for (let i = 0; i < types.length; i++) {
    var t = types[i];
    var def = cfg.HUB_TYPES[t];
    if (def && asStr(def.blockId) === asStr(blockId)) return true;
  }
  return false;
}

function hubTypeOfBlockId(blockId) {
  const cfg = getCfg();
  const types = typesList();

  for (let i = 0; i < types.length; i++) {
    var t = types[i];
    var def = cfg.HUB_TYPES[t];
    if (def && asStr(def.blockId) === asStr(blockId)) return t;
  }
  return null;
}

function stageOfType(type) {
  const cfg = getCfg();
  const def = (cfg.HUB_TYPES || {})[type] || {};
  return def.stage || null;
}

function questIdOfType(type) {
  const cfg = getCfg();
  const def = (cfg.HUB_TYPES || {})[type] || {};
  return def.questId || null;
}

function enterMessageOfType(type) {
  const cfg = getCfg();
  // Vous avez mis uniquement ACADEMY_ENTER_MESSAGE, donc :
  // - si vous voulez des messages par type, ajoutez dans HUB_TYPES[type].enterMessage
  // - sinon fallback sur votre clé existante pour ACADEMY
  const def = (cfg.HUB_TYPES || {})[type] || {};
  if (def.enterMessage) return def.enterMessage;

  if (type === "ACADEMY" && cfg.ACADEMY_ENTER_MESSAGE) return cfg.ACADEMY_ENTER_MESSAGE;
  return null;
}

function exitMessageOfType(type) {
  const cfg = getCfg();
  const def = (cfg.HUB_TYPES || {})[type] || {};
  if (def.exitMessage) return def.exitMessage;

  // fallback si vous n'avez pas encore mis exitMessage dans HUB_TYPES
  // (optionnel)
  return null;
}

function radiusOfType(type) {
  const cfg = getCfg();
  // Priorité : HUB_TYPES[type].radius (si vous l’ajoutez)
  // Sinon : cfg.RADIUS global
  const def = (cfg.HUB_TYPES || {})[type] || {};
  if (def.radius != null) return Number(def.radius);
  return Number(cfg.RADIUS != null ? cfg.RADIUS : 12);
}

// =========================
// SPAWN PRINCIPAL MFFS
// =========================

function placeRelativeStructureWithCommands(server, level, originBlock, structure) {
  // originBlock = event.block
  // structure = liste {dx,dy,dz,block,replace}

  if (!server || !level || !originBlock || !structure) return;

  for (let i = 0; i < structure.length; i++) {
    var e = structure[i];
    if (!e) continue;

    var x = originBlock.x + Number(e.dx || 0);
    var y = originBlock.y + Number(e.dy || 0);
    var z = originBlock.z + Number(e.dz || 0);

    var blockId = String(e.block || "");
    if (!blockId) continue;

    var doReplace = (e.replace === true);

    if (!doReplace) {
      // Anti-écrasement : on ne place que si la case est "air"
      // (Tu peux élargir la condition si tu veux autoriser aussi "minecraft:grass", etc.)
      var current = level.getBlock(x, y, z);
      var currentId = current ? String(current.id) : "";
      if (currentId !== "minecraft:air") {
        log("SKIP setblock (occupied) at " + x + " " + y + " " + z + " current=" + currentId);
        continue;
      }

      // Ici, on peut utiliser "replace" car on a déjà vérifié que c'est de l'air
      setBlockCmd(server, x, y, z, blockId, "replace");
    } else {
      // Remplacement autorisé
      setBlockCmd(server, x, y, z, blockId, "replace");
    }
  }
}

function mergeEnergyCubeAtRel(server, baseBlock, rel, storedStr) {
  if (!server || !baseBlock || !rel) return false;

  const x = baseBlock.x + (rel.dx || 0);
  const y = baseBlock.y + (rel.dy || 0);
  const z = baseBlock.z + (rel.dz || 0);

  // NBT Mekanism (selon version) : EnergyContainers / stored
  const nbt_energy = `{EnergyContainers:[{stored:"${storedStr}"}]}`;
  const nbt_face = `{componentConfig: {eject0: 1b, eject6: 0b, config0: {side2: 0, side4: 0, side0: 0, side3: 0, side1: 0, side5: 0}, config6: {side2: 1, side4: 1, side0: 4, side3: 1, side1: 1, side5: 1}}`
  var cmd = `data merge block ${x} ${y} ${z} ${nbt_energy}`;
  runCmdSilentWithServer(server, cmd);
  cmd = `data merge block ${x} ${y} ${z} ${nbt_face}`;
  return runCmdSilentWithServer(server, cmd);
}

// =========================
// REGISTER / UNREGISTER HUBS
// =========================

// Cette fonction sert à enregistrer les HP du bloc en fonction de max HP quand le bloc est pausé.
function maxHpOfType(type) {
  const cfg = getCfg();
  const def = (cfg.HUB_TYPES || {})[type] || {};
  const v = def.maxHp;
  return (v != null) ? Number(v) : 200; // défaut
}

function registerHub(server, teamId, type, dim, x, y, z) {
  const root = getRoot(server);
  log("On enregistre un hub à la position :" + x + ", " + y + ", " + z);
  ensureTeamEntry(root.hubsByTeam, teamId);

  const k = keyOf(dim, x, y, z);
  root.hubIndexByPos[k] = { teamId: asStr(teamId), type: asStr(type) };
  log("DEBUG registerHub: teamId=" + teamId + " type=" + type + " hasTypeObj=" + (root.hubsByTeam[teamId] && root.hubsByTeam[teamId][type] != null));
  const maxHp = maxHpOfType(type);
  root.hubsByTeam[teamId][type][k] = {
    dim: asStr(dim), x: x, y: y, z: z,
    hp: maxHp,
    maxHp: maxHp,
    dead: false
  }
  root.teamMode[teamId] = "dev"  // ou "prod";

  log("REGISTER team=" + teamId + " type=" + type + " at " + k + " hp=" + maxHp);
}

function unregisterHub(server, teamId, type, dim, x, y, z) {
  const root = getRoot(server);
  if (root.hubIndexByPos && root.hubIndexByPos[k]) delete root.hubIndexByPos[k];
  log("On supprime un hub à la position :" + x + ", " + y + ", " + z);
  ensureTeamEntry(root.hubsByTeam, teamId);

  const k = keyOf(dim, x, y, z);
  if (root.hubsByTeam[teamId][type] && root.hubsByTeam[teamId][type][k]) {
    delete root.hubsByTeam[teamId][type][k];
    log("UNREGISTER team=" + teamId + " type=" + type + " at " + k);
  }
}

function wipeHubsForTeam(root, teamId) {
  if (!root || !teamId) return 0;

  var removed = 0;
  root.hubsByTeam = root.hubsByTeam || {};
  root.hubIndexByPos = root.hubIndexByPos || {};
  root.teamMode = root.teamMode || {};

  var teamObj = root.hubsByTeam[teamId];
  if (!teamObj) return 0;

  var types = typesList();
  for (var i = 0; i < types.length; i++) {
    var t = types[i];
    var map = teamObj[t] || {};
    var keys = Object.keys(map);
    removed += keys.length;

    for (var k = 0; k < keys.length; k++) {
      var posKey = keys[k];
      if (root.hubIndexByPos[posKey]) delete root.hubIndexByPos[posKey];
    }
  }

  delete root.hubsByTeam[teamId];
  if (root.teamMode[teamId]) delete root.teamMode[teamId];

  log("WIPE HUBS teamId=" + teamId + " removed=" + removed);
  return removed;
}


// =========================
// EVENTS : placement / casse
// =========================
BlockEvents.placed(event => {
  const b = event.block;
  log("on a posé un bloc");
  const id = asStr(b.id);
  log("Ona l'id :" + id);
  if (!isHubBlockId(id)) return;
  log("On a reconnu l'id :" + id);
  const type = hubTypeOfBlockId(id);
  const p = event.player;
  if (!p) return;

  const teamId = teamOf(event.server, p);
  const dim = asStr(b.level.dimension);
  log("DEBUG placed: id=" + id + " type=" + type + " teamId=" + teamId);
  registerHub(event.server, teamId, type, dim, b.x, b.y, b.z);

  if (String(type) === "PRINCIPAL") {
    var struct = global.HUBS_PRINCIPAL_STRUCTURE || [];
    placeRelativeStructureWithCommands(event.server, b.level, b, struct);

    // ----- AJOUT : injecter l'énergie dans le cube à position relative -----
    mergeEnergyCubeAtRel(event.server, b, ENERGY_CUBE_REL, ENERGY_STORED);
  }
});

// BlockEvents.broken déplacé dans 30_hub_hp.js (incassable sauf créatif + unregister)

// =========================
// LOG IN : mémoriser team et init nearState
// =========================
PlayerEvents.loggedIn(event => {
  const p = event.player;
  if (!p || !p.uuid) return;

  const root = getRoot(event.server);
  const uuid = asStr(p.uuid);
  const t = teamOf(event.server, p);

  root.playerTeam[uuid] = t;
  ensurePlayerNearEntry(root.nearState, uuid);

  // Force "sorti" à la connexion ; le tick recalculera ensuite
  const types = typesList();
  for (let i = 0; i < types.length; i++) {
    root.nearState[uuid][types[i]] = false;
  }

  log("Player loggedIn username=" + asStr(p.username) + " team=" + t);
});


// =========================
// CALCUL : joueur proche d’un type de hub ?
// =========================
function isPlayerNearType(server, player, teamId, type) {
  const root = getRoot(server);
  ensureTeamEntry(root.hubsByTeam, teamId);

  const dim = asStr(player.level.dimension);
  const hubsMap = root.hubsByTeam[teamId][type] || {};
  const keys = Object.keys(hubsMap);

  if (keys.length === 0) return false;

  const r = radiusOfType(type);
  const r2 = r * r;

  for (let i = 0; i < keys.length; i++) {
    var h = hubsMap[keys[i]];
    if (!h) continue;
    if (asStr(h.dim) !== dim) continue;

    var d2 = distSq(player.x, player.y, player.z, h.x + 0.5, h.y + 0.5, h.z + 0.5);
    if (d2 <= r2) return true;
  }

  return false;
}


// =========================
// APPLY : entrée/sortie (stage + quest reset + message)
// =========================
function applyNearStateTransition(player, type, wasNear, isNear) {
  const stage = stageOfType(type);
  const questIdExit = questIdOfType(type); // si vous voulez reset sur sortie, on réutilise questId
  const enterMsg = enterMessageOfType(type);

  if (!wasNear && isNear) {
    if (enterMsg) player.tell(asStr(enterMsg));
    if (stage) addStageCmd(player.server, player.username, stage);
    log("ENTER type=" + type + " stage=" + stage);
  }

  if (wasNear && !isNear) {
    const exitMsg = exitMessageOfType(type);
    if (exitMsg) player.tell(asStr(exitMsg));

    if (stage) removeStageCmd(player.server, player.username, stage);
    if (questIdExit) resetQuestIfConfigured(player, questIdExit);

    log("EXIT type=" + type + " stage=" + stage + " questId=" + questIdExit);
  }
}


// =========================
// TICK (périodique)
// =========================
ServerEvents.tick(event => {
  const server = event.server;
  if (!server) return;

  const cfg = getCfg();
  const root = getRoot(server);

  root.tickCounter = (root.tickCounter + 1) | 0;

  const tickPeriod = Number(cfg.TICK_PERIOD != null ? cfg.TICK_PERIOD : 20);
  if ((root.tickCounter % tickPeriod) !== 0) return;

  log("Tick start");

  const players = server.players;
  if (!players) return;

  const types = typesList();

  // Version robuste Rhino
  for (var p of players) {
    if (!p || !p.uuid) continue;

    var uuid = asStr(p.uuid);
    ensurePlayerNearEntry(root.nearState, uuid);

    var teamNow = String(teamOf(server, p));
    if (!root.playerTeam[uuid] || String(root.playerTeam[uuid]).length === 0) {
      root.playerTeam[uuid] = teamNow;
      }
  ensureTeamEntry(root.hubsByTeam, teamNow);

    for (let i = 0; i < types.length; i++) {

      var type = types[i];
      var wasNear = !!root.nearState[uuid][type];
      var isNear = isPlayerNearType(server, p, teamNow, type);

      if (wasNear !== isNear) {
        applyNearStateTransition(p, type, wasNear, isNear);
        root.nearState[uuid][type] = isNear;
      } else {
        root.nearState[uuid][type] = isNear;
      }
    }
  }
  log("Tick end");
});


// =========================
// EXPORT GLOBAL
// =========================
global.HubRegistry = {
  // helpers
  asStr: asStr,
  log: log,
  getCfg: getCfg,
  keyOf: keyOf,

  // registry / storage
  getRoot: getRoot,
  ensureTeamEntry: ensureTeamEntry,

  // hub identification
  isHubBlockId: isHubBlockId,
  hubTypeOfBlockId: hubTypeOfBlockId,

  // team
  teamOf: teamOf,

  // actions
  registerHub: registerHub,
  unregisterHub: unregisterHub,

  // hp config
  maxHpOfType: maxHpOfType,

    // pour lancer des commandes
  runCmdSilentWithServer: runCmdSilentWithServer,

  isPlayerNearType: isPlayerNearType
};