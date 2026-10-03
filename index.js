const http = require('http');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

const {
    Client,
    GatewayIntentBits,
    REST,
    Routes,
    PermissionsBitField
} = require('discord.js');

const {
    joinVoiceChannel,
    createAudioPlayer,
    createAudioResource,
    AudioPlayerStatus,
    NoSubscriberBehavior,
    StreamType
} = require('@discordjs/voice');

const ffmpegPath = require('ffmpeg-static');

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildVoiceStates,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildPresences
    ]
});

const chatTimers = new Map();
const musicStates = new Map();
const memberSetupMessages = new Map();
const activeMemberCounts = new Map();
const activeMemberUpdateTimers = new Map();
const dmSubscribers = new Map();
const botLogs = [];
const MAX_BOT_LOGS = 50;

function addBotLog(message) {
    const line = `[${new Date().toISOString()}] ${message}`;
    botLogs.push(line);
    if (botLogs.length > MAX_BOT_LOGS) botLogs.shift();
    console.log(line);
}

const SONG_FILE =
    'MURDER DRONES - BANG BANG BANG - Chainsaw Man Song - AMV_EDIT(M4A_128K).m4a';

/* =========================
   Render Web Service
========================= */

const PORT = process.env.PORT || 10000;

http.createServer((req, res) => {
    res.writeHead(200, {
        'Content-Type': 'text/plain'
    });

    res.end('Discord bot is online.');
}).listen(PORT, '0.0.0.0', () => {
    addBotLog(`HTTP server listening on port ${PORT}`);
});

/* =========================
   Active Members
========================= */

async function updateActiveMembersMessage(guild, { force = false } = {}) {
    const setup = memberSetupMessages.get(guild.id);
    if (!setup) return;

    const channel = guild.channels.cache.get(setup.channelId);
    if (!channel || !channel.isTextBased()) return;

    const activeCount = guild.members.cache.filter(member =>
        !member.user.bot &&
        member.presence &&
        ['online', 'idle', 'dnd'].includes(member.presence.status)
    ).size;

    if (!force && activeMemberCounts.get(guild.id) === activeCount) {
        return;
    }

    try {
        const message = await channel.messages.fetch(setup.messageId);
        await message.edit(`🟢 **الأعضاء النشطين: ${activeCount}**`);
        activeMemberCounts.set(guild.id, activeCount);
    } catch (error) {
        addBotLog(`Active member counter error: ${error.message}`);
    }
}

function scheduleActiveMemberUpdate(guild, delay = 30000) {
    if (!guild || !memberSetupMessages.has(guild.id)) return;
    if (activeMemberUpdateTimers.has(guild.id)) return;

    const timer = setTimeout(async () => {
        activeMemberUpdateTimers.delete(guild.id);

        try {
            await updateActiveMembersMessage(guild);
        } catch (error) {
            addBotLog(`Scheduled member update error: ${error.message}`);
        }
    }, delay);

    activeMemberUpdateTimers.set(guild.id, timer);
}

async function restoreActiveMemberMessages() {
    for (const guild of client.guilds.cache.values()) {
        try {
            const channels = guild.channels.cache.filter(channel =>
                channel.isTextBased() &&
                channel.messages &&
                channel.viewable &&
                channel.permissionsFor(guild.members.me)?.has(PermissionsBitField.Flags.ViewChannel) &&
                channel.permissionsFor(guild.members.me)?.has(PermissionsBitField.Flags.ReadMessageHistory)
            );

            for (const channel of channels.values()) {
                try {
                    const messages = await channel.messages.fetch({ limit: 50 });
                    const statusMessage = messages.find(message =>
                        message.author.id === client.user.id &&
                        message.content.startsWith('🟢 **الأعضاء النشطين:')
                    );

                    if (statusMessage) {
                        memberSetupMessages.set(guild.id, {
                            channelId: channel.id,
                            messageId: statusMessage.id
                        });
                        addBotLog(`Restored active member counter for guild ${guild.id}.`);
                        break;
                    }
                } catch (error) {}
            }
        } catch (error) {
            addBotLog(`Restore active member counter error: ${error.message}`);
        }
    }

    for (const guild of client.guilds.cache.values()) {
        if (memberSetupMessages.has(guild.id)) {
            scheduleActiveMemberUpdate(guild, 60000);
        }
    }
}

