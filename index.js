require('dotenv').config();

const { Client, GatewayIntentBits, Partials, EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const Database = require('better-sqlite3');
const express = require('express');

// =============================================
//  SERVIDOR WEB (para estadísticas en tiempo real)
// =============================================
const app = express();
const PORT = process.env.PORT || 3000;

app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  next();
});

app.get('/stats', (req, res) => {
  res.json({
    servers: client.guilds?.cache.size || 0,
    users: client.guilds?.cache.reduce((acc, guild) => acc + guild.memberCount, 0) || 0,
    status: client.isReady() ? 'online' : 'offline',
    ping: client.ws.ping || 0,
  });
});

app.get('/', (req, res) => res.send('Orvex Bot API funcionando ✅'));

app.listen(PORT, () => console.log(`🌐 API corriendo en puerto ${PORT}`));

// =============================================
//  BASE DE DATOS
// =============================================
const db = new Database('orvex.db');

db.exec(`
  CREATE TABLE IF NOT EXISTS warns (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    userId    TEXT NOT NULL,
    guildId   TEXT NOT NULL,
    reason    TEXT NOT NULL,
    moderator TEXT NOT NULL,
    date      TEXT NOT NULL
  )
`);

function addWarn(userId, guildId, reason, moderator) {
  const stmt = db.prepare('INSERT INTO warns (userId, guildId, reason, moderator, date) VALUES (?, ?, ?, ?, ?)');
  stmt.run(userId, guildId, reason, moderator, new Date().toISOString());
}

function getWarns(userId, guildId) {
  const stmt = db.prepare('SELECT * FROM warns WHERE userId = ? AND guildId = ?');
  return stmt.all(userId, guildId);
}

function clearWarns(userId, guildId) {
  const stmt = db.prepare('DELETE FROM warns WHERE userId = ? AND guildId = ?');
  stmt.run(userId, guildId);
}

// =============================================
//  CONFIGURACIÓN
// =============================================
const TOKEN          = process.env.TOKEN;
const PREFIX         = '!';
const LOG_CHANNEL_ID = '';

// =============================================
//  CLIENTE
// =============================================
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
  ],
  partials: [Partials.Message, Partials.Channel],
});

// =============================================
//  LOGS
// =============================================
async function sendLog(guild, embed) {
  if (!LOG_CHANNEL_ID) return;
  try {
    const logChannel = await guild.channels.fetch(LOG_CHANNEL_ID);
    if (logChannel) logChannel.send({ embeds: [embed] });
  } catch (_) {}
}

// =============================================
//  BOT LISTO
// =============================================
client.once('ready', () => {
  console.log(`✅ Bot conectado como ${client.user.tag}`);
  console.log(`📋 Servidores: ${client.guilds.cache.size}`);
  console.log(`💾 Base de datos lista`);
  client.user.setActivity('!help | Orvex', { type: 3 });
});

