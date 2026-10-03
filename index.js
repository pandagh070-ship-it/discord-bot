const {
    Client,
    GatewayIntentBits,
    REST,
    Routes,
    PermissionsBitField
} = require('discord.js');

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildVoiceStates
    ]
});


// ==============================
// الإعدادات
// ==============================

const chatTimers = new Map();


// ==============================
// عند تشغيل البوت
// ==============================

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


// ==============================
// الرسائل العادية
// ==============================

client.on('messageCreate', async message => {

    if (message.author.bot) return;


    // هلا
    if (message.content === 'هلا') {

        await message.reply(
            'هلا والله 👋'
        );

    }


    // !join
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

            await message.member.voice.channel.join();

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


// ==============================
// Slash Commands
// ==============================

client.on('interactionCreate', async interaction => {

    if (!interaction.isChatInputCommand()) return;


    // ==============================
    // /join
    // ==============================

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

            await member.voice.channel.join();

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

    }


    // ==============================
    // /setup_chat
    // ==============================

    if (
        interaction.commandName ===
        'setup_chat'
    ) {

        const channelId =
            interaction.channelId;


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


// ==============================
// أخطاء الاتصال
// ==============================

client.on('error', error => {

    console.error(
        'Discord client error:',
        error
    );

});


// ==============================
// تشغيل البوت
// ==============================

client.login(
    process.env.DISCORD_TOKEN
);
