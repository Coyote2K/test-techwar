// =======================
// Réglages
// =======================
const FALL_SPEED = 1.0  // blocs par tick (2.5 = très rapide). Essayez 1.5 si vous voulez plus smooth.
const RADIUS = 128      // IMPORTANT : 1000 = souvent hors chunks chargés -> l'airdrop ne tick pas

// =======================
// /airdrop
// =======================
ServerEvents.commandRegistry(event => {
  event.register(
    event.commands.literal("airdrop")
      .executes(ctx => {
        const player = ctx.source.player
        if (!player) return 0

        const server = ctx.source.server   // ✅ mieux que event.server
        const level = player.level

        const x = player.x + (Math.random() - 0.5) * (RADIUS * 2)
        const z = player.z + (Math.random() - 0.5) * (RADIUS * 2)
        const y = 256


        // ✅ tellraw global doré, SANS "/" et avec @a
        server.runCommandSilent(
          `tellraw @a [{"text":"═════════════════════════════\\n","color":"red"},` +
          `{"text":"Un joueur a commandé un airdrop aux coordonnées :\\n","color":"blue"},` +
          `{"text":"                     (${Math.floor(x)}, ${Math.floor(y)}, ${Math.floor(z)})        \\n","color":"blue"},` +
          `{"text":"═════════════════════════════","color":"red"}]`
        )
        // Spawn du faux coffre (display)
        level.runCommandSilent(
          `summon minecraft:block_display ${x} ${y} ${z} {block_state:{Name:"minecraft:chest"},Tags:["airdrop"]}`
        )

        // Petit effet au spawn
        level.runCommandSilent(
          `particle minecraft:cloud ${x} ${y} ${z} 0.6 0.6 0.6 0.02 20`
        )

        return 1
      })
  )
})

// =======================
// Tick : chute + atterrissage (100% commandes)
// =======================
ServerEvents.tick(event => {
  const server = event.server

  // On exécute dans chaque dimension pour être robuste
  server.allLevels.forEach(level => {

    // 1) Particules pendant la descente
    level.runCommandSilent(
      `execute as @e[type=minecraft:block_display,tag=airdrop] at @s run particle minecraft:cloud ~ ~ ~ 0.2 0.2 0.2 0.01 3`
    )

    // 2) Si le bloc en dessous est de l'air => on descend vite
    level.runCommandSilent(
      `execute as @e[type=minecraft:block_display,tag=airdrop] at @s if block ~ ~-1 ~ minecraft:air run tp @s ~ ~-${FALL_SPEED} ~`
    )

    // 3) Si le bloc en dessous n'est PAS de l'air => atterrissage :
    //    - on place un vrai coffre
    //    - on lui met la loot table
    //    - on supprime le display
    //
    // Note : ~ ~ ~ est la position courante de l'entité (arrondie aux coordonnées bloc par Minecraft)
    level.runCommandSilent(
      `execute as @e[type=minecraft:block_display,tag=airdrop] at @s unless block ~ ~-1 ~ minecraft:air run setblock ~ ~ ~ minecraft:chest`
    )

    level.runCommandSilent(
      `execute as @e[type=minecraft:block_display,tag=airdrop] at @s unless block ~ ~-1 ~ minecraft:air run data merge block ~ ~ ~ {LootTable:"custom:chests/air_drop"}`
    )

    level.runCommandSilent(
      `execute as @e[type=minecraft:block_display,tag=airdrop] at @s unless block ~ ~-1 ~ minecraft:air run kill @s`
    )
  })
})