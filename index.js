require('dotenv').config();
const http = require('http');
const https = require('https');
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
const maze3dGames = new Map();
const effectStates = new Map();
const addonStates = new Map();
const hackSimulations = new Map();

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
  const bombDir = path.join(__dirname, 'bomb');
  if (!fs.existsSync(bombDir)) return [];
  return fs.readdirSync(bombDir)
    .filter(f => /\.(m4a|mp3|wav|ogg|webm)$/i.test(f))
    .map(f => path.join('نوع_القنبلة', f))
    .sort((a,b) => a.localeCompare(b));
}

function getDomainExpansionFiles() {
  const dir = path.join(__dirname, 'توسيع مجال');
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter(f => /\.(m4a|mp3|wav|ogg|webm)$/i.test(f))
    .map(f => path.join('توسيع مجال', f))
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
  if(ch) await ch.send('🌙 **بدأ الليل**\nالأدوار السرية تتخذ قراراتها في الخاص.');
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
  let msg='☀️ **صباح جديد!**\n';
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
    await ch.send({content:msg+'\n\n🗳️ **التصويت مفتوح.** اختر لاعباً لإخراجه.',components:rows.slice(0,5)});
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

// Keep a free Render web service receiving HTTP traffic so its idle timer
// does not suspend the Discord gateway connection. This is best-effort;
// the bot still logs any failures and Discord reconnect logic remains active.
const renderPublicUrl = process.env.RENDER_EXTERNAL_URL || 'https://discord-bot-5a4b.onrender.com';
setInterval(() => {
  let request;
  try {
    request = https.get(new URL('/keepalive', renderPublicUrl), response => {
      response.resume();
    });
    request.setTimeout(10000, () => request.destroy(new Error('keep-alive request timed out')));
    request.on('error', error => log('Render keep-alive request failed: ' + error.message));
  } catch (error) {
    log('Render keep-alive setup failed: ' + error.message);
  }
}, 10 * 60 * 1000);


// Persistent channel-name backup stored in a private Discord channel (survives Render restarts).
const RENAME_STORAGE_MARKER = 'ETO_CHANNEL_BACKUP_STORAGE:';
const RENAME_META_MARKER = 'ETO_CHANNEL_BACKUP_META:';
const RENAME_DATA_MARKER = 'ETO_CHANNEL_BACKUP_DATA:';

async function getRenameStorageChannel(guild, create = false) {
  let storage = guild.channels.cache.find(ch =>
    ch.type === 0 && typeof ch.topic === 'string' &&
    ch.topic.includes(RENAME_STORAGE_MARKER + guild.id)
  );
  if (storage) return storage;
  const fetched = await guild.channels.fetch().catch(() => null);
  storage = fetched?.find(ch =>
    ch.type === 0 && typeof ch.topic === 'string' &&
    ch.topic.includes(RENAME_STORAGE_MARKER + guild.id)
  );
  if (storage || !create) return storage || null;
  const me = guild.members.me || await guild.members.fetch(client.user.id);
  return guild.channels.create({
    name: 'eto-bot-backup',
    type: 0,
    topic: RENAME_STORAGE_MARKER + guild.id + ' | Private storage for /تغير and /اعاده',
    permissionOverwrites: [
      { id: guild.roles.everyone.id, deny: [PermissionsBitField.Flags.ViewChannel] },
      { id: me.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory, PermissionsBitField.Flags.ManageChannels] }
    ],
    reason: 'Persistent backup for channel names'
  });
}

