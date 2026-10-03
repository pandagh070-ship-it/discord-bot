const Discord = require('discord.js');

const client = new Discord.Client();

const chatTimers = new Map();

client.on('ready', () => {
    console.log('Bot is online as ' + client.user.tag);
});


// ==============================
// الرسائل العادية
// ==============================

client.on('message', async message => {
    if (message.author.bot) return;

    // هلا
    if (message.content === 'هلا') {
        message.reply('هلا والله 👋');
    }

    // !join
    if (message.content === '!join') {

        if (!message.member || !message.member.voice || !message.member.voice.channel) {
            message.reply('ادخل الروم الصوتي أولاً.');
            return;
        }

        try {
            await message.member.voice.channel.join();
            message.reply('دخلت المكالمة 🎙️');
        } catch (error) {
            console.log(error);
            message.reply('حدث خطأ أثناء دخول المكالمة.');
        }
    }
});


// ==============================
// Slash Command: /join
// ==============================

client.ws.on('INTERACTION_CREATE', async interaction => {

    if (!interaction.data) return;

    // /join
    if (interaction.data.name === 'join') {

        const guild = client.guilds.get(interaction.guild_id);

        if (!guild) return;

        const member = guild.members.get(interaction.member.user.id);

        if (!member || !member.voice || !member.voice.channelID) {

            await client.api.interactions(interaction.id, interaction.token).callback.post({
                data: {
                    type: 4,
                    data: {
                        content: 'ادخل الروم الصوتي أولاً 🎙️'
                    }
                }
            });

            return;
        }

        const channel = guild.channels.get(member.voice.channelID);

        try {

            await channel.join();

            await client.api.interactions(interaction.id, interaction.token).callback.post({
                data: {
                    type: 4,
                    data: {
                        content: 'دخلت المكالمة 🎙️'
                    }
                }
            });

        } catch (error) {

            console.log(error);

            await client.api.interactions(interaction.id, interaction.token).callback.post({
                data: {
                    type: 4,
                    data: {
                        content: 'حدث خطأ أثناء دخول المكالمة.'
                    }
                }
            });
        }
    }


    // ==============================
    // /setup_chat
    // ==============================

    if (interaction.data.name === 'setup_chat') {

        const channelId = interaction.channel_id;

        await client.api.interactions(interaction.id, interaction.token).callback.post({
            data: {
                type: 4,
                data: {
                    content: 'تم تشغيل التذكير 📢 كل 5 ساعات.'
                }
            }
        });

        if (chatTimers.has(channelId)) {
            clearInterval(chatTimers.get(channelId));
        }

        const timer = setInterval(() => {

            const channel = client.channels.get(channelId);

            if (channel) {
                channel.send('@everyone تفاعلو 📢');
            }

        }, 5 * 60 * 60 * 1000);

        chatTimers.set(channelId, timer);
    }

});


// ==============================
// تسجيل Slash Commands
// ==============================

client.on('ready', async () => {

    for (const guild of client.guilds.cache.values()) {

        try {

            await client.api
                .applications(client.user.id)
                .guilds(guild.id)
                .commands.post({
                    data: {
                        name: 'join',
                        description: 'دخول الروم الصوتي'
                    }
                });

            await client.api
                .applications(client.user.id)
                .guilds(guild.id)
                .commands.post({
                    data: {
                        name: 'setup_chat',
                        description: 'تذكير بالتفاعل كل 5 ساعات'
                    }
                });

            console.log('Slash commands registered.');

        } catch (error) {
            console.log('Slash command error:', error);
        }
    }

});


client.login(process.env.DISCORD_TOKEN);
