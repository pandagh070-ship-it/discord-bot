const http = require('http');
const path = require('path');
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
        GatewayIntentBits.GuildVoiceStates
    ]
});

const chatTimers = new Map();
const musicStates = new Map();

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

    if (!channel) {
        throw new Error('USER_NOT_IN_VOICE');
    }

    // Stop any previous song in this server.
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

    const songPath = path.join(
        __dirname,
        SONG_FILE
    );

    // Convert M4A to raw PCM for Discord.
    const ffmpeg = spawn(ffmpegPath, [
        '-hide_banner',
        '-loglevel',
        'error',
        '-i',
        songPath,
        '-f',
        's16le',
        '-ar',
        '48000',
        '-ac',
        '2',
        'pipe:1'
    ]);

    ffmpeg.stderr.on('data', data => {
        console.error(
            'FFmpeg:',
            data.toString()
        );
    });

    ffmpeg.on('error', error => {
        console.error(
            'FFmpeg process error:',
            error
        );
    });

    const resource = createAudioResource(
        ffmpeg.stdout,
        {
            inputType: StreamType.Raw,
            inlineVolume: false
        }
    );

    player.play(resource);
    connection.subscribe(player);

    const state = {
        connection,
        player,
        ffmpeg
    };

    musicStates.set(
        channel.guild.id,
        state
    );

    player.once(
        AudioPlayerStatus.Idle,
        () => {
            console.log('Music finished.');

            if (musicStates.get(channel.guild.id) === state) {
                try {
                    connection.destroy();
                } catch (e) {}

                musicStates.delete(
                    channel.guild.id
                );
            }
        }
    );

    player.on('error', error => {
        console.error(
            'Audio player error:',
            error
        );

        stopMusic(channel.guild.id);
    });
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
                    '❌ ما قدرت أشغل الأغنية. تأكد أن ملف الأغنية موجود.'
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

client.login(
    process.env.DISCORD_TOKEN
);
