require("dotenv").config();
const fs=require("node:fs"),path=require("node:path");
const {
  Client,GatewayIntentBits,Events,PermissionFlagsBits,EmbedBuilder,MessageFlags,
  ActionRowBuilder,ButtonBuilder,ButtonStyle,ModalBuilder,TextInputBuilder,TextInputStyle,
  AudioPlayerStatus
}=require("discord.js");
const {
  joinVoiceChannel,createAudioPlayer,createAudioResource,VoiceConnectionStatus,
  entersState,NoSubscriberBehavior
}=require("@discordjs/voice");
const play=require("play-dl");

if(!process.env.DISCORD_TOKEN)throw Error("DISCORD_TOKEN missing");
const client=new Client({intents:[GatewayIntentBits.Guilds,GatewayIntentBits.GuildVoiceStates,GatewayIntentBits.GuildPresences,GatewayIntentBits.GuildMembers]});
const dir=path.join(__dirname,"..","data"),file=path.join(dir,"engagement.json");
fs.mkdirSync(dir,{recursive:true});
let cfg={};
try{cfg=JSON.parse(fs.readFileSync(file,"utf8"))}catch{}
const timers=new Map(),sessions=new Map(),presenceTimers=new Map();

function save(){fs.writeFileSync(file,JSON.stringify(cfg,null,2))}
function schedule(id){
  if(timers.has(id))clearInterval(timers.get(id));
  const c=cfg[id];
  if(!c||!c.enabled)return;
  const timer=setInterval(async()=>{
    try{
      const ch=await client.channels.fetch(c.channelId);
      if(ch&&ch.isTextBased())await ch.send({content:c.message,allowedMentions:{parse:[]}});
    }catch(e){console.error("Reminder:",e.message)}
  },7200000);
  timers.set(id,timer);
}

function onlineCount(guild){
  return guild.presences.cache.filter(p=>p.status==="online"&&!p.user?.bot).size;
}
async function refreshOnlineMessage(guild){
  const c=cfg[guild.id]?.activeCount;
  if(!c?.channelId||!c?.messageId)return;
  try{
    const channel=await client.channels.fetch(c.channelId);
    if(!channel?.isTextBased())return;
    const message=await channel.messages.fetch(c.messageId);
    await message.edit({content:`🟢 **الأعضاء المتصلون الآن: ${onlineCount(guild)}**
(لا يشمل البوتات)`});
  }catch(e){console.error("Active count update:",e.message)}
}
function queueOnlineUpdate(guild){
  if(presenceTimers.has(guild.id))clearTimeout(presenceTimers.get(guild.id));
  presenceTimers.set(guild.id,setTimeout(()=>{
    presenceTimers.delete(guild.id);
    refreshOnlineMessage(guild).catch(console.error);
  },1800));
}

function makeSession(guild){
  const s={
    guild,player:createAudioPlayer({behaviors:{noSubscriber:NoSubscriberBehavior.Pause}}),
    connection:null,voiceChannelId:null,url:null,repeat:false,starting:false
  };
  s.player.on(AudioPlayerStatus.Idle,()=>{
    if(s.repeat&&s.url&&!s.starting&&s.voiceChannelId){
      startMusic(s,s.url).catch(e=>console.error("Repeat:",e));
    }
  });
  sessions.set(guild.id,s);
  return s;
}
function getSession(guild){return sessions.get(guild.id)||makeSession(guild)}
async function startMusic(s,url){
  if(s.starting)throw Error("يوجد تشغيل قيد التجهيز.");
  s.starting=true;
  try{
    const stream=await play.stream(url);
    if(!s.connection){
      s.connection=joinVoiceChannel({
        channelId:s.voiceChannelId,guildId:s.guild.id,
        adapterCreator:s.guild.voiceAdapterCreator,selfDeaf:true
      });
      s.connection.subscribe(s.player);
      await entersState(s.connection,VoiceConnectionStatus.Ready,20000);
    }
    s.url=url;
    s.player.play(createAudioResource(stream.stream,{inputType:stream.type}));
  }finally{s.starting=false}
}
function musicControls(s,userId){
  return [new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`music:${s.guild.id}:${userId}:repeat`)
      .setLabel(s.repeat?"التكرار: تشغيل":"التكرار: إيقاف")
      .setStyle(s.repeat?ButtonStyle.Success:ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`music:${s.guild.id}:${userId}:link`)
      .setLabel("تغيير الرابط").setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(`music:${s.guild.id}:${userId}:stop`)
      .setLabel("إيقاف").setStyle(ButtonStyle.Danger)
  )];
}
function musicModal(guildId,userId){
  const modal=new ModalBuilder().setCustomId(`musiclink:${guildId}:${userId}`).setTitle("تغيير رابط الموسيقى");
  const input=new TextInputBuilder().setCustomId("url").setLabel("رابط YouTube أو SoundCloud")
    .setStyle(TextInputStyle.Short).setPlaceholder("https://...").setRequired(true).setMaxLength(400);
  modal.addComponents(new ActionRowBuilder().addComponents(input));
  return modal;
}

