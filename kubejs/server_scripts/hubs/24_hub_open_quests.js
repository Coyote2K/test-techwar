// kubejs/server_scripts/hubs/24_hub_open_quests.js
// priority: 24

BlockEvents.rightClicked(event => {
  var player = event.player;
  var block = event.block;
  var server = event.server;

  if (!player || !block || !server) return;
  if (event.hand != "MAIN_HAND") return;

  // Only while sneaking
  if (!player.isCrouching()) return;

  if (!global.HubRegistry) return;
  var reg = global.HubRegistry;

  var blockId = String(block.id);
  if (!reg.isHubBlockId(blockId)) return;

  var hubType = reg.hubTypeOfBlockId(blockId);
  if (!hubType) return;

  var questOpenId = reg.openQuestBookIdOfType
    ? reg.openQuestBookIdOfType(hubType)
    : null;

  if (!questOpenId) {
    player.tell("§cAucun identifiant d'ouverture de quete configure pour ce hub.");
    return;
  }

  reg.runCmdSilentWithServer(
    server,
    "execute as " + player.username + " run ftbquests open_book " + questOpenId
  );

  event.cancel();
});