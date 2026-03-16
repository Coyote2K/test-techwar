// kubejs/server_scripts/hubs/20_hub_debug_commands.js
// Debug hubs via chat : !hublist !hubnear !hubdist !hubwipe [TYPE] !hubwipeall
// Compatible Rhino / KubeJS MC 1.20.1 Forge

global.HubDebug = global.HubDebug || {};

function S(x) { return String(x); }

// --- Détection NBT CompoundTag (Minecraft persistentData peut être NBT)
function isNBTCompound(x) {
  return x && typeof x.getAllKeys === "function" && typeof x.getCompound === "function";
}

// Utilitaire pour reset le hub dans les fichiers NBT persistants.
function resetHubsRoot(server) {
  server.persistentData.__HUBS__ = {
    hubsByTeam: {},
    playerTeam: {},
    nearState: {},
    tickCounter: 0
  };
}

// --- Root commun aux hubs : server.persistentData.__HUBS__
global.HubDebug.getRoot = function(server) {
  var pd = server.persistentData;
  if (!pd.__HUBS__) pd.__HUBS__ = {};
  return pd.__HUBS__;
};

global.HubDebug.getCfg = function() {
  return global.HUBS_CONFIG || {};
};

global.HubDebug.fmtDim = function(d) {
  return S(d || "").replace("ResourceKey[minecraft:dimension / ", "").replace("]", "");
};

// --- Lire un enfant (NBT ou JS)
function getChild(container, key) {
  if (!container) return null;

  if (isNBTCompound(container)) {
    try {
      if (typeof container.contains === "function" && !container.contains(key)) return null;
      return container.getCompound(key);
    } catch (e) {
      return null;
    }
  }
  return container[key] || null;
}

// --- Lister clés (NBT ou JS)
function listKeys(container) {
  var out = [];
  if (!container) return out;

  if (isNBTCompound(container)) {
    try {
      var set = container.getAllKeys();
      var it = set.iterator();
      while (it.hasNext()) out.push(S(it.next()));
      return out;
    } catch (e) {
      return out;
    }
  }

  try { return Object.keys(container); } catch (e2) { return out; }
}

// --- Convertir hubs (NBT map ou JS map/array) en tableau
function hubsToArray(hubsContainer) {
  var arr = [];
  if (!hubsContainer) return arr;

  if (Array.isArray(hubsContainer)) {
    for (var i = 0; i < hubsContainer.length; i++) if (hubsContainer[i]) arr.push(hubsContainer[i]);
    return arr;
  }

  if (isNBTCompound(hubsContainer)) {
    var keys = listKeys(hubsContainer);
    for (var k = 0; k < keys.length; k++) {
      var kk = keys[k];
      var hub = getChild(hubsContainer, kk);
      if (!hub) continue;

      var hx = (typeof hub.getInt === "function") ? hub.getInt("x") : hub.x;
      var hy = (typeof hub.getInt === "function") ? hub.getInt("y") : hub.y;
      var hz = (typeof hub.getInt === "function") ? hub.getInt("z") : hub.z;
      var hdim = (typeof hub.getString === "function") ? hub.getString("dim") : hub.dim;

      arr.push({ x: hx, y: hy, z: hz, dim: hdim });
    }
    return arr;
  }

  var jsKeys = listKeys(hubsContainer);
  for (var j = 0; j < jsKeys.length; j++) {
    var key = jsKeys[j];
    var h = hubsContainer[key];
    if (h) arr.push(h);
  }
  return arr;
}

function dist3D(px, py, pz, hx, hy, hz) {
  var dx = px - hx, dy = py - hy, dz = pz - hz;
  return Math.sqrt(dx*dx + dy*dy + dz*dz);
}

// --- Team : on lit root.playerTeam[uuid] si possible, sinon username
function teamOf(server, player) {
  // 1) Si votre registre principal existe, on utilise exactement la même logique
  try {
    if (global.HubRegistry && global.HubRegistry.teamOf) {
      return String(global.HubRegistry.teamOf(server, player));
    }
  } catch (e) {}

  // 2) Fallback (votre ancienne logique) si HubRegistry absent
  var root = global.HubDebug.getRoot(server);
  var uuid = player && player.uuid ? S(player.uuid) : null;
  var playerTeam = getChild(root, "playerTeam");

  if (uuid && playerTeam && !isNBTCompound(playerTeam) && playerTeam[uuid]) return S(playerTeam[uuid]);

  if (uuid && playerTeam && isNBTCompound(playerTeam) && typeof playerTeam.getString === "function") {
    try {
      var t = playerTeam.getString(uuid);
      if (t && t.length > 0) return t;
    } catch (e2) {}
  }

  return S(player.username);
}

