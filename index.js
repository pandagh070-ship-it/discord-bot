const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const {
  Client, GatewayIntentBits, REST, Routes, PermissionsBitField,
  MessageFlags, EmbedBuilder
} = require('discord.js');

const {
  joinVoiceChannel, createAudioPlayer, createAudioResource,
  AudioPlayerStatus, NoSubscriberBehavior, StreamType
} = require('@discordjs/voice');

const ffmpegPath = require('ffmpeg-static');

process.on('uncaughtException', e => console.error('UNCAUGHT:', e));
process.on('unhandledRejection', e => console.error('UNHANDLED:', e));

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildPresences
  ]
});

const PORT = process.env.PORT || 10000;
const songsDir = path.join(__dirname, 'songs');
const musicStates = new Map();
const chatTimers = new Map();
const dmSubscribers = new Map();
const memberSetupMessages = new Map();
const logs = [];

function log(x) {
  const line = '[' + new Date().toISOString() + '] ' + x;
  logs.push(line);
  if (logs.length > 80) logs.shift();
  console.log(line);
}

if (!fs.existsSync(songsDir)) fs.mkdirSync(songsDir, { recursive: true });

function getSongs() {
  const files = fs.readdirSync(songsDir)
    .filter(f => /\.(m4a|mp3|wav|ogg|webm)$/i.test(f));
  const rootSongs = fs.readdirSync(__dirname)
    .filter(f => /\.(m4a|mp3|wav|ogg|webm)$/i.test(f));
  return [...new Set([...files.map(f => path.join('songs', f)), ...rootSongs])]
    .sort((a,b) => a.localeCompare(b));
}

function songLabel(file) {
  return path.basename(file).replace(/\.[^.]+$/, '');
}

function findSong(name) {
  const songs = getSongs();
  const exact = songs.find(f => songLabel(f).toLowerCase() === name.toLowerCase());
  if (exact) return exact;
  return songs.find(f => songLabel(f).toLowerCase().includes(name.toLowerCase()));
}

function perms(i, p) {
  return i.memberPermissions?.has(p) ?? false;
}

function member(i) {
  return i.guild?.members.cache.get(i.user.id);
}

function stopMusic(guildId) {
  const s = musicStates.get(guildId);
  if (!s) return false;
  try { s.player.stop(true); } catch {}
  try { s.ffmpeg?.kill('SIGKILL'); } catch {}
  try { s.connection.destroy(); } catch {}
  musicStates.delete(guildId);
  return true;
}

function startTrack(guildId) {
  const s = musicStates.get(guildId);
  if (!s || !s.queue.length) {
    if (s) {
      try { s.connection.destroy(); } catch {}
      musicStates.delete(guildId);
    }
    return;
  }

  const file = s.queue[0];
  const full = path.isAbsolute(file) ? file : path.join(__dirname, file);
  if (!fs.existsSync(full)) {
    s.queue.shift();
    return startTrack(guildId);
  }

  try { s.ffmpeg?.kill('SIGKILL'); } catch {}

  const ffmpeg = spawn(ffmpegPath, [
    '-hide_banner','-loglevel','error','-i',full,'-vn',
    '-ac','2','-ar','48000','-c:a','libopus','-b:a','128k',
    '-f','ogg','pipe:1'
  ]);

  const resource = createAudioResource(ffmpeg.stdout, { inputType: StreamType.OggOpus });
  s.ffmpeg = ffmpeg;
  s.player.play(resource);
  s.current = file;
  log('Playing ' + songLabel(file) + ' in ' + guildId);

  ffmpeg.on('error', e => log('FFmpeg error: ' + e.message));
  s.player.once(AudioPlayerStatus.Idle, () => {
    if (musicStates.get(guildId) !== s) return;
    try { ffmpeg.kill(); } catch {}
    if (s.repeat) {
      startTrack(guildId);
      return;
    }
    s.queue.shift();
    startTrack(guildId);
  });
}