async function getRenameBackup(storage) {
  const messages = await storage.messages.fetch({ limit: 100 });
  const ordered = [...messages.values()].sort((a, b) => b.createdTimestamp - a.createdTimestamp);
  const metaMessage = ordered.find(m => m.content.startsWith(RENAME_META_MARKER));
  if (!metaMessage) return { metaMessage: null, meta: null, records: [] };
  let meta;
  try { meta = JSON.parse(metaMessage.content.slice(RENAME_META_MARKER.length)); }
  catch { throw new Error('BACKUP_META_INVALID'); }
  if (!meta?.backupId || !Number.isInteger(meta.chunkCount)) throw new Error('BACKUP_META_INVALID');
  // First try the exact backup ID in metadata. If it points to a missing
  // data set, recover a matching guild backup from the stored data messages.
  let selectedBackupId = meta.backupId;
  let dataMessages = ordered.filter(m => m.content.startsWith(RENAME_DATA_MARKER + selectedBackupId + ':'));
  if (!dataMessages.length) {
    const groups = new Map();
    for (const message of ordered) {
      if (!message.content.startsWith(RENAME_DATA_MARKER)) continue;
      const restAll = message.content.slice(RENAME_DATA_MARKER.length);
      const firstColon = restAll.indexOf(':');
      if (firstColon < 1) continue;
      const candidateId = restAll.slice(0, firstColon);
      if (!candidateId.endsWith('-' + storage.guild.id)) continue;
      if (!groups.has(candidateId)) groups.set(candidateId, []);
      groups.get(candidateId).push(message);
    }
    const candidates = [...groups.entries()].map(([id, items]) => ({ id, items }))
      .sort((a, b) => Math.max(...b.items.map(m => m.createdTimestamp)) - Math.max(...a.items.map(m => m.createdTimestamp)));
    const usable = candidates.find(candidate => candidate.items.some(m => {
      const rest = m.content.slice((RENAME_DATA_MARKER + candidate.id + ':').length);
      const separator = rest.indexOf(':');
      if (separator < 1) return false;
      try { return Array.isArray(JSON.parse(rest.slice(separator + 1))); } catch { return false; }
    }));
    if (usable) {
      selectedBackupId = usable.id;
      dataMessages = usable.items;
      meta.recoveryWarning = true;
      meta.backupId = selectedBackupId;
      log('Backup metadata ID had no data; falling back to stored backup ' + selectedBackupId + '.');
    }
  }
  const chunks = new Map();
  for (const message of dataMessages) {
    const prefix = RENAME_DATA_MARKER + selectedBackupId + ':';
    const rest = message.content.slice(prefix.length);
    const separator = rest.indexOf(':');
    if (separator < 1) continue;
    const chunkIndex = Number(rest.slice(0, separator));
    if (!Number.isInteger(chunkIndex) || chunkIndex < 0) continue;
    try {
      const chunk = JSON.parse(rest.slice(separator + 1));
      if (Array.isArray(chunk)) chunks.set(chunkIndex, chunk);
    } catch { throw new Error('BACKUP_DATA_INVALID'); }
  }
  // Recover usable chunks even if older bot versions wrote incorrect chunk/record counts.
  // Sort by the stored chunk index and reject only when no valid channel records remain.
  const records = [];
  const chunkIndexes = [...chunks.keys()].sort((a, b) => a - b);
  for (const n of chunkIndexes) records.push(...chunks.get(n));
  if (!records.length) throw new Error('BACKUP_INCOMPLETE');
  if (chunks.size !== meta.chunkCount || records.length !== meta.recordCount) {
    log('Backup count mismatch; recovering ' + records.length + ' available channel records from ' + chunks.size + ' data chunks (metadata expected ' + meta.recordCount + ' records / ' + meta.chunkCount + ' chunks).');
    meta.recoveryWarning = true;
    meta.recordCount = records.length;
    meta.chunkCount = chunks.size;
  }
  return { metaMessage, meta, records };
}

async function saveRenameBackup(storage, records, active) {
  const backupId = Date.now().toString(36) + '-' + storage.guild.id;
  const chunks = [];
  let chunk = [];
  for (const record of records) {
    const candidate = [...chunk, record];
    if (chunk.length && (RENAME_DATA_MARKER + backupId + ':' + chunks.length + ':' + JSON.stringify(candidate)).length > 1700) {
      chunks.push(chunk);
      chunk = [record];
    } else chunk = candidate;
  }
  if (chunk.length) chunks.push(chunk);
  for (let n = 0; n < chunks.length; n++) {
    await storage.send(RENAME_DATA_MARKER + backupId + ':' + n + ':' + JSON.stringify(chunks[n]));
  }
  const meta = { backupId, active, chunkCount: chunks.length, recordCount: records.length, savedAt: new Date().toISOString() };
  await storage.send(RENAME_META_MARKER + JSON.stringify(meta));
}


