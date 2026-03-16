// kubejs/server_scripts/hubs/05_hub_server_ref.js
// priority: 0

global.HubServer = {
  server: null
};

ServerEvents.loaded(event => {
  global.HubServer.server = event.server;
  console.log("[HUBS] HubServer: server reference OK");
});