/* =========================
   Slash Commands Registration
========================= */

client.once('ready', async () => {
    addBotLog(`Bot is online as ${client.user.tag}`);
    await restoreActiveMemberMessages();

    const commands = [
        { name: 'join', description: 'دخول الروم الصوتي' },
        { name: 'setup_chat', description: 'تذكير بالتفاعل كل 5 ساعات' },
        { name: 'play_music', description: 'تشغيل الأغنية' },
        { name: 'dis_music', description: 'إيقاف الأغنية والخروج من الروم' },
        {
            name: 'ban',
            description: 'حظر عضو من السيرفر',
            options: [{
                name: 'user',
                description: 'الشخص الذي تريد حظره',
                type: 6,
                required: true
            }]
        },
        {
            name: 'setup_members',
            description: 'عرض عدد الأعضاء النشطين وتحديثه تلقائياً'
        },
        { name: 'dm_subscribe', description: 'الاشتراك في رسائل الإعلانات الخاصة' },
        { name: 'dm_unsubscribe', description: 'إلغاء الاشتراك في رسائل الإعلانات الخاصة' },
        { name: 'subscribers', description: 'عرض الأشخاص المشتركين في رسائل الخاص' },
        {
            name: 'sandall',
            description: 'إرسال إعلان للمشتركين في الخاص',
            options: [{
                name: 'message',
                description: 'نص الإعلان',
                type: 3,
                required: true
            }]
        },
        {
            name: 'sand',
            description: 'إرسال رسالة خاصة لشخص معين',
            options: [
                {
                    name: 'member',
                    description: 'الشخص الذي ستصله الرسالة',
                    type: 6,
                    required: true
                },
                {
                    name: 'message',
                    description: 'الرسالة',
                    type: 3,
                    required: true
                }
            ]
        },
        { name: 'ping', description: 'عرض Ping البوت' },
        { name: 'log', description: 'عرض آخر سجلات البوت' }
    ];

    const rest = new REST({ version: '10' })
        .setToken(process.env.DISCORD_TOKEN);

    try {
        await rest.put(
            Routes.applicationCommands(client.user.id),
            { body: commands }
        );

        addBotLog('Global slash commands registered.');
    } catch (error) {
        addBotLog(`Slash command registration error: ${error.message}`);
    }
});

/* =========================
   Join Voice
========================= */

function joinUserVoice(member) {
    if (!member?.voice?.channel) return null;

    const channel = member.voice.channel;

    return joinVoiceChannel({
        channelId: channel.id,
        guildId: channel.guild.id,
        adapterCreator: channel.guild.voiceAdapterCreator,
        selfDeaf: false,
        selfMute: false
    });
}

/* =========================
   Stop Music
========================= */

function stopMusic(guildId) {
    const state = musicStates.get(guildId);

    if (!state) return false;

    try { state.player.stop(); } catch (e) {}
    if (state.ffmpeg) {
        try { state.ffmpeg.kill('SIGKILL'); } catch (e) {}
    }
    if (state.connection) {
        try { state.connection.destroy(); } catch (e) {}
    }

    musicStates.delete(guildId);
    addBotLog(`Music stopped in guild ${guildId}.`);
    return true;
}

/* =========================
   Play Music
========================= */