client.once('clientReady', async () => {
  log('Bot online as ' + client.user.tag);

  const commands = [
    {name:'مؤثره',description:'اختيار مؤثر صوتي وتشغيله في روم صوتي',options:[
      {name:'نوع_القنبلة',description:'اختر المؤثر الصوتي',type:3,required:true,choices:[
        {name:'قنبله نوويه 💣',value:'normal'},
        {name:'قنبله خاطفه 💣',value:'speed'},
        {name:'توسيع مجال 🤞',value:'domain_expansion'}
      ]},
      {name:'الروم',description:'اختر الروم الصوتي',type:7,required:true,channel_types:[2,13]}
    ]},
    {name:'تشغيل-اغنيه',description:'اختيار وتشغيل أغنية'},
    {name:'اطفاء-اغنيه',description:'إيقاف الأغنية والخروج من الروم الصوتي'},
    {name:'العاب',description:'ابدأ مغامرة متاهة بمنظور ثلاثي الأبعاد داخل ديسكورد'}
  ];

  try {
    const rest = new REST({version:'10'}).setToken(process.env.DISCORD_TOKEN);
    await rest.put(Routes.applicationCommands(client.user.id), {body:commands});
    log('Global slash commands registered: ' + commands.length);
  } catch(e) {
    log('Command registration error: ' + e.message);
  }
});


