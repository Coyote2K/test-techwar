// kubejs/server_scripts/hubs/23_hub_top_block_command.js
// priority: 23

// =========================
// HYPERPARAMS
// =========================
const HUB_TOP_BLOCK_ID = "mffs:projector";

// =========================
// HELPERS
// =========================
function _hubTopTell(source, text) {
  if (!source || !text) return;

  try {
    var p = source.player;
    if (p) {
      p.tell(String(text));
      return;
    }
  } catch (e) {}

  try {
    source.server.tell(String(text));
  } catch (e2) {}
}

function placeFixedBlockAbovePrincipalHeartForPlayerTeam(server, player) {
  if (!server || !player || !global.HubRegistry) return 0;

  var reg = global.HubRegistry;
  var root = reg.getRoot(server);
  var teamId = String(reg.teamOf(server, player));

  reg.ensureTeamEntry(root.hubsByTeam, teamId);

  var hubsMap = (root.hubsByTeam[teamId] && root.hubsByTeam[teamId]["PRINCIPAL"])
    ? root.hubsByTeam[teamId]["PRINCIPAL"]
    : {};

  var keys = Object.keys(hubsMap);
  if (keys.length === 0) {
    player.tell("§cAucun coeur principal trouvé pour votre équipe.");
    return 0;
  }

  var placed = 0;

  for (var i = 0; i < keys.length; i++) {
    var key = keys[i];
    var hub = hubsMap[key];
    if (!hub) continue;

    var x = hub.x;
    var y = hub.y;
    var z = hub.z;
    var dim = hub.dim;

    if (x == null || y == null || z == null || !dim) continue;

    var ok = reg.runCmdSilentWithServer(
      server,
      "execute in " + String(dim) + " run setblock " + x + " " + (y + 2) + " " + z + " " + HUB_TOP_BLOCK_ID + " replace"
    );

    if (ok) {
      placed++;
      reg.log(
        "[HUB TOP BLOCK] team=" + teamId +
        " dim=" + dim +
        " pos=" + x + "," + (y + 2) + "," + z +
        " block=" + HUB_TOP_BLOCK_ID
      );
    }
  }

  if (placed > 0) {
    player.tell("§aBloc replacé au-dessus de " + placed + " coeur(s) principal(aux) : §f" + HUB_TOP_BLOCK_ID);
  } else {
    player.tell("§cImpossible de replacer le bloc au-dessus du coeur principal.");
  }

  return placed;
}

// =========================
// COMMAND
// =========================
ServerEvents.commandRegistry(event => {
  const { commands: Commands } = event;

  event.register(
    Commands.literal("hubtopblock")
        
      .executes(ctx => {
        var source = ctx.source;
        var player = source.player;

        if (!player) {
          _hubTopTell(source, "§cCette commande doit être exécutée par un joueur.");
          return 0;
        }

        return placeFixedBlockAbovePrincipalHeartForPlayerTeam(source.server, player);
      })
      .requires(source => source.hasPermission(2) || source.player == null)
  );
});