function playMusic(member) {
    const channel = member.voice.channel;
    if (!channel) throw new Error('USER_NOT_IN_VOICE');

    const songPath = path.join(__dirname, SONG_FILE);

    if (!ffmpegPath) throw new Error('FFMPEG_NOT_FOUND');
    if (!fs.existsSync(songPath)) throw new Error('SONG_FILE_NOT_FOUND');

    stopMusic(channel.guild.id);

    const connection = joinVoiceChannel({
        channelId: channel.id,
        guildId: channel.guild.id,
        adapterCreator: channel.guild.voiceAdapterCreator,
        selfDeaf: false,
        selfMute: false
    });

    const player = createAudioPlayer({
        behaviors: { noSubscriber: NoSubscriberBehavior.Play }
    });

    const ffmpeg = spawn(ffmpegPath, [
        '-hide_banner',
        '-loglevel', 'error',
        '-i', songPath,
        '-vn',
        '-ac', '2',
        '-ar', '48000',
        '-c:a', 'libopus',
        '-b:a', '128k',
        '-f', 'ogg',
        'pipe:1'
    ]);

    ffmpeg.stderr.on('data', data => addBotLog(`FFmpeg: ${data.toString().trim()}`));

    ffmpeg.on('error', error => {
        addBotLog(`FFmpeg process error: ${error.message}`);
        stopMusic(channel.guild.id);
    });

    const resource = createAudioResource(ffmpeg.stdout, {
        inputType: StreamType.OggOpus
    });

    const state = { connection, player, ffmpeg };
    musicStates.set(channel.guild.id, state);

    player.on('error', error => {
        addBotLog(`Audio player error: ${error.message}`);
        stopMusic(channel.guild.id);
    });

    player.once(AudioPlayerStatus.Idle, () => {
        addBotLog('Music finished.');
        if (musicStates.get(channel.guild.id) === state) {
            try { ffmpeg.kill(); } catch (e) {}
            try { connection.destroy(); } catch (e) {}
            musicStates.delete(channel.guild.id);
        }
    });

    connection.subscribe(player);
    player.play(resource);
}

/* =========================
   Normal Messages
========================= */

client.on('messageCreate', async message => {
    if (message.author.bot) return;

    if (message.content === 'هلا') {
        await message.reply('هلا والله 👋');
        return;
    }

    if (message.content === '!join') {
        if (!message.member?.voice?.channel) {
            await message.reply('ادخل الروم الصوتي أولاً 🎙️');
            return;
        }

        try {
            joinUserVoice(message.member);
            await message.reply('دخلت المكالمة 🎙️');
            addBotLog(`!join used by ${message.author.tag}`);
        } catch (error) {
            addBotLog(`Voice error: ${error.message}`);
            await message.reply('ما قدرت أدخل الروم الصوتي.');
        }
    }
});

/* =========================
   Slash Commands
========================= */