const MAZE3D_MAP = [
  '###########',
  '#...#.....#',
  '#.#.#.###.#',
  '#.#...#...#',
  '#.###.#.#.#',
  '#.....#.#.#',
  '###.###.#.#',
  '#...#...#.#',
  '#.#...#...#',
  '#.........#',
  '###########'
];
const MAZE3D_DIRS = [{x:0,y:-1},{x:1,y:0},{x:0,y:1},{x:-1,y:0}];
function maze3dWall(x,y){return y<0||y>=MAZE3D_MAP.length||x<0||x>=MAZE3D_MAP[0].length||MAZE3D_MAP[y][x]==='#';}
function maze3dVisibleObject(game){
  const d=MAZE3D_DIRS[game.dir];
  for(let n=1;n<=7;n++){
    const x=game.x+d.x*n,y=game.y+d.y*n;
    if(maze3dWall(x,y)) return null;
    const enemy=game.enemies.find(e=>e.x===x&&e.y===y);
    if(enemy) return {kind:'enemy',distance:n};
    const crystal=game.crystals.find(c=>c.x===x&&c.y===y);
    if(crystal) return {kind:'crystal',distance:n};
    if(x===game.exit.x&&y===game.exit.y) return {kind:'exit',distance:n};
  }
  return null;
}
function maze3dView(game){
  const width=9,height=7,rows=[],dirs=MAZE3D_DIRS[game.dir],facing=Math.atan2(dirs.y,dirs.x);
  for(let sy=0;sy<height;sy++){
    let row='';
    for(let sx=0;sx<width;sx++){
      const offset=((sx/(width-1))-0.5)*1.05,angle=facing+offset;
      let distance=0.12,hit=false,side=false;
      while(distance<9){
        if(maze3dWall(Math.floor(game.x+Math.cos(angle)*distance),Math.floor(game.y+Math.sin(angle)*distance))){hit=true;side=Math.abs(Math.sin(angle))>Math.abs(Math.cos(angle));break;}
        distance+=0.07;
      }
      const corrected=Math.max(0.3,distance*Math.cos(offset)),wallHeight=hit?Math.min(height,Math.max(1,Math.floor(8.2/corrected))):0;
      const top=Math.floor((height-wallHeight)/2),bottom=top+wallHeight;
      let tile;
      if(hit&&sy>=top&&sy<bottom){
        if(corrected<1.5) tile=side?'🟦':'🟪';
        else if(corrected<3) tile=side?'🟫':'🟦';
        else tile=side?'⬛':'🟪';
      }else if(sy<height/2) tile=((sx+sy)%4===0)?'🌌':'⬛';
      else tile=((sx+sy+Math.floor(game.steps/2))%3===0)?'🟩':'🟫';
      row+=tile;
    }
    rows.push(row);
  }
  const object=maze3dVisibleObject(game);
  if(object){
    const center=4;
    const row=Math.max(0,Math.min(height-1,Math.floor(height/2+(object.distance-2)*0.42)));
    const glyph=object.kind==='enemy'?'👾':object.kind==='crystal'?'💎':'🚪';
    rows[row]=rows[row].slice(0,center*2)+glyph+rows[row].slice((center+1)*2);
  }else{
    const center=4,mid=Math.floor(height/2);
    rows[mid]=rows[mid].slice(0,center*2)+'🎯'+rows[mid].slice((center+1)*2);
  }
  return rows.join('\n');
}
function maze3dControls(){
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('maze3d_forward').setLabel('تقدم ⬆️').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId('maze3d_left').setLabel('لف يسار ↶').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('maze3d_right').setLabel('لف يمين ↷').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('maze3d_back').setLabel('رجوع ⬇️').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('maze3d_pulse').setLabel('نبضة ⚡').setStyle(ButtonStyle.Danger)
    ),
    new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('maze3d_exit').setLabel('إنهاء اللعبة').setEmoji('🛑').setStyle(ButtonStyle.Secondary))
  ];
}
function maze3dMessage(game,prefix){
  const fence=String.fromCharCode(96).repeat(3);
  return (prefix||'🌀 **NEON MAZE 3D | متاهة منظور ثلاثي الأبعاد**')+'\n❤️ الصحة: **'+game.hp+'**   💎 البلورات: **'+game.collected+'/'+game.crystalGoal+'**   👾 الحراس: **'+game.enemies.length+'**\n'+fence+'\n'+maze3dView(game)+'\n'+fence+'\nاجمع البلورات 💎، تفادَ الحراس أو اضربهم بنبضة ⚡، ثم اعثر على 🚪 المخرج. المشهد ثلاثي الأبعاد مُحاكى برسائل 2D.';

}

