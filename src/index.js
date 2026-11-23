require("dotenv").config();

const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { Readable } = require("node:stream");
const youtubedl = require("youtube-dl-exec");
const {
  Client, GatewayIntentBits, Events, MessageFlags, SlashCommandBuilder,
  ChannelType
} = require("discord.js");
const {
  joinVoiceChannel, createAudioPlayer, createAudioResource,
  AudioPlayerStatus, VoiceConnectionStatus, entersState,
  NoSubscriberBehavior, StreamType
} = require("@discordjs/voice");

const ffmpegPath = require("ffmpeg-static");
if (!process.env.DISCORD_TOKEN) throw new Error("DISCORD_TOKEN missing");
if (!ffmpegPath) throw new Error("ffmpeg-static binary is unavailable");

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});
const songsDir = path.join(__dirname, "..", "songs");
const sessions = new Map();
const talkingModes = new Map();
const conversations = new Map();
const allowedExtensions = new Set([".mp3", ".wav", ".ogg", ".flac", ".m4a"]);
const AI_API_KEY = process.env.AI_API_KEY || process.env.OPENAI_API_KEY ||
  process.env.GROQ_API_KEY || process.env.DEEPSEEK_API_KEY || "";
const AI_BASE_URL = (process.env.AI_BASE_URL || "https://api.openai.com/v1").replace(/\/$/, "");
const AI_MODEL = process.env.AI_MODEL || "gpt-4o-mini";
const TTS_API_KEY = process.env.TTS_API_KEY || AI_API_KEY;
const TTS_BASE_URL = (process.env.TTS_BASE_URL || "https://api.openai.com/v1").replace(/\/$/, "");
const TTS_MODEL = process.env.TTS_MODEL || "gpt-4o-mini-tts";
const TTS_VOICE = process.env.TTS_VOICE || "alloy";

