const Discord = require('discord.js');

const client = new Discord.Client();

client.on('ready', () => {
    console.log('Bot is online as ' + client.user.tag);
});

client.on('message', async message => {
    if (message.author.bot) return;

    if (message.content === 'هلا') {
    message.reply('هلا والله 👋');
}
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
// Slash Command: /setup_chat
// ==============================

const chatTimers = new Map();

client.on('ready', async () => {
    console.log('Registering slash commands...');

    for (const guild of client.guilds.cache.values()) {
        try {
            await client.api
                .applications(client.user.id)
                .guilds(guild.id)
                .commands.post({
                    data: {
                        name: 'setup_chat',
                        description: 'تشغيل تذكير التفاعل كل 5 ساعات'
                    }
                });

            console.log('Slash command registered in ' + guild.name);
        } catch (error) {
            console.log('Slash command error:', error);
        }
    }
});

client.on('interactionCreate', async interaction => {
    if (!interaction.isCommand()) return;

    if (interaction.commandName === 'setup_chat') {

        const channel = interaction.channel;

        await interaction.reply('تم تشغيل التذكير 📢 كل 5 ساعات.');

        // إلغاء مؤقت قديم لنفس الروم
        if (chatTimers.has(channel.id)) {
            clearInterval(chatTimers.get(channel.id));
        }

        // إرسال كل 5 ساعات
        const timer = setInterval(() => {

            channel.send('@everyone تفاعلو 📢');

        }, 5 * 60 * 60 * 1000);

        chatTimers.set(channel.id, timer);
    }
});

client.login(process.env.DISCORD_TOKEN);
