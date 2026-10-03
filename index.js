const Discord = require('discord.js');

const client = new Discord.Client();

const chatTimers = new Map();


// ==============================
// دخول الروم الصوتي
// ==============================

async function joinVoice(member) {

    if (!member || !member.voice || !member.voice.channel) {
        return {
            success: false,
            message: 'ادخل الروم الصوتي أولاً 🎙️'
        };
    }

    try {
        await member.voice.channel.join();

        return {
            success: true,
            message: 'دخلت المكالمة 🎙️'
        };

    } catch (error) {

        console.log(error);

        return {
            success: false,
            message: 'حدث خطأ أثناء دخول المكالمة.'
        };
    }
}


// ==============================
// Bot Ready
// ==============================

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

        const result = await joinVoice(message.member);

        message.reply(result.message);

    }

});


// ==============================
// Slash Commands
// ==============================

client.ws.on('INTERACTION_CREATE', async interaction => {

    if (!interaction.data) return;


    // ==============================
    // /join
    // ==============================

    if (interaction.data.name === 'join') {

        const guild = client.guilds.get(interaction.guild_id);

        if (!guild) return;

        const member = guild.members.get(
            interaction.member.user.id
        );

        const result = await joinVoice(member);


        await client.api
            .interactions(interaction.id, interaction.token)
            .callback.post({

                data: {
                    type: 4,

                    data: {
                        content: result.message
                    }
                }

            });

    }


    // ==============================
    // /setup_chat
    // ==============================

    if (interaction.data.name === 'setup_chat') {

        const channelId = interaction.channel_id;


        await client.api
            .interactions(interaction.id, interaction.token)
            .callback.post({

                data: {
                    type: 4,

                    data: {
                        content: 'تم تشغيل التذكير 📢 كل 5 ساعات.'
                    }
                }

            });


        // إلغاء مؤقت قديم
        if (chatTimers.has(channelId)) {

            clearInterval(
                chatTimers.get(channelId)
            );

        }


        // كل 5 ساعات
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

    client.guilds.forEach(async guild => {

        try {

            // /join
            await client.api
                .applications(client.user.id)
                .guilds(guild.id)
                .commands.post({

                    data: {

                        name: 'join',

                        description: 'دخول الروم الصوتي'

                    }

                });


            // /setup_chat
            await client.api
                .applications(client.user.id)
                .guilds(guild.id)
                .commands.post({

                    data: {

                        name: 'setup_chat',

                        description: 'تذكير بالتفاعل كل 5 ساعات'

                    }

                });


            console.log(
                'Slash commands registered in ' + guild.name
            );

        } catch (error) {

            console.log(
                'Slash command error:',
                error
            );

        }

    });

});


// ==============================
// إعادة الاتصال عند الانقطاع
// ==============================

client.on('disconnect', () => {

    console.log('Bot disconnected. Trying to reconnect...');

});


// ==============================
// تشغيل البوت
// ==============================

client.login(process.env.DISCORD_TOKEN);