function listSongs() {
  fs.mkdirSync(songsDir, { recursive: true });
  return fs.readdirSync(songsDir, { withFileTypes: true })
    .filter(entry => entry.isFile() && allowedExtensions.has(path.extname(entry.name).toLowerCase()))
    .map(entry => entry.name)
    .sort((a, b) => a.localeCompare(b));
}
function displayName(filename) {
  return path.basename(filename, path.extname(filename));
}
function parseSupportedUrl(value) {
  let url;
  try { url = new URL(value); } catch { return null; }
  if (url.protocol !== "https:" || url.username || url.password) return null;
  const host = url.hostname.toLowerCase();
  const youtubeHosts = new Set(["youtube.com", "www.youtube.com", "m.youtube.com", "music.youtube.com", "youtu.be"]);
  if (youtubeHosts.has(host)) return { type: "youtube", url: url.toString() };
  if (host === "open.spotify.com" && /^\/(?:intl-[^/]+\/)?track\/[A-Za-z0-9]+\/?$/.test(url.pathname)) {
    return { type: "spotify", url: url.toString() };
  }
  return null;
}
async function fetchWithTimeout(url, options = {}, timeoutMs = 45000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}
async function resolveMediaUrl(inputUrl) {
  const parsed = parseSupportedUrl(inputUrl);
  if (!parsed) throw new Error("الرابط غير مدعوم. أرسل رابط أغنية من YouTube أو Spotify.");
  let target = parsed.url;
  let trackLabel = "";

  if (parsed.type === "spotify") {
    let response;
    let lastError;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        response = await fetchWithTimeout(
          "https://open.spotify.com/oembed?url=" + encodeURIComponent(parsed.url),
          { headers: { "User-Agent": "Mozilla/5.0 EtoDiscordBot/1.0" } },
          45000
        );
        if (response.ok) break;
        lastError = new Error("Spotify metadata HTTP " + response.status);
      } catch (error) {
        lastError = error;
      }
      if (attempt < 2) await new Promise(resolve => setTimeout(resolve, 1200 * (attempt + 1)));
    }
    if (!response?.ok) {
      throw new Error("Spotify تأخر في الرد أو رفض الرابط. جرّب رابط أغنية مباشر أو أعد المحاولة.");
    }
    const metadata = await response.json();
    if (!metadata.title || !metadata.author_name) {
      throw new Error("تعذر استخراج اسم الأغنية والفنان من Spotify.");
    }
    trackLabel = metadata.author_name + " - " + metadata.title;
    target = "ytsearch1:" + trackLabel;
  }

  let output;
  try {
    output = await youtubedl(target, {
      getUrl: true,
      format: "bestaudio[ext=m4a]/bestaudio/best",
      noPlaylist: true,
      quiet: true,
      noWarnings: true,
      socketTimeout: 45,
      retries: 3,
      extractorRetries: 2
    });
  } catch (error) {
    const detail = String(error.message || error);
    if (/abort|timeout|timed out/i.test(detail)) {
      throw new Error("انتهت مهلة الاتصال بمصدر الأغنية. أعد المحاولة أو جرّب رابطاً آخر.");
    }
    throw new Error("فشل استخراج الصوت من YouTube: " + detail.slice(0, 120));
  }
  const mediaUrl = String(output).trim().split(/\r?\n/)[0];
  if (!mediaUrl || !/^https?:\/\//i.test(mediaUrl)) {
    throw new Error("لم أتمكن من استخراج رابط الصوت من المصدر.");
  }
  return { mediaUrl, trackLabel };
}
function destroySession(session) {
  if (!session) return;
  session.player.stop(true);
  if (session.ffmpeg && !session.ffmpeg.killed) session.ffmpeg.kill("SIGKILL");
  try { session.connection.destroy(); } catch {}
}
function stopSession(guildId) {
  const session = sessions.get(guildId);
  if (!session) return;
  destroySession(session);
  sessions.delete(guildId);
}
async function playSong(interaction, filename, audioUrl) {
  const voiceChannel = interaction.member?.voice?.channel;
  if (!voiceChannel) {
    return interaction.reply({ content: "ادخل روم صوتي أولاً، ثم اختر الأغنية.", flags: MessageFlags.Ephemeral });
  }
  const remote = Boolean(audioUrl);
  if (!remote && !listSongs().includes(filename)) {
    return interaction.reply({ content: "الأغنية غير موجودة في مجلد songs.", flags: MessageFlags.Ephemeral });
  }
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const connection = joinVoiceChannel({
    channelId: voiceChannel.id, guildId: interaction.guildId,
    adapterCreator: interaction.guild.voiceAdapterCreator, selfDeaf: true
  });
  let ffmpeg = null;
  try {
    await entersState(connection, VoiceConnectionStatus.Ready, 25000);
    let mediaUrl = null;
    let trackLabel = "";
    if (remote) {
      const resolved = await resolveMediaUrl(audioUrl);
      mediaUrl = resolved.mediaUrl;
      trackLabel = resolved.trackLabel;
    }
    const player = createAudioPlayer({ behaviors: { noSubscriber: NoSubscriberBehavior.Pause } });
    let resource;
    if (remote) {
      ffmpeg = spawn(ffmpegPath, [
        "-nostdin", "-hide_banner", "-loglevel", "error",
        "-reconnect", "1", "-reconnect_streamed", "1", "-reconnect_delay_max", "5",
        "-i", mediaUrl, "-vn", "-f", "s16le", "-ar", "48000", "-ac", "2", "pipe:1"
      ], { stdio: ["ignore", "pipe", "pipe"] });
      ffmpeg.stderr.on("data", chunk => console.error("FFmpeg:", String(chunk).slice(0, 300)));
      resource = createAudioResource(ffmpeg.stdout, { inputType: StreamType.Raw });
    } else {
      resource = createAudioResource(path.join(songsDir, filename));
    }
    stopSession(interaction.guildId);
    const session = { connection, player, filename, ffmpeg };
    sessions.set(interaction.guildId, session);
    connection.subscribe(player);
    player.play(resource);
    player.once(AudioPlayerStatus.Idle, () => {
      if (sessions.get(interaction.guildId) === session) {
        if (ffmpeg && !ffmpeg.killed) ffmpeg.kill("SIGKILL");
        try { connection.destroy(); } catch {}
        sessions.delete(interaction.guildId);
      }
    });
    player.on("error", error => {
      console.error("Music player error:", error);
      if (sessions.get(interaction.guildId) === session) {
        if (ffmpeg && !ffmpeg.killed) ffmpeg.kill("SIGKILL");
        try { connection.destroy(); } catch {}
        sessions.delete(interaction.guildId);
      }
    });
    if (ffmpeg) {
      ffmpeg.on("error", error => console.error("FFmpeg process error:", error));
      ffmpeg.on("close", code => { if (code && code !== 0) console.error("FFmpeg exited with code", code); });
    }
    const label = remote ? (trackLabel || "YouTube") : displayName(filename);
    return interaction.editReply("🎵 الآن تعمل: **" + label.slice(0, 180) + "**");
  } catch (error) {
    if (ffmpeg && !ffmpeg.killed) ffmpeg.kill("SIGKILL");
    try { connection.destroy(); } catch {}
    throw error;
  }
}

