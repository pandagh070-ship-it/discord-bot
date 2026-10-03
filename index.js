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
const dmSubscribers = new Map();

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
    console.log(`HTTP server listening on port ${PORT}`);
});

/* =========================
   Slash Commands
========================= */

client.once('ready', async () => {
    console.log(`Bot is online as ${client.user.tag}`);

    const commands = [
        {
            name: 'join',
            description: 'دخول الروم الصوتي'
        },
        {
            name: 'setup_chat',
            description: 'تذكير بالتفاعل كل 5 ساعات'
        },
        {
            name: 'play_music',
            description: 'تشغيل الأغنية'
        },
        {
            name: 'dis_music',
            description: 'إيقاف الأغنية والخروج من الروم'
        },
        {
            name: 'ban',
            description: 'حظر عضو من السيرفر',
            options: [
                {
                    name: 'user',
                    description: 'الشخص الذي تريد حظره',
                    type: 6,
                    required: true
                }
            ]
        },
        {
            name: 'setup_members',
            description: 'عرض عدد الأعضاء النشطين وتحديثه تلقائياً'
        },
        {
            name: 'dm_subscribe',
            description: 'الاشتراك في رسائل الإعلانات الخاصة'
        },
        {
            name: 'dm_unsubscribe',
            description: 'إلغاء الاشتراك في رسائل الإعلانات الخاصة'
        },
        {
            name: 'sandall',
            description: 'إرسال إعلان للمشتركين في الخاص',
            options: [
                {
                    name: 'message',
                    description: 'نص الإعلان',
                    type: 3,
                    required: true
                }
            ]
        }
    ];

    const rest = new REST({ version: '10' })
        .setToken(process.env.DISCORD_TOKEN);

    try {
        await rest.put(
            Routes.applicationCommands(client.user.id),
            { body: commands }
        );

        console.log('Global slash commands registered.');
    } catch (error) {
        console.error(
            'Slash command registration error:',
            error
        );
    }
});

/* =========================
   Join Voice
========================= */

function joinUserVoice(member) {
    if (
        !member ||
        !member.voice ||
        !member.voice.channel
    ) {
        return null;
    }

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

    if (!state) {
        return false;
    }

    try {
        state.player.stop();
    } catch (e) {}

    if (state.ffmpeg) {
        try {
            state.ffmpeg.kill('SIGKILL');
        } catch (e) {}
    }

    if (state.connection) {
        try {
            state.connection.destroy();
        } catch (e) {}
    }

    musicStates.delete(guildId);

    return true;
}

/* =========================
   Play Music
========================= */

function playMusic(member) {
    const channel = member.voice.channel;

    if (!channel) throw new Error('USER_NOT_IN_VOICE');

    const songPath = path.join(__dirname, SONG_FILE);

    console.log('Song path:', songPath);
    console.log('FFmpeg path:', ffmpegPath);

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
        behaviors: {
            noSubscriber: NoSubscriberBehavior.Play
        }
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

    ffmpeg.stderr.on('data', data => {
        console.error('FFmpeg:', data.toString());
    });

    ffmpeg.on('error', error => {
        console.error('FFmpeg process error:', error);
        stopMusic(channel.guild.id);
    });

    const resource = createAudioResource(ffmpeg.stdout, {
        inputType: StreamType.OggOpus
    });

    const state = { connection, player, ffmpeg };
    musicStates.set(channel.guild.id, state);

    player.on('error', error => {
        console.error('Audio player error:', error);
        stopMusic(channel.guild.id);
    });

    player.once(AudioPlayerStatus.Idle, () => {
        console.log('Music finished.');
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
        if (
            !message.member ||
            !message.member.voice ||
            !message.member.voice.channel
        ) {
            await message.reply(
                'ادخل الروم الصوتي أولاً 🎙️'
            );
            return;
        }

        try {
            joinUserVoice(message.member);

            await message.reply(
                'دخلت المكالمة 🎙️'
            );
        } catch (error) {
            console.error(
                'Voice error:',
                error
            );

            await message.reply(
                'ما قدرت أدخل الروم الصوتي.'
            );
        }
    }
});

/* =========================
   Slash Commands
========================= */

