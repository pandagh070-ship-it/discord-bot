require("dotenv").config();
const fs=require("node:fs"),path=require("node:path");
const {
  Client,GatewayIntentBits,Events,PermissionFlagsBits,EmbedBuilder,MessageFlags,
  ActionRowBuilder,ButtonBuilder,ButtonStyle,ModalBuilder,TextInputBuilder,TextInputStyle,
  AudioPlayerStatus,StringSelectMenuBuilder,StringSelectMenuOptionBuilder
}=require("discord.js");
const {
  joinVoiceChannel,createAudioPlayer,createAudioResource,VoiceConnectionStatus,
  entersState,NoSubscriberBehavior
}=require("@discordjs/voice");
const play=require("@iamtraction/play-dl");

if(!process.env.DISCORD_TOKEN)throw Error("DISCORD_TOKEN missing");
const client=new Client({intents:[GatewayIntentBits.Guilds,GatewayIntentBits.GuildVoiceStates,GatewayIntentBits.GuildPresences,GatewayIntentBits.GuildMembers,GatewayIntentBits.GuildMessages,GatewayIntentBits.MessageContent]});
const dir=path.join(__dirname,"..","data"),file=path.join(dir,"engagement.json");
fs.mkdirSync(dir,{recursive:true});
let cfg={};
try{cfg=JSON.parse(fs.readFileSync(file,"utf8"))}catch{}
const timers=new Map(),sessions=new Map(),presenceTimers=new Map();

function save(){fs.writeFileSync(file,JSON.stringify(cfg,null,2))}

const messengerHistory=new Map(),messengerTimers=new Map();
async function askGroq(channelId){
  const apiKey=process.env.GROQ_API_KEY;
  if(!apiKey)return null;
  const history=messengerHistory.get(channelId)||[];
  const messages=[
    {role:"system",content:"أنت إيتو، عضو طبيعي في سيرفر ديسكورد. تكلم بعفوية وبلهجة مصرية ممزوجة بالخليجية، لا تستخدم الفصحى إلا للضرورة. ردودك قصيرة غالباً، ذكية وخفيفة، وتفاعل مع سياق الكلام كأنك شخص موجود في القعدة. لا تتصنع الحماس ولا تمدح الناس بلا سبب. افهم آخر المحادثة قبل الرد، ولا تكرر كلامك. لا تقل إنك ذكاء اصطناعي إلا إذا سُئلت مباشرة. لا تخترع حقائق عن أعضاء السيرفر أو أحداث لم تُذكر. أجب على الرسائل العادية والكلمات القصيرة والتعليقات حتى لو لم يتم منشنك أو توجيه سؤال لك. إذا أرسل شخص رسالة أو رسالتين في الروم، شارك برد طبيعي وقصير يناسب السياق. لا تتجاهل الرسائل العادية."},
    ...history.slice(-12).map(x=>({role:x.role,content:x.content}))
  ];
  const response=await fetch("https://api.groq.com/openai/v1/chat/completions",{
    method:"POST",
    headers:{"Authorization":"Bearer "+apiKey,"Content-Type":"application/json"},
    body:JSON.stringify({model:"openai/gpt-oss-20b",messages,temperature:0.85,max_completion_tokens:180}),
    signal:AbortSignal.timeout(25000)
  });
  if(!response.ok)throw Error("Groq API "+response.status);
  const data=await response.json();
  return data.choices?.[0]?.message?.content?.trim()||null;
}
client.on(Events.MessageCreate,async message=>{
  try{
    if(!message.guild||message.author.bot)return;
    const settings=cfg[message.guild.id]?.messenger;
    if(!settings?.enabled||settings.channelId!==message.channelId)return;
    const content=message.content?.trim();
    if(!content)return;
    const history=messengerHistory.get(message.channelId)||[];
    history.push({role:"user",content:message.author.username+": "+content,at:Date.now()});
    messengerHistory.set(message.channelId,history.slice(-16));

    // اجمع الرسائل المتقاربة ثم رد بعد توقف بسيط.
    const oldTimer=messengerTimers.get(message.channelId);
    if(oldTimer)clearTimeout(oldTimer);
    const timer=setTimeout(async()=>{
      messengerTimers.delete(message.channelId);
      try{
        if(!process.env.GROQ_API_KEY){
          if(!global.groqKeyWarning){console.warn("Messenger enabled but GROQ_API_KEY is not configured.");global.groqKeyWarning=true}
          return;
        }
        const answer=await askGroq(message.channelId);
        if(!answer)return;
        const safe=answer.replace(/@everyone|@here/g,"").replace(/^\[SKIP\]$/i,"").slice(0,1900);
        if(!safe.trim())return;
        await message.reply({content:safe,allowedMentions:{parse:[]}});
        const updated=messengerHistory.get(message.channelId)||[];
        updated.push({role:"assistant",content:safe,at:Date.now()});
        messengerHistory.set(message.channelId,updated.slice(-16));
      }catch(e){console.error("Messenger:",e.message)}
    },1300);
    messengerTimers.set(message.channelId,timer);
  }catch(e){console.error("Messenger:",e.message)}
});


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


