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

client.login(process.env.DISCORD_TOKEN);