client.on('interactionCreate', async interaction => {
    if (!interaction.isChatInputCommand()) return;

    /* /join */
    if (interaction.commandName === 'join') {
        const member = interaction.member;

        if (
            !member ||
            !member.voice ||
            !member.voice.channel
        ) {
            await interaction.reply(
                'ادخل الروم الصوتي أولاً 🎙️'
            );
            return;
        }

        try {
            joinUserVoice(member);

            await interaction.reply(
                'دخلت المكالمة 🎙️'
            );
        } catch (error) {
            console.error(
                'Voice error:',
                error
            );

            await interaction.reply(
                'ما قدرت أدخل الروم الصوتي.'
            );
        }

        return;
    }

    /* /play_music */
    if (interaction.commandName === 'play_music') {
        const member = interaction.member;

        if (
            !member ||
            !member.voice ||
            !member.voice.channel
        ) {
            await interaction.reply(
                'ادخل الروم الصوتي أولاً 🎙️'
            );
            return;
        }

        try {
            await interaction.deferReply();

            playMusic(member);

            await interaction.editReply(
                '🎵 تم تشغيل الأغنية!'
            );
        } catch (error) {
            console.error(
                'Music error:',
                error
            );

            if (error.message === 'USER_NOT_IN_VOICE') {
                await interaction.editReply(
                    'ادخل الروم الصوتي أولاً 🎙️'
                );
            } else {
                await interaction.editReply(
                    '❌ ما قدرت أشغل الأغنية. راجع Logs في Render.'
                );
            }
        }

        return;
    }

    /* /dis_music */
    if (interaction.commandName === 'dis_music') {
        const stopped = stopMusic(
            interaction.guildId
        );

        if (stopped) {
            await interaction.reply(
                '⏹️ تم إيقاف الأغنية وخرجت من الروم.'
            );
        } else {
            await interaction.reply(
                'ما فيه أغنية شغالة حالياً.'
            );
        }

        return;
    }

    /* /dm_subscribe */
    if (interaction.commandName === 'dm_subscribe') {
        dmSubscribers.set(interaction.guildId, dmSubscribers.get(interaction.guildId) || new Set());
        dmSubscribers.get(interaction.guildId).add(interaction.user.id);
        await interaction.reply({
            content: '✅ تم اشتراكك في إعلانات السيرفر الخاصة.',
            ephemeral: true
        });
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
                    `📢 **إعلان من سيرفر ${interaction.guild.name}**\\n\\n${message}`
                );
                sent++;
            } catch (error) {
                failed++;
            }
        }

        await interaction.editReply(
            `✅ تم إرسال الإعلان إلى **${sent}** مشترك.\\n❌ لم تصل إلى **${failed}**.`
        );
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
        } catch (error) {
            console.error('Ban error:', error);

            await interaction.reply({
                content: '❌ ما قدرت أحظر هذا الشخص. تأكد أن البوت لديه صلاحية Ban Members وأن رتبته أعلى من رتبة الشخص.',
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
            await interaction.guild.members.fetch();

            const activeCount = interaction.guild.members.cache.filter(member =>
                !member.user.bot &&
                member.presence &&
                ['online', 'idle', 'dnd'].includes(member.presence.status)
            ).size;

            const channel = interaction.channel;
            const oldMessageId = memberSetupMessages.get(interaction.guildId);

            if (oldMessageId) {
                try {
                    const oldMessage = await channel.messages.fetch(oldMessageId);
                    await oldMessage.delete();
                } catch (e) {}
            }

            const statusMessage = await channel.send(
                `🟢 **الأعضاء النشطين: ${activeCount}**`
            );

            memberSetupMessages.set(
                interaction.guildId,
                statusMessage.id
            );

            await interaction.editReply(
                '✅ تم إعداد عداد الأعضاء النشطين. سيتحدث تلقائياً عند تغير حالة الأعضاء.'
            );
        } catch (error) {
            console.error('Setup members error:', error);

            await interaction.editReply(
                '❌ ما قدرت أجهز عداد الأعضاء. تأكد أن Privileged Intents الخاصة بـ Server Members و Presence مفعلة في Discord Developer Portal.'
            );
        }

        return;
    }

    /* /setup_chat */
    if (interaction.commandName === 'setup_chat') {
        if (
            !interaction.member.permissions.has(
                PermissionsBitField.Flags.ManageGuild
            )
        ) {
            await interaction.reply({
                content:
                    'هذا الأمر يحتاج صلاحية Manage Server.',
                ephemeral: true
            });

            return;
        }

        const channelId =
            interaction.channelId;

        if (chatTimers.has(channelId)) {
            clearInterval(
                chatTimers.get(channelId)
            );
        }

        const timer = setInterval(
            async () => {
                const channel =
                    client.channels.cache.get(
                        channelId
                    );

                if (!channel) return;

                try {
                    await channel.send(
                        '@everyone تفاعلو 📢'
                    );
                } catch (error) {
                    console.error(
                        'Message error:',
                        error
                    );
                }
            },
            5 * 60 * 60 * 1000
        );

        chatTimers.set(
            channelId,
            timer
        );

        await interaction.reply(
            'تم تشغيل التذكير 📢 كل 5 ساعات.'
        );
    }
});

client.on('presenceUpdate', async (oldPresence, newPresence) => {
    const guild = newPresence.guild;

    if (!guild || !memberSetupMessages.has(guild.id)) return;

    const channel = guild.channels.cache.find(ch =>
        ch.isTextBased() &&
        ch.messages &&
        ch.permissionsFor(guild.members.me)?.has(PermissionsBitField.Flags.SendMessages)
    );

    if (!channel) return;

    try {
        const message = await channel.messages.fetch(
            memberSetupMessages.get(guild.id)
        );

        const activeCount = guild.members.cache.filter(member =>
            !member.user.bot &&
            member.presence &&
            ['online', 'idle', 'dnd'].includes(member.presence.status)
        ).size;

        await message.edit(
            `🟢 **الأعضاء النشطين: ${activeCount}**`
        );
    } catch (error) {
        console.error('Active member counter update error:', error);
    }
});

/* =========================
   Errors
========================= */

client.on('error', error => {
    console.error(
        'Discord client error:',
        error
    );
});

/* =========================
   Login
========================= */

const discordToken = process.env.DISCORD_TOKEN?.trim();

if (!discordToken) {
    console.error('DISCORD_TOKEN is missing or empty.');
    process.exit(1);
}

console.log(
    `DISCORD_TOKEN loaded successfully (length: ${discordToken.length})`
);

client.login(discordToken).catch(error => {
    console.error('Discord login failed:', error);
    process.exit(1);
});