// --- Supprimer hubs (JS) : pour NBT, on ne peut pas facilement delete sans API dédiée.
// Heureusement, dans votre script hubs principal, hubsByTeam est en général un objet JS.
// Ici on gère le cas JS (le plus courant). Si c'est du NBT, on fait un wipe global en réinitialisant __HUBS__.
function wipeTeam(root, teamName, typeOrAll) {
  if (!root) return { ok: false, msg: "root null" };

  // Si root est NBT, on reset complètement __HUBS__ (simple et efficace)
  if (isNBTCompound(root)) {
    // On remplace par un nouvel objet JS : cela réinitialise tout
    // (KubeJS recréera ensuite les structures)
    return { ok: false, msg: "root is NBT CompoundTag (wipe via reset not supported here)" };
  }

  root.hubsByTeam = root.hubsByTeam || {};

  if (!teamName || !root.hubsByTeam[teamName]) {
    return { ok: true, removed: 0, msg: "no team entry" };
  }

  var removed = 0;

  if (!typeOrAll || typeOrAll === "ALL") {
    // Compte avant suppression
    var keys = Object.keys(root.hubsByTeam[teamName] || {});
    for (var i = 0; i < keys.length; i++) {
      var t = keys[i];
      var obj = root.hubsByTeam[teamName][t] || {};
      removed += Object.keys(obj).length;
    }
    delete root.hubsByTeam[teamName];
    return { ok: true, removed: removed, msg: "team wiped" };
  }

  // Wipe d'un type
  root.hubsByTeam[teamName][typeOrAll] = root.hubsByTeam[teamName][typeOrAll] || {};
  removed = Object.keys(root.hubsByTeam[teamName][typeOrAll]).length;
  root.hubsByTeam[teamName][typeOrAll] = {};
  return { ok: true, removed: removed, msg: "type wiped" };
}

function wipeAll(root) {
  if (!root) return { ok: false, msg: "root null" };

  if (isNBTCompound(root)) {
    return { ok: false, msg: "root is NBT CompoundTag (wipe via reset not supported here)" };
  }

  var removed = 0;
  root.hubsByTeam = root.hubsByTeam || {};
  var teams = Object.keys(root.hubsByTeam);
  for (var ti = 0; ti < teams.length; ti++) {
    var team = teams[ti];
    var types = Object.keys(root.hubsByTeam[team] || {});
    for (var i = 0; i < types.length; i++) {
      removed += Object.keys(root.hubsByTeam[team][types[i]] || {}).length;
    }
  }
  root.hubsByTeam = {};
  return { ok: true, removed: removed, msg: "all wiped" };
}

