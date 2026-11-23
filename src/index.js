require("dotenv").config();

const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");
const youtubedl = require("youtube-dl-exec");
const {
  Client, GatewayIntentBits, Events, MessageFlags, SlashCommandBuilder
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
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates]
});
const songsDir = path.join(__dirname, "..", "songs");
const sessions = new Map();
const allowedExtensions = new Set([".mp3", ".wav", ".ogg", ".flac", ".m4a"]);

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
  const youtubeHosts = new Set([
    "youtube.com", "www.youtube.com", "m.youtube.com", "music.youtube.com", "youtu.be"
  ]);
  if (youtubeHosts.has(host)) return { type: "youtube", url: url.toString() };

  if (host === "open.spotify.com" && /^\/(?:intl-[^/]+\/)?track\/[A-Za-z0-9]+\/?$/.test(url.pathname)) {
    return { type: "spotify", url: url.toString() };
  }

  return null;
}

async function resolveMediaUrl(inputUrl) {
  const parsed = parseSupportedUrl(inputUrl);
  if (!parsed) {
    throw new Error("الرابط غير مدعوم. أرسل رابط أغنية من YouTube أو Spotify.");
  }

  let target = parsed.url;
  let trackLabel = "";

  if (parsed.type === "spotify") {
    const response = await fetch(
      "https://open.spotify.com/oembed?url=" + encodeURIComponent(parsed.url),
      { signal: AbortSignal.timeout(12_000) }
    );
    if (!response.ok) throw new Error("تعذر قراءة بيانات رابط Spotify.");
    const metadata = await response.json();
    if (!metadata.title || !metadata.author_name) {
      throw new Error("لم أستطع استخراج اسم الأغنية والفنان من Spotify.");
    }
    trackLabel = metadata.author_name + " - " + metadata.title;
    target = "ytsearch1:" + trackLabel;
  }

  const output = await youtubedl(target, {
    getUrl: true,
    format: "bestaudio/best",
    noPlaylist: true,
    quiet: true,
    noWarnings: true,
    socketTimeout: 20
  });
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
    return interaction.reply({
      content: "ادخل روم صوتي أولاً، ثم اختر الأغنية.",
      flags: MessageFlags.Ephemeral
    });
  }

  const remote = Boolean(audioUrl);
  const songs = listSongs();
  if (!remote && !songs.includes(filename)) {
    return interaction.reply({
      content: "الأغنية غير موجودة في مجلد songs.",
      flags: MessageFlags.Ephemeral
    });
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const connection = joinVoiceChannel({
    channelId: voiceChannel.id,
    guildId: interaction.guildId,
    adapterCreator: interaction.guild.voiceAdapterCreator,
    selfDeaf: true
  });
  let ffmpeg = null;

  try {
    await entersState(connection, VoiceConnectionStatus.Ready, 20_000);

    let mediaUrl = null;
    let trackLabel = "";
    if (remote) {
      const resolved = await resolveMediaUrl(audioUrl);
      mediaUrl = resolved.mediaUrl;
      trackLabel = resolved.trackLabel;
    }

    const player = createAudioPlayer({
      behaviors: { noSubscriber: NoSubscriberBehavior.Pause }
    });

    let resource;
    if (remote) {
      ffmpeg = spawn(ffmpegPath, [
        "-nostdin", "-hide_banner", "-loglevel", "error", "-re",
        "-i", mediaUrl, "-vn", "-f", "s16le", "-ar", "48000", "-ac", "2", "pipe:1"
      ], { stdio: ["ignore", "pipe", "pipe"] });
      ffmpeg.stderr.on("data", chunk => console.error("FFmpeg:", String(chunk).slice(0, 300)));
      resource = createAudioResource(ffmpeg.stdout, { inputType: StreamType.Raw });
    } else {
      resource = createAudioResource(path.join(songsDir, filename));
    }

    const previous = sessions.get(interaction.guildId);
    if (previous) destroySession(previous);

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
      ffmpeg.on("close", code => {
        if (code && code !== 0) console.error("FFmpeg exited with code", code);
      });
    }

    const label = remote ? (trackLabel || "YouTube") : displayName(filename);
    return interaction.editReply("🎵 الآن تعمل: **" + label.slice(0, 180) + "**");
  } catch (error) {
    if (ffmpeg && !ffmpeg.killed) ffmpeg.kill("SIGKILL");
    try { connection.destroy(); } catch {}
    throw error;
  }
}

const commands = [
  new SlashCommandBuilder()
    .setName("music")
    .setDescription("تشغيل الموسيقى")
    .addSubcommand(sub =>
      sub.setName("play")
        .setDescription("تشغيل أغنية من ملف أو YouTube أو Spotify")
        .addStringOption(option => {
          option.setName("song").setDescription("أغنية محفوظة في البوت").setRequired(false);
          for (const song of listSongs().slice(0, 25)) {
            option.addChoices({ name: displayName(song).slice(0, 100), value: song });
          }
          return option;
        })
        .addStringOption(option =>
          option.setName("url")
            .setDescription("رابط أغنية YouTube أو Spotify")
            .setRequired(false)
        )
    )
    .addSubcommand(sub =>
      sub.setName("stop").setDescription("إيقاف الأغنية ومغادرة الروم الصوتي")
    )
].map(command => command.toJSON());

client.once(Events.ClientReady, readyClient => {
  console.log("Eto Music Bot ready as " + readyClient.user.tag);
  console.log("Available local songs: " + listSongs().length);
});

client.on(Events.InteractionCreate, async interaction => {
  if (!interaction.isChatInputCommand() || interaction.commandName !== "music") return;
  try {
    const action = interaction.options.getSubcommand();
    if (action === "stop") {
      stopSession(interaction.guildId);
      return interaction.reply({
        content: "⏹️ تم إيقاف الموسيقى ومغادرة الروم الصوتي.",
        flags: MessageFlags.Ephemeral
      });
    }

    const filename = interaction.options.getString("song");
    const audioUrl = interaction.options.getString("url");
    if (Boolean(filename) === Boolean(audioUrl)) {
      return interaction.reply({
        content: "حدد خياراً واحداً فقط: song أو url.",
        flags: MessageFlags.Ephemeral
      });
    }
    return await playSong(interaction, filename, audioUrl);
  } catch (error) {
    console.error("Music command error:", error);
    const message = "تعذر تشغيل الأغنية: " + String(error.message || error).slice(0, 180);
    if (interaction.deferred || interaction.replied) {
      await interaction.followUp({ content: message, flags: MessageFlags.Ephemeral }).catch(() => {});
    } else {
      await interaction.reply({ content: message, flags: MessageFlags.Ephemeral }).catch(() => {});
    }
  }
});

client.on(Events.Error, error => console.error("Discord client error:", error));
client.login(process.env.DISCORD_TOKEN);
