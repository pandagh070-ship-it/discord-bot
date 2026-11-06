require("dotenv").config();
const {REST,Routes,SlashCommandBuilder,PermissionFlagsBits,ChannelType}=require("discord.js");
const commands=[
new SlashCommandBuilder().setName("تفاعل").setDescription("تذكير التفاعل كل ساعتين").setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
.addSubcommand(s=>s.setName("تشغيل").setDescription("تشغيل التذكير").addChannelOption(o=>o.setName("الروم").setDescription("روم التذكير").addChannelTypes(ChannelType.GuildText).setRequired(true)).addStringOption(o=>o.setName("الرسالة").setDescription("نص التذكير").setMaxLength(1500)))
.addSubcommand(s=>s.setName("ايقاف").setDescription("إيقاف التذكير")),
new SlashCommandBuilder().setName("تحذير").setDescription("تحذير عضو وتسجيله").setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
.addUserOption(o=>o.setName("العضو").setDescription("العضو").setRequired(true))
.addStringOption(o=>o.setName("النوع").setDescription("نوع التحذير").setRequired(true).addChoices({name:"عضو عادي",value:"member"},{name:"إداري / موظف",value:"staff"}))
.addStringOption(o=>o.setName("السبب").setDescription("سبب التحذير").setRequired(true).setMaxLength(1000))
.addChannelOption(o=>o.setName("روم_السجل").setDescription("روم تسجيل التحذير").addChannelTypes(ChannelType.GuildText).setRequired(true)),
new SlashCommandBuilder().setName("موسيقى").setDescription("تشغيل رابط صوتي في رومك")
.addSubcommand(s=>s.setName("تشغيل").setDescription("تشغيل رابط").addStringOption(o=>o.setName("الرابط").setDescription("رابط YouTube أو SoundCloud مدعوم").setRequired(true)))
.addSubcommand(s=>s.setName("ايقاف").setDescription("إيقاف الموسيقى"))
].map(x=>x.toJSON());
(async()=>{
const {DISCORD_TOKEN,CLIENT_ID,GUILD_ID}=process.env;
if(!DISCORD_TOKEN||!CLIENT_ID)throw Error("Set DISCORD_TOKEN and CLIENT_ID in .env");
const rest=new REST({version:"10"}).setToken(DISCORD_TOKEN);
await rest.put(GUILD_ID?Routes.applicationGuildCommands(CLIENT_ID,GUILD_ID):Routes.applicationCommands(CLIENT_ID),{body:commands});
console.log("Registered 3 commands.");
})().catch(e=>{console.error(e);process.exit(1);});
