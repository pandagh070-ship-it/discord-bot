const http = require('http');
const path = require('path');

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
    NoSubscriberBehavior
} = require('@discordjs/voice');

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildVoiceStates
    ]
});

const chatTimers = new Map();
const musicPlayers = new Map();

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
   Bot Ready
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
            description: 'إيقاف الأغنية'
        }
    ];

    const rest = new REST({ version: '10' })
        .setToken(process.env.DISCORD_TOKEN);

    try {
        await rest.put(
            Routes.applicationCommands(client.user.id),
            {
                body: commands
            }
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

    /* =========================
       /join
    ========================= */

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

    /* =========================
       /play_music
    ========================= */

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
            const channel = member.voice.channel;

            const connection = joinVoiceChannel({
                channelId: channel.id,
                guildId: channel.guild.id,
                adapterCreator:
                    channel.guild.voiceAdapterCreator,
                selfDeaf: false,
                selfMute: false
            });

            let player = musicPlayers.get(
                interaction.guildId
            );

            if (!player) {
                player = createAudioPlayer({
                    behaviors: {
                        noSubscriber:
                            NoSubscriberBehavior.Play
                    }
                });

                musicPlayers.set(
                    interaction.guildId,
                    player
                );
            }

            const songPath = path.join(
                __dirname,
                'song.mp3'
            );

            const resource =
                createAudioResource(songPath);

            player.play(resource);

            connection.subscribe(player);

            await interaction.reply(
                '🎵 تم تشغيل الأغنية!'
            );

            player.on(
                AudioPlayerStatus.Idle,
                () => {
                    console.log(
                        'Music finished.'
                    );
                }
            );

        } catch (error) {
            console.error(
                'Music error:',
                error
            );

            await interaction.reply(
                '❌ ما قدرت أشغل الأغنية.'
            );
        }

        return;
    }

    /* =========================
       /dis_music
    ========================= */

    if (interaction.commandName === 'dis_music') {
        const player = musicPlayers.get(
            interaction.guildId
        );

        if (!player) {
            await interaction.reply(
                'ما فيه أغنية شغالة حالياً.'
            );
            return;
        }

        try {
            player.stop();

            musicPlayers.delete(
                interaction.guildId
            );

            const connection =
                interaction.guild.voiceStates.cache
                    .get(client.user.id);

            if (connection) {
                connection.disconnect();
            }

            await interaction.reply(
                '⏹️ تم إيقاف الأغنية.'
            );

        } catch (error) {
            console.error(
                'Stop music error:',
                error
            );

            await interaction.reply(
                '❌ ما قدرت أوقف الأغنية.'
            );
        }

        return;
    }

    /* =========================
       /setup_chat
    ========================= */

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