client.on('interactionCreate', async i => {
  try {
    if (i.isChatInputCommand()) {
      const c = i.commandName;

      if (c === 'العاب') {
        const menu = new StringSelectMenuBuilder()
          .setCustomId('games_menu')
          .setPlaceholder('🎮 اختر لعبة')
          .addOptions([{label:'NEON MAZE 3D',description:'متاهة منظور ثلاثي الأبعاد بإيموجيات داخل ديسكورد',value:'maze3d',emoji:'🌀'}]);
        return i.reply({
          content:'🎮 **اختر اللعبة التي تريد تشغيلها:**',
          components:[new ActionRowBuilder().addComponents(menu)],
          flags:MessageFlags.Ephemeral
        });
      }

      if (c === 'تشغيل-اغنيه') {
        const m = member(i);
        if (!m?.voice?.channel) return i.reply({content:'🎙️ ادخل الروم الصوتي أولاً.',flags:MessageFlags.Ephemeral});
        const songs = getSongs();
        if (!songs.length) return i.reply({content:'📭 ما فيه أغاني. أضف ملفات الصوت إلى مجلد songs.',flags:MessageFlags.Ephemeral});
        const menu = new StringSelectMenuBuilder()
          .setCustomId('music_pick')
          .setPlaceholder('🎵 اختر أغنية')
          .addOptions(songs.slice(0,25).map((f,n)=>({label:songLabel(f).slice(0,100),value:String(n)})));
        const row = new ActionRowBuilder().addComponents(menu);
        const buttons = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId('music_repeat_btn').setLabel('تكرار 🔁').setStyle(ButtonStyle.Secondary),
          new ButtonBuilder().setCustomId('music_stop_btn').setLabel('إيقاف').setEmoji('⏹️').setStyle(ButtonStyle.Danger)
        );
        return i.reply({content:'🎵 **اختر الأغنية:**',components:[row,buttons],flags:MessageFlags.Ephemeral});
      }

      if (c === 'اطفاء-اغنيه') {
        return i.reply({
          content:stopMusic(i.guildId) ? '⏹️ تم إيقاف الموسيقى وخروج البوت.' : 'ما فيه موسيقى شغالة.',
          flags:MessageFlags.Ephemeral
        });
      }

      if (c === 'مؤثره') {
        if (!perms(i, PermissionsBitField.Flags.ManageGuild)) return i.reply({content:'❌ تحتاج صلاحية Manage Server لاستخدام هذا الأمر.',flags:MessageFlags.Ephemeral});
        const bombType = i.options.getString('نوع_القنبلة', true);
        const channel = i.options.getChannel('الروم', true);
        if (!channel.isVoiceBased?.() || !channel.guild) return i.reply({content:'❌ اختر رومًا صوتيًا صالحًا.',flags:MessageFlags.Ephemeral});
        const speedMode = bombType === 'speed';
        const domainExpansionMode = bombType === 'domain_expansion';
        const effects = domainExpansionMode ? getDomainExpansionFiles() : (speedMode ? getBombSpeedFiles() : getBombFiles());
        const folderName = domainExpansionMode ? 'توسيع مجال' : (speedMode ? 'bomb speed' : 'bomb');
        const durationMs = 6000;
        if (!effects.length) return i.reply({content:'📭 مجلد **'+folderName+'** فارغ. ارفع ملف الصوت إليه في GitHub أولًا.',flags:MessageFlags.Ephemeral});
        const file = domainExpansionMode ? effects[0] : (effects.find(f => /tsar|bomba|قنبلة|انفجار/i.test(songLabel(f))) || effects[0]);
        const cp = channel.permissionsFor(i.guild.members.me);
        if (!cp?.has(PermissionsBitField.Flags.Connect) || !cp?.has(PermissionsBitField.Flags.Speak)) return i.reply({content:'❌ البوت يحتاج صلاحيتَي Connect و Speak في الروم المختار.',flags:MessageFlags.Ephemeral});
        if (!cp?.has(PermissionsBitField.Flags.MoveMembers)) return i.reply({content:'❌ البوت يحتاج صلاحية Move Members لفصل الأعضاء من المكالمة.',flags:MessageFlags.Ephemeral});
        await i.deferReply({flags:MessageFlags.Ephemeral});
        try {
          await playVoiceEffect({voice:{channel}}, file, i.guildId, durationMs, async voiceChannel => {
            let disconnected = 0, failed = 0;
            const targets = [...voiceChannel.members.values()].filter(m => m.id !== client.user.id && !m.user.bot);
            for (const target of targets) {
              try {
                if (target.voice.channelId === voiceChannel.id) {
                  await target.voice.disconnect('Timed /مؤثره voice-room action');
                  disconnected++;
                }
              } catch (e) {
                failed++;
                log('VoiceEffect disconnect failed for ' + target.id + ': ' + e.message);
              }
            }
            log('VoiceEffect (' + bombType + ') completed in ' + voiceChannel.id + ': disconnected=' + disconnected + ', failed=' + failed);
          });
          return i.editReply('🔊 بدأ **'+(domainExpansionMode ? 'توسيع مجال 🤞' : (speedMode ? 'قنبله خاطفه 💣' : 'قنبله نوويه 💣'))+'** في '+channel.toString()+'. بعد 6 ثوانٍ سيحاول البوت فصل الأعضاء البشر من المكالمة فقط، بدون ميوت أو طردهم من السيرفر.');
        } catch (e) {
          log('VoiceEffect command error: ' + e.stack);
          return i.editReply('❌ تعذّر تشغيل المؤثر. تأكد من صلاحيات Connect و Speak و Move Members ومن سلامة ملف الصوت.');
        }
      }
      return;
    }

    if (i.isStringSelectMenu() && i.customId === 'games_menu') {
      if (i.values[0] === 'maze3d') {
        const game={x:1,y:1,dir:1,hp:100,steps:0,collected:0,crystalGoal:3,crystals:[{x:3,y:1},{x:5,y:3},{x:1,y:5}],exit:{x:9,y:9},enemies:[{x:7,y:1},{x:9,y:3},{x:5,y:5}]};
        maze3dGames.set(i.user.id,game);
        return i.update({content:maze3dMessage(game),components:maze3dControls()});
      }
    }

    if (i.isButton() && i.customId.startsWith('maze3d_')) {
      const game=maze3dGames.get(i.user.id);
      if(!game)return i.reply({content:'انتهت جلستك. استخدم /العاب لبدء مغامرة جديدة.',flags:MessageFlags.Ephemeral});
      if(i.customId==='maze3d_exit'){maze3dGames.delete(i.user.id);return i.update({content:'🛑 انتهت مغامرة NEON MAZE 3D.',components:[]});}
      if(i.customId==='maze3d_left')game.dir=(game.dir+3)%4;
      else if(i.customId==='maze3d_right')game.dir=(game.dir+1)%4;
      else if(i.customId==='maze3d_forward'||i.customId==='maze3d_back'){
        const dir=MAZE3D_DIRS[game.dir],sign=i.customId==='maze3d_forward'?1:-1,nx=game.x+dir.x*sign,ny=game.y+dir.y*sign;
        if(!maze3dWall(nx,ny)){
          game.x=nx;game.y=ny;game.steps++;
          const ci=game.crystals.findIndex(c=>c.x===game.x&&c.y===game.y);
          if(ci>=0){game.crystals.splice(ci,1);game.collected++;}
          const enemy=game.enemies.find(e=>e.x===game.x&&e.y===game.y);
          if(enemy)game.hp=Math.max(0,game.hp-25);
        }else game.hp=Math.max(0,game.hp-4);
      }else if(i.customId==='maze3d_pulse'){
        const dir=MAZE3D_DIRS[game.dir];let target=null;
        for(let step=1;step<=6;step++){
          const x=game.x+dir.x*step,y=game.y+dir.y*step;
          if(maze3dWall(x,y))break;
          target=game.enemies.find(e=>e.x===x&&e.y===y)||null;
          if(target)break;
        }
        if(target){game.enemies=game.enemies.filter(e=>e!==target);}
        else game.hp=Math.max(0,game.hp-2);
      }
      if(game.hp<=0){maze3dGames.delete(i.user.id);return i.update({content:'💀 **انتهت المغامرة!** استُنفدت صحتك. استخدم /العاب للمحاولة مجددًا.',components:[]});}
      if(game.x===game.exit.x&&game.y===game.exit.y){
        if(game.collected>=game.crystalGoal){maze3dGames.delete(i.user.id);return i.update({content:'🏆 **نجحت في الهروب من NEON MAZE 3D!** جمعت البلورات ووجدت المخرج.',components:[]});}
        return i.update({content:maze3dMessage(game,'🚪 **المخرج مقفل!** اجمع البلورات الثلاث أولًا.'),components:maze3dControls()});
      }
      return i.update({content:maze3dMessage(game),components:maze3dControls()});
    }

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
        content:'🎵 **'+songLabel(s.current)+'**\n'+(s.repeat?'🔁 التكرار: **مفعّل**':'➡️ التكرار: **متوقف**'),
        components:[new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId('music_repeat_btn').setLabel(s.repeat?'إلغاء التكرار':'تكرار 🔁').setStyle(s.repeat?ButtonStyle.Success:ButtonStyle.Secondary),
          new ButtonBuilder().setCustomId('music_stop_btn').setLabel('إيقاف').setEmoji('⏹️').setStyle(ButtonStyle.Danger)
        )]
      });
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