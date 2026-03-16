StartupEvents.registry('block', event => {

  event.create('base_heart_academy_bloc')
    .displayName('Base Heart (Academy)')
    .hardness(1.0)
    .resistance(3600000.0)   // ✅ anti-explosion (très haute résistance)
    .requiresTool(true)

  event.create('base_heart_factory_bloc')
    .displayName('Base Heart (Factory)')
    .hardness(1.0)
    .resistance(3600000.0)   // ✅ anti-explosion
    .requiresTool(true)

  event.create('base_heart_principal_bloc')
    .displayName('Base Heart (Principal)')
    .hardness(1.0)
    .resistance(3600000.0)   // ✅ anti-explosion
    .requiresTool(true)
})