async function askAI(channelId, user, content) {
  if (!AI_API_KEY) throw new Error("مفتاح الذكاء الاصطناعي غير مضبوط. أضف AI_API_KEY في Secrets.");
  const history = conversations.get(channelId) || [];
  const messages = [
    { role: "system", content: "أنت مساعد ديسكورد ودود ومختصر. أجب بلغة الشخص الذي يكتب لك، ولا تستخدم Markdown معقداً." },
    ...history,
    { role: "user", content: user + ": " + content.slice(0, 3500) }
  ];
  const response = await fetchWithTimeout(AI_BASE_URL + "/chat/completions", {
    method: "POST",
    headers: { "Authorization": "Bearer " + AI_API_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ model: AI_MODEL, messages, temperature: 0.7, max_tokens: 500 })
  }, 60000);
  if (!response.ok) {
    const body = await response.text();
    throw new Error("AI API " + response.status + ": " + body.slice(0, 180));
  }
  const data = await response.json();
  const answer = data.choices?.[0]?.message?.content;
  if (!answer) throw new Error("خدمة الذكاء الاصطناعي لم ترجع إجابة.");
  const clean = String(answer).slice(0, 1900);
  const next = [...history, { role: "user", content: user + ": " + content.slice(0, 3500) }, { role: "assistant", content: clean }].slice(-12);
  conversations.set(channelId, next);
  return clean;
}
async function synthesizeSpeech(text) {
  if (!TTS_API_KEY) throw new Error("مفتاح تحويل النص إلى صوت غير مضبوط.");
  const response = await fetchWithTimeout(TTS_BASE_URL + "/audio/speech", {
    method: "POST",
    headers: { "Authorization": "Bearer " + TTS_API_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ model: TTS_MODEL, voice: TTS_VOICE, input: text.slice(0, 3500), response_format: "mp3" })
  }, 90000);
  if (!response.ok) {
    const body = await response.text();
    throw new Error("TTS API " + response.status + ": " + body.slice(0, 160));
  }
  return Buffer.from(await response.arrayBuffer());
}
async function speakInVoice(session, text) {
  const audio = await synthesizeSpeech(text);
  const ffmpeg = spawn(ffmpegPath, [
    "-hide_banner", "-loglevel", "error", "-i", "pipe:0",
    "-f", "s16le", "-ar", "48000", "-ac", "2", "pipe:1"
  ], { stdio: ["pipe", "pipe", "pipe"] });
  session.ffmpeg = ffmpeg;
  ffmpeg.stdin.end(audio);
  const resource = createAudioResource(ffmpeg.stdout, { inputType: StreamType.Raw });
  session.player.play(resource);
  await new Promise((resolve, reject) => {
    const onIdle = () => { cleanup(); resolve(); };
    const onError = error => { cleanup(); reject(error); };
    const cleanup = () => {
      session.player.off(AudioPlayerStatus.Idle, onIdle);
      session.player.off("error", onError);
    };
    session.player.once(AudioPlayerStatus.Idle, onIdle);
    session.player.once("error", onError);
  });
  if (!ffmpeg.killed) ffmpeg.kill("SIGKILL");
  session.ffmpeg = null;
}
function stopTalking(channelId) {
  const mode = talkingModes.get(channelId);
  if (!mode) return false;
  talkingModes.delete(channelId);
  if (mode.voiceSession) {
    mode.voiceSession.player.stop(true);
    if (mode.voiceSession.ffmpeg && !mode.voiceSession.ffmpeg.killed) mode.voiceSession.ffmpeg.kill("SIGKILL");
    try { mode.voiceSession.connection.destroy(); } catch {}
  }
  conversations.delete(channelId);
  return true;
}

