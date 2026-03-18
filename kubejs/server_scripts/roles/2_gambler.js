let EconomyAPI = null

try {
  EconomyAPI = Java.loadClass("net.sixik.sdmeconomy.api.EconomyAPI")
  console.info("[GAMBLER] EconomyAPI chargée avec succès")
} catch (e) {
  console.error("[GAMBLER] Impossible de charger EconomyAPI : " + e)
}

if (!global.GamblerSessions) {
  global.GamblerSessions = {}
}

const GAMBLER_ENTRY_COST = 50
const GAMBLER_BASE_MULTIPLIER = 2.0
const GAMBLER_REROLL_MULTIPLIER_STEP = 0.5

function getGamblerKey(player) {
  return String(player.uuid)
}

function getGamblerSession(player) {
  return global.GamblerSessions[getGamblerKey(player)] || null
}

function startNewGamblerSession(player) {
  const key = getGamblerKey(player)

global.GamblerSessions[key] = {
  totalScore: 0,
  invested: GAMBLER_ENTRY_COST,
  payoutMultiplier: GAMBLER_BASE_MULTIPLIER,
  rerollCount: 0,
  rollIndex: 1,
  inRoll: false
}

  return global.GamblerSessions[key]
}

function clearGamblerSession(player) {
  delete global.GamblerSessions[getGamblerKey(player)]
}

function getRequiredDelta(player) {
  if (player.stages.has("gambler_3")) return 2.5
  if (player.stages.has("gambler_2")) return 3.33
  if (player.stages.has("gambler_1")) return 3.75
  return null
}

function getPlayerSdmcCoinAccess(player) {
  if (!player || !EconomyAPI) return null

  try {
    let result = EconomyAPI.getCurrencyPlayerData(player)
    if (!result) return null

    let resultClass = result.getClass()
    let resultFields = resultClass.getDeclaredFields()

    let valueList = null
    let codeValue = null

    for (let i = 0; i < resultFields.length; i++) {
      let f = resultFields[i]
      f.setAccessible(true)

      let name = String(f.getName())
      let value = f.get(result)

      if (name === "value") valueList = value
      if (name === "codes") codeValue = String(value)
    }

    if (codeValue !== "SUCCESS") return null
    if (valueList == null || valueList.size() <= 0) return null

    for (let i = 0; i < valueList.size(); i++) {
      let playerCurrency = valueList.get(i)
      let currencyFields = playerCurrency.getClass().getDeclaredFields()

      let currencyObj = null
      let balanceField = null
      let lockedValue = false
      let currentBalance = 0

      for (let j = 0; j < currencyFields.length; j++) {
        let cf = currencyFields[j]
        cf.setAccessible(true)

        let fieldName = String(cf.getName())

        if (fieldName === "currency") {
          currencyObj = cf.get(playerCurrency)
        } else if (fieldName === "balance") {
          balanceField = cf
          currentBalance = Number(cf.get(playerCurrency))
        } else if (fieldName === "isLocked") {
          let rawLocked = cf.get(playerCurrency)
          lockedValue = String(rawLocked) === "true"
        }
      }

      if (currencyObj == null || balanceField == null) continue

      let currencyClassName = String(currencyObj.getClass().getName())

      if (currencyClassName !== "net.sixik.sdmshop.currencies.SDMCoin") continue
      if (lockedValue) continue

      return {
        playerCurrency: playerCurrency,
        balanceField: balanceField,
        balance: currentBalance
      }
    }

    return null
  } catch (e) {
    console.error("[GAMBLER] Erreur getPlayerSdmcCoinAccess : " + e)
    return null
  }
}

function addPlayerMoney(player, amount) {
  if (!player || !EconomyAPI) return false
  if (amount <= 0) return false

  try {
    let access = getPlayerSdmcCoinAccess(player)
    if (!access) return false

    let newBalance = access.balance + amount
    access.balanceField.set(access.playerCurrency, newBalance)

    EconomyAPI.syncCurrencyData(player)
    EconomyAPI.savePlayerData(player.server)

    return true
  } catch (e) {
    console.error("[GAMBLER] Erreur addPlayerMoney : " + e)
    return false
  }
}