client.on('interactionCreate', async interaction => {
    if (!interaction.isChatInputCommand()) return;

    /* /ping */
    if (interaction.commandName === 'ping') {
        const latency = Date.now() - interaction.createdTimestamp;
        const websocketPing = client.ws.ping;

        await interaction.reply(
            `🏓 **Pong!**\n📡 استجابة الأمر: **${latency}ms**\n💓 WebSocket: **${websocketPing}ms**`
        );

        addBotLog(`/ping used by ${interaction.user.tag}: ${websocketPing}ms`);
        return;
    }

    /* /log */
    if (interaction.commandName === 'log') {
        if (!interaction.member.permissions.has(PermissionsBitField.Flags.ManageGuild)) {
            await interaction.reply({
                content: '❌ تحتاج صلاحية Manage Server لاستخدام هذا الأمر.',
                ephemeral: true
            });
            return;
        }

        const logs = botLogs.length
            ? botLogs.slice(-15).join('\n')
            : 'لا توجد سجلات حالياً.';

        await interaction.reply({
            content: `🧾 **آخر سجلات البوت:**\n\`\`\`\n${logs}\n\`\`\``,
            ephemeral: true
        });
        return;
    }

    /* /subscribers */
    if (interaction.commandName === 'subscribers') {
        const subscribers = dmSubscribers.get(interaction.guildId);

        if (!subscribers || subscribers.size === 0) {
            await interaction.reply({
                content: '📭 لا يوجد أشخاص مشتركين حالياً.',
                ephemeral: true
            });
            return;
        }

        const lines = [];
        let number = 1;

        for (const userId of subscribers) {
            try {
                const user = await client.users.fetch(userId);
                lines.push(`${number}. <@${userId}> • ${user.tag}`);
            } catch (error) {
                lines.push(`${number}. <@${userId}>`);
            }
            number++;
        }

        await interaction.reply({
            content: `📬 **المشتركون في رسائل الخاص (${subscribers.size}):**\n${lines.join('\n')}`,
            ephemeral: true
        });

        addBotLog(`/subscribers used by ${interaction.user.tag}`);
        return;
    }

    /* /sand */
    if (interaction.commandName === 'sand') {
        const hasHighRole =
            interaction.member.permissions.has(PermissionsBitField.Flags.Administrator) ||
            interaction.member.roles.highest.position >=
            interaction.guild.members.me.roles.highest.position;

        if (!hasHighRole) {
            await interaction.reply({
                content: '❌ هذا الأمر مخصص لأصحاب الرتب العالية فقط.',
                ephemeral: true
            });
            return;
        }

        const member = interaction.options.getMember('member');
        const message = interaction.options.getString('message', true);

        if (!member) {
            await interaction.reply({
                content: '❌ ما قدرت أجد هذا العضو.',
                ephemeral: true
            });
            return;
        }

        await interaction.deferReply({ ephemeral: true });

        try {
            await member.user.send(
                `📩 **رسالة من إدارة سيرفر ${interaction.guild.name}**\n\n${message}`
            );

            await interaction.editReply(`✅ تم إرسال الرسالة إلى **${member.user.tag}** في الخاص.`);
            addBotLog(`/sand sent by ${interaction.user.tag} to ${member.user.tag}`);
        } catch (error) {
            addBotLog(`/sand failed for ${member.user.tag}: ${error.message}`);
            await interaction.editReply('❌ ما قدرت أرسل له الخاص. ممكن يكون مقفل الرسائل الخاصة.');
        }

        return;
    }

    /* /join */
    if (interaction.commandName === 'join') {
        const member = interaction.member;

        if (!member?.voice?.channel) {
            await interaction.reply('ادخل الروم الصوتي أولاً 🎙️');
            return;
        }

        try {
            joinUserVoice(member);
            await interaction.reply('دخلت المكالمة 🎙️');
            addBotLog(`/join used by ${interaction.user.tag}`);
        } catch (error) {
            addBotLog(`Voice error: ${error.message}`);
            await interaction.reply('ما قدرت أدخل الروم الصوتي.');
        }
        return;
    }

    /* /play_music */
    if (interaction.commandName === 'play_music') {
        const member = interaction.member;

        if (!member?.voice?.channel) {
            await interaction.reply('ادخل الروم الصوتي أولاً 🎙️');
            return;
        }

        try {
            await interaction.deferReply();
            playMusic(member);
            await interaction.editReply('🎵 تم تشغيل الأغنية!');
            addBotLog(`/play_music used by ${interaction.user.tag}`);
        } catch (error) {
            addBotLog(`Music error: ${error.message}`);

            if (error.message === 'USER_NOT_IN_VOICE') {
                await interaction.editReply('ادخل الروم الصوتي أولاً 🎙️');
            } else {
                await interaction.editReply('❌ ما قدرت أشغل الأغنية. راجع /log أو Logs في Render.');
            }
        }
        return;
    }

    /* /dis_music */
    if (interaction.commandName === 'dis_music') {
        const stopped = stopMusic(interaction.guildId);

        await interaction.reply(
            stopped
                ? '⏹️ تم إيقاف الأغنية وخرجت من الروم.'
                : 'ما فيه أغنية شغالة حالياً.'
        );
        return;
    }

    /* /dm_subscribe */
    if (interaction.commandName === 'dm_subscribe') {
        dmSubscribers.set(
            interaction.guildId,
            dmSubscribers.get(interaction.guildId) || new Set()
        );
        dmSubscribers.get(interaction.guildId).add(interaction.user.id);

        await interaction.reply({
            content: '✅ تم اشتراكك في إعلانات السيرفر الخاصة.',
            ephemeral: true
        });

        addBotLog(`${interaction.user.tag} subscribed to DMs in guild ${interaction.guildId}`);
        return;
    }

    /* /dm_unsubscribe */
    if (interaction.commandName === 'dm_unsubscribe') {
        const subscribers = dmSubscribers.get(interaction.guildId);
        if (subscribers) subscribers.delete(interaction.user.id);

        await interaction.reply({
            content: '✅ تم إلغاء اشتراكك في الإعلانات الخاصة.',
            ephemeral: true
        });

        addBotLog(`${interaction.user.tag} unsubscribed from DMs in guild ${interaction.guildId}`);
        return;
    }

    /* /sandall */
    if (interaction.commandName === 'sandall') {
        const hasHighRole =
            interaction.member.permissions.has(PermissionsBitField.Flags.Administrator) ||
            interaction.member.roles.highest.position >=
            interaction.guild.members.me.roles.highest.position;

        if (!hasHighRole) {
            await interaction.reply({
                content: '❌ هذا الأمر مخصص لأصحاب الرتب العالية فقط.',
                ephemeral: true
            });
            return;
        }

        const message = interaction.options.getString('message', true);
        const subscribers = dmSubscribers.get(interaction.guildId);

        if (!subscribers || subscribers.size === 0) {
            await interaction.reply({
                content: 'ℹ️ لا يوجد أعضاء مشتركين حاليًا.',
                ephemeral: true
            });
            return;
        }

        await interaction.deferReply({ ephemeral: true });

        let sent = 0;
        let failed = 0;

        for (const userId of subscribers) {
            try {
                const user = await client.users.fetch(userId);
                await user.send(
                    `📢 **إعلان من سيرفر ${interaction.guild.name}**\n\n${message}`
                );
                sent++;
            } catch (error) {
                failed++;
                addBotLog(`DM failed to ${userId}: ${error.message}`);
            }
        }

        await interaction.editReply(
            `✅ تم إرسال الإعلان إلى **${sent}** مشترك.\n❌ لم تصل إلى **${failed}**.`
        );

        addBotLog(`/sandall by ${interaction.user.tag}: sent=${sent}, failed=${failed}`);
        return;
    }

    /* /ban */
    if (interaction.commandName === 'ban') {
        if (!interaction.member.permissions.has(PermissionsBitField.Flags.BanMembers)) {
            await interaction.reply({
                content: '❌ تحتاج صلاحية Ban Members لاستخدام هذا الأمر.',
                ephemeral: true
            });
            return;
        }

        const user = interaction.options.getUser('user', true);

        if (user.id === interaction.user.id) {
            await interaction.reply({
                content: '❌ لا يمكنك حظر نفسك.',
                ephemeral: true
            });
            return;
        }

        try {
            await interaction.guild.members.ban(user.id, {
                reason: `Banned by ${interaction.user.tag} using /ban`
            });

            await interaction.reply(`🔨 تم حظر **${user.tag}** من السيرفر.`);
            addBotLog(`/ban used by ${interaction.user.tag} on ${user.tag}`);
        } catch (error) {
            addBotLog(`Ban error: ${error.message}`);
            await interaction.reply({
                content: '❌ ما قدرت أحظر هذا الشخص. تأكد من الصلاحيات ورتبة البوت.',
                ephemeral: true
            });
        }
        return;
    }

    /* /setup_members */
    if (interaction.commandName === 'setup_members') {
        if (!interaction.member.permissions.has(PermissionsBitField.Flags.ManageGuild)) {
            await interaction.reply({
                content: '❌ تحتاج صلاحية Manage Server لاستخدام هذا الأمر.',
                ephemeral: true
            });
            return;
        }

        await interaction.deferReply({ ephemeral: true });

        try {
            const activeCount = interaction.guild.members.cache.filter(member =>
                !member.user.bot &&
                member.presence &&
                ['online', 'idle', 'dnd'].includes(member.presence.status)
            ).size;

            const channel = interaction.channel;
            const setup = memberSetupMessages.get(interaction.guildId);
            let statusMessage = null;

            if (setup) {
                try {
                    const oldChannel = interaction.guild.channels.cache.get(setup.channelId);
                    if (oldChannel && oldChannel.isTextBased()) {
                        statusMessage = await oldChannel.messages.fetch(setup.messageId);
                        await statusMessage.edit(`🟢 **الأعضاء النشطين: ${activeCount}**`);
                    }
                } catch (e) {
                    statusMessage = null;
                }
            }

            if (!statusMessage) {
                statusMessage = await channel.send(`🟢 **الأعضاء النشطين: ${activeCount}**`);
            }

            memberSetupMessages.set(interaction.guildId, {
                channelId: statusMessage.channel.id,
                messageId: statusMessage.id
            });
            activeMemberCounts.set(interaction.guildId, activeCount);

            await interaction.editReply('✅ تم إعداد عداد الأعضاء النشطين. سيتحدث تلقائياً عند تغير حالة الأعضاء.');
            addBotLog(`/setup_members used by ${interaction.user.tag}`);
        } catch (error) {
            addBotLog(`Setup members error: ${error.message}`);
            await interaction.editReply('❌ ما قدرت أجهز عداد الأعضاء. تأكد من Privileged Intents.');
        }
        return;
    }

    /* /setup_chat */
    if (interaction.commandName === 'setup_chat') {
        if (!interaction.member.permissions.has(PermissionsBitField.Flags.ManageGuild)) {
            await interaction.reply({
                content: 'هذا الأمر يحتاج صلاحية Manage Server.',
                ephemeral: true
            });
            return;
        }

        const channelId = interaction.channelId;

        if (chatTimers.has(channelId)) {
            clearInterval(chatTimers.get(channelId));
        }

        const timer = setInterval(async () => {
            const channel = client.channels.cache.get(channelId);
            if (!channel) return;

            try {
                await channel.send('@everyone تفاعلو 📢');
            } catch (error) {
                addBotLog(`Message error: ${error.message}`);
            }
        }, 5 * 60 * 60 * 1000);

        chatTimers.set(channelId, timer);
        await interaction.reply('تم تشغيل التذكير 📢 كل 5 ساعات.');
        addBotLog(`/setup_chat used by ${interaction.user.tag}`);
    }
});

client.on('presenceUpdate', (oldPresence, newPresence) => {
    const guild = newPresence.guild;
    if (!guild || !memberSetupMessages.has(guild.id)) return;
    scheduleActiveMemberUpdate(guild, 30000);
});

client.on('guildMemberAdd', member => {
    if (memberSetupMessages.has(member.guild.id)) {
        scheduleActiveMemberUpdate(member.guild, 30000);
    }
});

client.on('guildMemberRemove', member => {
    if (memberSetupMessages.has(member.guild.id)) {
        scheduleActiveMemberUpdate(member.guild, 30000);
    }
});

/* =========================
   Errors
========================= */

client.on('error', error => {
    addBotLog(`Discord client error: ${error.message}`);
});

/* =========================
   Login
========================= */

const discordToken = process.env.DISCORD_TOKEN?.trim();

if (!discordToken) {
    addBotLog('DISCORD_TOKEN is missing or empty.');
    process.exit(1);
}

addBotLog(`DISCORD_TOKEN loaded successfully (length: ${discordToken.length})`);

client.login(discordToken).catch(error => {
    addBotLog(`Discord login failed: ${error.message}`);
    process.exit(1);
});