const musicCommand = new SlashCommandBuilder()
  .setName("music").setDescription("تشغيل الموسيقى")
  .addSubcommand(sub => sub.setName("play").setDescription("تشغيل ملف أو رابط YouTube أو Spotify")
    .addStringOption(option => {
      option.setName("song").setDescription("أغنية محفوظة في songs").setRequired(false);
      for (const song of listSongs().slice(0, 25)) option.addChoices({ name: displayName(song).slice(0, 100), value: song });
      return option;
    })
    .addStringOption(option => option.setName("url").setDescription("رابط أغنية YouTube أو Spotify").setRequired(false)))
  .addSubcommand(sub => sub.setName("stop").setDescription("إيقاف الموسيقى"));

const talkingCommand = new SlashCommandBuilder()
  .setName("talking").setDescription("تشغيل مساعد الذكاء الاصطناعي")
  .addSubcommand(sub => sub.setName("ai").setDescription("تفعيل الردود الذكية في هذه القناة"))
  .addSubcommand(sub => sub.setName("stop").setDescription("إيقاف المساعد في هذه القناة"))
  .addSubcommandGroup(group => group.setName("voice").setDescription("مساعد صوتي")
    .addSubcommand(sub => sub.setName("ai").setDescription("دخول رومك الصوتي والتحدث بالذكاء الاصطناعي")));

client.once(Events.ClientReady, readyClient => {
  console.log("Eto Bot ready as " + readyClient.user.tag);
  console.log("Available local songs: " + listSongs().length);
});

client.on(Events.MessageCreate, async message => {
  if (!message.guild || message.author.bot || !message.content.trim()) return;
  const mode = talkingModes.get(message.channelId);
  if (!mode) return;
  try {
    const answer = await askAI(message.channelId, message.member?.displayName || message.author.username, message.content);
    await message.reply({ content: answer, allowedMentions: { repliedUser: false } });
    if (mode.voiceSession) {
      mode.voiceQueue = (mode.voiceQueue || Promise.resolve())
        .then(() => speakInVoice(mode.voiceSession, answer))
        .catch(error => {
          console.error("Voice AI error:", error);
          message.channel.send("تعذر تحويل الرد إلى صوت. تحقق من إعدادات TTS.").catch(() => {});
        });
    }
  } catch (error) {
    console.error("Talking AI error:", error);
    await message.reply({
      content: "تعذر الحصول على رد من الذكاء الاصطناعي: " + String(error.message || error).slice(0, 220),
      allowedMentions: { repliedUser: false }
    }).catch(() => {});
  }
});