const afkConnections=new Map();
function joinAfk(guild,channel){
  const old=afkConnections.get(guild.id);
  if(old){try{old.destroy()}catch{}}
  const connection=joinVoiceChannel({
    channelId:channel.id,guildId:guild.id,adapterCreator:guild.voiceAdapterCreator,
    selfDeaf:true,selfMute:true
  });
  afkConnections.set(guild.id,connection);
  cfg[guild.id]={...(cfg[guild.id]||{}),afkChannelId:channel.id};
  save();
  return connection;
}
function leaveAfk(guildId){
  const connection=afkConnections.get(guildId);
  if(connection){try{connection.destroy()}catch{}}
  afkConnections.delete(guildId);
  if(cfg[guildId]){delete cfg[guildId].afkChannelId;save()}
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
  s.player.on("error",e=>console.error("Audio player error:",e.message));
  s.player.on(AudioPlayerStatus.Idle,()=>{
    if(s.repeat&&s.url&&!s.starting&&s.voiceChannelId){
      startMusic(s,s.url).catch(e=>console.error("Repeat:",e));
    }
  });
  sessions.set(guild.id,s);
  return s;
}
function getSession(guild){return sessions.get(guild.id)||makeSession(guild)}
async function startMusic(s,input){
  if(s.starting)throw Error("فيه طلب تشغيل قيد التجهيز، انتظر لحظة.");
  s.starting=true;
  try{
    let url=input.trim(),title=url;
    if(!/^https?:\\/\\//i.test(url)){
      const results=await play.search(url,{limit:1});
      if(!results?.length)throw Error("ما لقيت نتيجة لهذا الاسم. جرّب عنواناً أو رابطاً آخر.");
      url=results[0].url;
      title=results[0].title||url;
    }
    const stream=await play.stream(url);
    if(!s.connection||s.connection.state.status===VoiceConnectionStatus.Destroyed){
      s.connection=joinVoiceChannel({
        channelId:s.voiceChannelId,guildId:s.guild.id,
        adapterCreator:s.guild.voiceAdapterCreator,selfDeaf:true
      });
      s.connection.on("error",e=>console.error("Voice connection error:",e.message));
      await entersState(s.connection,VoiceConnectionStatus.Ready,25000);
      s.connection.subscribe(s.player);
    }
    s.url=url;
    s.player.play(createAudioResource(stream.stream,{inputType:stream.type}));
    return title;
  }catch(e){
    throw new Error("تعذر تشغيل الصوت: "+(e.message||"مصدر الصوت لم يستجب"));
  }finally{s.starting=false}
}
function musicControls(s,userId){
  return [new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`music:${s.guild.id}:${userId}:repeat`)
      .setLabel(s.repeat?"التكرار: تشغيل":"التكرار: إيقاف")
      .setStyle(s.repeat?ButtonStyle.Success:ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`music:${s.guild.id}:${userId}:link`)
      .setLabel("تغيير الرابط").setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(`music:${s.guild.id}:${userId}:pause`)
      .setLabel(s.player.state.status===AudioPlayerStatus.Paused?"استئناف":"إيقاف مؤقت")
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`music:${s.guild.id}:${userId}:stop`)
      .setLabel("إيقاف").setStyle(ButtonStyle.Danger)
  )];
}
function musicModal(guildId,userId){
  const modal=new ModalBuilder().setCustomId(`musiclink:${guildId}:${userId}`).setTitle("تغيير رابط الموسيقى");
  const input=new TextInputBuilder().setCustomId("url").setLabel("اسم أغنية أو رابط")
    .setStyle(TextInputStyle.Short).setPlaceholder("اسم الأغنية أو https://...").setRequired(true).setMaxLength(400);
  modal.addComponents(new ActionRowBuilder().addComponents(input));
  return modal;
}