function playSong(memberObj, file, guildId) {
  if (!memberObj?.voice?.channel) throw new Error('VOICE_REQUIRED');

  let s = musicStates.get(guildId);
  if (s) stopMusic(guildId);

  const channel = memberObj.voice.channel;
  const connection = joinVoiceChannel({
    channelId: channel.id,
    guildId,
    adapterCreator: channel.guild.voiceAdapterCreator,
    selfDeaf: false,
    selfMute: false
  });
  const player = createAudioPlayer({
    behaviors: { noSubscriber: NoSubscriberBehavior.Play }
  });

  s = { connection, player, queue: [file], repeat: false, current: file, ffmpeg: null };
  musicStates.set(guildId, s);
  connection.subscribe(player);
  player.on('error', e => log('Audio error: ' + e.message));
  startTrack(guildId);
}

function queueSong(guildId, file) {
  const s = musicStates.get(guildId);
  if (!s) return false;
  s.queue.push(file);
  return true;
}

http.createServer((req,res) => {
  if (req.url === '/health') {
    const ok = client.isReady();
    res.writeHead(ok ? 200 : 503, {'Content-Type':'application/json'});
    return res.end(JSON.stringify({ok, discord: ok ? 'connected':'disconnected', songs:getSongs().length}));
  }
  res.writeHead(200, {'Content-Type':'text/plain'});
  res.end('Discord bot is online.');
}).listen(PORT, '0.0.0.0', () => log('HTTP server listening on ' + PORT));

client.once('clientReady', async () => {
  log('Bot online as ' + client.user.tag);

  const commands = [
    {name:'ping',description:'عرض سرعة البوت'},
    {name:'join',description:'دخول الروم الصوتي'},
    {name:'play_music',description:'تشغيل أغنية من قائمة الأغاني',options:[{name:'song',description:'اسم الأغنية',type:3,required:true,autocomplete:true}]},
    {name:'music_list',description:'عرض الأغاني المتوفرة'},
    {name:'music_next',description:'تشغيل الأغنية التالية'},
    {name:'music_repeat',description:'تفعيل أو إيقاف تكرار الأغنية'},
    {name:'music_stop',description:'إيقاف الموسيقى والخروج'},
    {name:'queue',description:'عرض قائمة الانتظار'},
    {name:'coinflip',description:'عملة: صورة أو كتابة'},
    {name:'roll',description:'رمي نرد'},
    {name:'rps',description:'حجر ورق مقص',options:[{name:'choice',description:'اختيارك',type:3,required:true,choices:[{name:'حجر',value:'rock'},{name:'ورق',value:'paper'},{name:'مقص',value:'scissors'}]}]},
    {name:'8ball',description:'اسأل الكرة السحرية',options:[{name:'question',description:'سؤالك',type:3,required:true}]},
    {name:'slots',description:'لعبة الحظ'},
    {name:'serverinfo',description:'معلومات السيرفر'},
    {name:'userinfo',description:'معلومات عضو',options:[{name:'user',description:'العضو',type:6,required:false}]},
    {name:'avatar',description:'عرض صورة عضو',options:[{name:'user',description:'العضو',type:6,required:false}]},
    {name:'invite',description:'رابط إضافة البوت'},
    {name:'kick',description:'طرد عضو',options:[{name:'user',description:'العضو',type:6,required:true}]},
    {name:'ban',description:'حظر عضو',options:[{name:'user',description:'العضو',type:6,required:true}]},
    {name:'clear',description:'حذف رسائل',options:[{name:'amount',description:'1-100',type:4,required:true,min_value:1,max_value:100}]},
    {name:'slowmode',description:'تغيير Slowmode',options:[{name:'seconds',description:'0-21600',type:4,required:true,min_value:0,max_value:21600}]},
    {name:'chat_lock',description:'قفل الدردشة',options:[{name:'reason',description:'السبب',type:3,required:false}]},
    {name:'chat_unlock',description:'فتح الدردشة'},
    {name:'setup_chat',description:'تذكير تفاعل كل 5 ساعات'},
    {name:'stop_chat',description:'إيقاف تذكير التفاعل'},
    {name:'setup_members',description:'عداد الأعضاء النشطين'},
    {name:'dm_subscribe',description:'الاشتراك في إعلانات الخاص'},
    {name:'dm_unsubscribe',description:'إلغاء الاشتراك'},
    {name:'subscribers',description:'عرض المشتركين'},
    {name:'sandall',description:'إرسال إعلان للمشتركين',options:[{name:'message',description:'الإعلان',type:3,required:true}]},
    {name:'sand',description:'إرسال خاص لعضو',options:[{name:'member',description:'العضو',type:6,required:true},{name:'message',description:'الرسالة',type:3,required:true}]},
    {name:'log',description:'عرض سجلات البوت'}
  ];

  try {
    const rest = new REST({version:'10'}).setToken(process.env.DISCORD_TOKEN);
    await rest.put(Routes.applicationCommands(client.user.id), {body:commands});
    log('Global slash commands registered: ' + commands.length);
  } catch(e) {
    log('Command registration error: ' + e.message);
  }
});