function tryTakePlayerMoney(player, amount) {
  if (!player || !EconomyAPI) return false
  if (amount <= 0) return true

  try {
    let access = getPlayerSdmcCoinAccess(player)
    if (!access) return false

    if (access.balance < amount) return false

    let newBalance = access.balance - amount
    access.balanceField.set(access.playerCurrency, newBalance)

    EconomyAPI.syncCurrencyData(player)
    EconomyAPI.savePlayerData(player.server)

    return true
  } catch (e) {
    console.error("[GAMBLER] Erreur tryTakePlayerMoney : " + e)
    return false
  }
}

function startPaidGamblerRun(player) {
  if (!player) return false

  let existing = getGamblerSession(player)
  if (existing) {
    player.tell("§eUne session Gambler est déjà en cours.")
          player.tell(
        Text.of("§6Choisissez : ")
          .append(
            Text.of("§a[RELANCER]")
              .clickRunCommand("/gambler_continue_pay")
              .hover("§7Paye 50, garde le score, augmente le multiplicateur de 0.5")
          )
          .append(Text.of(" §7ou "))
          .append(
            Text.of("§b[ARRÊTER]")
              .clickRunCommand("/gambler_cashout")
              .hover("§7Encaisser et terminer la session")
          )
      )
    return false
  }

  let ok = tryTakePlayerMoney(player, GAMBLER_ENTRY_COST)
  if (!ok) {
    player.tell("§cVous n'avez pas assez d'argent pour lancer une partie.")
    return false
  }

  startNewGamblerSession(player)
  player.tell("§aNouvelle partie Gambler lancée pour §e" + GAMBLER_ENTRY_COST + "§a.")
  showLoadingAnimation(player, false)
  return true
}

global.HubDebug.handle = function(event) {
  var player = event.player
  if (!player) return

  var msg = S(event.message || "").trim()
  if (!msg || msg.charAt(0) !== "!") return

  try { event.cancel() } catch (e0) {}

  var parts = msg.substring(1).split(/\s+/)
  var cmd = (parts[0] || "").toLowerCase()

  if (cmd !== "balance" && cmd !== "hublist" && cmd !== "hubnear" && cmd !== "hubdist" && cmd !== "hubwipe" && cmd !== "hubwipeall") return

  var server = event.server || player.server
  var cfg = global.HubDebug.getCfg()
  var root = global.HubDebug.getRoot(server)

  var teamName = teamOf(event.server, player)
  var playerDim = S(player.level.dimension)
  var radius = Number(cfg.RADIUS != null ? cfg.RADIUS : 12)

  var typeKeys = Object.keys(cfg.HUB_TYPES || {})
  var typesToUse = (typeKeys.length > 0) ? typeKeys : ["ACADEMY", "FACTORY", "PRINCIPAL"]

  player.tell("§6[HUB DEBUG] §fcmd=!" + cmd + " §7team=§f" + teamName + " §7dim=§f" + global.HubDebug.fmtDim(playerDim) + " §7R=§f" + radius)

  if (cmd == "balance") {

  }
}

