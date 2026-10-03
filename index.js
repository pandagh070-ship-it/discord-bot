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
    // ==============================
// Slash Command: /setup_chat
// ==============================

const chatTimers = new Map();

client.ws.on('INTERACTION_CREATE', async interaction => {

    if (!interaction.data) return;
    if (interaction.data.name !== 'setup_chat') return;

    const channelId = interaction.channel_id;

    // رد فوري على الأمر
    await client.api.interactions(interaction.id, interaction.token).callback.post({
        data: {
            type: 4,
            data: {
                content: 'تم تشغيل التذكير 📢 كل 5 ساعات.'
            }
        }
    });

    // إلغاء مؤقت قديم
    if (chatTimers.has(channelId)) {
        clearInterval(chatTimers.get(channelId));
    }

    // كل 5 ساعات
    const timer = setInterval(() => {

        const channel = client.channels.get(channelId);

        if (channel) {
            channel.send('@everyone تفاعلو 📢');
        }

    }, 5 * 60 * 60 * 1000);

    chatTimers.set(channelId, timer);
});
            
client.login(process.env.DISCORD_TOKEN);