client.on('interactionCreate', async i => {
  try {
    if (i.isAutocomplete()) {
      if (i.commandName !== 'play_music') return;
      const q = (i.options.getString('song') || '').toLowerCase();
      const choices = getSongs().filter(f => songLabel(f).toLowerCase().includes(q)).slice(0,25)
        .map(f => ({name:songLabel(f).slice(0,100),value:songLabel(f).slice(0,100)}));
      return i.respond(choices);
    }

    if (!i.isChatInputCommand()) return;
    const c = i.commandName;

    if (c === 'ping') return i.reply('🏓 Pong! ' + Math.round(client.ws.ping) + 'ms');

    if (c === 'music_list') {
      const songs = getSongs();
      return i.reply(songs.length ? '🎵 **الأغاني المتوفرة:**\n' + songs.map((s,n)=>`${n+1}. ${songLabel(s)}`).join('\n') : '📭 ما فيه أغاني. أضف ملفات إلى مجلد songs.');
    }

    if (c === 'play_music') {
      const m = member(i);
      if (!m?.voice?.channel) return i.reply({content:'🎙️ ادخل الروم الصوتي أولاً.',flags:MessageFlags.Ephemeral});
      const name = i.options.getString('song',true);
      const file = findSong(name);
      if (!file) return i.reply({content:'❌ الأغنية غير موجودة. استخدم /music_list.',flags:MessageFlags.Ephemeral});
      await i.deferReply();
      playSong(m,file,i.guildId);
      return i.editReply('🎵 شغلت **' + songLabel(file) + '**');
    }

    if (c === 'music_next') {
      const s = musicStates.get(i.guildId);
      if (!s) return i.reply('❌ ما فيه أغنية شغالة.');
      if (s.queue.length > 1) s.queue.shift();
      else if (s.repeat) {}
      else s.queue = [];
      if (!s.queue.length) return i.reply('⏹️ انتهت قائمة التشغيل.');
      startTrack(i.guildId);
      return i.reply('⏭️ الأغنية التالية: **' + songLabel(s.queue[0]) + '**');
    }

    if (c === 'music_repeat') {
      const s = musicStates.get(i.guildId);
      if (!s) return i.reply('❌ شغل أغنية أولاً.');
      s.repeat = !s.repeat;
      return i.reply(s.repeat ? '🔁 التكرار: **تشغيل**' : '➡️ التكرار: **إيقاف**');
    }

    if (c === 'music_stop') {
      return i.reply(stopMusic(i.guildId) ? '⏹️ تم إيقاف الموسيقى.' : 'ما فيه موسيقى شغالة.');
    }

    if (c === 'queue') {
      const s = musicStates.get(i.guildId);
      if (!s) return i.reply('📭 القائمة فارغة.');
      return i.reply('🎶 **الآن:** ' + songLabel(s.current) + '\n' + (s.queue.slice(1).map((x,n)=>`${n+1}. ${songLabel(x)}`).join('\n') || 'لا توجد أغاني بعدها.'));
    }

    if (c === 'join') {
      const m = member(i);
      if (!m?.voice?.channel) return i.reply('🎙️ ادخل الروم أولاً.');
      joinVoiceChannel({channelId:m.voice.channel.id,guildId:i.guildId,adapterCreator:i.guild.voiceAdapterCreator,selfDeaf:false,selfMute:false});
      return i.reply('🎙️ دخلت الروم.');
    }

    if (c === 'coinflip') return i.reply(Math.random()<0.5 ? '🪙 **صورة**' : '🪙 **كتابة**');
    if (c === 'roll') return i.reply('🎲 النتيجة: **' + (Math.floor(Math.random()*6)+1) + '**');

    if (c === 'rps') {
      const user=i.options.getString('choice',true);
      const bot=['rock','paper','scissors'][Math.floor(Math.random()*3)];
      const win=(user==='rock'&&bot==='scissors')||(user==='paper'&&bot==='rock')||(user==='scissors'&&bot==='paper');
      const names={rock:'حجر 🪨',paper:'ورق 📄',scissors:'مقص ✂️'};
      return i.reply('أنت: **'+names[user]+'**\nأنا: **'+names[bot]+'**\n\n'+(user===bot?'🤝 تعادل':win?'🏆 فزت!':'🤖 أنا فزت!'));
    }

    if (c === '8ball') {
      const answers=['نعم ✅','لا ❌','غالباً 🔮','ممكن 🤔','أكيد 💯','لا أظن 🌀','اسألني لاحقاً ⏳'];
      return i.reply('🎱 ' + answers[Math.floor(Math.random()*answers.length)]);
    }

    if (c === 'slots') {
      const a=['🍒','🍋','🍉','⭐','7️⃣'];
      const x=[0,0,0].map(()=>a[Math.floor(Math.random()*a.length)]);
      return i.reply(x.join(' | ') + '\n' + (x[0]===x[1]&&x[1]===x[2]?'🎉 جاكبوت!':'😅 حاول مرة ثانية'));
    }

    if (c === 'serverinfo') return i.reply(`🏠 **${i.guild.name}**\n👥 الأعضاء: **${i.guild.memberCount}**\n📝 الرومات: **${i.guild.channels.cache.size}**\n🎭 الرتب: **${i.guild.roles.cache.size}**`);

    if (c === 'userinfo' || c === 'avatar') {
      const u=i.options.getUser('user') || i.user;
      if (c==='avatar') return i.reply(u.displayAvatarURL({size:1024}));
      const m=i.guild.members.cache.get(u.id);
      return i.reply(`👤 **${u.tag}**\n🆔 ${u.id}\n🎭 ${m?.roles?.highest?.name || 'غير معروف'}`);
    }

    if (c === 'invite') {
      const url=`https://discord.com/oauth2/authorize?client_id=${client.user.id}&scope=bot%20applications.commands&permissions=8`;
      return i.reply({content:'🤖 إضافة البوت:\n'+url,flags:MessageFlags.Ephemeral});
    }

    if (c==='kick' || c==='ban') {
      const permission=c==='kick'?PermissionsBitField.Flags.KickMembers:PermissionsBitField.Flags.BanMembers;
      if (!perms(i,permission)) return i.reply({content:'❌ ما عندك الصلاحية المطلوبة.',flags:MessageFlags.Ephemeral});
      const u=i.options.getUser('user',true);
      const m=i.guild.members.cache.get(u.id);
      if (u.id===i.user.id) return i.reply({content:'❌ لا يمكنك استخدام الأمر على نفسك.',flags:MessageFlags.Ephemeral});
      if (m && !(c==='kick'?m.kickable:m.bannable)) return i.reply({content:'❌ رتبة البوت يجب أن تكون أعلى من العضو.',flags:MessageFlags.Ephemeral});
      if (c==='kick') await m.kick('Discord bot /kick by '+i.user.tag);
      else await i.guild.members.ban(u.id,{reason:'Discord bot /ban by '+i.user.tag});
      return i.reply((c==='kick'?'👢 تم طرد ':'🔨 تم حظر ')+ '**'+u.tag+'**');
    }

    if (c==='clear') {
      if (!perms(i,PermissionsBitField.Flags.ManageMessages)) return i.reply({content:'❌ تحتاج Manage Messages.',flags:MessageFlags.Ephemeral});
      await i.deferReply({flags:MessageFlags.Ephemeral});
      const n=i.options.getInteger('amount',true);
      const deleted=await i.channel.bulkDelete(n,true);
      return i.editReply('🧹 تم حذف **'+deleted.size+'** رسالة.');
    }

    if (c==='slowmode') {
      if (!perms(i,PermissionsBitField.Flags.ManageChannels)) return i.reply({content:'❌ تحتاج Manage Channels.',flags:MessageFlags.Ephemeral});
      const n=i.options.getInteger('seconds',true);
      await i.channel.setRateLimitPerUser(n);
      return i.reply('🐢 Slowmode: **'+n+' ثانية**.');
    }

    if (c==='chat_lock' || c==='chat_unlock') {
      if (!perms(i,PermissionsBitField.Flags.ManageChannels)) return i.reply({content:'❌ تحتاج Manage Channels.',flags:MessageFlags.Ephemeral});
      await i.channel.permissionOverwrites.edit(i.guild.roles.everyone,{SendMessages:c==='chat_lock'?false:null});
      return i.reply(c==='chat_lock'?'🔒 تم قفل الدردشة.':'🔓 تم فتح الدردشة.');
    }

    if (c==='setup_chat') {
      if (!perms(i,PermissionsBitField.Flags.ManageGuild)) return i.reply({content:'❌ تحتاج Manage Server.',flags:MessageFlags.Ephemeral});
      if (chatTimers.has(i.channelId)) clearInterval(chatTimers.get(i.channelId));
      const timer=setInterval(async()=>{try{await i.channel.send('@everyone تفاعلو 📢')}catch(e){log(e.message)}},5*60*60*1000);
      chatTimers.set(i.channelId,timer);
      return i.reply('📢 تم تشغيل التذكير كل 5 ساعات.');
    }

    if (c==='stop_chat') {
      if (!perms(i,PermissionsBitField.Flags.ManageGuild)) return i.reply({content:'❌ تحتاج Manage Server.',flags:MessageFlags.Ephemeral});
      const t=chatTimers.get(i.channelId);
      if (!t) return i.reply('ℹ️ ما فيه تذكير شغال هنا.');
      clearInterval(t); chatTimers.delete(i.channelId);
      return i.reply('🛑 تم إيقاف التذكير.');
    }

    if (c==='dm_subscribe' || c==='dm_unsubscribe') {
      const set=dmSubscribers.get(i.guildId)||new Set();
      if(c==='dm_subscribe') set.add(i.user.id); else set.delete(i.user.id);
      dmSubscribers.set(i.guildId,set);
      return i.reply({content:c==='dm_subscribe'?'✅ تم اشتراكك.':'✅ تم إلغاء الاشتراك.',flags:MessageFlags.Ephemeral});
    }

    if (c==='subscribers') {
      const set=dmSubscribers.get(i.guildId)||new Set();
      return i.reply({content:set.size?'📬 المشتركين: '+[...set].map(x=>'<@'+x+'>').join(', '):'📭 لا يوجد مشتركين.',flags:MessageFlags.Ephemeral});
    }

    if (c==='sand' || c==='sandall') {
      if (!perms(i,PermissionsBitField.Flags.ManageGuild)) return i.reply({content:'❌ تحتاج Manage Server.',flags:MessageFlags.Ephemeral});
      await i.deferReply({flags:MessageFlags.Ephemeral});
      const text=i.options.getString('message',true);
      let sent=0, failed=0;
      const ids=c==='sandall'?[...(dmSubscribers.get(i.guildId)||new Set())]:[i.options.getUser('member',true).id];
      for(const id of ids){try{const u=await client.users.fetch(id);await u.send('📢 **إعلان من '+i.guild.name+'**\\n\\n'+text);sent++}catch{failed++}}
      return i.editReply('✅ أُرسلت: **'+sent+'** | ❌ فشلت: **'+failed+'**');
    }

    if (c==='log') {
      if (!perms(i,PermissionsBitField.Flags.ManageGuild)) return i.reply({content:'❌ تحتاج Manage Server.',flags:MessageFlags.Ephemeral});
      return i.reply({content:'```\n'+logs.slice(-20).join('\n').slice(0,1800)+'\n```',flags:MessageFlags.Ephemeral});
    }
  } catch(e) {
    log('Interaction error: '+e.stack);
    if (!i.replied && !i.deferred) await i.reply({content:'❌ صار خطأ أثناء تنفيذ الأمر.',flags:MessageFlags.Ephemeral}).catch(()=>{});
    else if (i.deferred) await i.editReply('❌ صار خطأ أثناء تنفيذ الأمر.').catch(()=>{});
  }
});

client.on('error', e=>log('Discord error: '+e.message));

const token=process.env.DISCORD_TOKEN?.trim();
if(!token){log('DISCORD_TOKEN missing');process.exit(1);}
log('DISCORD_TOKEN loaded');
client.login(token).catch(e=>{log('Login failed: '+e.message);process.exit(1);});
