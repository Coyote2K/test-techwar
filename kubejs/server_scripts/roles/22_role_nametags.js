// kubejs/server_scripts/hubs/22_role_nametags.js
// priority: 22

function roleDefsForNametag() {
  return [
    {
      role: "ESPION",
      entries: [
        { stage: "espion_1", rank: 1, label: "Informateur" },
        { stage: "espion_2", rank: 2, label: "Espion" },
        { stage: "espion_3", rank: 3, label: "007" }
      ]
    },
    {
      role: "INGENIEUR",
      entries: [
        { stage: "ingenieur_1", rank: 1, label: "Ingénieur" },
        { stage: "ingenieur_2", rank: 2, label: "Chef de production" },
        { stage: "ingenieur_3", rank: 3, label: "Dr. Vegapunk" }
      ]
    },
    {
      role: "SOLDAT",
      entries: [
        { stage: "soldat_1", rank: 1, label: "Caporal" },
        { stage: "soldat_2", rank: 2, label: "Lieutenant" },
        { stage: "soldat_3", rank: 3, label: "Grand Général sous les Cieux" }
      ]
    },
    {
      role: "GAMBLER",
      entries: [
        { stage: "gambler_1", rank: 1, label: "Joueur de Poker" },
        { stage: "gambler_2", rank: 2, label: "Accros du Casino" },
        { stage: "gambler_3", rank: 3, label: "Compteur de cartes" }
      ]
    },
    {
      role: "DIPLOMATE",
      entries: [
        { stage: "diplomate_1", rank: 1, label: "Conseiller" },
        { stage: "diplomate_2", rank: 2, label: "Stratège" },
        { stage: "diplomate_3", rank: 3, label: "Chancelier" }
      ]
    }
  ];
}

function sanitizeScoreboardTeamId(s) {
  return String(s || "").toLowerCase().replace(/[^a-z0-9_.-]/g, "_");
}

function getHighestRoleEntryForFamily(player, roleDef) {
  if (!player || !roleDef || !roleDef.entries) return null;

  var best = null;

  for (var i = 0; i < roleDef.entries.length; i++) {
    var e = roleDef.entries[i];
    if (!e || !e.stage) continue;

    if (player.stages.has(String(e.stage))) {
      if (best == null || Number(e.rank) > Number(best.rank)) {
        best = e;
      }
    }
  }

  return best;
}

function getAllRoleNametagLabels(player) {
  if (!player) return [];

  var defs = roleDefsForNametag();
  var labels = [];

  for (var i = 0; i < defs.length; i++) {
    var best = getHighestRoleEntryForFamily(player, defs[i]);
    if (!best) continue;

    labels.push(String(best.label));
  }

  return labels;
}

function buildCombinedRolePrefix(player) {
  var labels = getAllRoleNametagLabels(player);
  if (!labels || labels.length === 0) return null;

  // Séparateur modifiable
  var combined = labels.join(" | ");

  // Protection simple contre un préfixe trop long
  // Un nametag trop long peut devenir illisible.
  if (combined.length > 80) {
    combined = combined.substring(0, 77) + "...";
  }

  return combined;
}

function ensureNametagTeam(server, teamId, prefixText) {
  if (!server || !teamId || !global.HubRegistry) return false;

  var reg = global.HubRegistry;
  var safeTeamId = sanitizeScoreboardTeamId(teamId);
  var prefixJson = JSON.stringify({ text: String(prefixText || "") + " " });

  server.runCommandSilent("team add " + safeTeamId);

  reg.runCmdSilentWithServer(server, "team modify " + safeTeamId + " nametagVisibility always");
  reg.runCmdSilentWithServer(server, "team modify " + safeTeamId + " collisionRule always");
  reg.runCmdSilentWithServer(server, "team modify " + safeTeamId + " prefix " + prefixJson);

  return true;
}

function clearRoleNametag(player) {
  if (!player || !player.server || !global.HubRegistry) return false;

  var reg = global.HubRegistry;
  reg.runCmdSilentWithServer(player.server, "team leave " + player.username);
  return true;
}

function applyRoleNametag(player) {
  if (!player || !player.server || !global.HubRegistry) return false;

  var reg = global.HubRegistry;
  var server = player.server;

  var combinedPrefix = buildCombinedRolePrefix(player);

  if (!combinedPrefix) {
    clearRoleNametag(player);
    return false;
  }

  // Une équipe unique par combinaison de rôles
  var scoreboardTeamId = "roletag_" + sanitizeScoreboardTeamId(combinedPrefix);

  ensureNametagTeam(server, scoreboardTeamId, combinedPrefix);

  reg.runCmdSilentWithServer(server, "team leave " + player.username);
  reg.runCmdSilentWithServer(server, "team join " + scoreboardTeamId + " " + player.username);

  return true;
}

ServerEvents.tick(event => {
  var server = event.server;
  if (!server) return;

  var root = global.HubRegistry ? global.HubRegistry.getRoot(server) : null;
  if (!root) return;

  root.__roleNametagTick__ = Number(root.__roleNametagTick__ || 0) + 1;

  // Toutes les 5 secondes
  if ((root.__roleNametagTick__ % 100) !== 0) return;

  var players = server.players;
  if (!players) return;

  for (var p of players) {
    if (!p) continue;
    applyRoleNametag(p);
  }
});

PlayerEvents.loggedIn(event => {
  var player = event.player;
  if (!player) return;

  applyRoleNametag(player);
});