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

process.on('uncaughtException', e => { console.error('UNCAUGHT:', e); log('UNCAUGHT: ' + (e?.stack || e)); setTimeout(() => process.exit(1), 2000); });
process.on('unhandledRejection', e => { console.error('UNHANDLED:', e); log('UNHANDLED: ' + (e?.stack || e)); });

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
const mafiaGames = new Map();
const rpsGames = new Map();
const battleGames = new Map();
const effectStates = new Map();
const addonStates = new Map();

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

function getBombFiles() {
  const bombDir = path.join(__dirname, 'نوع_القنبلة');
  if (!fs.existsSync(bombDir)) return [];
  return fs.readdirSync(bombDir)
    .filter(f => /\.(m4a|mp3|wav|ogg|webm)$/i.test(f))
    .map(f => path.join('نوع_القنبلة', f))
    .sort((a,b) => a.localeCompare(b));
}

function getBombSpeedFiles() {
  const bombDir = path.join(__dirname, 'bomb speed');
  if (!fs.existsSync(bombDir)) return [];
  return fs.readdirSync(bombDir)
    .filter(f => /\.(m4a|mp3|wav|ogg|webm)$/i.test(f))
    .map(f => path.join('bomb speed', f))
    .sort((a,b) => a.localeCompare(b));
}