client.once(Events.ClientReady,()=>{
  console.log("Eto bot online as "+client.user.tag);
  for(const id of Object.keys(cfg)){
    schedule(id);
    if(cfg[id]?.activeCount){
      const guild=client.guilds.cache.get(id);
      if(guild)guild.members.fetch({withPresences:true}).then(()=>refreshOnlineMessage(guild)).catch(e=>console.error("Presence fetch:",e.message));
    }
  }
});

client.on(Events.PresenceUpdate,(oldPresence,newPresence)=>{
  if(oldPresence?.status===newPresence.status)return;
  const guild=newPresence.guild||oldPresence?.guild;
  if(guild&&cfg[guild.id]?.activeCount)queueOnlineUpdate(guild);
});

client.on(Events.InteractionCreate,async i=>{
  try{
    if(i.isButton()&&i.customId.startsWith("music:")){
      const [,guildId,userId,action]=i.customId.split(":");
      if(i.user.id!==userId)return i.reply({content:"هذه لوحة تحكم صاحب التشغيل فقط.",flags:MessageFlags.Ephemeral});
      const s=sessions.get(guildId);
      if(!s)return i.reply({content:"جلسة الموسيقى انتهت. شغّل الأمر من جديد.",flags:MessageFlags.Ephemeral});
      if(action==="repeat"){
        s.repeat=!s.repeat;
        return i.update({content:`🎵 التحكم بالموسيقى\nالتكرار: **${s.repeat?"مفعّل":"متوقف"}**`,components:musicControls(s,userId)});
      }
      if(action==="link")return i.showModal(musicModal(guildId,userId));
      if(action==="stop"){
        s.repeat=false;
        s.player.stop(true);
        if(s.connection){s.connection.destroy();s.connection=null}
        return i.update({content:"⏹️ تم إيقاف الموسيقى ومغادرة الروم. يمكنك تغيير الرابط من نفس القائمة.",components:musicControls(s,userId)});
      }
    }

    if(i.isModalSubmit()&&i.customId.startsWith("musiclink:")){
      const [,guildId,userId]=i.customId.split(":");
      if(i.user.id!==userId)return i.reply({content:"هذه اللوحة ليست لك.",flags:MessageFlags.Ephemeral});
      const s=sessions.get(guildId);
      if(!s)return i.reply({content:"انتهت جلسة الموسيقى. شغّل الأمر من جديد.",flags:MessageFlags.Ephemeral});
      const url=i.fields.getTextInputValue("url").trim();
      if(!/^https:\/\//i.test(url))return i.reply({content:"أرسل رابط HTTPS صالحاً.",flags:MessageFlags.Ephemeral});
      await startMusic(s,url);
      return i.update({content:"🎵 تم تغيير الرابط وبدأ التشغيل. لوحة التحكم ستبقى ظاهرة.",components:musicControls(s,userId)});
    }

    if(!i.isChatInputCommand())return;


    if(i.commandName==="عدد_نشطين"){
      if(!i.memberPermissions?.has(PermissionFlagsBits.ManageGuild))
        return i.reply({content:"تحتاج صلاحية إدارة السيرفر.",flags:MessageFlags.Ephemeral});
      const ch=i.options.getChannel("الروم");
      await i.deferReply({flags:MessageFlags.Ephemeral});
      await i.guild.members.fetch({withPresences:true});
      const message=await ch.send({content:`🟢 **الأعضاء المتصلون الآن: ${onlineCount(i.guild)}**
(لا يشمل البوتات)`});
      cfg[i.guildId]={...(cfg[i.guildId]||{}),activeCount:{channelId:ch.id,messageId:message.id}};
      save();
      return i.editReply({content:"تم تفعيل عداد المتصلين في <#"+ch.id+">. سيُحدّث نفس الرسالة تلقائياً."});
    }

    if(i.commandName==="تحديث"){
      if(!i.memberPermissions?.has(PermissionFlagsBits.ManageGuild))
        return i.reply({content:"تحتاج صلاحية إدارة السيرفر.",flags:MessageFlags.Ephemeral});
      const ch=i.options.getChannel("الروم"),message=i.options.getString("الرسالة");
      await ch.send({content:"@everyone\n"+message,allowedMentions:{parse:["everyone"]}});
      return i.reply({content:"تم إرسال إعلان التحديث في <#"+ch.id+"> مع منشن الجميع.",flags:MessageFlags.Ephemeral});
    }

    if(i.commandName==="تفاعل"){
      if(!i.memberPermissions?.has(PermissionFlagsBits.ManageGuild))
        return i.reply({content:"تحتاج صلاحية إدارة السيرفر.",flags:MessageFlags.Ephemeral});
      if(i.options.getSubcommand()==="تشغيل"){
        const ch=i.options.getChannel("الروم");
        cfg[i.guildId]={...(cfg[i.guildId]||{}),enabled:true,channelId:ch.id,message:"❄️ وقت التفاعل! شاركونا وجودكم في السيرفر."};
        save();schedule(i.guildId);
        return i.reply({content:"تم تشغيل التذكير في <#"+ch.id+">. سيبدأ الإرسال بعد ساعتين.",flags:MessageFlags.Ephemeral});
      }
      if(timers.has(i.guildId))clearInterval(timers.get(i.guildId));
      timers.delete(i.guildId);
      cfg[i.guildId]={...(cfg[i.guildId]||{}),enabled:false};
      save();
      return i.reply({content:"تم إيقاف التذكير.",flags:MessageFlags.Ephemeral});
    }

    if(i.commandName==="رساله"){
      const user=i.options.getUser("العضو"),message=i.options.getString("النص");
      if(user.bot)return i.reply({content:"لا يمكن إرسال رسالة إلى بوت.",flags:MessageFlags.Ephemeral});
      try{
        await user.send({content:message,allowedMentions:{parse:[]}});
        return i.reply({content:"تم إرسال الرسالة إلى خاص <@"+user.id+">.",flags:MessageFlags.Ephemeral});
      }catch{
        return i.reply({content:"تعذر الإرسال. قد يكون الخاص مغلقاً أو أن العضو يمنع الرسائل.",flags:MessageFlags.Ephemeral});
      }
    }

    if(i.commandName==="تحذير"){
      if(!i.memberPermissions?.has(PermissionFlagsBits.ModerateMembers))
        return i.reply({content:"تحتاج صلاحية إدارة الأعضاء.",flags:MessageFlags.Ephemeral});
      const user=i.options.getUser("العضو"),type=i.options.getString("النوع"),
        reason=i.options.getString("السبب"),log=i.options.getChannel("روم_السجل");
      const label=type==="staff"?"تحذير إداري / موظف":"تحذير عضو";
      const embed=new EmbedBuilder().setColor(type==="staff"?0xD9A441:0xD94B4B)
        .setTitle("⚠️ تسجيل تحذير")
        .addFields(
          {name:"العضو",value:"<@"+user.id+"> ("+user.tag+")"},
          {name:"النوع",value:label,inline:true},
          {name:"بواسطة",value:"<@"+i.user.id+">",inline:true},
          {name:"السبب",value:reason}
        ).setTimestamp();
      await log.send({embeds:[embed]});
      let dm=true;
      try{
        await user.send({embeds:[new EmbedBuilder().setColor(0xD94B4B)
          .setTitle("⚠️ لديك تحذير في السيرفر")
          .setDescription("السيرفر: "+i.guild.name+"\nالنوع: "+label+"\nالسبب: "+reason).setTimestamp()]});
      }catch{dm=false}
      return i.reply({content:"تم تسجيل التحذير في <#"+log.id+">."+(dm?" وتم إرسال نسخة للخاص.":" لكن الخاص مغلق، ولم تصل رسالة DM."),flags:MessageFlags.Ephemeral});
    }

    if(i.commandName==="موسيقى"){
      if(i.options.getSubcommand()==="ايقاف"){
        const s=sessions.get(i.guildId);
        if(s){
          s.repeat=false;s.player.stop(true);
          if(s.connection)s.connection.destroy();
          sessions.delete(i.guildId);
        }
        return i.reply({content:"تم إيقاف الموسيقى ومغادرة الروم.",flags:MessageFlags.Ephemeral});
      }
      const member=await i.guild.members.fetch(i.user.id),voice=member.voice.channel;
      if(!voice)return i.reply({content:"ادخل روم صوتي أولاً.",flags:MessageFlags.Ephemeral});
      const url=i.options.getString("الرابط");
      if(!/^https:\/\//i.test(url))return i.reply({content:"أرسل رابط HTTPS صالحاً.",flags:MessageFlags.Ephemeral});
      await i.deferReply({flags:MessageFlags.Ephemeral});
      const s=getSession(i.guild);
      s.voiceChannelId=voice.id;s.repeat=false;
      await startMusic(s,url);
      return i.editReply({content:"🎵 بدأ التشغيل. استخدم الأزرار للتحكم، وستبقى القائمة ظاهرة.",components:musicControls(s,i.user.id)});
    }
  }catch(e){
    console.error(e);
    const msg="تعذر تنفيذ الأمر. تحقق من صلاحيات البوت وأن الرابط مدعوم.";
    if(i.deferred||i.replied)await i.followUp({content:msg,flags:MessageFlags.Ephemeral}).catch(()=>{});
    else await i.reply({content:msg,flags:MessageFlags.Ephemeral}).catch(()=>{});
  }
});

client.login(process.env.DISCORD_TOKEN);