client.once(Events.ClientReady,()=>{
  console.log("Eto bot online as "+client.user.tag);
  for(const id of Object.keys(cfg)){
    schedule(id);
    if(cfg[id]?.afkChannelId){
      const guild=client.guilds.cache.get(id);
      const channel=guild?.channels.cache.get(cfg[id].afkChannelId);
      if(guild&&channel&&channel.isVoiceBased()){
        try{joinAfk(guild,channel)}catch(e){console.error("AFK restore:",e.message)}
      }else{delete cfg[id].afkChannelId;save()}
    }
    if(cfg[id]?.activeCount){
      const guild=client.guilds.cache.get(id);
      if(guild)guild.members.fetch({withPresences:true}).then(()=>refreshOnlineMessage(guild)).catch(e=>console.error("Presence fetch:",e.message));
    }
  }
});

client.on(Events.VoiceStateUpdate,(oldState,newState)=>{
  if(newState.id!==client.user?.id)return;
  if(oldState.channelId&&!newState.channelId){
    leaveAfk(newState.guild.id);
  }else if(newState.channelId&&cfg[newState.guild.id]?.afkChannelId!==newState.channelId){
    cfg[newState.guild.id]={...(cfg[newState.guild.id]||{}),afkChannelId:newState.channelId};
    save();
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
      if(action==="pause"){
        if(s.player.state.status===AudioPlayerStatus.Paused)s.player.unpause();
        else s.player.pause();
        return i.update({content:s.player.state.status===AudioPlayerStatus.Paused?"⏸️ تم إيقاف الصوت مؤقتاً.":"▶️ تم استئناف الصوت.",components:musicControls(s,userId)});
      }
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
      if(!url?.trim())return i.reply({content:"اكتب اسم أغنية أو رابطاً صالحاً.",flags:MessageFlags.Ephemeral});
      const title=await startMusic(s,url);
      return i.reply({content:"🎵 تم تشغيل: **"+title.slice(0,180)+"**",components:musicControls(s,userId),flags:MessageFlags.Ephemeral});
    }

    if(i.isStringSelectMenu()&&i.customId==="eto:help"){
      const pages={
        community:["👥 الأعضاء والمجتمع","/عضو • /سيرفر • /رساله"],
        fun:["✨ الترفيه والابتكار","/نشرة_إيتو • /ماذا_لو • /بصمة"],
        voice:["🎧 الصوت والموسيقى","/موسيقى تشغيل • /موسيقى ايقاف • /afk دخول • /afk خروج • /afk حالة"],
        admin:["🛡️ الإدارة والحماية","/تحذير • /مهلة • /طرد • /حظر • /مسح • /قفل • /فتح • /بطء"],
        tools:["⚙️ الأدوات والإحصاءات","/تفاعل تشغيل • /تفاعل ايقاف • /عدد_نشطين • /تحديث • /تفعيل_وضع_مراسل • /إيقاف_وضع_مراسل"]
      };
      const page=pages[i.values[0]];
      if(!page)return i.deferUpdate();
      const embed=new EmbedBuilder().setColor(0x8BD5FF).setTitle(page[0]).setDescription(page[1])
        .setFooter({text:"اختر قسماً آخر من القائمة للتنقل"});
      return i.update({embeds:[embed]});
    }
    if(!i.isChatInputCommand())return;



    if(i.commandName==="تفعيل_وضع_مراسل"){
      if(!i.memberPermissions?.has(PermissionFlagsBits.ManageGuild))
        return i.reply({content:"تحتاج صلاحية إدارة السيرفر.",flags:MessageFlags.Ephemeral});
      const ch=i.options.getChannel("الروم");
      cfg[i.guildId]={...(cfg[i.guildId]||{}),messenger:{enabled:true,channelId:ch.id}};
      save();
      return i.reply({content:"تم تفعيل وضع المراسل في <#"+ch.id+">.\\n"+(process.env.GROQ_API_KEY?"المراسل جاهز للرد حسب سياق المحادثة.":"باقي إضافة مفتاح GROQ_API_KEY في GitHub Secrets حتى يبدأ الذكاء الاصطناعي بالرد."),flags:MessageFlags.Ephemeral});
    }
    if(i.commandName==="إيقاف_وضع_مراسل"){
      if(!i.memberPermissions?.has(PermissionFlagsBits.ManageGuild))
        return i.reply({content:"تحتاج صلاحية إدارة السيرفر.",flags:MessageFlags.Ephemeral});
      if(cfg[i.guildId]?.messenger)cfg[i.guildId].messenger.enabled=false;
      save();
      return i.reply({content:"تم إيقاف وضع المراسل.",flags:MessageFlags.Ephemeral});
    }

    if(i.commandName==="afk"){
      if(!i.memberPermissions?.has(PermissionFlagsBits.ManageGuild))
        return i.reply({content:"تحتاج صلاحية إدارة السيرفر للتحكم بوضع AFK.",flags:MessageFlags.Ephemeral});
      const sub=i.options.getSubcommand();
      if(sub==="دخول"){
        const channel=i.options.getChannel("الروم");
        if(!channel?.isVoiceBased())return i.reply({content:"اختر روم صوتي صالحاً.",flags:MessageFlags.Ephemeral});
        joinAfk(i.guild,channel);
        return i.reply({content:"💤 دخل البوت <#"+channel.id+"> وسيبقى هناك حتى تستخدم /afk خروج أو تخرجه يدوياً.",flags:MessageFlags.Ephemeral});
      }
      if(sub==="خروج"){
        leaveAfk(i.guildId);
        return i.reply({content:"تم إخراج البوت من الروم الصوتي.",flags:MessageFlags.Ephemeral});
      }
      const channelId=cfg[i.guildId]?.afkChannelId;
      return i.reply({content:channelId?"البوت موجود حالياً في <#"+channelId+">.":"البوت ليس في وضع AFK حالياً.",flags:MessageFlags.Ephemeral});
    }

    if(i.commandName==="مساعدة"){
      const menu=new StringSelectMenuBuilder().setCustomId("eto:help")
        .setPlaceholder("اختر القسم لعرض أوامره")
        .addOptions(
          new StringSelectMenuOptionBuilder().setLabel("الأعضاء والمجتمع").setValue("community").setEmoji("👥"),
          new StringSelectMenuOptionBuilder().setLabel("الترفيه والابتكار").setValue("fun").setEmoji("✨"),
          new StringSelectMenuOptionBuilder().setLabel("الصوت والموسيقى").setValue("voice").setEmoji("🎧"),
          new StringSelectMenuOptionBuilder().setLabel("الإدارة والحماية").setValue("admin").setEmoji("🛡️"),
          new StringSelectMenuOptionBuilder().setLabel("الأدوات والإحصاءات").setValue("tools").setEmoji("⚙️")
        );
      const embed=new EmbedBuilder().setColor(0x8BD5FF).setTitle("❄️ مركز Eto")
        .setDescription("مركز تفاعلي. اختر قسماً من القائمة لتظهر لك أوامره.")
        .setFooter({text:"Eto Network • Control Center"});
      return i.reply({embeds:[embed],components:[new ActionRowBuilder().addComponents(menu)],flags:MessageFlags.Ephemeral});
    }
    if(i.commandName==="نشرة_إيتو"){
      const headlines=[
        ["📡 إشارة من خارج الخريطة","وصلت رسالة مشوشة تقول: «لا تبحثوا عن الباب، الباب يبحث عنكم». لم يُعرف مصدرها."],
        ["🏛️ قرار غريب","أعلنت بلدية القمر منع الظلال من الوقوف في الطوابير، وطلبت من الجميع إحضار ظل احتياطي."],
        ["🧊 الطقس داخل السيرفر","احتمال تساقط مكعبات ثلج افتراضية بنسبة 87%. يُنصح بإبعاد المايك عن العاصفة."],
        ["🛰️ اكتشاف اليوم","رُصد كوكب صغير يدور حول إشعار ديسكورد لم يُفتح منذ 2021."],
        ["🗞️ خبر عاجل","مصدر مجهول يؤكد أن الساعة تأخرت دقيقة لأنها كانت تقرأ المحادثة."]
      ];
      const item=headlines[Math.floor(Math.random()*headlines.length)];
      const embed=new EmbedBuilder().setColor(0x8BD5FF).setTitle("🗞️ نشرة إيتو | "+item[0])
        .setDescription(item[1]).setFooter({text:"نشرة خيالية للترفيه • لا تمثل أخباراً حقيقية"}).setTimestamp();
      return i.reply({embeds:[embed]});
    }
    if(i.commandName==="ماذا_لو"){
      const idea=i.options.getString("الفكرة");
      const twists=[
        "بعد ساعة، يبدأ الجميع بملاحظة أن التفاصيل الصغيرة حولهم تتغير، لكن شخصاً واحداً فقط يتذكر شكل العالم السابق.",
        "تظهر وثيقة قديمة تثبت أن الحدث كان متوقعاً، لكن آخر سطر فيها مكتوب بخط يشبه خطك.",
        "ينقسم الناس إلى فريقين: فريق يريد إيقاف ما يحدث، وفريق يعتقد أن هذه هي الفرصة الوحيدة لتغيير شيء أكبر.",
        "تصل رسالة قصيرة من المستقبل، لا تحذّر من الخطر، بل تسأل لماذا لم تتخذوا القرار بعد.",
        "يبدو الأمر عادياً في البداية، ثم تكتشف أن كل اختيار صغير يفتح مساراً مختلفاً تماماً."
      ];
      const embed=new EmbedBuilder().setColor(0xB8A1FF).setTitle("🌀 ملف ماذا لو؟")
        .addFields({name:"الفكرة",value:idea},{name:"ما الذي يحدث بعدها؟",value:twists[Math.floor(Math.random()*twists.length)]})
        .setFooter({text:"سيناريو خيالي من مختبر Eto"});
      return i.reply({embeds:[embed]});
    }
    if(i.commandName==="بصمة"){
      const traits=[
        ["🧭 مستكشف الأنماط","تلاحظ التفاصيل التي تمر على الآخرين، وتحب فهم الصورة قبل التحرك."],
        ["🧊 هدوء محسوب","لا تتسرع في رد الفعل، وتفضّل أن تتكلم عندما يكون عندك شيء يستحق."],
        ["⚡ شرارة الأفكار","تربط أشياء بعيدة عن بعضها وتطلع منها بفكرة جديدة."],
        ["🛰️ مراقب من المدار","تراقب المشهد أولاً، ثم تختار اللحظة المناسبة للدخول."]
      ];
      const item=traits[Math.floor(Math.random()*traits.length)];
      const embed=new EmbedBuilder().setColor(0x8BD5FF).setTitle("🪪 بصمة Eto")
        .setDescription("**"+item[0]+"**\n"+item[1])
        .setThumbnail(i.user.displayAvatarURL({size:256}))
        .setFooter({text:"وصف خيالي للتسلية، وليس حكماً على شخصيتك"});
      return i.reply({embeds:[embed]});
    }

    if(i.commandName==="عضو"){
      const user=i.options.getUser("العضو")||i.user;
      const member=await i.guild.members.fetch(user.id).catch(()=>null);
      const embed=new EmbedBuilder().setColor(0x7BC8F6).setTitle("👤 معلومات العضو")
        .setThumbnail(user.displayAvatarURL({size:256}))
        .addFields(
          {name:"الاسم",value:user.tag,inline:true},
          {name:"المعرف",value:user.id,inline:true},
          {name:"الحساب",value:"<t:"+Math.floor(user.createdTimestamp/1000)+":R>",inline:true},
          {name:"انضم للسيرفر",value:member?.joinedTimestamp?"<t:"+Math.floor(member.joinedTimestamp/1000)+":R>":"غير متاح",inline:true},
          {name:"البوت؟",value:user.bot?"نعم":"لا",inline:true}
        );
      return i.reply({embeds:[embed],flags:MessageFlags.Ephemeral});
    }

    if(i.commandName==="سيرفر"){
      const g=i.guild;
      const embed=new EmbedBuilder().setColor(0x7BC8F6).setTitle("🏠 "+g.name)
        .setThumbnail(g.iconURL({size:256}))
        .addFields(
          {name:"المالك",value:"<@"+g.ownerId+">",inline:true},
          {name:"الأعضاء",value:String(g.memberCount),inline:true},
          {name:"الرومات",value:String(g.channels.cache.size),inline:true},
          {name:"تاريخ الإنشاء",value:"<t:"+Math.floor(g.createdTimestamp/1000)+":D>",inline:true},
          {name:"المستوى",value:String(g.premiumTier),inline:true}
        );
      return i.reply({embeds:[embed],flags:MessageFlags.Ephemeral});
    }

    if(i.commandName==="مسح"){
      if(!i.memberPermissions?.has(PermissionFlagsBits.ManageMessages))
        return i.reply({content:"تحتاج صلاحية إدارة الرسائل.",flags:MessageFlags.Ephemeral});
      const amount=i.options.getInteger("العدد");
      const deleted=await i.channel.bulkDelete(amount,true);
      return i.reply({content:"🧹 تم حذف "+deleted.size+" رسالة. الرسائل الأقدم من 14 يوماً لا يمكن حذفها بهذه الطريقة.",flags:MessageFlags.Ephemeral});
    }

    if(i.commandName==="قفل"||i.commandName==="فتح"){
      if(!i.memberPermissions?.has(PermissionFlagsBits.ManageChannels))
        return i.reply({content:"تحتاج صلاحية إدارة القنوات.",flags:MessageFlags.Ephemeral});
      const lock=i.commandName==="قفل";
      await i.channel.permissionOverwrites.edit(i.guild.roles.everyone,{SendMessages:lock?false:null});
      return i.reply({content:lock?"🔒 تم قفل الكتابة في هذا الروم.":"🔓 تم فتح الكتابة وإزالة منع الكتابة العام.",flags:MessageFlags.Ephemeral});
    }

    if(i.commandName==="بطء"){
      if(!i.memberPermissions?.has(PermissionFlagsBits.ManageChannels))
        return i.reply({content:"تحتاج صلاحية إدارة القنوات.",flags:MessageFlags.Ephemeral});
      const seconds=i.options.getInteger("ثواني");
      await i.channel.setRateLimitPerUser(seconds);
      return i.reply({content:seconds?("🐢 تم ضبط مهلة إرسال الرسائل على "+seconds+" ثانية."):"تم إيقاف وضع البطء.",flags:MessageFlags.Ephemeral});
    }

    if(i.commandName==="مهلة"){
      if(!i.memberPermissions?.has(PermissionFlagsBits.ModerateMembers))
        return i.reply({content:"تحتاج صلاحية إدارة الأعضاء.",flags:MessageFlags.Ephemeral});
      const user=i.options.getUser("العضو"),minutes=i.options.getInteger("دقائق"),reason=i.options.getString("السبب")||"بدون سبب";
      if(user.id===i.user.id||user.id===client.user.id)return i.reply({content:"لا يمكن تطبيق المهلة على هذا الحساب.",flags:MessageFlags.Ephemeral});
      const member=await i.guild.members.fetch(user.id);
      await member.timeout(minutes*60000,reason);
      return i.reply({content:"⏳ تم إعطاء <@"+user.id+"> مهلة لمدة "+minutes+" دقيقة. السبب: "+reason});
    }

    if(i.commandName==="طرد"||i.commandName==="حظر"){
      const isBan=i.commandName==="حظر";
      const permission=isBan?PermissionFlagsBits.BanMembers:PermissionFlagsBits.KickMembers;
      if(!i.memberPermissions?.has(permission))
        return i.reply({content:isBan?"تحتاج صلاحية حظر الأعضاء.":"تحتاج صلاحية طرد الأعضاء.",flags:MessageFlags.Ephemeral});
      const user=i.options.getUser("العضو"),reason=i.options.getString("السبب")||"بدون سبب";
      if(user.id===i.user.id||user.id===client.user.id)return i.reply({content:"لا يمكن تنفيذ هذا الإجراء على هذا الحساب.",flags:MessageFlags.Ephemeral});
      const member=await i.guild.members.fetch(user.id);
      if(isBan)await member.ban({reason});else await member.kick(reason);
      return i.reply({content:(isBan?"🔨 تم حظر ":"👢 تم طرد ")+user.tag+". السبب: "+reason});
    }

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
      if(!url?.trim())return i.reply({content:"اكتب اسم أغنية أو رابطاً صالحاً.",flags:MessageFlags.Ephemeral});
      await i.deferReply({flags:MessageFlags.Ephemeral});
      const s=getSession(i.guild);
      s.voiceChannelId=voice.id;s.repeat=false;
      const title=await startMusic(s,url);
      return i.editReply({content:"🎵 بدأ التشغيل: **"+title.slice(0,180)+"**",components:musicControls(s,i.user.id)});
    }
  }catch(e){
    console.error(e);
    const msg=i.commandName==="موسيقى"?"تعذر تشغيل الموسيقى. "+(e.message||"تحقق من صلاحيات Connect وSpeak ومصدر الصوت."):"تعذر تنفيذ الأمر. تحقق من صلاحيات البوت وأن الرابط مدعوم.";
    if(i.deferred||i.replied)await i.followUp({content:msg,flags:MessageFlags.Ephemeral}).catch(()=>{});
    else await i.reply({content:msg,flags:MessageFlags.Ephemeral}).catch(()=>{});
  }
});

client.login(process.env.DISCORD_TOKEN);