function getSovietAddonFiles() {
  const dir = path.join(__dirname, 'اضافات', 'اتحاد سوفيتي');
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter(f => /\.(m4a|mp3|wav|ogg|webm)$/i.test(f))
    .map(f => path.join('اضافات', 'اتحاد سوفيتي', f))
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



function mafiaRoleCount(n){return{mafia:Math.max(1,Math.floor(n/4)),doctor:n>=5?1:0,detective:n>=6?1:0};}
function mafiaAlive(g){return g.players.filter(id=>g.alive.has(id));}
function mafiaRoleName(r){return({mafia:'🔪 مافيا',doctor:'💉 طبيب',detective:'🔎 محقق',citizen:'👤 مواطن'})[r]||'👤 مواطن';}
async function mafiaEnd(g,w){const key=g.guildId+':mafia';mafiaGames.delete(key);gameLobbies.delete(key);const roles=g.players.map(id=>'<@'+id+'> = '+mafiaRoleName(g.roles[id])+(g.alive.has(id)?' 🟢':' 💀')).join('\n');try{const ch=await client.channels.fetch(g.channelId);await ch.send('🏆 **انتهت لعبة المافيا**\n\n'+w+'\n\n📋 **الأدوار:**\n'+roles);}catch(e){log('Mafia end: '+e.message);}}
async function mafiaCheckWin(g){const a=mafiaAlive(g),m=a.filter(id=>g.roles[id]==='mafia').length;if(!m){await mafiaEnd(g,'🎉 **المواطنون فازوا!**');return true;}if(m>=a.length-m){await mafiaEnd(g,'🔪 **المافيا فازت!**');return true;}return false;}
async function mafiaNightStart(g){
  g.phase='night'; g.night={};
  const alive=mafiaAlive(g);
  for(const id of alive){
    const role=g.roles[id];
    const rows=[];
    if(role!=='citizen'){
      const targets=alive.filter(t=>!(role==='mafia'&&t===id));
      for(let x=0;x<targets.length;x+=5){
        rows.push(new ActionRowBuilder().addComponents(...targets.slice(x,x+5).map(t=>
          new ButtonBuilder().setCustomId('mafia_night_'+role+'_'+t)
            .setLabel((g.guild?.members?.cache?.get(t)?.displayName||'هدف').slice(0,80))
            .setEmoji('🎯').setStyle(ButtonStyle.Secondary)
        )));
      }
    }
    try{
      const u=await client.users.fetch(id);
      await u.send({
        content:role==='mafia'?'🌙 اختر ضحية المافيا.':role==='doctor'?'🌙 اختر لاعباً لإنقاذه.':role==='detective'?'🌙 اختر لاعباً للتحقيق.':'🌙 أنت مواطن، انتظر الصباح.',
        components:rows.slice(0,5)
      });
    }catch(err){log('Mafia DM error: '+err.message);}
  }
  const ch=await client.channels.fetch(g.channelId).catch(()=>null);
  if(ch) await ch.send('🌙 **بدأ الليل**\\nالأدوار السرية تتخذ قراراتها في الخاص.');
}

async function mafiaNightResolve(g){
  const alive=mafiaAlive(g);
  const k=g.night.mafiaTarget, s=g.night.doctorTarget;
  if(g.night.detectiveTarget){
    const d=g.players.find(id=>g.roles[id]==='detective'&&g.alive.has(id));
    if(d) try{
      const u=await client.users.fetch(d);
      await u.send('🔎 النتيجة: <@'+g.night.detectiveTarget+'> هو **'+(g.roles[g.night.detectiveTarget]==='mafia'?'مافيا 🔪':'ليس مافيا 👤')+'**.');
    }catch(err){log('Mafia detective DM error: '+err.message);}
  }
  let msg='☀️ **صباح جديد!**\\n';
  if(k&&k!==s&&g.alive.has(k)){g.alive.delete(k);msg+='💀 <@'+k+'> مات الليلة.';}
  else msg+='🕊️ لم يمت أحد الليلة.';
  g.phase='day'; g.votes={};
  const ch=await client.channels.fetch(g.channelId).catch(()=>null);
  if(ch){
    const rows=[];
    for(let x=0;x<alive.length;x+=5){
      rows.push(new ActionRowBuilder().addComponents(...alive.slice(x,x+5).map(id=>
        new ButtonBuilder().setCustomId('mafia_vote_'+id)
          .setLabel('صوّت على '+(ch.guild?.members.cache.get(id)?.displayName||'لاعب').slice(0,70))
          .setEmoji('🗳️').setStyle(ButtonStyle.Danger)
      )));
    }
    await ch.send({content:msg+'\\n\\n🗳️ **التصويت مفتوح.** اختر لاعباً لإخراجه.',components:rows.slice(0,5)});
  }
  await mafiaCheckWin(g);
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

async function playVoiceEffect(memberObj, file, guildId, durationMs = 0, onDurationEnd = null) {
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

  const state = { connection, player, ffmpeg: null, timer: null };
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

  const cleanupEffect = () => {
    if (effectStates.get(guildId) !== state) return;
    if (state.timer) clearTimeout(state.timer);
    try { player.stop(true); } catch {}
    try { ffmpeg.kill('SIGKILL'); } catch {}
    try { connection.destroy(); } catch {}
    effectStates.delete(guildId);
    log('Effect finished, left voice in ' + guildId);
  };
  player.once(AudioPlayerStatus.Idle, () => {
    // For timed effects, keep the bot connected until the requested duration ends.
    if (durationMs <= 0) cleanupEffect();
  });
  if (durationMs > 0) {
    state.timer = setTimeout(async () => {
      if (effectStates.get(guildId) !== state) return;
      try {
        if (typeof onDurationEnd === 'function') await onDurationEnd(channel);
      } catch (e) {
        log('Timed effect completion action error: ' + (e?.stack || e));
      } finally {
        cleanupEffect();
      }
    }, durationMs);
  }
}

async function cleanupSovietAddon(guildId, state, stopAudio = false) {
  if (!state || state.cleaning) return;
  state.cleaning = true;
  if (addonStates.get(guildId) === state) addonStates.delete(guildId);
  try { if (state.timer) clearTimeout(state.timer); } catch {}
  if (stopAudio) { try { state.player?.stop(true); } catch {} }
  try { state.ffmpeg?.kill('SIGKILL'); } catch {}
  try { state.connection?.destroy(); } catch {}

  for (const saved of state.members || []) {
    try {
      const m = await state.guild.members.fetch(saved.id);
      if (m.nickname !== saved.nickname) await m.setNickname(saved.nickname, 'Restore after اتحاد سوفيتي add-on');
    } catch (e) { log('Soviet add-on nickname restore failed for ' + saved.id + ': ' + e.message); }
    try {
      const m = await state.guild.members.fetch(saved.id);
      if (m.voice.serverMute !== saved.serverMute) await m.voice.setMute(saved.serverMute, 'Restore after اتحاد سوفيتي add-on');
    } catch (e) { log('Soviet add-on mute restore failed for ' + saved.id + ': ' + e.message); }
  }
  try {
    if (state.channel && state.channel.name !== state.originalChannelName) {
      await state.channel.setName(state.originalChannelName, 'Restore after اتحاد سوفيتي add-on');
    }
  } catch (e) { log('Soviet add-on channel restore failed: ' + e.message); }
  log('اتحاد سوفيتي add-on finished in ' + guildId);
}

async function runSovietAddon(memberObj, guildId) {
  if (!memberObj?.voice?.channel) throw new Error('VOICE_REQUIRED');
  if (addonStates.has(guildId)) throw new Error('ADDON_ALREADY_RUNNING');
  const files = getSovietAddonFiles();
  if (!files.length) throw new Error('ADDON_FILE_MISSING');

  const channel = memberObj.voice.channel;
  const guild = channel.guild;
  const me = guild.members.me;
  const guildPerms = me?.permissions;
  const channelPerms = channel.permissionsFor(me);
  if (!guildPerms?.has(PermissionsBitField.Flags.ManageNicknames)) throw new Error('NEED_MANAGE_NICKNAMES');
  if (!guildPerms?.has(PermissionsBitField.Flags.MuteMembers)) throw new Error('NEED_MUTE_MEMBERS');
  if (!channelPerms?.has(PermissionsBitField.Flags.ManageChannels)) throw new Error('NEED_MANAGE_CHANNELS');
  if (!channelPerms?.has(PermissionsBitField.Flags.Connect) || !channelPerms?.has(PermissionsBitField.Flags.Speak)) throw new Error('NEED_VOICE_PERMS');

  const state = {
    guild, channel, originalChannelName: channel.name,
    members: [...channel.members.values()].filter(m => !m.user.bot).map(m => ({ id:m.id, nickname:m.nickname, serverMute:m.voice.serverMute })),
    connection:null, player:null, ffmpeg:null, timer:null, cleaning:false
  };
  addonStates.set(guildId, state);

  try {
    await channel.setName('اتحاد-سوفيتي-🫡', 'اتحاد سوفيتي add-on started');
    for (const saved of state.members) {
      try {
        const target = await guild.members.fetch(saved.id);
        if (target.manageable && target.nickname !== 'تحيا اتحاد سوفيتي 🫡') await target.setNickname('تحيا اتحاد سوفيتي 🫡', 'اتحاد سوفيتي add-on started');
      } catch (e) { log('Soviet add-on nickname change failed for ' + saved.id + ': ' + e.message); }
      try {
        const target = await guild.members.fetch(saved.id);
        if (!target.voice.serverMute) await target.voice.setMute(true, 'اتحاد سوفيتي add-on started');
      } catch (e) { log('Soviet add-on mute failed for ' + saved.id + ': ' + e.message); }
    }

    const connection = joinVoiceChannel({ channelId:channel.id, guildId, adapterCreator:guild.voiceAdapterCreator, selfDeaf:false, selfMute:false });
    const player = createAudioPlayer({ behaviors:{ noSubscriber:NoSubscriberBehavior.Play } });
    state.connection = connection;
    state.player = player;
    connection.subscribe(player);
    player.on('error', e => {
      log('Soviet add-on audio error: ' + e.message);
      cleanupSovietAddon(guildId, state, true).catch(err => log('Soviet cleanup error: ' + err.message));
    });
    await entersState(connection, VoiceConnectionStatus.Ready, 15000);

    const full = path.join(__dirname, files[0]);
    if (!fs.existsSync(full)) throw new Error('ADDON_FILE_MISSING');
    const ffmpeg = spawn(ffmpegPath, ['-hide_banner','-loglevel','error','-i',full,'-vn','-ac','2','-ar','48000','-c:a','libopus','-b:a','128k','-f','ogg','pipe:1']);
    state.ffmpeg = ffmpeg;
    ffmpeg.stderr.on('data', d => log('Soviet add-on FFmpeg: ' + d.toString().trim()));
    ffmpeg.on('error', e => {
      log('Soviet add-on FFmpeg error: ' + e.message);
      cleanupSovietAddon(guildId, state, true).catch(err => log('Soviet cleanup error: ' + err.message));
    });
    ffmpeg.on('close', code => { if (code !== 0) log('Soviet add-on FFmpeg exited with code ' + code); });
    player.once(AudioPlayerStatus.Idle, () => cleanupSovietAddon(guildId, state, false).catch(err => log('Soviet cleanup error: ' + err.message)));
    player.play(createAudioResource(ffmpeg.stdout, { inputType:StreamType.OggOpus }));
    log('اتحاد سوفيتي add-on started in ' + guildId + ' with ' + songLabel(files[0]));
  } catch (e) {
    await cleanupSovietAddon(guildId, state, true);
    throw e;
  }
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
    if (!ok && process.env.DISCORD_TOKEN?.trim()) {
      scheduleDiscordReconnect('health check found Discord disconnected', 0);
    }
    res.writeHead(ok ? 200 : 503, {'Content-Type':'application/json'});
    return res.end(JSON.stringify({ok, discord: ok ? 'connected':'disconnected', songs:getSongs().length}));
  }
  res.writeHead(200, {'Content-Type':'text/plain'});
  res.end('Discord bot is online.');
}).listen(PORT, '0.0.0.0', () => log('HTTP server listening on ' + PORT));

