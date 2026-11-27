require("dotenv").config();
const {REST,Routes,SlashCommandBuilder,ChannelType}=require("discord.js");

const commands=[
  new SlashCommandBuilder()
    .setName("nuclearmag").setDescription("إرسال رسم نووي تجريبي في الخاص")
    .addUserOption(o=>o.setName("member").setDescription("العضو المستهدف").setRequired(true)),
  new SlashCommandBuilder()
    .setName("nuclearvoice").setDescription("تشغيل مؤثر إنذار وانفجار سينمائي في روم فويس")
    .addChannelOption(o=>o.setName("room").setDescription("الروم الصوتي").addChannelTypes(ChannelType.GuildVoice).setRequired(true)),
  new SlashCommandBuilder().setName("alive").setDescription("تشغيل وضع Live المستقل"),
  new SlashCommandBuilder().setName("stoplive").setDescription("إيقاف وضع Live"),
  new SlashCommandBuilder()
    .setName("cods").setDescription("إنشاء غرفة إدارة السيرفر بالذكاء الاصطناعي"),
  new SlashCommandBuilder()
    .setName("music").setDescription("تشغيل الموسيقى")
    .addSubcommand(s=>s.setName("play").setDescription("تشغيل أغنية بالاسم أو الرابط")
      .addStringOption(o=>o.setName("song").setDescription("اسم الأغنية أو رابط YouTube/Spotify").setRequired(true)))
    .addSubcommand(s=>s.setName("stop").setDescription("إيقاف الموسيقى")),
  new SlashCommandBuilder()
    .setName("screen").setDescription("عرض فيديو من رابط")
    .addStringOption(o=>o.setName("link").setDescription("رابط الفيديو").setRequired(true)),
  new SlashCommandBuilder()
    .setName("talking").setDescription("مساعد الذكاء الاصطناعي")
    .addSubcommand(s=>s.setName("ai").setDescription("تفعيل الردود الذكية في هذه القناة"))
    .addSubcommandGroup(g=>g.setName("voice").setDescription("المساعد الصوتي")
      .addSubcommand(s=>s.setName("ai").setDescription("دخول رومك الصوتي والرد بصوت AI")))
    .addSubcommand(s=>s.setName("stop").setDescription("إيقاف المساعد"))
].map(x=>x.toJSON());

(async()=>{
  const {DISCORD_TOKEN,CLIENT_ID,GUILD_ID}=process.env;
  if(!DISCORD_TOKEN||!CLIENT_ID)throw Error("Set DISCORD_TOKEN and CLIENT_ID in .env");
  const rest=new REST({version:"10"}).setToken(DISCORD_TOKEN);
  await rest.put(GUILD_ID?Routes.applicationGuildCommands(CLIENT_ID,GUILD_ID):Routes.applicationCommands(CLIENT_ID),{body:commands});
  console.log("Registered "+commands.length+" commands.");
})().catch(e=>{console.error(e);process.exit(1);});
