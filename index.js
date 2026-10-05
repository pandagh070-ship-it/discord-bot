require('dotenv').config();
const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const {
  Client, GatewayIntentBits, REST, Routes, PermissionsBitField,
  MessageFlags, EmbedBuilder, ActionRowBuilder, StringSelectMenuBuilder, ButtonBuilder, ButtonStyle
} = require('discord.js');

const {
  joinVoiceChannel, createAudioPlayer, createAudioResource, entersState, VoiceConnectionStatus,
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
const effectsDir = path.join(__dirname, 'effects');
const musicStates = new Map();
const chatTimers = new Map();
const dmSubscribers = new Map();
const memberSetupMessages = new Map();
const logs = [];
const gameLobbies = new Map();
const rpsGames = new Map();
const battleGames = new Map();
const effectStates = new Map();

function log(x) {
  const line = '[' + new Date().toISOString() + '] ' + x;
  logs.push(line);
  if (logs.length > 80) logs.shift();
  console.log(line);
}

if (!fs.existsSync(songsDir)) fs.mkdirSync(songsDir, { recursive: true });
if (!fs.existsSync(effectsDir)) fs.mkdirSync(effectsDir, { recursive: true });

function getSongs() {
  const files = fs.readdirSync(songsDir)
    .filter(f => /\.(m4a|mp3|wav|ogg|webm)$/i.test(f));
  const rootSongs = fs.readdirSync(__dirname)
    .filter(f => /\.(m4a|mp3|wav|ogg|webm)$/i.test(f));
  return [...new Set([...files.map(f => path.join('songs', f)), ...rootSongs])]
    .sort((a,b) => a.localeCompare(b));
}


function getEffectFiles() {
  if (!fs.existsSync(effectsDir)) return [];
  return fs.readdirSync(effectsDir)
    .filter(f => /\.(m4a|mp3|wav|ogg|webm)$/i.test(f))
    .map(f => path.join('effects', f))
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
  ffmpeg.stderr.on('data', d => log('FFmpeg: ' + d.toString().trim()));
  ffmpeg.on('close', code => { if (code !== 0) log('FFmpeg exited with code ' + code); });
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



function battleDamage() {
  const attacks = [
    {damage:10, weight:25},
    {damage:20, weight:20},
    {damage:30, weight:12},
    {damage:40, weight:5},
    {damage:50, weight:2}
  ];
  const total = attacks.reduce((n,a)=>n+a.weight,0);
  let roll = Math.random()*total;
  for (const attack of attacks) {
    roll -= attack.weight;
    if (roll < 0) return attack.damage;
  }
  return 10;
}

function battleRow() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('battle_attack').setLabel('هجوم ⚔️').setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId('battle_heal').setLabel('استرجاع ❤️').setStyle(ButtonStyle.Success)
  );
}

async function playVoiceEffect(memberObj, file, guildId) {
  if (!memberObj?.voice?.channel) throw new Error('VOICE_REQUIRED');

  const old = effectStates.get(guildId);
  if (old) {
    try { old.player.stop(true); } catch {}
    try { old.ffmpeg?.kill('SIGKILL'); } catch {}
    try { old.connection.destroy(); } catch {}
    effectStates.delete(guildId);
  }

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

  const state = { connection, player, ffmpeg: null };
  effectStates.set(guildId, state);
  connection.subscribe(player);

  player.on('error', e => log('Effect audio error: ' + e.message));

  await entersState(connection, VoiceConnectionStatus.Ready, 15000);

  const full = path.isAbsolute(file) ? file : path.join(__dirname, file);
  if (!fs.existsSync(full)) {
    try { connection.destroy(); } catch {}
    effectStates.delete(guildId);
    throw new Error('EFFECT_FILE_NOT_FOUND');
  }

  const ffmpeg = spawn(ffmpegPath, [
    '-hide_banner','-loglevel','error','-i',full,'-vn',
    '-ac','2','-ar','48000','-filter:a','volume=3.0','-c:a','libopus','-b:a','128k',
    '-f','ogg','pipe:1'
  ]);

  state.ffmpeg = ffmpeg;
  const resource = createAudioResource(ffmpeg.stdout, { inputType: StreamType.OggOpus });

  ffmpeg.stderr.on('data', d => log('Effect FFmpeg: ' + d.toString().trim()));
  ffmpeg.on('error', e => log('Effect FFmpeg error: ' + e.message));
  ffmpeg.on('close', code => {
    if (code !== 0) log('Effect FFmpeg exited with code ' + code);
  });

  player.play(resource);
  log('Playing effect ' + songLabel(file) + ' in ' + guildId);

  player.once(AudioPlayerStatus.Idle, () => {
    if (effectStates.get(guildId) !== state) return;
    try { ffmpeg.kill(); } catch {}
    try { connection.destroy(); } catch {}
    effectStates.delete(guildId);
    log('Effect finished, left voice in ' + guildId);
  });
}