ServerEvents.commandRegistry(event => {
  event.register(
    event.commands.literal("gambler_continue_pay")
      .executes(ctx => {
        const player = ctx.source.player
        if (!player) return 0

        const session = getGamblerSession(player)

        // Cas 1 : aucune session => on démarre une nouvelle partie payante
        if (!session) {
          player.tell("on a pas retrouvé ta session")
          const okStart = startPaidGamblerRun(player)
          return okStart ? 1 : 0
        }

        // Cas 2 : session existante => relance payante
        if (session.inRoll) {
          player.tell("§cUne animation est déjà en cours.")
          return 0
        }

        const okPay = tryTakePlayerMoney(player, GAMBLER_ENTRY_COST)
        if (!okPay) {
          player.tell("§cVous n'avez pas assez d'argent pour relancer.")
          return 0
        }

        session.invested += GAMBLER_ENTRY_COST
        session.payoutMultiplier += GAMBLER_REROLL_MULTIPLIER_STEP
        session.rerollCount += 1
        addStageCmd(player.server, player.username, 'gambler_reroll')
        player.tell("§6Relance achetée pour §e" + GAMBLER_ENTRY_COST + "§6.")
        player.tell("§7Nouveau multiplicateur : §ex" + session.payoutMultiplier)

        return 1
      })
  )

  event.register(
    event.commands.literal("gambler_cashout")
      .executes(ctx => {
        const player = ctx.source.player
        if (!player) return 0

        const session = getGamblerSession(player)
        if (!session) {
          player.tell("§cAucune partie Gambler en cours.")
          return 0
        }

        if (session.inRoll) {
          player.tell("§cVous ne pouvez pas encaisser pendant l'animation.")
          return 0
        }

        const reward = Math.floor(session.invested * session.payoutMultiplier)
        const ok = addPlayerMoney(player, reward)

        if (!ok) {
          player.tell("§cImpossible de créditer votre solde.")
          return 0
        }

        player.tell("§aVous avez encaissé §e" + reward + "§a.")
        player.tell("§7Mise totale : §e" + session.invested + " §7| Multiplicateur : §ex" + session.payoutMultiplier)

        clearGamblerSession(player)
        return 1
      })
  )
})

GameStageEvents.stageAdded(event => {
  var stage = String(event.stage)
  var player = event.entity
  if (!player) return

  if (stage === "gambler_reroll") {
    player.tell("Nouveau reroll")
    removeStageCmd(player.server, player.username, 'gambler_reroll')
    showLoadingAnimation(player, true)
    return
  }

    if (stage === "gambling") {
    removeStageCmd(player.server, player.username, 'gambling')
    player.tell("Nouveau reroll")
    startPaidGamblerRun(player)
    showLoadingAnimation(player, true)
    return
  }
})

