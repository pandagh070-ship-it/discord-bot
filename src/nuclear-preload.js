const { Client, Events, PermissionFlagsBits, MessageFlags, ChannelType } = require("discord.js");
const {
  joinVoiceChannel, createAudioPlayer, createAudioResource,
  entersState, VoiceConnectionStatus, AudioPlayerStatus,
  NoSubscriberBehavior, StreamType
} = require("@discordjs/voice");
const { Readable } = require("node:stream");

const ART = "```text\n              .  *  .\n           *    ☢    *\n              .  *  .\n          .-=========-.\n       .-'  .-------.  '-.\n      /    /  .---.  \\    \\\n     |    |  /     \\  |    |\n     |    |  \\     /  |    |\n      \\    \\  '---'  /    /\n       '-.  '-------'  .-'\n          '-----------'\n             ☢  ETO\n```";

function makeWav(kind) {
  const rate = 48000;
  const seconds = kind === "alarm" ? 5 : 2.2;
  const frames = Math.floor(rate * seconds);
  const pcm = Buffer.alloc(frames * 2);
  for (let i = 0; i < frames; i++) {
    const t = i / rate;
    let sample = 0;
    if (kind === "alarm") {
      const sweep = 440 + 260 * (0.5 + 0.5 * Math.sin(2 * Math.PI * 0.22 * t));
      sample = Math.sin(2 * Math.PI * sweep * t) * (0.45 + 0.25 * Math.sin(2 * Math.PI * 3.1 * t));
    } else {
      const decay = Math.exp(-t * 2.8);
      const low = Math.sin(2 * Math.PI * (58 - 22 * Math.min(t, 1)) * t);
      const mid = Math.sin(2 * Math.PI * 91 * t) * 0.35;
      sample = (low + mid) * decay * 0.82;
    }
    const fade = Math.min(1, (seconds - t) * 8);
    pcm.writeInt16LE(Math.max(-1, Math.min(1, sample * fade)) * 26000, i * 2);
  }
  const header = Buffer.alloc(44);
  header.write("RIFF", 0); header.writeUInt32LE(36 + pcm.length, 4);
  header.write("WAVE", 8); header.write("fmt ", 12);
  header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22); header.writeUInt32LE(rate, 24);
  header.writeUInt32LE(rate * 2, 28); header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34); header.write("data", 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

async function playEffect(player, kind) {
  const wav = makeWav(kind);
  const stream = Readable.from([wav.subarray(44)]);
  const resource = createAudioResource(stream, { inputType: StreamType.Raw });
  await new Promise((resolve, reject) => {
    let started = false;
    const cleanup = () => {
      player.off(AudioPlayerStatus.Playing, onPlaying);
      player.off(AudioPlayerStatus.Idle, onIdle);
      player.off("error", onError);
    };
    const onPlaying = () => { started = true; };
    const onIdle = () => { cleanup(); started ? resolve() : reject(Error("لم يبدأ تشغيل الصوت.")); };
    const onError = e => { cleanup(); reject(e); };
    player.once(AudioPlayerStatus.Playing, onPlaying);
    player.once(AudioPlayerStatus.Idle, onIdle);
    player.once("error", onError);
    player.play(resource);
    setTimeout(() => { cleanup(); resolve(); }, (kind === "alarm" ? 6500 : 3500));
  });
}

async function handleNuclearCommands(i) {
  if (!i.isChatInputCommand()) return;
  if (i.commandName !== "nuclearmag" && i.commandName !== "nuclearvoice") return;
  if (!i.guild || !i.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
    return i.reply({ content: "تحتاج صلاحية إدارة السيرفر لاستخدام هذا الأمر.", flags: MessageFlags.Ephemeral });
  }

  if (i.commandName === "nuclearmag") {
    const target = i.options.getUser("member", true);
    if (target.bot) return i.reply({ content: "اختر عضواً، وليس بوتاً.", flags: MessageFlags.Ephemeral });
    await i.deferReply({ flags: MessageFlags.Ephemeral });
    try {
      await target.send({ content: "☢️ **ETO — تنبيه نووي تجريبي**\n" + ART });
      return i.editReply("تم إرسال رسم نووي واحد إلى الخاص. لن أرسل رسائل متكررة.");
    } catch {
      return i.editReply("تعذر الإرسال؛ قد تكون الرسائل الخاصة مغلقة لدى العضو.");
    }
  }

  const channel = i.options.getChannel("room", true);
  if (channel.type !== ChannelType.GuildVoice && channel.type !== ChannelType.GuildStageVoice) {
    return i.reply({ content: "اختر روم فويس عادي.", flags: MessageFlags.Ephemeral });
  }
  const me = i.guild.members.me;
  const perms = channel.permissionsFor(me);
  if (!perms?.has([PermissionFlagsBits.Connect, PermissionFlagsBits.Speak])) {
    return i.reply({ content: "البوت يحتاج صلاحيتَي Connect وSpeak في الروم.", flags: MessageFlags.Ephemeral });
  }
  await i.deferReply({ flags: MessageFlags.Ephemeral });
  let connection;
  try {
    connection = joinVoiceChannel({
      channelId: channel.id, guildId: i.guildId,
      adapterCreator: i.guild.voiceAdapterCreator,
      selfDeaf: true, selfMute: false
    });
    await entersState(connection, VoiceConnectionStatus.Ready, 20000);
    const player = createAudioPlayer({ behaviors: { noSubscriber: NoSubscriberBehavior.Pause } });
    connection.subscribe(player);
    await playEffect(player, "alarm");
    await new Promise(r => setTimeout(r, 700));
    await playEffect(player, "impact");
    player.stop(true);
    connection.destroy();
    return i.editReply("انتهى المؤثر الصوتي التجريبي. لم يتم طرد أي عضو من الروم.");
  } catch (e) {
    if (connection) { try { connection.destroy(); } catch {} }
    return i.editReply("تعذر تشغيل المؤثر الصوتي: " + String(e.message || e).slice(0, 180));
  }
}

const originalLogin = Client.prototype.login;
Client.prototype.login = function (...args) {
  if (!this.__etoNuclearHandler) {
    this.__etoNuclearHandler = true;
    this.on(Events.InteractionCreate, i => {
      handleNuclearCommands(i).catch(e => console.error("[Nuclear commands]", e));
    });
  }
  return originalLogin.apply(this, args);
};