client.on(Events.InteractionCreate, async interaction => {
  if (!interaction.isChatInputCommand()) return;
  try {
    if (interaction.commandName === "music") {
      const action = interaction.options.getSubcommand();
      if (action === "stop") {
        stopSession(interaction.guildId);
        return interaction.reply({ content: "⏹️ تم إيقاف الموسيقى ومغادرة الروم الصوتي.", flags: MessageFlags.Ephemeral });
      }
      const filename = interaction.options.getString("song");
      const audioUrl = interaction.options.getString("url");
      if (Boolean(filename) === Boolean(audioUrl)) {
        return interaction.reply({ content: "حدد خياراً واحداً فقط: song أو url.", flags: MessageFlags.Ephemeral });
      }
      return await playSong(interaction, filename, audioUrl);
    }

    if (interaction.commandName === "talking") {
      const group = interaction.options.getSubcommandGroup(false);
      const action = interaction.options.getSubcommand();
      const textChannel = interaction.channel;
      if (!textChannel || textChannel.type !== ChannelType.GuildText) {
        return interaction.reply({ content: "استخدم الأمر داخل قناة نصية عادية.", flags: MessageFlags.Ephemeral });
      }
      if (group === "voice" && action === "ai") {
        if (!AI_API_KEY) {
          return interaction.reply({ content: "لم أجد مفتاح AI_API_KEY في إعدادات البوت.", flags: MessageFlags.Ephemeral });
        }
        if (!TTS_API_KEY) {
          return interaction.reply({ content: "أضف مفتاح TTS_API_KEY لتحويل الردود إلى صوت.", flags: MessageFlags.Ephemeral });
        }
        const voiceChannel = interaction.member?.voice?.channel;
        if (!voiceChannel) {
          return interaction.reply({ content: "ادخل روم صوتي أولاً ثم استخدم الأمر.", flags: MessageFlags.Ephemeral });
        }
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        const connection = joinVoiceChannel({
          channelId: voiceChannel.id, guildId: interaction.guildId,
          adapterCreator: interaction.guild.voiceAdapterCreator, selfDeaf: true
        });
        try {
          await entersState(connection, VoiceConnectionStatus.Ready, 25000);
          stopTalking(textChannel.id);
          stopSession(interaction.guildId);
          const player = createAudioPlayer({ behaviors: { noSubscriber: NoSubscriberBehavior.Pause } });
          const voiceSession = { connection, player, ffmpeg: null };
          connection.subscribe(player);
          talkingModes.set(textChannel.id, { voiceSession, voiceQueue: Promise.resolve() });
          return interaction.editReply("🎙️ دخلت **" + voiceChannel.name + "**. اكتب رسالتك في هذه القناة النصية وسأرد كتابةً وصوتاً. لإيقافي استخدم /talking stop.");
        } catch (error) {
          try { connection.destroy(); } catch {}
          throw error;
        }
      }
      if (action === "stop") {
        const stopped = stopTalking(textChannel.id);
        return interaction.reply({ content: stopped ? "تم إيقاف مساعد الذكاء الاصطناعي ومغادرة الروم الصوتي." : "المساعد غير مفعّل في هذه القناة.", flags: MessageFlags.Ephemeral });
      }
      if (group === null && action === "ai") {
        if (!AI_API_KEY) {
          return interaction.reply({ content: "لم أجد مفتاح AI_API_KEY في إعدادات البوت.", flags: MessageFlags.Ephemeral });
        }
        talkingModes.set(textChannel.id, { voiceSession: null, voiceQueue: Promise.resolve() });
        conversations.set(textChannel.id, []);
        return interaction.reply({ content: "تم تفعيل الذكاء الاصطناعي في هذه القناة. اكتب أي رسالة وسأرد عليك هنا.", flags: MessageFlags.Ephemeral });
      }
    }
  } catch (error) {
    console.error("Command error:", error);
    const message = "حدث خطأ: " + String(error.message || error).slice(0, 220);
    if (interaction.deferred || interaction.replied) {
      await interaction.followUp({ content: message, flags: MessageFlags.Ephemeral }).catch(() => {});
    } else {
      await interaction.reply({ content: message, flags: MessageFlags.Ephemeral }).catch(() => {});
    }
  }
});

client.on(Events.Error, error => console.error("Discord client error:", error));
client.login(process.env.DISCORD_TOKEN);