function showLoadingAnimation(player, isReroll) {
  if (!player || !player.server) return

  const requiredDelta = getRequiredDelta(player)
  if (requiredDelta == null) {
    player.tell("§cVous n'avez aucun stage gambler requis.")
    return
  }

  let session = getGamblerSession(player)
  if (!session) {
    player.tell("§cAucune session Gambler active.")
    return
  }

  if (session.inRoll) {
    player.tell("§cUne animation est déjà en cours.")
    session.inRoll = false
    return
  }

  session.inRoll = true

  let startScore = Number(session.totalScore || 0)
  let total = startScore
  let steps = 5
  let results = []

  let colorThreshold = 999999
  if (player.stages.has("gambler_3")) {
    colorThreshold = 0.50
  } else if (player.stages.has("gambler_2")) {
    colorThreshold = 0.66
  } else if (player.stages.has("gambler_1")) {
    colorThreshold = 0.75
  }
  var multiplicateur = 0
  if(session.rollIndex > 4){
    multiplicateur += 1
  }
  let targetScore = session.rollIndex * (requiredDelta + 0.25) -0.25 + (session.rollIndex ** 2) * 0.015 + multiplicateur * 0.25
  player.runCommandSilent("title @s times 0 40 0")

  function runStep(index) {
    if (!player || !player.server) {
      session.inRoll = false
      return
    }

    if (index >= steps) {
      let finalScore = total.toFixed(2)
      let win = total > targetScore

      let finalTitle = "§eScore total : §f" + finalScore
      let finalSubtitle = win
        ? "§aGAGNÉ §7(objectif: §f" + targetScore.toFixed(2) + "§7)"
        : "§cPERDU §7(objectif: §f" + targetScore.toFixed(2) + "§7)"

      player.runCommandSilent(
        'title @s title {"text":"' + finalTitle + '"}'
      )
      player.runCommandSilent(
        'title @s subtitle {"text":"' + finalSubtitle + '"}'
      )

      session.inRoll = false

      if (!win) {
        let invested = Math.floor(session.invested || 0)
        clearGamblerSession(player)

        player.tell("§cVous avez perdu.")
        player.tell("§cVous perdez toute votre mise : §e" + invested)

        player.tell(
          Text.of("§6Voulez-vous rejouer ? ")
            .append(
              Text.of("§a[RELANCER]")
                .clickRunCommand("/gambler_continue_pay")
                .hover("§7Payer 50 pour recommencer une nouvelle partie")
            )
        )

        return
      }

      session.totalScore = total
      session.rollIndex += 1

      let currentPotentialReward = Math.floor(session.invested * session.payoutMultiplier)

      player.tell("§aVictoire.")
      player.tell("§7Score conservé : §e" + total.toFixed(2))
      player.tell("§7Relances payées : §e" + session.rerollCount)
      player.tell("§7Mise totale : §e" + session.invested)
      player.tell("§7Multiplicateur actuel : §ex" + session.payoutMultiplier)
      player.tell("§7Gain potentiel si vous arrêtez maintenant : §e" + currentPotentialReward)

      player.tell(
        Text.of("§6Choisissez : ")
          .append(
            Text.of("§a[RELANCER]")
              .clickRunCommand("/gambler_continue_pay")
              .hover("§7Paye 50, garde le score, augmente le multiplicateur de 0.5")
          )
          .append(Text.of(" §7ou "))
          .append(
            Text.of("§b[ARRÊTER]")
              .clickRunCommand("/gambler_cashout")
              .hover("§7Encaisser et terminer la session")
          )
      )

      return
    }

    let r = Math.random()
    let value = r.toFixed(1)
    let colored = (r > colorThreshold ? "§a" : "§c") + value

    results.push(colored)
    total += r

    let currentScore = total.toFixed(2)
    let subtitleMsg = "§7Objectif: §f" + targetScore.toFixed(2) + " §8| §7Tirages: " + results.join(" ")
    player.runCommandSilent(
      'title @s title {"text":"§eScore : §f' + currentScore + '"}'
    )
    player.runCommandSilent(
      'title @s subtitle {"text":"' + subtitleMsg + '"}'
    )

    player.server.scheduleInTicks(20, function () {
      playSoundXP(player.server, player.username)
      runStep(index + 1)
    })
  }

  runStep(0)
}


if (!global.GamblingHeartState) {
  global.GamblingHeartState = {}
}

function getHeartKey(player) {
  return String(player.uuid)
}

function setHeartWaiting(player) {
  global.GamblingHeartState[getHeartKey(player)] = {
    waiting: true
  }
}

function clearHeartWaiting(player) {
  delete global.GamblingHeartState[getHeartKey(player)]
}

function isHeartWaiting(player) {
  let state = global.GamblingHeartState[getHeartKey(player)]
  return state != null && state.waiting === true
}

function findOnlinePlayerByName(server, name) {
  if (!server || !name) return null

  let list = server.getPlayerList().getPlayers()
  let wanted = String(name).trim().toLowerCase()

  for (let i = 0; i < list.size(); i++) {
    let p = list.get(i)
    if (String(p.username).toLowerCase() === wanted) {
      return p
    }
  }

  return null
}

