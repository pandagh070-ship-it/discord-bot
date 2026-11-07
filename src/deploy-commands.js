require("dotenv").config();
const {REST,Routes,SlashCommandBuilder,PermissionFlagsBits,ChannelType}=require("discord.js");

const commands=[
  new SlashCommandBuilder()
    .setName("تفعيل_وضع_مراسل")
    .setDescription("تفعيل المراسل الذكي في روم محدد")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addChannelOption(o=>o.setName("الروم").setDescription("الروم الذي سيتفاعل فيه المراسل").addChannelTypes(ChannelType.GuildText).setRequired(true)),
  new SlashCommandBuilder()
    .setName("إيقاف_وضع_مراسل")
    .setDescription("إيقاف المراسل الذكي")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
  new SlashCommandBuilder()
    .setName("تفاعل")
    .setDescription("تشغيل أو إيقاف تذكير التفاعل")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand(s=>s.setName("تشغيل").setDescription("تشغيل التذكير في روم")
      .addChannelOption(o=>o.setName("الروم").setDescription("روم التذكير").addChannelTypes(ChannelType.GuildText).setRequired(true)))
    .addSubcommand(s=>s.setName("ايقاف").setDescription("إيقاف التذكير")),

  new SlashCommandBuilder()
    .setName("رساله")
    .setDescription("إرسال رسالة إلى عضو في الخاص")
    .addUserOption(o=>o.setName("العضو").setDescription("العضو المستلم").setRequired(true))
    .addStringOption(o=>o.setName("النص").setDescription("محتوى الرسالة").setRequired(true).setMaxLength(1900)),

  new SlashCommandBuilder()
    .setName("موسيقى")
    .setDescription("تشغيل الموسيقى والتحكم بها")
    .addSubcommand(s=>s.setName("تشغيل").setDescription("تشغيل رابط صوتي")
      .addStringOption(o=>o.setName("الرابط").setDescription("رابط YouTube أو SoundCloud").setRequired(true)))
    .addSubcommand(s=>s.setName("ايقاف").setDescription("إيقاف الموسيقى ومغادرة الروم")),

  new SlashCommandBuilder()
    .setName("تحذير")
    .setDescription("تحذير عضو وتسجيله")
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .addUserOption(o=>o.setName("العضو").setDescription("العضو").setRequired(true))
    .addStringOption(o=>o.setName("النوع").setDescription("نوع التحذير").setRequired(true)
      .addChoices({name:"عضو عادي",value:"member"},{name:"إداري / موظف",value:"staff"}))
    .addStringOption(o=>o.setName("السبب").setDescription("سبب التحذير").setRequired(true).setMaxLength(1000))
    .addChannelOption(o=>o.setName("روم_السجل").setDescription("روم تسجيل التحذير")
      .addChannelTypes(ChannelType.GuildText).setRequired(true)),

  new SlashCommandBuilder()
    .setName("عدد_نشطين")
    .setDescription("عرض عدد الأعضاء المتصلين وتحديثه تلقائياً")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addChannelOption(o=>o.setName("الروم").setDescription("روم عرض العداد").addChannelTypes(ChannelType.GuildText).setRequired(true)),

  new SlashCommandBuilder()
    .setName("تحديث")
    .setDescription("إرسال إعلان تحديث مع منشن الجميع")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addChannelOption(o=>o.setName("الروم").setDescription("روم إعلان التحديث").addChannelTypes(ChannelType.GuildText).setRequired(true))
    .addStringOption(o=>o.setName("الرسالة").setDescription("تفاصيل التحديث").setRequired(true).setMaxLength(1800)),

  new SlashCommandBuilder()
    .setName("afk").setDescription("إبقاء البوت في روم صوتي حتى إخراجه")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand(s=>s.setName("دخول").setDescription("إدخال البوت إلى روم صوتي")
      .addChannelOption(o=>o.setName("الروم").setDescription("الروم الصوتي").addChannelTypes(ChannelType.GuildVoice,ChannelType.GuildStageVoice).setRequired(true)))
    .addSubcommand(s=>s.setName("خروج").setDescription("إخراج البوت من الروم الصوتي"))
    .addSubcommand(s=>s.setName("حالة").setDescription("معرفة الروم الذي يقف فيه البوت")),
  new SlashCommandBuilder().setName("مساعدة").setDescription("عرض قائمة أوامر بوت Eto"),
  new SlashCommandBuilder().setName("عضو").setDescription("عرض معلومات عضو")
    .addUserOption(o=>o.setName("العضو").setDescription("العضو المطلوب").setRequired(false)),
  new SlashCommandBuilder().setName("سيرفر").setDescription("عرض معلومات السيرفر"),
  new SlashCommandBuilder().setName("مسح").setDescription("حذف عدد من الرسائل")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
    .addIntegerOption(o=>o.setName("العدد").setDescription("من 1 إلى 100").setMinValue(1).setMaxValue(100).setRequired(true)),
  new SlashCommandBuilder().setName("قفل").setDescription("قفل الكتابة في الروم الحالي")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels),
  new SlashCommandBuilder().setName("فتح").setDescription("فتح الكتابة في الروم الحالي")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels),
  new SlashCommandBuilder().setName("بطء").setDescription("تحديد مهلة بين الرسائل في الروم")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels)
    .addIntegerOption(o=>o.setName("ثواني").setDescription("من 0 إلى 21600").setMinValue(0).setMaxValue(21600).setRequired(true)),
  new SlashCommandBuilder().setName("مهلة").setDescription("إعطاء عضو مهلة مؤقتة")
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .addUserOption(o=>o.setName("العضو").setDescription("العضو").setRequired(true))
    .addIntegerOption(o=>o.setName("دقائق").setDescription("مدة المهلة بالدقائق").setMinValue(1).setMaxValue(40320).setRequired(true))
    .addStringOption(o=>o.setName("السبب").setDescription("السبب").setMaxLength(500).setRequired(false)),
  new SlashCommandBuilder().setName("طرد").setDescription("طرد عضو من السيرفر")
    .setDefaultMemberPermissions(PermissionFlagsBits.KickMembers)
    .addUserOption(o=>o.setName("العضو").setDescription("العضو").setRequired(true))
    .addStringOption(o=>o.setName("السبب").setDescription("السبب").setMaxLength(500).setRequired(false)),
  new SlashCommandBuilder().setName("حظر").setDescription("حظر عضو من السيرفر")
    .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers)
    .addUserOption(o=>o.setName("العضو").setDescription("العضو").setRequired(true))
    .addStringOption(o=>o.setName("السبب").setDescription("السبب").setMaxLength(500).setRequired(false)),
].map(x=>x.toJSON());

(async()=>{
  const {DISCORD_TOKEN,CLIENT_ID,GUILD_ID}=process.env;
  if(!DISCORD_TOKEN||!CLIENT_ID)throw Error("Set DISCORD_TOKEN and CLIENT_ID in .env");
  const rest=new REST({version:"10"}).setToken(DISCORD_TOKEN);
  await rest.put(GUILD_ID?Routes.applicationGuildCommands(CLIENT_ID,GUILD_ID):Routes.applicationCommands(CLIENT_ID),{body:commands});
  console.log(`Registered ${commands.length} commands.`);
})().catch(e=>{console.error(e);process.exit(1);});
