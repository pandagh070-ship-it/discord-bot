require("dotenv").config();
const fs=require("node:fs"),path=require("node:path");
const {Client,GatewayIntentBits,Events,PermissionFlagsBits,EmbedBuilder,MessageFlags}=require("discord.js");
const {joinVoiceChannel,createAudioPlayer,createAudioResource,VoiceConnectionStatus,entersState,NoSubscriberBehavior}=require("@discordjs/voice");
const play=require("play-dl");
if(!process.env.DISCORD_TOKEN)throw Error("DISCORD_TOKEN missing");
const client=new Client({intents:[GatewayIntentBits.Guilds,GatewayIntentBits.GuildVoiceStates]});
const dir=path.join(__dirname,"..","data"),file=path.join(dir,"engagement.json");
fs.mkdirSync(dir,{recursive:true});let cfg={};try{cfg=JSON.parse(fs.readFileSync(file,"utf8"))}catch{}
const timers=new Map(),sessions=new Map();
function save(){fs.writeFileSync(file,JSON.stringify(cfg,null,2))}
function schedule(id){
if(timers.has(id))clearInterval(timers.get(id));
const c=cfg[id];if(!c||!c.enabled)return;
const timer=setInterval(async()=>{try{const ch=await client.channels.fetch(c.channelId);if(ch&&ch.isTextBased())await ch.send({content:c.message,allowedMentions:{parse:["everyone"]}})}catch(e){console.error("Reminder:",e.message)}},7200000);
timers.set(id,timer);
}
function session(id){if(!sessions.has(id))sessions.set(id,{player:createAudioPlayer({behaviors:{noSubscriber:NoSubscriberBehavior.Pause}}),connection:null});return sessions.get(id)}
client.once(Events.ClientReady,()=>{console.log("Eto bot online as "+client.user.tag);for(const id of Object.keys(cfg))schedule(id)});
client.on(Events.InteractionCreate,async i=>{
if(!i.isChatInputCommand())return;
try{
if(i.commandName==="تفاعل"){
if(!i.memberPermissions.has(PermissionFlagsBits.ManageGuild))return i.reply({content:"تحتاج صلاحية إدارة السيرفر.",flags:MessageFlags.Ephemeral});
if(i.options.getSubcommand()==="تشغيل"){
const ch=i.options.getChannel("الروم"),message=i.options.getString("الرسالة")||"❄️ وقت التفاعل! شاركونا وجودكم في السيرفر.";
cfg[i.guildId]={enabled:true,channelId:ch.id,message};save();schedule(i.guildId);
return i.reply({content:"تم تشغيل التذكير في <#"+ch.id+">. سيبدأ الإرسال بعد ساعتين.",flags:MessageFlags.Ephemeral});
}
if(timers.has(i.guildId))clearInterval(timers.get(i.guildId));timers.delete(i.guildId);cfg[i.guildId]={...(cfg[i.guildId]||{}),enabled:false};save();
return i.reply({content:"تم إيقاف التذكير.",flags:MessageFlags.Ephemeral});
}
if(i.commandName==="تحذير"){
if(!i.memberPermissions.has(PermissionFlagsBits.ModerateMembers))return i.reply({content:"تحتاج صلاحية إدارة الأعضاء.",flags:MessageFlags.Ephemeral});
const user=i.options.getUser("العضو"),type=i.options.getString("النوع"),reason=i.options.getString("السبب"),log=i.options.getChannel("روم_السجل");
const label=type==="staff"?"تحذير إداري / موظف":"تحذير عضو";
const embed=new EmbedBuilder().setColor(type==="staff"?0xD9A441:0xD94B4B).setTitle("⚠️ تسجيل تحذير")
.addFields({name:"العضو",value:"<@"+user.id+"> ("+user.tag+")"},{name:"النوع",value:label,inline:true},{name:"بواسطة",value:"<@"+i.user.id+">",inline:true},{name:"السبب",value:reason}).setTimestamp();
await log.send({embeds:[embed]});let dm=true;
try{await user.send({embeds:[new EmbedBuilder().setColor(0xD94B4B).setTitle("⚠️ لديك تحذير في السيرفر").setDescription("السيرفر: "+i.guild.name+"\nالنوع: "+label+"\nالسبب: "+reason).setTimestamp()]})}catch{dm=false}
return i.reply({content:"تم تسجيل التحذير في <#"+log.id+">."+(dm?" وتم إرسال نسخة للخاص.":" لكن الخاص مغلق، ولم تصل رسالة DM."),flags:MessageFlags.Ephemeral});
}
if(i.commandName==="موسيقى"){
const s=session(i.guildId);
if(i.options.getSubcommand()==="ايقاف"){s.player.stop(true);if(s.connection)s.connection.destroy();sessions.delete(i.guildId);return i.reply({content:"تم إيقاف الموسيقى ومغادرة الروم.",flags:MessageFlags.Ephemeral})}
const member=await i.guild.members.fetch(i.user.id),voice=member.voice.channel;
if(!voice)return i.reply({content:"ادخل روم صوتي أولاً.",flags:MessageFlags.Ephemeral});
const url=i.options.getString("الرابط");if(!/^https:\/\//i.test(url))return i.reply({content:"أرسل رابط HTTPS صالحاً.",flags:MessageFlags.Ephemeral});
await i.deferReply({flags:MessageFlags.Ephemeral});
const stream=await play.stream(url);
if(s.connection)s.connection.destroy();
s.connection=joinVoiceChannel({channelId:voice.id,guildId:i.guildId,adapterCreator:i.guild.voiceAdapterCreator,selfDeaf:true});
s.connection.subscribe(s.player);await entersState(s.connection,VoiceConnectionStatus.Ready,20000);
s.player.play(createAudioResource(stream.stream,{inputType:stream.type}));
return i.editReply("🎵 بدأ التشغيل. استخدم /موسيقى ايقاف للمغادرة.");
}
}catch(e){console.error(e);const msg="تعذر تنفيذ الأمر. تحقق من صلاحيات البوت وأن الرابط مدعوم.";if(i.deferred||i.replied)await i.followUp({content:msg,flags:MessageFlags.Ephemeral}).catch(()=>{});else await i.reply({content:msg,flags:MessageFlags.Ephemeral}).catch(()=>{})}
});
client.login(process.env.DISCORD_TOKEN);