function launchGamblingHeartWheel(sourcePlayer, targetPlayer) {
  if (!sourcePlayer || !sourcePlayer.server || !targetPlayer) return

  let server = sourcePlayer.server

  // 1 chance sur 5 de gagner (★)
  let isWin = Math.floor(Math.random() * 5) === 0

  let wheel = []
  let totalSteps = 40

  for (let i = 0; i < totalSteps - 1; i++) {
    wheel.push(Math.random() < 0.5 ? "WIN" : "LOSE")
  }

  wheel.push(isWin ? "WIN" : "LOSE")

  let index = 0

  sourcePlayer.runCommandSilent("title @s times 0 6 0")

  function buildLine(value, selected) {
    let text = " "
    let color = "white"

    if (value === "WIN") {
      text = "★"
      color = "yellow"
    } else if (value === "LOSE") {
      text = "☠"
      color = "red"
    }

    if (selected) {
      return '{"text":"[ ' + text + ' ]","color":"' + color + '","bold":true}'
    } else {
      return '{"text":"  ' + text + '  ","color":"' + color + '"}'
    }
  }

  function showFrame() {
    if (!sourcePlayer || !sourcePlayer.server) return

    let top = index > 0 ? wheel[index - 1] : " "
    let mid = wheel[index]
    let bot = index < wheel.length - 1 ? wheel[index + 1] : " "

    let titleJson =
      '[' +
      buildLine(top, false) + ',' +
      '{"text":" "},' +
      buildLine(mid, true) + ',' +
      '{"text":" "},' +
      buildLine(bot, false) +
      ']'

    sourcePlayer.runCommandSilent('title @s title ' + titleJson)
    sourcePlayer.runCommandSilent(
      'title @s subtitle {"text":"Cible : ' + targetPlayer.username + '","color":"white"}'
    )

    // ===== FIN DE LA ROUE =====
    if (index >= wheel.length - 1) {
      let finalValue = wheel[index]

      if (finalValue === "WIN") {
        // Message pour le lanceur
        sourcePlayer.tell("§6★ GAGNÉ ! §f" + targetPlayer.username + " §6subit 5 coeurs.")

        // Dégâts
        server.runCommandSilent('damage ' + targetPlayer.username + ' 10 minecraft:generic')

        // ===== MESSAGE A LA CIBLE =====
        targetPlayer.runCommandSilent("title @s times 10 40 10")

        targetPlayer.runCommandSilent(
          'title @s title {"text":"☠ VOUS AVEZ ÉTÉ CIBLÉ","color":"red","bold":true}'
        )

        targetPlayer.runCommandSilent(
          'title @s subtitle {"text":"Par ' + sourcePlayer.username + '","color":"gold"}'
        )

        targetPlayer.tell("§cVous avez été frappé par un Gambling Heart !")

      } else {
        sourcePlayer.tell("§c☠ PERDU... §fVous subissez 5 coeurs.")

        server.runCommandSilent('damage ' + sourcePlayer.username + ' 10 minecraft:generic')
      }

      return
    }

    index++

    // Ralentissement progressif
    let delay = 1
    if (index > 20) delay = 2
    if (index > 30) delay = 3
    if (index > 35) delay = 4
    if (index > 38) delay = 5

    server.scheduleInTicks(delay, function () {
      showFrame()
    })
  }

  showFrame()
}

function showConnectedPlayersClickable(player) {
  if (!player || !player.server) return

  let list = player.server.getPlayerList().getPlayers()
  log("on a la list + " + list)
  let found = false

  player.tell("§d[GAMBLING HEART] §fChoisissez un joueur connecté :")

  for (let i = 0; i < list.size(); i++) {
    let target = list.get(i)
    log("on a la target " + target)
    if (!target) continue

    let targetName = String(target.username)
    log(" ona a target name " + targetName)
    // empêche de se sélectionner soi-même

    found = true

    player.tell(
      Text.of("§a[ " + targetName + " ]")
        .clickSuggestCommand("#gh " + targetName)
        .hover("§7Cliquez puis validez pour choisir " + targetName)
    )
  }

  if (!found) {
    player.tell("§cAucun autre joueur connecté.")
    clearHeartWaiting(player)
  } else {
    player.tell("§7Après avoir cliqué sur un nom, appuyez sur Entrée.")
  }
}