// =============================================
//  MENSAJES
// =============================================
client.on('messageCreate', async (message) => {
  if (message.author.bot) return;
  if (!message.guild) return;
  if (!message.content.startsWith(PREFIX)) return;

  const args    = message.content.slice(PREFIX.length).trim().split(/ +/);
  const command = args.shift().toLowerCase();

  // ── HELP ──
  if (command === 'help') {
    const embed = new EmbedBuilder()
      .setTitle('📋 Comandos de Orvex')
      .setColor(0x7c3aed)
      .addFields(
        { name: '`!warn @usuario [razón]`', value: 'Advierte a un usuario',               inline: false },
        { name: '`!warns @usuario`',         value: 'Ver advertencias de un usuario',      inline: false },
        { name: '`!clearwarns @usuario`',    value: 'Eliminar advertencias de un usuario', inline: false },
        { name: '`!kick @usuario [razón]`',  value: 'Expulsa a un usuario',                inline: false },
        { name: '`!ban @usuario [razón]`',   value: 'Banea a un usuario',                  inline: false },
        { name: '`!unban ID`',               value: 'Desbanea a un usuario por su ID',     inline: false },
        { name: '`!clear [cantidad]`',       value: 'Borra mensajes del canal (máx 100)',  inline: false },
      )
      .setFooter({ text: `Prefijo: ${PREFIX} • Orvex Bot` })
      .setTimestamp();
    return message.reply({ embeds: [embed] });
  }

  // ── WARN ──
  if (command === 'warn') {
    if (!message.member.permissions.has(PermissionFlagsBits.ModerateMembers))
      return message.reply('❌ No tienes permisos para advertir usuarios.');

    const target = message.mentions.members.first();
    if (!target) return message.reply('❌ Menciona al usuario. Ej: `!warn @usuario spam`');
    if (target.id === message.author.id) return message.reply('❌ No puedes advertirte a ti mismo.');
    if (target.user.bot) return message.reply('❌ No puedes advertir a un bot.');

    const reason = args.slice(1).join(' ') || 'Sin razón especificada';

    addWarn(target.id, message.guild.id, reason, message.author.tag);
    const userWarns = getWarns(target.id, message.guild.id);

    const embed = new EmbedBuilder()
      .setTitle('⚠️ Advertencia emitida')
      .setColor(0xFEE75C)
      .addFields(
        { name: 'Usuario',        value: `${target.user.tag} (${target.id})`, inline: true },
        { name: 'Moderador',      value: message.author.tag,                  inline: true },
        { name: 'Total de warns', value: `${userWarns.length}`,               inline: true },
        { name: 'Razón',          value: reason,                              inline: false },
      )
      .setThumbnail(target.user.displayAvatarURL())
      .setTimestamp();

    message.channel.send({ embeds: [embed] });

    try {
      await target.send({
        embeds: [new EmbedBuilder()
          .setTitle(`⚠️ Has recibido una advertencia en ${message.guild.name}`)
          .setColor(0xFEE75C)
          .addFields(
            { name: 'Razón',          value: reason },
            { name: 'Moderador',      value: message.author.tag },
            { name: 'Total de warns', value: `${userWarns.length}` },
          )
          .setTimestamp()
        ]
      });
    } catch (_) {}

    sendLog(message.guild, embed);
  }

  // ── WARNS ──
  if (command === 'warns') {
    if (!message.member.permissions.has(PermissionFlagsBits.ModerateMembers))
      return message.reply('❌ No tienes permisos para ver advertencias.');

    const target = message.mentions.members.first();
    if (!target) return message.reply('❌ Menciona al usuario. Ej: `!warns @usuario`');

    const userWarns = getWarns(target.id, message.guild.id);

    if (userWarns.length === 0)
      return message.reply(`✅ **${target.user.tag}** no tiene advertencias.`);

    const warnList = userWarns
      .map((w, i) => {
        const fecha = new Date(w.date).toLocaleDateString('es-MX');
        return `**#${i + 1}** — ${w.reason}\n└ Por: ${w.moderator} • ${fecha}`;
      })
      .join('\n\n');

    const embed = new EmbedBuilder()
      .setTitle(`📋 Advertencias de ${target.user.tag}`)
      .setColor(0xEB459E)
      .setDescription(warnList)
      .setThumbnail(target.user.displayAvatarURL())
      .setFooter({ text: `Total: ${userWarns.length} advertencia(s)` })
      .setTimestamp();

    message.reply({ embeds: [embed] });
  }

  // ── CLEARWARNS ──
  if (command === 'clearwarns') {
    if (!message.member.permissions.has(PermissionFlagsBits.Administrator))
      return message.reply('❌ Solo los administradores pueden limpiar advertencias.');

    const target = message.mentions.members.first();
    if (!target) return message.reply('❌ Menciona al usuario. Ej: `!clearwarns @usuario`');

    clearWarns(target.id, message.guild.id);

    const embed = new EmbedBuilder()
      .setTitle('🧹 Advertencias eliminadas')
      .setColor(0x57F287)
      .setDescription(`Las advertencias de **${target.user.tag}** han sido eliminadas.`)
      .addFields({ name: 'Moderador', value: message.author.tag })
      .setTimestamp();

    message.reply({ embeds: [embed] });
    sendLog(message.guild, embed);
  }

  // ── CLEAR ──
  if (command === 'clear' || command === 'purge') {
    if (!message.member.permissions.has(PermissionFlagsBits.ManageMessages))
      return message.reply('❌ No tienes permisos para borrar mensajes.');
    if (!message.guild.members.me.permissions.has(PermissionFlagsBits.ManageMessages))
      return message.reply('❌ El bot no tiene permisos para borrar mensajes.');

    const amount = parseInt(args[0]);
    if (!amount || amount < 1 || amount > 100)
      return message.reply('❌ Pon un número entre 1 y 100. Ej: `!clear 10`');

    await message.delete();
    const deleted = await message.channel.bulkDelete(amount, true);

    const msg = await message.channel.send({
      embeds: [new EmbedBuilder()
        .setTitle('🧹 Chat limpiado')
        .setColor(0x57F287)
        .setDescription(`Se borraron **${deleted.size}** mensajes.`)
        .addFields({ name: 'Moderador', value: message.author.tag })
        .setTimestamp()
      ]
    });

    setTimeout(() => msg.delete(), 4000);
  }

  // ── KICK ──
  if (command === 'kick') {
    if (!message.member.permissions.has(PermissionFlagsBits.KickMembers))
      return message.reply('❌ No tienes permisos para expulsar usuarios.');
    if (!message.guild.members.me.permissions.has(PermissionFlagsBits.KickMembers))
      return message.reply('❌ El bot no tiene permisos para expulsar usuarios.');

    const target = message.mentions.members.first();
    if (!target) return message.reply('❌ Menciona al usuario. Ej: `!kick @usuario razón`');
    if (!target.kickable) return message.reply('❌ No puedo expulsar a ese usuario (tiene un rol superior al mío).');

    const reason = args.slice(1).join(' ') || 'Sin razón especificada';

    try {
      await target.send({
        embeds: [new EmbedBuilder()
          .setTitle(`👢 Has sido expulsado de ${message.guild.name}`)
          .setColor(0xED4245)
          .addFields({ name: 'Razón', value: reason })
          .setTimestamp()
        ]
      });
    } catch (_) {}

    await target.kick(reason);

    const embed = new EmbedBuilder()
      .setTitle('👢 Usuario expulsado')
      .setColor(0xED4245)
      .addFields(
        { name: 'Usuario',   value: `${target.user.tag} (${target.id})`, inline: true },
        { name: 'Moderador', value: message.author.tag,                  inline: true },
        { name: 'Razón',     value: reason,                              inline: false },
      )
      .setThumbnail(target.user.displayAvatarURL())
      .setTimestamp();

    message.channel.send({ embeds: [embed] });
    sendLog(message.guild, embed);
  }

  // ── BAN ──
  if (command === 'ban') {
    if (!message.member.permissions.has(PermissionFlagsBits.BanMembers))
      return message.reply('❌ No tienes permisos para banear usuarios.');
    if (!message.guild.members.me.permissions.has(PermissionFlagsBits.BanMembers))
      return message.reply('❌ El bot no tiene permisos para banear usuarios.');

    const target = message.mentions.members.first();
    if (!target) return message.reply('❌ Menciona al usuario. Ej: `!ban @usuario razón`');
    if (!target.bannable) return message.reply('❌ No puedo banear a ese usuario (tiene un rol superior al mío).');

    const reason = args.slice(1).join(' ') || 'Sin razón especificada';

    try {
      await target.send({
        embeds: [new EmbedBuilder()
          .setTitle(`🔨 Has sido baneado de ${message.guild.name}`)
          .setColor(0xED4245)
          .addFields({ name: 'Razón', value: reason })
          .setTimestamp()
        ]
      });
    } catch (_) {}

    await target.ban({ reason, deleteMessageSeconds: 60 * 60 * 24 });

    const embed = new EmbedBuilder()
      .setTitle('🔨 Usuario baneado')
      .setColor(0xED4245)
      .addFields(
        { name: 'Usuario',   value: `${target.user.tag} (${target.id})`, inline: true },
        { name: 'Moderador', value: message.author.tag,                  inline: true },
        { name: 'Razón',     value: reason,                              inline: false },
      )
      .setThumbnail(target.user.displayAvatarURL())
      .setTimestamp();

    message.channel.send({ embeds: [embed] });
    sendLog(message.guild, embed);
  }

  // ── UNBAN ──
  if (command === 'unban') {
    if (!message.member.permissions.has(PermissionFlagsBits.BanMembers))
      return message.reply('❌ No tienes permisos para desbanear usuarios.');

    const userId = args[0];
    if (!userId) return message.reply('❌ Pon la ID del usuario. Ej: `!unban 123456789012345678`');

    try {
      await message.guild.members.unban(userId);

      const embed = new EmbedBuilder()
        .setTitle('✅ Usuario desbaneado')
        .setColor(0x57F287)
        .addFields(
          { name: 'ID del usuario', value: userId,             inline: true },
          { name: 'Moderador',      value: message.author.tag, inline: true },
        )
        .setTimestamp();

      message.channel.send({ embeds: [embed] });
      sendLog(message.guild, embed);
    } catch (err) {
      message.reply('❌ No encontré ese usuario en la lista de baneados. Verifica que la ID sea correcta.');
    }
  }
});

// =============================================
//  ERRORES
// =============================================
client.on('error', (err) => console.error('Error del cliente:', err));
process.on('unhandledRejection', (err) => console.error('Error no manejado:', err));

// =============================================
//  INICIAR
// =============================================
client.login(TOKEN);