client.once('clientReady', async () => {
  log('Bot online as ' + client.user.tag);

  const commands = [
    {name:'سرعة',description:'عرض سرعة البوت'},
    {name:'تشغيل_اغنية',description:'اختيار وتشغيل أغنية'},
    {name:'ايقاف_الموسيقى',description:'إيقاف الموسيقى والخروج'},
    {name:'العاب',description:'فتح قائمة الألعاب'},
    {name:'نقل_اعضاء',description:'نقل جميع الأعضاء من روم صوتي إلى روم آخر',options:[{name:'المصدر',description:'الروم الصوتي الذي تريد نقل الأعضاء منه',type:7,required:true,channel_types:[2,13]},{name:'الوجهة',description:'الروم الصوتي الذي تريد نقل الأعضاء إليه',type:7,required:true,channel_types:[2,13]}]},
    {name:'تكلم',description:'نشر نص واضح بالنيابة عن عضو',options:[{name:'العضو',description:'اختر العضو',type:6,required:true},{name:'الكلام',description:'النص الذي تريد نشره',type:3,required:true,max_length:1500}]},
    {name:'قصف',description:'اختيار قنبلة وتشغيلها في روم صوتي',options:[{name:'نوع_القنبلة',description:'اختر نوع القنبلة',type:3,required:true,choices:[{name:'قنبله نوويه 💣',value:'normal'},{name:'قنبله خاطفه 💣',value:'speed'}]},{name:'الروم',description:'اختر الروم الصوتي',type:7,required:true,channel_types:[2,13]}]},
    {name:'اضافات',description:'اختيار وتشغيل إضافة مؤقتة',options:[{name:'اضافة',description:'اختر الإضافة',type:3,required:true,choices:[{name:'اتحاد سوفيتي 🫡',value:'soviet_union'}]}]},
    {name:'طرد_عضو',description:'طرد عضو من السيرفر',options:[{name:'العضو',description:'العضو',type:6,required:true}]},
    {name:'حظر_عضو',description:'حظر عضو من السيرفر',options:[{name:'العضو',description:'العضو',type:6,required:true}]},
    {name:'مسح_رسائل',description:'حذف رسائل من الروم',options:[{name:'العدد',description:'1-100',type:4,required:true,min_value:1,max_value:100}]},
    {name:'بطء_الدردشة',description:'تغيير بطء الدردشة',options:[{name:'الثواني',description:'0-21600',type:4,required:true,min_value:0,max_value:21600}]},
    {name:'قفل_الدردشة',description:'قفل الدردشة'},
    {name:'فتح_الدردشة',description:'فتح الدردشة'},
    {name:'تفعيل_تذكير',description:'تذكير تفاعل كل 5 ساعات'},
    {name:'ايقاف_تذكير',description:'إيقاف تذكير التفاعل'},
    {name:'عداد_الأعضاء',description:'عداد الأعضاء النشطين'},
    {name:'اعلان_للجميع',description:'إرسال إعلان للمشتركين',options:[{name:'النص',description:'الإعلان',type:3,required:true}]},
    {name:'رسالة_خاصة',description:'إرسال رسالة خاصة لعضو',options:[{name:'العضو',description:'العضو',type:6,required:true},{name:'النص',description:'الرسالة',type:3,required:true}]},
    {name:'سجلات',description:'عرض سجلات البوت'},
    {name:'سحب_جائزة',description:'إرسال سحب جائزة في روم تختاره',options:[{name:'الروم',description:'الروم النصي',type:7,required:true,channel_types:[0]},{name:'النص',description:'نص الـ Giveaway',type:3,required:true,max_length:4000}]}
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

    if (i.isButton() && i.customId === 'music_repeat_btn') {
      const s = musicStates.get(i.guildId);
      if (!s) return i.reply({content:'❌ ما فيه أغنية شغالة.',flags:MessageFlags.Ephemeral});
      s.repeat = !s.repeat;
      return i.update({
        content:'🎵 **'+songLabel(s.current)+'**\\n'+(s.repeat?'🔁 التكرار: **مفعّل**':'➡️ التكرار: **متوقف**'),
        components:[
          new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('music_repeat_btn').setLabel(s.repeat?'إلغاء التكرار':'تكرار 🔁').setStyle(s.repeat?ButtonStyle.Success:ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId('music_stop_btn').setLabel('إيقاف').setEmoji('⏹️').setStyle(ButtonStyle.Danger)
          )
        ]
      });
    }



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
        const key=i.guildId+':mafia'; let g=gameLobbies.get(key);
        if(!g){g={host:i.user.id,players:new Set([i.user.id]),channelId:i.channelId};gameLobbies.set(key,g);}
        return i.update({content:'🔪 **مافيا: غرفة الانتظار**\\n👥 **'+g.players.size+'/12** لاعبين\\n🎯 الحد الأدنى: **4**\\n\\n🌙 ليلة • ☀️ نهار • 🗳️ تصويت • 💉 طبيب • 🔎 محقق',components:[new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('mafia_join').setLabel('انضم').setEmoji('👤').setStyle(ButtonStyle.Success),new ButtonBuilder().setCustomId('mafia_start').setLabel('بدء اللعبة').setEmoji('▶️').setStyle(ButtonStyle.Primary))]});
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
      const key=i.guildId+':mafia',g=gameLobbies.get(key);
      if(!g)return i.reply({content:'❌ لا توجد غرفة مافيا.',flags:MessageFlags.Ephemeral});
      if(g.started)return i.reply({content:'❌ اللعبة بدأت.',flags:MessageFlags.Ephemeral});
      if(g.players.has(i.user.id))return i.reply({content:'❌ أنت منضم بالفعل.',flags:MessageFlags.Ephemeral});
      if(g.players.size>=12)return i.reply({content:'❌ الغرفة مكتملة.',flags:MessageFlags.Ephemeral});
      g.players.add(i.user.id);
      return i.update({content:'🔪 **مافيا: غرفة الانتظار**\\n👥 **'+g.players.size+'/12** لاعبين',components:[new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('mafia_join').setLabel('انضم').setEmoji('👤').setStyle(ButtonStyle.Success),new ButtonBuilder().setCustomId('mafia_start').setLabel('بدء اللعبة').setEmoji('▶️').setStyle(ButtonStyle.Primary))]});
    }

    if(i.isButton()&&i.customId==='mafia_start'){
      const key=i.guildId+':mafia',l=gameLobbies.get(key);
      if(!l)return i.reply({content:'❌ لا توجد غرفة.',flags:MessageFlags.Ephemeral});
      if(l.host!==i.user.id)return i.reply({content:'❌ منشئ الغرفة فقط.',flags:MessageFlags.Ephemeral});
      if(l.players.size<4)return i.reply({content:'⏳ تحتاج 4 لاعبين على الأقل.',flags:MessageFlags.Ephemeral});
      const players=[...l.players],n=mafiaRoleCount(players.length),sh=[...players].sort(()=>Math.random()-.5),roles={};
      sh.forEach((id,x)=>roles[id]=x<n.mafia?'mafia':x<n.mafia+n.doctor?'doctor':x<n.mafia+n.doctor+n.detective?'detective':'citizen');
      const g={guildId:i.guildId,channelId:i.channelId,players,roles,alive:new Set(players),phase:'starting',night:{},votes:{}};
      mafiaGames.set(key,g);gameLobbies.delete(key);
      for(const id of players){try{const u=await client.users.fetch(id);await u.send('🔐 **دورك:** '+mafiaRoleName(roles[id])+'\\n\\n'+(roles[id]==='mafia'?'اقضِ على المواطنين.':roles[id]==='doctor'?'أنقذ لاعباً كل ليلة.':roles[id]==='detective'?'حقق في لاعب كل ليلة.':'اكشف المافيا وصوّت عليها.')+'\\n⚠️ لا تكشف دورك.');}catch{}}
      await i.update({content:'🔪 **بدأت المافيا!**\\n👥 اللاعبين: **'+players.length+'**\\n🔪 مافيا: **'+n.mafia+'** | 💉 طبيب: **'+n.doctor+'** | 🔎 محقق: **'+n.detective+'**\\n📩 الأدوار في الخاص.\\n🌙 تبدأ الليلة الأولى.',components:[]});
      await mafiaNightStart(g);return;
    }

    if(i.isButton()&&i.customId.startsWith('mafia_night_')){
      const key=i.guildId+':mafia',g=mafiaGames.get(key);if(!g||g.phase!=='night')return i.reply({content:'❌ الليل غير نشط.',flags:MessageFlags.Ephemeral});
      if(!g.alive.has(i.user.id))return i.reply({content:'💀 أنت ميت.',flags:MessageFlags.Ephemeral});
      const p=i.customId.split('_'),role=p[2],target=p[3];
      if(g.roles[i.user.id]!==role)return i.reply({content:'❌ هذا القرار ليس لدورك.',flags:MessageFlags.Ephemeral});
      if(!g.alive.has(target))return i.reply({content:'❌ الهدف غير حي.',flags:MessageFlags.Ephemeral});
      if(role==='mafia')g.night.mafiaTarget=target;if(role==='doctor')g.night.doctorTarget=target;if(role==='detective')g.night.detectiveTarget=target;
      await i.reply({content:'✅ تم تسجيل قرارك.',flags:MessageFlags.Ephemeral});
      const need=['mafia'];if([...g.alive].some(id=>g.roles[id]==='doctor'))need.push('doctor');if([...g.alive].some(id=>g.roles[id]==='detective'))need.push('detective');
      if(need.every(x=>g.night[x+'Target']))await mafiaNightResolve(g);return;
    }

    if(i.isButton()&&i.customId.startsWith('mafia_vote_')){
      const key=i.guildId+':mafia',g=mafiaGames.get(key);if(!g||g.phase!=='day')return i.reply({content:'❌ التصويت مغلق.',flags:MessageFlags.Ephemeral});
      if(!g.alive.has(i.user.id))return i.reply({content:'💀 الميت لا يصوّت.',flags:MessageFlags.Ephemeral});
      const target=i.customId.replace('mafia_vote_','');if(!g.alive.has(target)||target===i.user.id)return i.reply({content:'❌ اختر لاعباً آخر.',flags:MessageFlags.Ephemeral});
      g.votes[i.user.id]=target;await i.reply({content:'🗳️ تم تسجيل تصويتك.',flags:MessageFlags.Ephemeral});
      const alive=mafiaAlive(g);if(alive.every(id=>g.votes[id])){const counts={};alive.forEach(id=>{const t=g.votes[id];counts[t]=(counts[t]||0)+1;});const max=Math.max(...Object.values(counts)),w=Object.keys(counts).filter(id=>counts[id]===max),ch=await client.channels.fetch(g.channelId).catch(()=>null);if(w.length!==1){g.votes={};if(ch)await ch.send('🤝 **تعادل!** لا أحد يخرج.\\n🌙 ليلة جديدة.');await mafiaNightStart(g);return;}const out=w[0];g.alive.delete(out);if(ch)await ch.send('🗳️ **نتيجة التصويت:** 💀 <@'+out+'> خرج وكان **'+mafiaRoleName(g.roles[out])+'**.');if(await mafiaCheckWin(g))return;await mafiaNightStart(g);}return;
    }

    if (!i.isChatInputCommand()) return;
    const c = i.commandName;

    if(c==='سرعة')return i.reply('🏓 Pong! '+Math.round(client.ws.ping)+'ms');
    if (c === 'سحب_جائزة') {
      if (!perms(i,PermissionsBitField.Flags.ManageGuild)) return i.reply({content:'❌ تحتاج Manage Server.',flags:MessageFlags.Ephemeral});
      const channel=i.options.getChannel('الروم',true);
      const text=i.options.getString('النص',true).trim();
      if (!channel.isTextBased?.()) return i.reply({content:'❌ اختر روم نصي.',flags:MessageFlags.Ephemeral});
      const me=i.guild.members.me;
      const cp=channel.permissionsFor(me);
      if (!cp?.has(PermissionsBitField.Flags.SendMessages) || !cp?.has(PermissionsBitField.Flags.EmbedLinks)) return i.reply({content:'❌ البوت يحتاج Send Messages و Embed Links في الروم المحدد.',flags:MessageFlags.Ephemeral});
      const embed=new EmbedBuilder().setTitle('🎁 Giveaway').setDescription(text).setFooter({text:'🎁 Giveaway'}).setTimestamp();
      await channel.send({embeds:[embed]});
      return i.reply({content:'✅ تم إرسال Giveaway في '+channel.toString()+' 🎁',flags:MessageFlags.Ephemeral});
    }

    if (c === 'اضافات') {
      if (!perms(i, PermissionsBitField.Flags.ManageGuild)) return i.reply({content:'❌ تحتاج صلاحية إدارة السيرفر لاستخدام الإضافات.',flags:MessageFlags.Ephemeral});
      const addon = i.options.getString('اضافة', true);
      if (addon !== 'soviet_union') return i.reply({content:'❌ الإضافة غير معروفة.',flags:MessageFlags.Ephemeral});
      const m = member(i);
      if (!m?.voice?.channel) return i.reply({content:'🎙️ ادخل الروم الصوتي أولاً، ثم شغّل الإضافة.',flags:MessageFlags.Ephemeral});
      await i.deferReply({flags:MessageFlags.Ephemeral});
      try {
        await runSovietAddon(m, i.guildId);
        return i.editReply('🫡 **بدأ اتحاد سوفيتي!** تغيّر اسم الفويس وأسماء الأعضاء وتم تفعيل الميوت، وستُستعاد الأسماء وحالة الميوت واسم الفويس بعد انتهاء الأغنية.');
      } catch (e) {
        log('Add-on command error: ' + (e?.stack || e));
        const messages = {
          VOICE_REQUIRED:'🎙️ ادخل الروم الصوتي أولاً.',
          ADDON_ALREADY_RUNNING:'⏳ توجد إضافة شغالة بالفعل في هذا السيرفر.',
          ADDON_FILE_MISSING:'📁 مجلد الإضافة فارغ. ارفع أغنية MP3 أو WAV أو OGG إلى مجلد اضافات/اتحاد سوفيتي.',
          NEED_MANAGE_NICKNAMES:'❌ البوت يحتاج صلاحية Manage Nicknames.',
          NEED_MUTE_MEMBERS:'❌ البوت يحتاج صلاحية Mute Members.',
          NEED_MANAGE_CHANNELS:'❌ البوت يحتاج صلاحية Manage Channels في الروم.',
          NEED_VOICE_PERMS:'❌ البوت يحتاج صلاحيتَي Connect و Speak.'
        };
        return i.editReply(messages[e.message] || '❌ فشلت الإضافة. تحقق من صلاحيات البوت وملف الأغنية، ثم راجع سجلات Render.');
      }
    }

    if (c === 'تكلم') {
      if (!perms(i, PermissionsBitField.Flags.ManageMessages)) {
        return i.reply({content:'❌ تحتاج صلاحية إدارة الرسائل لاستخدام هذا الأمر.',flags:MessageFlags.Ephemeral});
      }
      const target = i.options.getUser('العضو', true);
      const speech = i.options.getString('الكلام', true).trim();
      if (!speech) return i.reply({content:'❌ اكتب الكلام الذي تريد نشره.',flags:MessageFlags.Ephemeral});
      const me = i.guild.members.me;
      const channelPerms = i.channel.permissionsFor(me);
      if (!channelPerms?.has(PermissionsBitField.Flags.ManageWebhooks)) {
        return i.reply({content:'❌ البوت يحتاج صلاحية Manage Webhooks في هذا الروم ليعرض اسم العضو وصورته.',flags:MessageFlags.Ephemeral});
      }
      const targetMember = await i.guild.members.fetch(target.id).catch(() => null);
      const displayName = targetMember?.displayName || target.username;
      const avatarURL = target.displayAvatarURL({extension:'png', size:256});
      const safeText = speech.replace(/@everyone/g, '@​everyone').replace(/@here/g, '@​here');
      let webhook;
      try {
        webhook = await i.channel.createWebhook({name:'رسائل بالنيابة', reason:'نشر رسالة موضّحة بطلب من مشرف'});
        await webhook.send({
          content:safeText+'\\n\\nⓘ نُشرت عبر البوت بطلب من '+i.user.tag+'، وليست رسالة كتبها العضو بنفسه.',
          username:displayName,
          avatarURL,
          allowedMentions:{parse:[]}
        });
      } finally {
        if (webhook) await webhook.delete('حذف webhook المؤقت بعد النشر').catch(e => log('Temporary webhook cleanup failed: '+e.message));
      }
      return i.reply({content:'✅ نُشر النص باسم العضو وصورته، مع توضيح أنه نُشر عبر البوت.',flags:MessageFlags.Ephemeral});
    }

    if (c === 'نقل_اعضاء') {
      if (!perms(i, PermissionsBitField.Flags.MoveMembers)) {
        return i.reply({content:'❌ تحتاج صلاحية نقل الأعضاء (Move Members).',flags:MessageFlags.Ephemeral});
      }
      const source = i.options.getChannel('المصدر', true);
      const destination = i.options.getChannel('الوجهة', true);
      if (!source.isVoiceBased?.() || !destination.isVoiceBased?.()) {
        return i.reply({content:'❌ اختر رومين صوتيين صالحين.',flags:MessageFlags.Ephemeral});
      }
      if (source.id === destination.id) {
        return i.reply({content:'❌ اختر رومًا مختلفًا كوجهة للنقل.',flags:MessageFlags.Ephemeral});
      }
      const botMember = i.guild.members.me;
      for (const ch of [source, destination]) {
        const cp = ch.permissionsFor(botMember);
        if (!cp?.has(PermissionsBitField.Flags.ViewChannel) ||
            !cp?.has(PermissionsBitField.Flags.Connect) ||
            !cp?.has(PermissionsBitField.Flags.MoveMembers)) {
          return i.reply({content:'❌ البوت يحتاج صلاحيات عرض الروم والاتصال ونقل الأعضاء في الرومين المحددين.',flags:MessageFlags.Ephemeral});
        }
      }
      await i.deferReply({flags:MessageFlags.Ephemeral});
      const targets = [...source.members.values()].filter(m => m.id !== client.user.id);
      let moved = 0, failed = 0;
      for (const target of targets) {
        try {
          if (target.voice.channelId === source.id) {
            await target.voice.setChannel(destination, 'نقل الأعضاء بواسطة أمر /نقل_اعضاء');
            moved++;
          }
        } catch (e) {
          failed++;
          log('Move members failed for ' + target.id + ': ' + e.message);
        }
      }
      return i.editReply('🚚 **اكتمل النقل**\\nمن: '+source.toString()+'\\nإلى: '+destination.toString()+'\\n✅ تم نقل: **'+moved+'**\\n❌ تعذّر نقل: **'+failed+'**');
    }

    if (c === 'قصف') {
      if (!perms(i, PermissionsBitField.Flags.ManageGuild)) return i.reply({content:'❌ تحتاج صلاحية Manage Server لاستخدام هذا الأمر.',flags:MessageFlags.Ephemeral});
      const bombType = i.options.getString('نوع_القنبلة', true);
      const channel = i.options.getChannel('الروم', true);
      if (!channel.isVoiceBased?.() || !channel.guild) return i.reply({content:'❌ اختر رومًا صوتيًا صالحًا.',flags:MessageFlags.Ephemeral});
      const speedMode = bombType === 'speed';
      const effects = speedMode ? getBombSpeedFiles() : getBombFiles();
      const folderName = speedMode ? 'bomb speed' : 'bomb';
      const durationMs = speedMode ? 2000 : 30000;
      if (!effects.length) return i.reply({content:'📭 مجلد **'+folderName+'** فارغ. ارفع ملف الصوت إليه في GitHub أولًا.',flags:MessageFlags.Ephemeral});
      const file = effects.find(f => /tsar|bomba|قنبلة|انفجار/i.test(songLabel(f))) || effects[0];
      const cp = channel.permissionsFor(i.guild.members.me);
      if (!cp?.has(PermissionsBitField.Flags.Connect) || !cp?.has(PermissionsBitField.Flags.Speak)) return i.reply({content:'❌ البوت يحتاج صلاحيتَي Connect و Speak في الروم المختار.',flags:MessageFlags.Ephemeral});
      if (!cp?.has(PermissionsBitField.Flags.MuteMembers) || !cp?.has(PermissionsBitField.Flags.MoveMembers)) return i.reply({content:'❌ البوت يحتاج صلاحيتَي Mute Members و Move Members أيضًا.',flags:MessageFlags.Ephemeral});
      await i.deferReply({flags:MessageFlags.Ephemeral});
      try {
        await playVoiceEffect({voice:{channel}}, file, i.guildId, durationMs, async (voiceChannel) => {
          let muted = 0, disconnected = 0, failed = 0;
          const targets = [...voiceChannel.members.values()].filter(m => m.id !== client.user.id && !m.user.bot);
          for (const target of targets) {
            try {
              if (!target.voice.serverMute) await target.voice.setMute(true, 'Timed /قصف voice-room action');
              muted++;
            } catch (e) {
              failed++;
              log('Qasf mute failed for ' + target.id + ': ' + e.message);
            }
          }
          for (const target of targets) {
            try {
              if (target.voice.channelId === voiceChannel.id) {
                await target.voice.disconnect('Timed /قصف voice-room action');
                disconnected++;
              }
            } catch (e) {
              failed++;
              log('Qasf disconnect failed for ' + target.id + ': ' + e.message);
            }
          }
          log('Qasf (' + bombType + ') completed in ' + voiceChannel.id + ': muted=' + muted + ', disconnected=' + disconnected + ', failed=' + failed);
        });
        return i.editReply('🔊 بدأ **'+(speedMode ? 'قنبله خاطفه 💣' : 'قنبله نوويه 💣')+'** في '+channel.toString()+'. بعد '+(speedMode ? 'ثانيتين' : '30 ثانية')+' سيحاول البوت عمل Server Mute وفصل الأعضاء البشر الموجودين في الروم الصوتي. لن يطردهم من السيرفر.');
      } catch (e) {
        log('Qasf command error: ' + e.stack);
        return i.editReply('❌ تعذّر تشغيل المؤثر. تأكد من صلاحيات Connect و Speak و Mute Members و Move Members ومن سلامة ملف الصوت.');
      }
    }

    if (c === 'العاب') {
      const menu=new StringSelectMenuBuilder().setCustomId('games_menu').setPlaceholder('🎮 اختر لعبة').addOptions(
        {label:'مافيا',description:'4-12: ليلة وتصويت وأدوار',value:'mafia',emoji:'🔪'},
        {label:'حجر ورقة مقص ضد بوت',description:'العب فوراً ضد البوت',value:'rps_bot',emoji:'🤖'},
        {label:'حجر ورقة مقص ضد لاعب',description:'أنشئ مباراة وانتظر لاعباً',value:'rps_player',emoji:'👤'},
        {label:'قتال لاعبين في الفويس',description:'لاعبان في نفس الروم والبوت يدخل معكم',value:'battle',emoji:'⚔️'}
      );
      return i.reply({content:'🎮 **قائمة الألعاب**\nاختر اللعبة:',components:[new ActionRowBuilder().addComponents(menu)]});
    }

    if (c === 'تشغيل_اغنية') {
      const m = member(i);
      if (!m?.voice?.channel) return i.reply({content:'🎙️ ادخل الروم الصوتي أولاً.',flags:MessageFlags.Ephemeral});
      const songs = getSongs();
      if (!songs.length) return i.reply({content:'📭 ما فيه أغاني. أضف ملفات الصوت إلى مجلد songs.',flags:MessageFlags.Ephemeral});
      const menu = new StringSelectMenuBuilder().setCustomId('music_pick').setPlaceholder('🎵 اختر أغنية').addOptions(songs.slice(0,25).map((f,n)=>({label:songLabel(f).slice(0,100),value:String(n)})));
      const row = new ActionRowBuilder().addComponents(menu);
      const buttons = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('music_repeat_btn').setLabel('تكرار 🔁').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('music_stop_btn').setLabel('إيقاف').setEmoji('⏹️').setStyle(ButtonStyle.Danger)
      );
      return i.reply({content:'🎵 **اختر الأغنية:**',components:[row,buttons],flags:MessageFlags.Ephemeral});
    }

    if (c === 'ايقاف_الموسيقى') {
      return i.reply(stopMusic(i.guildId) ? '⏹️ تم إيقاف الموسيقى.' : 'ما فيه موسيقى شغالة.');
    }

    if (c==='طرد_عضو' || c==='حظر_عضو') {
      const permission=c==='طرد_عضو'?PermissionsBitField.Flags.KickMembers:PermissionsBitField.Flags.BanMembers;
      if (!perms(i,permission)) return i.reply({content:'❌ ما عندك الصلاحية المطلوبة.',flags:MessageFlags.Ephemeral});
      const u=i.options.getUser('العضو',true);
      const m=i.guild.members.cache.get(u.id);
      if (u.id===i.user.id) return i.reply({content:'❌ لا يمكنك استخدام الأمر على نفسك.',flags:MessageFlags.Ephemeral});
      if (m && !(c==='طرد_عضو'?m.kickable:m.bannable)) return i.reply({content:'❌ رتبة البوت يجب أن تكون أعلى من العضو.',flags:MessageFlags.Ephemeral});
      if (c==='طرد_عضو') await m.kick('Discord bot /kick by '+i.user.tag);
      else await i.guild.members.ban(u.id,{reason:'Discord bot /ban by '+i.user.tag});
      return i.reply((c==='طرد_عضو'?'👢 تم طرد ':'🔨 تم حظر ')+ '**'+u.tag+'**');
    }

    if (c==='مسح_رسائل') {
      if (!perms(i,PermissionsBitField.Flags.ManageMessages)) return i.reply({content:'❌ تحتاج Manage Messages.',flags:MessageFlags.Ephemeral});
      await i.deferReply({flags:MessageFlags.Ephemeral});
      const n=i.options.getInteger('العدد',true);
      const deleted=await i.channel.bulkDelete(n,true);
      return i.editReply('🧹 تم حذف **'+deleted.size+'** رسالة.');
    }

    if (c==='بطء_الدردشة') {
      if (!perms(i,PermissionsBitField.Flags.ManageChannels)) return i.reply({content:'❌ تحتاج Manage Channels.',flags:MessageFlags.Ephemeral});
      const n=i.options.getInteger('الثواني',true);
      await i.channel.setRateLimitPerUser(n);
      return i.reply('🐢 Slowmode: **'+n+' ثانية**.');
    }

    if (c==='قفل_الدردشة' || c==='فتح_الدردشة') {
      if (!perms(i,PermissionsBitField.Flags.ManageChannels)) return i.reply({content:'❌ تحتاج Manage Channels.',flags:MessageFlags.Ephemeral});
      await i.channel.permissionOverwrites.edit(i.guild.roles.everyone,{SendMessages:c==='قفل_الدردشة'?false:null});
      return i.reply(c==='قفل_الدردشة'?'🔒 تم قفل الدردشة.':'🔓 تم فتح الدردشة.');
    }

    if (c==='تفعيل_تذكير') {
      if (!perms(i,PermissionsBitField.Flags.ManageGuild)) return i.reply({content:'❌ تحتاج Manage Server.',flags:MessageFlags.Ephemeral});
      if (chatTimers.has(i.channelId)) clearInterval(chatTimers.get(i.channelId));
      const timer=setInterval(async()=>{try{await i.channel.send('@everyone تفاعلو 📢')}catch(e){log(e.message)}},5*60*60*1000);
      chatTimers.set(i.channelId,timer);
      return i.reply('📢 تم تشغيل التذكير كل 5 ساعات.');
    }

    if (c==='ايقاف_تذكير') {
      if (!perms(i,PermissionsBitField.Flags.ManageGuild)) return i.reply({content:'❌ تحتاج Manage Server.',flags:MessageFlags.Ephemeral});
      const t=chatTimers.get(i.channelId);
      if (!t) return i.reply('ℹ️ ما فيه تذكير شغال هنا.');
      clearInterval(t); chatTimers.delete(i.channelId);
      return i.reply('🛑 تم إيقاف التذكير.');
    }

    if (c==='رسالة_خاصة' || c==='اعلان_للجميع') {
      if (!perms(i,PermissionsBitField.Flags.ManageGuild)) return i.reply({content:'❌ تحتاج Manage Server.',flags:MessageFlags.Ephemeral});
      await i.deferReply({flags:MessageFlags.Ephemeral});
      const text=i.options.getString('النص',true);
      let sent=0, failed=0;
      const ids=c==='اعلان_للجميع'?[...(dmSubscribers.get(i.guildId)||new Set())]:[i.options.getUser('العضو',true).id];
      for(const id of ids){try{const u=await client.users.fetch(id);await u.send('📢 **إعلان من '+i.guild.name+'**\\n\\n'+text);sent++}catch{failed++}}
      return i.editReply('✅ أُرسلت: **'+sent+'** | ❌ فشلت: **'+failed+'**');
    }

    if (c==='سجلات') {
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

let reconnecting = false;
let reconnectTimer = null;
let loginFailureCount = 0;

function scheduleDiscordReconnect(reason, delay = 10000) {
  if (reconnecting || reconnectTimer) return;
  log('Discord reconnect scheduled: ' + reason + ' in ' + delay + 'ms');
  reconnectTimer = setTimeout(async () => {
    reconnectTimer = null;
    await reconnectDiscord(reason);
  }, delay);
}

async function reconnectDiscord(reason) {
  if (reconnecting) return;
  const token = process.env.DISCORD_TOKEN?.trim();
  if (!token) {
    log('Discord reconnect skipped: DISCORD_TOKEN missing');
    return;
  }

  reconnecting = true;
  log('Discord reconnect requested: ' + reason);

  try {
    if (client.isReady()) {
      reconnecting = false;
      return;
    }

    await client.login(token);
    loginFailureCount = 0;
    log('Discord reconnect successful');
  } catch (e) {
    loginFailureCount++;
    const delay = Math.min(60000, 5000 * Math.max(1, loginFailureCount));
    log('Discord reconnect failed #' + loginFailureCount + ': ' + e.message);
    reconnecting = false;
    scheduleDiscordReconnect('retry after login failure', delay);
    return;
  }

  reconnecting = false;
}

client.on('shardDisconnect', (event, shardId) => {
  log('Discord shard disconnected (' + shardId + '): ' + (event?.code ?? 'unknown'));
  scheduleDiscordReconnect('shardDisconnect', 10000);
});

client.on('shardError', (error, shardId) => {
  log('Discord shard error (' + shardId + '): ' + error.message);
  scheduleDiscordReconnect('shardError', 10000);
});

client.on('shardReconnecting', shardId => {
  log('Discord shard reconnecting: ' + shardId);
});

client.on('shardResume', (shardId, replayed) => {
  loginFailureCount = 0;
  log('Discord shard resumed: ' + shardId + ' replayed=' + replayed);
});

client.on('invalidated', () => {
  log('Discord session invalidated. Waiting for process restart/login.');
});

setInterval(() => {
  if (!process.env.DISCORD_TOKEN?.trim()) return;
  if (!client.isReady()) scheduleDiscordReconnect('client is not ready', 5000);
}, 30000);

const token=process.env.DISCORD_TOKEN?.trim();
if(!token){log('DISCORD_TOKEN missing');process.exit(1);}
log('DISCORD_TOKEN loaded');

client.login(token).then(() => {
  loginFailureCount = 0;
  log('Initial Discord login successful');
}).catch(e => {
  log('Initial Discord login failed: ' + e.message);
  scheduleDiscordReconnect('initial login failure', 5000);
});