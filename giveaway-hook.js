const { Client, REST, EmbedBuilder, MessageFlags, PermissionsBitField } = require('discord.js');

const giveawayCommand = {
  name: 'giveaway',
  description: 'إرسال رسالة Giveaway داخل روم تختاره',
  options: [
    {
      name: 'channel',
      description: 'الروم الذي سيتم إرسال الرسالة فيه',
      type: 7,
      required: true,
      channel_types: [0]
    },
    {
      name: 'message',
      description: 'الكلام الذي تريد إرساله',
      type: 3,
      required: true,
      max_length: 4000
    }
  ]
};

const originalPut = REST.prototype.put;
REST.prototype.put = function(route, options = {}) {
  if (Array.isArray(options.body)) {
    const body = options.body.filter(c => c?.name !== 'giveaway');
    body.push(giveawayCommand);
    options = { ...options, body };
  }
  return originalPut.call(this, route, options);
};

const originalEmit = Client.prototype.emit;
Client.prototype.emit = function(event, ...args) {
  if (event === 'interactionCreate') {
    const interaction = args[0];
    if (interaction?.isChatInputCommand?.() && interaction.commandName === 'giveaway') {
      setImmediate(async () => {
        try {
          const guild = interaction.guild;
          if (!guild) return;

          if (!interaction.memberPermissions?.has(PermissionsBitField.Flags.ManageGuild)) {
            return interaction.reply({
              content: '❌ تحتاج صلاحية Manage Server لاستخدام Giveaway.',
              flags: MessageFlags.Ephemeral
            });
          }

          const channel = interaction.options.getChannel('channel', true);
          const message = interaction.options.getString('message', true).trim();

          if (!channel.isTextBased?.()) {
            return interaction.reply({
              content: '❌ اختر روم نصي.',
              flags: MessageFlags.Ephemeral
            });
          }

          const me = guild.members.me;
          const perms = channel.permissionsFor(me);
          if (!perms?.has(PermissionsBitField.Flags.SendMessages) ||
              !perms?.has(PermissionsBitField.Flags.EmbedLinks)) {
            return interaction.reply({
              content: '❌ البوت يحتاج Send Messages و Embed Links في الروم المحدد.',
              flags: MessageFlags.Ephemeral
            });
          }

          const embed = new EmbedBuilder()
            .setTitle('🎁 Giveaway')
            .setDescription(message)
            .setFooter({ text: '🎁 Giveaway' })
            .setTimestamp();

          await channel.send({ embeds: [embed] });

          return interaction.reply({
            content: '✅ تم إرسال الـ Giveaway في ' + channel.toString() + ' 🎁',
            flags: MessageFlags.Ephemeral
          });
        } catch (e) {
          console.error('[GIVEAWAY] ' + (e.stack || e.message || e));
          if (!interaction.replied && !interaction.deferred) {
            await interaction.reply({
              content: '❌ فشل إرسال الـ Giveaway. تأكد من صلاحيات البوت في الروم.',
              flags: MessageFlags.Ephemeral
            }).catch(() => {});
          }
        }
      });
    }
  }
  return originalEmit.call(this, event, ...args);
};