GameStageEvents.stageAdded(event => {
  let player = event.entity
  if (!player) return

  let stage = String(event.stage)
  if (stage !== "gambling_heart") return

  player.stages.remove("gambling_heart")
  setHeartWaiting(player)
  showConnectedPlayersClickable(player)
})

PlayerEvents.chat(event => {
  let player = event.player
  if (!player) return

  let msg = String(event.message || "").trim()
  log("msg = " + msg)
  if (!isHeartWaiting(player)) return
  if (!msg.startsWith("#gh ")) return


  let typedName = msg.substring(4).trim()
  if (!typedName) {
    player.tell("§cNom invalide.")
    return
  }

  let targetPlayer = findOnlinePlayerByName(player.server, typedName)
  if (!targetPlayer) {
    player.tell("§cLe joueur §f" + typedName + "§c n'est pas connecté.")
    player.tell("§7Cliquez sur un nom valide dans la liste.")
    return
  }

  clearHeartWaiting(player)
  player.tell("§aVous avez choisi §f" + targetPlayer.username + "§a.")
  launchGamblingHeartWheel(player, targetPlayer)
  event.cancel()
})

if (!global.GamblerDeathState) {
  global.GamblerDeathState = {}
}

function getDeathKey(player) {
  return String(player.uuid)
}

function setDeathWaiting(player) {
  global.GamblerDeathState[getDeathKey(player)] = {
    waiting: true
  }
}

function clearDeathWaiting(player) {
  delete global.GamblerDeathState[getDeathKey(player)]
}

function isDeathWaiting(player) {
  let state = global.GamblerDeathState[getDeathKey(player)]
  return state != null && state.waiting === true
}


function showConnectedPlayersClickableForDeath(player) {
  if (!player || !player.server) return

  let list = player.server.getPlayerList().getPlayers()
  let found = false

  player.tell("§4[GAMBLER DEATH] §fChoisissez un joueur connecté :")

  for (let i = 0; i < list.size(); i++) {
    let target = list.get(i)
    if (!target) continue

    let targetName = String(target.username)

    // Empêche de se cibler soi-même

    found = true

    player.tell(
      Text.of("§c[ " + targetName + " ]")
        .clickSuggestCommand("#gd " + targetName)
        .hover("§7Cliquez puis validez pour choisir " + targetName)
    )
  }

  if (!found) {
    player.tell("§cAucun autre joueur connecté.")
    clearDeathWaiting(player)
  } else {
    player.tell("§7Après avoir cliqué sur un nom, appuyez sur Entrée.")
  }
}