async function playSong(memberObj, file, guildId) {
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
  await entersState(connection, VoiceConnectionStatus.Ready, 15000);
  log('Voice connection ready in ' + guildId);
  startTrack(guildId);
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
    {name:'play_music',description:'اختيار وتشغيل أغنية'},
    {name:'music_stop',description:'إيقاف الموسيقى والخروج'},
    {name:'games',description:'فتح قائمة الألعاب'},
    {name:'effects',description:'تشغيل مؤثر صوتي داخل الفويس'},
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
    if (i.isStringSelectMenu() && i.customId === 'music_pick') {
      const m = member(i);
      if (!m?.voice?.channel) return i.reply({content:'🎙️ ادخل الروم الصوتي أولاً.',flags:MessageFlags.Ephemeral});
      const songs = getSongs(), file = songs[Number(i.values[0])];
      if (!file) return i.reply({content:'❌ الأغنية غير موجودة.',flags:MessageFlags.Ephemeral});
      try {
        await playSong(m,file,i.guildId);
        return i.update({content:'🎵 شغالة الآن: **'+songLabel(file)+'**',components:[]});
      } catch(e) {
        log('Music start error: '+e.stack);
        return i.update({content:'❌ فشل تشغيل الأغنية: '+e.message,components:[]});
      }
    }

    if (i.isButton() && i.customId === 'music_stop_btn') {
      stopMusic(i.guildId);
      return i.update({content:'⏹️ تم إيقاف الموسيقى وخروج البوت.',components:[]});
    }


    if (i.isStringSelectMenu() && i.customId === 'effects_menu') {
      const m = member(i);
      if (!m?.voice?.channel) {
        return i.update({content:'🎙️ ادخل الروم الصوتي أولاً.',components:[]});
      }

      const effects = getEffectFiles();
      const file = effects[Number(i.values[0])];
      if (!file) {
        return i.update({content:'❌ المؤثر غير موجود.',components:[]});
      }

      try {
        await playVoiceEffect(m, file, i.guildId);
        return i.update({content:'🔊 تم تشغيل المؤثر: **' + songLabel(file) + '**\\n🚪 البوت سيخرج تلقائياً بعد انتهاء الصوت.',components:[]});
      } catch(e) {
        log('Effect start error: ' + e.stack);
        return i.update({content:'❌ فشل تشغيل المؤثر الصوتي.',components:[]});
      }
    }

    // Games UI
    if (i.isStringSelectMenu() && i.customId === 'games_menu') {
      const choice = i.values[0];
      if (choice === 'rps_bot') {
        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId('rps_bot_rock').setLabel('حجر').setEmoji('🪨').setStyle(ButtonStyle.Primary),
          new ButtonBuilder().setCustomId('rps_bot_paper').setLabel('ورقة').setEmoji('📄').setStyle(ButtonStyle.Primary),
          new ButtonBuilder().setCustomId('rps_bot_scissors').setLabel('مقص').setEmoji('✂️').setStyle(ButtonStyle.Primary)
        );
        return i.update({content:'🪨📄✂️ اختر حركتك ضد البوت:',components:[row]});
      }
      if (choice === 'rps_player') {
        const key = i.guildId + ':rps';
        const old = rpsGames.get(key);
        if (old) return i.update({content:'⏳ توجد مباراة حجر ورقة مقص تنتظر لاعباً آخر.',components:[new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('rps_join').setLabel('انضم للمباراة').setStyle(ButtonStyle.Success))]});
        rpsGames.set(key,{host:i.user.id,player:null,channelId:i.channelId});
        return i.update({content:'🪨📄✂️ تم إنشاء مباراة ضد لاعب. اضغط انضمام.',components:[new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('rps_join').setLabel('انضم للمباراة').setStyle(ButtonStyle.Success))]});
      }
      if (choice === 'battle') {
        const channel = i.member?.voice?.channel;
        if (!channel) return i.update({content:'🎙️ لازم تدخل روم فويس أولاً.',components:[]});
        const members = [...channel.members.values()].filter(m => !m.user.bot);
        if (members.length !== 2) return i.update({content:'⚔️ لازم يكون **لاعبين اثنين فقط** في نفس روم الفويس.',components:[]});
        const key = i.guildId + ':battle';
        if (battleGames.has(key)) return i.update({content:'⚔️ توجد معركة شغالة بالفعل.',components:[]});
        const [p1,p2]=members;
        const song=findSong('GOJO');
        if (!song) return i.update({content:'❌ ما لقيت أغنية القتال في مجلد songs.',components:[]});
        try {
          await playSong(i.member, song, i.guildId);
        } catch(e) {
          log('Battle music start error: '+e.stack);
          return i.update({content:'❌ فشل دخول البوت للروم أو تشغيل أغنية القتال.',components:[]});
        }
        const g={guildId:i.guildId,channelId:i.channelId,voiceChannelId:channel.id,players:[p1.id,p2.id],hp:{[p1.id]:100,[p2.id]:100},turn:p1.id,song};
        battleGames.set(key,g);
        const row=new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId('battle_attack').setLabel('هجوم ⚔️').setStyle(ButtonStyle.Danger),
          new ButtonBuilder().setCustomId('battle_heal').setLabel('استرجاع ❤️').setStyle(ButtonStyle.Success)
        );
        return i.update({content:'⚔️ **بدأت معركة اللاعبين!**\\n🎙️ الروم: <#'+channel.id+'>\\n👤 <@'+p1.id+'> ضد <@'+p2.id+'>\\n\\n❤️ كل لاعب يبدأ بـ **100 HP**\\n🎵 البوت دخل الروم وشغّل أغنية القتال.\\n\\n🎯 الدور الآن: <@'+g.turn+'>',components:[row]});
      }

      if (choice === 'mafia') {
        const key = i.guildId + ':mafia';
        let g = gameLobbies.get(key);
        if (!g) {
          g={host:i.user.id,players:new Set([i.user.id]),channelId:i.channelId};
          gameLobbies.set(key,g);
        }
        return i.update({content:'🔪 **مافيا**\nاللاعبون: **'+g.players.size+'**\nالحد الأدنى: **4 لاعبين**\n\nانضموا ثم اضغطوا بدء اللعبة.',components:[
          new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('mafia_join').setLabel('انضم').setEmoji('👤').setStyle(ButtonStyle.Success),
            new ButtonBuilder().setCustomId('mafia_start').setLabel('بدء اللعبة').setEmoji('▶️').setStyle(ButtonStyle.Primary)
          )
        ]});
      }
    }

    if (i.isButton() && i.customId.startsWith('rps_bot_')) {
      const userMove=i.customId.replace('rps_bot_','');
      const botMove=['rock','paper','scissors'][Math.floor(Math.random()*3)];
      const beats={rock:'scissors',paper:'rock',scissors:'paper'};
      const names={rock:'🪨 حجر',paper:'📄 ورقة',scissors:'✂️ مقص'};
      const result=userMove===botMove?'🤝 تعادل':beats[userMove]===botMove?'🏆 فزت!':'🤖 البوت فاز!';
      return i.update({content:'🪨📄✂️ **حجر ورقة مقص**\nأنت: '+names[userMove]+'\nالبوت: '+names[botMove]+'\n\n'+result,components:[]});
    }

    if (i.isButton() && i.customId === 'rps_join') {
      const key=i.guildId+':rps', g=rpsGames.get(key);
      if (!g) return i.reply({content:'❌ المباراة انتهت.',flags:MessageFlags.Ephemeral});
      if (g.host===i.user.id) return i.reply({content:'❌ أنت منشئ المباراة.',flags:MessageFlags.Ephemeral});
      if (g.player) return i.reply({content:'❌ المباراة مكتملة.',flags:MessageFlags.Ephemeral});
      g.player=i.user.id;
      const row=new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('rps_pick_rock').setLabel('حجر').setEmoji('🪨').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId('rps_pick_paper').setLabel('ورقة').setEmoji('📄').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId('rps_pick_scissors').setLabel('مقص').setEmoji('✂️').setStyle(ButtonStyle.Primary)
      );
      return i.update({content:'🪨📄✂️ **المباراة بدأت!**\n<@'+g.host+'> و <@'+g.player+'>\nكل لاعب يضغط حركته. الاختيارات سرية.',components:[row]});
    }

    if (i.isButton() && i.customId.startsWith('rps_pick_')) {
      const key=i.guildId+':rps', g=rpsGames.get(key);
      if (!g || !g.player) return i.reply({content:'❌ لا توجد مباراة نشطة.',flags:MessageFlags.Ephemeral});
      if (i.user.id!==g.host && i.user.id!==g.player) return i.reply({content:'❌ لست من لاعبي المباراة.',flags:MessageFlags.Ephemeral});
      const move=i.customId.replace('rps_pick_','');
      g.moves=g.moves||{};
      g.moves[i.user.id]=move;
      await i.reply({content:'✅ تم تسجيل حركتك.',flags:MessageFlags.Ephemeral});
      if (g.moves[g.host] && g.moves[g.player]) {
        const a=g.moves[g.host], b=g.moves[g.player], beats={rock:'scissors',paper:'rock',scissors:'paper'};
        const names={rock:'🪨 حجر',paper:'📄 ورقة',scissors:'✂️ مقص'};
        const result=a===b?'🤝 تعادل':beats[a]===b?'<@'+g.host+'> 🏆 فاز!':'<@'+g.player+'> 🏆 فاز!';
        await i.channel.send('🪨📄✂️ **نتيجة المباراة**\n<@'+g.host+'>: '+names[a]+'\n<@'+g.player+'>: '+names[b]+'\n'+result);
        rpsGames.delete(key);
      }
      return;
    }

    if (i.isButton() && (i.customId === 'battle_attack' || i.customId === 'battle_heal')) {
      const key=i.guildId+':battle', g=battleGames.get(key);
      if (!g) return i.reply({content:'❌ لا توجد معركة نشطة.',flags:MessageFlags.Ephemeral});
      const channel=i.guild.channels.cache.get(g.voiceChannelId);
      const voiceMember=channel?.members?.get(i.user.id);
      if (!g.players.includes(i.user.id)) return i.reply({content:'❌ أنت لست من لاعبي المعركة.',flags:MessageFlags.Ephemeral});
      if (i.user.id!==g.turn) return i.reply({content:'⏳ ليس دورك الآن.',flags:MessageFlags.Ephemeral});
      if (!voiceMember) return i.reply({content:'🎙️ يجب أن تبقى داخل روم الفويس أثناء المعركة.',flags:MessageFlags.Ephemeral});

      const enemy=g.players.find(id=>id!==i.user.id);
      if (i.customId==='battle_attack') {
        const damage=battleDamage();
        g.hp[enemy]=Math.max(0,g.hp[enemy]-damage);

        if (g.hp[enemy]===0) {
          stopMusic(i.guildId);
          battleGames.delete(key);
          return i.update({
            content:'🏆 **━━━━━━━━ انتهت المعركة ━━━━━━━━**🏆\\n\\n⚔️ <@'+i.user.id+'> وجّه ضربة بقوة **'+damage+'**!\\n💀 <@'+enemy+'> سقط في المعركة.\\n\\n🎵 تم إيقاف موسيقى القتال.\\n🚪 البوت غادر الروم.\\n\\n🏆 الفائز: <@'+i.user.id+'>',
            components:[]
          });
        }

        g.turn=enemy;
        return i.update({
          content:'⚔️ **━━━━━━━━ معركة اللاعبين ━━━━━━━━** ⚔️\\n\\n👤 <@'+i.user.id+'>\\n♥️ الصحة: **'+g.hp[i.user.id]+'**\\n\\n⚔️ الهجوم: **-'+damage+'**\\n💥 الضرر يتراوح من **10 إلى 50**\\n📉 الضربات الأقوى احتمالها أقل.\\n\\n👤 <@'+enemy+'>\\n♥️ الصحة: **'+g.hp[enemy]+'**\\n\\n━━━━━━━━━━━━━━━━━━━━\\n🎯 الدور الآن: <@'+g.turn+'>\\n\\n⚔️ **هجوم** = ضرر عشوائي\\n❤️ **استرجاع** = +10 إلى +20 HP\\n📌 الحد الأقصى للصحة: **100**',
          components:[battleRow()]
        });
      }

      const heal=Math.floor(Math.random()*11)+10;
      const before=g.hp[i.user.id];
      g.hp[i.user.id]=Math.min(100,g.hp[i.user.id]+heal);
      const actualHeal=g.hp[i.user.id]-before;
      g.turn=enemy;
      return i.update({
        content:'❤️ **━━━━━━━━ استرجاع ━━━━━━━━** ❤️\\n\\n👤 <@'+i.user.id+'>\\n♥️ الصحة: **'+before+' → '+g.hp[i.user.id]+'**\\n✨ استعاد **+'+actualHeal+' HP**\\n\\n👤 <@'+enemy+'>\\n♥️ الصحة: **'+g.hp[enemy]+'**\\n\\n━━━━━━━━━━━━━━━━━━━━\\n🎯 الدور الآن: <@'+g.turn+'>\\n\\n⚔️ الهجوم: **10–50**\\n❤️ الاسترجاع: **10–20**\\n🏁 الهدف: خفّض صحة خصمك إلى **0**',
        components:[battleRow()]
      });
    }

    if (i.isButton() && i.customId === 'mafia_join') {
      const key=i.guildId+':mafia', g=gameLobbies.get(key);
      if (!g) return i.reply({content:'❌ لا توجد غرفة مافيا.',flags:MessageFlags.Ephemeral});
      if (g.players.has(i.user.id)) return i.reply({content:'❌ أنت منضم بالفعل.',flags:MessageFlags.Ephemeral});
      if (g.started) return i.reply({content:'❌ اللعبة بدأت.',flags:MessageFlags.Ephemeral});
      if (g.players.size>=12) return i.reply({content:'❌ الغرفة مكتملة (12 لاعب).',flags:MessageFlags.Ephemeral});
      g.players.add(i.user.id);
      return i.update({content:'🔪 **مافيا**\nاللاعبون: **'+g.players.size+'**\nالحد الأدنى: **4**\n\nاضغطوا انضمام أو بدء اللعبة.',components:[
        new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId('mafia_join').setLabel('انضم').setEmoji('👤').setStyle(ButtonStyle.Success),
          new ButtonBuilder().setCustomId('mafia_start').setLabel('بدء اللعبة').setEmoji('▶️').setStyle(ButtonStyle.Primary)
        )
      ]});
    }

    if (i.isButton() && i.customId === 'mafia_start') {
      const key=i.guildId+':mafia', g=gameLobbies.get(key);
      if (!g) return i.reply({content:'❌ لا توجد غرفة مافيا.',flags:MessageFlags.Ephemeral});
      if (g.host!==i.user.id) return i.reply({content:'❌ منشئ الغرفة فقط يستطيع بدء اللعبة.',flags:MessageFlags.Ephemeral});
      if (g.players.size<4) return i.reply({content:'⏳ تحتاج اللعبة إلى 4 لاعبين على الأقل. حالياً: '+g.players.size,flags:MessageFlags.Ephemeral});
      g.started=true;
      const players=[...g.players];
      const shuffled=[...players].sort(()=>Math.random()-0.5);
      const mafiaCount=Math.max(1,Math.floor(players.length/4));
      const mafia=new Set(shuffled.slice(0,mafiaCount));
      gameLobbies.set(key,g);
      const roles=[];
      for(const id of players) {
        const role=mafia.has(id)?'🔪 مافيا':'👤 مواطن';
        try { const u=await client.users.fetch(id); await u.send('🔐 دورك في المافيا: **'+role+'**\nلا ترسل دورك للاعبين.'); } catch {}
        roles.push('<@'+id+'>');
      }
      return i.update({content:'🔪 **بدأت لعبة المافيا!**\nاللاعبون: '+roles.join('، ')+'\n\nتم إرسال الأدوار في الخاص. تبدأ الجولة الأولى الآن.',components:[]});
    }

    if (!i.isChatInputCommand()) return;
    const c = i.commandName;

    if (c === 'ping') return i.reply('🏓 Pong! ' + Math.round(client.ws.ping) + 'ms');


    if (c === 'effects') {
      const m = member(i);
      if (!m?.voice?.channel) {
        return i.reply({content:'🎙️ ادخل الروم الصوتي أولاً.',flags:MessageFlags.Ephemeral});
      }

      const effects = getEffectFiles();
      if (!effects.length) {
        return i.reply({content:'📭 ما فيه مؤثرات صوتية. أضف ملفات الصوت إلى مجلد effects.',flags:MessageFlags.Ephemeral});
      }

      const menu = new StringSelectMenuBuilder()
        .setCustomId('effects_menu')
        .setPlaceholder('🔊 اختر مؤثر صوتي')
        .addOptions(
          effects.slice(0,25).map((f,n)=>({
            label:songLabel(f).slice(0,100),
            value:String(n)
          }))
        );

      return i.reply({
        content:'🔊 **المؤثرات الصوتية**\\nاختر مؤثراً، والبوت سيدخل الروم ويشغله ثم يخرج تلقائياً.',
        components:[new ActionRowBuilder().addComponents(menu)],
        flags:MessageFlags.Ephemeral
      });
    }

    if (c === 'games') {
      const menu=new StringSelectMenuBuilder().setCustomId('games_menu').setPlaceholder('🎮 اختر لعبة').addOptions(
        {label:'مافيا',description:'4 إلى 12 لاعباً',value:'mafia',emoji:'🔪'},
        {label:'حجر ورقة مقص ضد بوت',description:'العب فوراً ضد البوت',value:'rps_bot',emoji:'🤖'},
        {label:'حجر ورقة مقص ضد لاعب',description:'أنشئ مباراة وانتظر لاعباً',value:'rps_player',emoji:'👤'},
        {label:'قتال لاعبين في الفويس',description:'لاعبان في نفس الروم والبوت يدخل معكم',value:'battle',emoji:'⚔️'}
      );
      return i.reply({content:'🎮 **قائمة الألعاب**\nاختر اللعبة:',components:[new ActionRowBuilder().addComponents(menu)]});
    }

    if (c === 'play_music') {
      const m = member(i);
      if (!m?.voice?.channel) return i.reply({content:'🎙️ ادخل الروم الصوتي أولاً.',flags:MessageFlags.Ephemeral});
      const songs = getSongs();
      if (!songs.length) return i.reply({content:'📭 ما فيه أغاني. أضف ملفات الصوت إلى مجلد songs.',flags:MessageFlags.Ephemeral});
      const menu = new StringSelectMenuBuilder().setCustomId('music_pick').setPlaceholder('🎵 اختر أغنية').addOptions(songs.slice(0,25).map((f,n)=>({label:songLabel(f).slice(0,100),value:String(n)})));
      const row = new ActionRowBuilder().addComponents(menu);
      const buttons = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('music_stop_btn').setLabel('إيقاف').setEmoji('⏹️').setStyle(ButtonStyle.Danger)
      );
      return i.reply({content:'🎵 **اختر الأغنية:**',components:[row,buttons],flags:MessageFlags.Ephemeral});
    }

    if (c === 'music_stop') {
      return i.reply(stopMusic(i.guildId) ? '⏹️ تم إيقاف الموسيقى.' : 'ما فيه موسيقى شغالة.');
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
