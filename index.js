const http = require('http');

const {
    Client,
    GatewayIntentBits,
    REST,
    Routes,
    PermissionsBitField
} = require('discord.js');

const {
    joinVoiceChannel
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
   Join Voice Function
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

        const channelId = interaction.channelId;

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