// --- Handler chat
global.HubDebug.handle = function(event) {
  var player = event.player;
  if (!player) return;

  var msg = S(event.message || "").trim();
  if (!msg || msg.charAt(0) !== "!") return;

  try { event.cancel(); } catch (e0) {}

  var parts = msg.substring(1).split(/\s+/);
  var cmd = (parts[0] || "").toLowerCase();

  if (cmd !== "hublist" && cmd !== "hubnear" && cmd !== "hubdist" && cmd !== "hubwipe" && cmd !== "hubwipeall") return;

  var server = event.server || player.server;
  var cfg = global.HubDebug.getCfg();
  var root = global.HubDebug.getRoot(server);

  var teamName = teamOf(event.server, player);;
  var playerDim = S(player.level.dimension);
  var radius = Number(cfg.RADIUS != null ? cfg.RADIUS : 12);

  var typeKeys = Object.keys(cfg.HUB_TYPES || {});
  var typesToUse = (typeKeys.length > 0) ? typeKeys : ["ACADEMY", "FACTORY", "PRINCIPAL"];

  player.tell("§6[HUB DEBUG] §fcmd=!"+cmd+" §7team=§f"+teamName+" §7dim=§f"+global.HubDebug.fmtDim(playerDim)+" §7R=§f"+radius);

  // --- Commandes wipe
  if (cmd === "hubwipeall") {
  resetHubsRoot(server);
  player.tell("§a[HUB DEBUG] wipeAll OK (root reset).");
  return;
  }

  if (cmd === "hubwipe") {
    var arg = parts.length >= 2 ? S(parts[1]).toUpperCase() : "ALL";
    var typeOk = (arg === "ALL");
    for (var iT = 0; iT < typesToUse.length; iT++) {
      if (typesToUse[iT] === arg) { typeOk = true; break; }
    }
    if (!typeOk) {
      player.tell("§c[HUB DEBUG] TYPE inconnu: " + arg);
      player.tell("§7Utilisez: !hubwipe  (tout)  ou  !hubwipe ACADEMY/FACTORY/PRINCIPAL");
      return;
    }

    var res = wipeTeam(root, teamName, arg);
    if (res.ok) {
      player.tell("§a[HUB DEBUG] wipe OK. team=" + teamName + " type=" + arg + " removed=" + res.removed);
    } else {
      player.tell("§c[HUB DEBUG] wipe FAILED: " + res.msg);
      player.tell("§7Si root est en NBT, solution simple: redémarrer + laisser le script hubs recréer __HUBS__ proprement.");
    }
    return;
  }

  // --- Lecture hubs
  var hubsByTeam = getChild(root, "hubsByTeam");
  if (!hubsByTeam) {
    player.tell("§c[HUB DEBUG] hubsByTeam introuvable (aucun hub enregistré).");
    return;
  }

  var teamObj = getChild(hubsByTeam, teamName);
  if (!teamObj) {
    player.tell("§c[HUB DEBUG] Aucun hub enregistré pour cette team.");
    return;
  }

  // --- hublist
  if (cmd === "hublist") {
    var total = 0;
    
    for (var i = 0; i < typesToUse.length; i++) {
      var t = typesToUse[i];
      var hubsRaw = getChild(teamObj, t);
      var hubsArr = hubsToArray(hubsRaw);

      total += hubsArr.length;

      player.tell("§e["+t+"] §7count=§f" + hubsArr.length);

      if (hubsArr.length === 0) {
        player.tell("  §8(aucun hub)");
        continue;
      }

      for (var k = 0; k < hubsArr.length; k++) {
        var h = hubsArr[k];
        player.tell("  §7#"+k+" §fpos=(" + h.x + "," + h.y + "," + h.z + ") §7dim=§f" + global.HubDebug.fmtDim(h.dim));
      }
    }

    player.tell("§6[HUB DEBUG] §7total=§f" + total);
    return;
  }

  // --- hubdist
  if (cmd === "hubdist") {
    var px = player.x, py = player.y, pz = player.z;

    for (var i2 = 0; i2 < typesToUse.length; i2++) {
      var t2 = typesToUse[i2];
      var hubsRaw2 = getChild(teamObj, t2);
      var hubsArr2 = hubsToArray(hubsRaw2);

      player.tell("§e["+t2+"] §7count=§f" + hubsArr2.length);

      if (hubsArr2.length === 0) {
        player.tell("  §8(aucun hub)");
        continue;
      }

      for (var kk = 0; kk < hubsArr2.length; kk++) {
        var hh = hubsArr2[kk];
        var sameDim = (S(hh.dim) === playerDim);
        var d = dist3D(px, py, pz, hh.x + 0.5, hh.y + 0.5, hh.z + 0.5);
        var status = !sameDim ? "§cDIM" : (d <= radius ? "§aNEAR" : "§7FAR");

        player.tell("  §7#"+kk+" "+status+" §fpos=(" + hh.x + "," + hh.y + "," + hh.z + ") §7dist=§f" + d.toFixed(2) + " §7dim=§f" + global.HubDebug.fmtDim(hh.dim));
      }
    }
    return;
  }

  // --- hubnear (optionnel si vous le souhaitez encore)
  if (cmd === "hubnear") {
    var uuid = player.uuid ? S(player.uuid) : null;
    var nearState = getChild(root, "nearState");

    if (!uuid || !nearState) {
      player.tell("§c[HUB DEBUG] nearState introuvable.");
      return;
    }

    var nearObj = getChild(nearState, uuid);
    if (!nearObj) {
      player.tell("§c[HUB DEBUG] nearState introuvable pour ce joueur.");
      return;
    }

    for (var i3 = 0; i3 < typesToUse.length; i3++) {
      var t3 = typesToUse[i3];
      var val = false;

      if (isNBTCompound(nearObj) && typeof nearObj.getBoolean === "function") {
        try { val = !!nearObj.getBoolean(t3); } catch (eB) { val = false; }
      } else {
        val = !!nearObj[t3];
      }

      player.tell("§e["+t3+"] §fnear=" + val);
    }
    return;
  }
};

try {
  PlayerEvents.chat(function(event) {
    try {
      global.HubDebug.handle(event);
    } catch (e) {
      console.log("[HUB DEBUG] ERROR in handler: " + e);
    }
  });
  console.log("[HUB DEBUG] PlayerEvents.chat hook installed");
} catch (eA) {
  console.log("[HUB DEBUG] PlayerEvents.chat unavailable: " + eA);
}