function launchGamblerDeathWheel(sourcePlayer, targetPlayer) {
  if (!sourcePlayer || !sourcePlayer.server || !targetPlayer) return

  let server = sourcePlayer.server

  // 10 effets différents
  let wheelEntries = [
    {
      emoji: "✨",
      label: "+10 niveaux",
      effectId: "give_levels_10"
    },
    {
      emoji: "🔁",
      label: "Retour à l'envoyeur",
      effectId: "return_gambler_death"
    },
    {
      emoji: "💰",
      label: "+1000 gold",
      effectId: "give_1000_gold"
    },
    {
      emoji: "🪙",
      label: "-1000 gold",
      effectId: "take_1000_gold"
    },
    {
      emoji: "📦",
      label: "Airdrop",
      effectId: "airdrop"
    },
    {
      emoji: "🩸",
      label: "-5 PV",
      effectId: "damage_5"
    },
    {
      emoji: "💥",
      label: "-9 PV",
      effectId: "damage_9"
    },
    {
      emoji: "☠",
      label: "Wither",
      effectId: "wither"
    },
    {
      emoji: "💸",
      label: "Vol de 500 gold",
      effectId: "steal_500_gold"
    },
    {
      emoji: "🪝",
      label: "Téléportation sur le lanceur",
      effectId: "tp_target_to_source"
    }
  ]

  let finalIndex = Math.floor(Math.random() * wheelEntries.length)
  let finalEntry = wheelEntries[finalIndex]

  let totalSteps = 40
  let wheel = []

  for (let i = 0; i < totalSteps - 1; i++) {
    wheel.push(wheelEntries[Math.floor(Math.random() * wheelEntries.length)])
  }

  wheel.push(finalEntry)

  let index = 0

  sourcePlayer.runCommandSilent("title @s times 0 6 0")

  function getEmojiColor(emoji) {
    if (emoji === "✨") return "light_purple"
    if (emoji === "🔁") return "yellow"
    if (emoji === "💰") return "gold"
    if (emoji === "🪙") return "dark_gray"
    if (emoji === "📦") return "aqua"
    if (emoji === "🩸") return "red"
    if (emoji === "💥") return "dark_red"
    if (emoji === "☠") return "black"
    if (emoji === "💸") return "green"
    if (emoji === "🪝") return "blue"
    return "white"
  }

  function buildLine(entry, selected) {
    if (!entry) {
      return '{"text":"   ","color":"white"}'
    }

    let color = getEmojiColor(entry.emoji)

    if (selected) {
      return '{"text":"[ ' + entry.emoji + ' ]","color":"' + color + '","bold":true}'
    } else {
      return '{"text":"  ' + entry.emoji + '  ","color":"' + color + '"}'
    }
  }

  function executeWheelEffect(entry) {
    if (!entry) return

    let sourceName = String(sourcePlayer.username)
    let targetName = String(targetPlayer.username)

    switch (entry.effectId) {
      case "give_levels_10":
        server.runCommandSilent('experience add ' + targetName + ' 10 levels')
        sourcePlayer.tell("§a" + targetName + " reçoit §e10 niveaux§a.")
        targetPlayer.tell("§aVous avez reçu §e10 niveaux§a.")
        break

      case "return_gambler_death":
        addStageCmd(server, targetName, 'gambler_death')
        sourcePlayer.tell("§eRetour à l'envoyeur : §f" + targetName + " §ereçoit le stage §cgambler_death§e.")
        targetPlayer.tell("§cVous avez reçu le stage §4gambler_death§c.")
        break

      case "give_1000_gold":
        server.runCommandSilent('sdmshop add ' + targetName + ' 1000')
        sourcePlayer.tell("§6" + targetName + " reçoit §e1000 gold§6.")
        targetPlayer.tell("§6Vous avez reçu §e1000 gold§6.")
        break

      case "take_1000_gold":
        server.runCommandSilent('sdmshop add ' + targetName + ' -1000')
        sourcePlayer.tell("§c" + targetName + " perd §e1000 gold§c.")
        targetPlayer.tell("§cVous avez perdu §e1000 gold§c.")
        break

case "airdrop":
  server.runCommandSilent('execute as ' + targetName + ' at ' + targetName + ' run airdrop')
  sourcePlayer.tell("§bUn airdrop a été déclenché sur §f" + targetName + "§b.")
  targetPlayer.tell("§bUn airdrop a été déclenché sur vous.")
  break

      case "damage_5":
        server.runCommandSilent('damage ' + targetName + ' 5 minecraft:generic')
        sourcePlayer.tell("§c" + targetName + " perd §e5 points de vie§c.")
        targetPlayer.tell("§cVous perdez §e5 points de vie§c.")
        break

      case "damage_9":
        server.runCommandSilent('damage ' + targetName + ' 9 minecraft:generic')
        sourcePlayer.tell("§c" + targetName + " perd §e9 points de vie§c.")
        targetPlayer.tell("§cVous perdez §e9 points de vie§c.")
        break

      case "wither":
        server.runCommandSilent('effect give ' + targetName + ' minecraft:wither 8 1 true')
        sourcePlayer.tell("§8" + targetName + " reçoit l'effet §0Wither§8.")
        targetPlayer.tell("§8Vous recevez l'effet §0Wither§8.")
        break

      case "steal_500_gold":
        server.runCommandSilent('sdmshop add ' + targetName + ' -500')
        server.runCommandSilent('sdmshop add ' + sourceName + ' 500')
        sourcePlayer.tell("§aVous volez §e500 gold §aà §f" + targetName + "§a.")
        targetPlayer.tell("§cVous perdez §e500 gold §cau profit de §f" + sourceName + "§c.")
        break

      case "tp_target_to_source":
        server.runCommandSilent('tp ' + targetName + ' ' + sourceName)
        sourcePlayer.tell("§b" + targetName + " a été téléporté sur vous.")
        targetPlayer.tell("§bVous avez été téléporté vers §f" + sourceName + "§b.")
        break
    }
  }

  function showFrame() {
    if (!sourcePlayer || !sourcePlayer.server) return

    let top = index > 0 ? wheel[index - 1] : null
    let mid = wheel[index]
    let bot = index < wheel.length - 1 ? wheel[index + 1] : null

    let titleJson =
      '[' +
      buildLine(top, false) + ',' +
      '{"text":" "},' +
      buildLine(mid, true) + ',' +
      '{"text":" "},' +
      buildLine(bot, false) +
      ']'

    sourcePlayer.runCommandSilent('title @s title ' + titleJson)
    sourcePlayer.runCommandSilent(
      'title @s subtitle {"text":"Cible : ' + targetPlayer.username + '","color":"white"}'
    )

    if (index >= wheel.length - 1) {
      let result = wheel[index]

      sourcePlayer.runCommandSilent("title @s times 10 40 10")
      sourcePlayer.runCommandSilent(
        'title @s title {"text":"Résultat : ' + result.emoji + '","color":"gold","bold":true}'
      )
      sourcePlayer.runCommandSilent(
        'title @s subtitle {"text":"' + result.label + '","color":"white"}'
      )

      sourcePlayer.tell("§6La roue s'arrête sur §f" + result.emoji + " §7(" + result.label + "§7)")

      targetPlayer.runCommandSilent("title @s times 10 40 10")
      targetPlayer.runCommandSilent(
        'title @s title {"text":"Effet reçu : ' + result.emoji + '","color":"red","bold":true}'
      )
      targetPlayer.runCommandSilent(
        'title @s subtitle {"text":"' + result.label + '","color":"gold"}'
      )

      executeWheelEffect(result)
      return
    }

    index++

    let delay = 1
    if (index > 20) delay = 2
    if (index > 30) delay = 3
    if (index > 35) delay = 4
    if (index > 38) delay = 5

    server.scheduleInTicks(delay, function () {
      showFrame()
    })
  }

  showFrame()
}

GameStageEvents.stageAdded(event => {
  let player = event.entity
  if (!player) return

  let stage = String(event.stage)
  if (stage === "gambler_death"){
  player.tell("Tu as repris la mort ")
  player.stages.remove("gambler_death")
  setDeathWaiting(player)
  showConnectedPlayersClickableForDeath(player)
}})

PlayerEvents.chat(event => {
  let player = event.player
  if (!player) return

  let msg = String(event.message || "").trim()

  if (!isDeathWaiting(player)) return
  if (!msg.startsWith("#gd ")) return

  let typedName = msg.substring(4).trim()
  if (!typedName) {
    player.tell("§cNom invalide.")
    event.cancel()
    return
  }

  let targetPlayer = findOnlinePlayerByName(player.server, typedName)
  if (!targetPlayer) {
    player.tell("§cLe joueur §f" + typedName + "§c n'est pas connecté.")
    player.tell("§7Cliquez sur un nom valide dans la liste.")
    event.cancel()
    return
  }

  clearDeathWaiting(player)
  player.tell("§aVous avez choisi §f" + targetPlayer.username + "§a.")
  launchGamblerDeathWheel(player, targetPlayer)
  event.cancel()
})