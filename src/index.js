require("dotenv").config();

const fs = require("node:fs");
const path = require("node:path");
const {
  Client,
  GatewayIntentBits,
  Events,
  MessageFlags,
  SlashCommandBuilder
} = require("discord.js");
const {
  joinVoiceChannel,
  createAudioPlayer,
  createAudioResource,
  AudioPlayerStatus,
  VoiceConnectionStatus,
  entersState,
  NoSubscriberBehavior
} = require("@discordjs/voice");

const ffmpegPath = require("ffmpeg-static");
if (ffmpegPath) {
  process.env.PATH = path.dirname(ffmpegPath) + path.delimiter + process.env.PATH;
}

if (!process.env.DISCORD_TOKEN) throw new Error("DISCORD_TOKEN missing");

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

function stopSession(guildId) {
  const session = sessions.get(guildId);
  if (!session) return;
  session.player.stop(true);
  try { session.connection.destroy(); } catch {}
  sessions.delete(guildId);
}

async function playSong(interaction, filename) {
  const voiceChannel = interaction.member?.voice?.channel;
  if (!voiceChannel) {
    return interaction.reply({
      content: "ادخل روم صوتي أولاً، ثم اختر الأغنية.",
      flags: MessageFlags.Ephemeral
    });
  }

  const songs = listSongs();
  if (!songs.includes(filename)) {
    return interaction.reply({
      content: "الأغنية غير موجودة في مجلد songs. حدّث قائمة الملفات ثم جرّب مجدداً.",
      flags: MessageFlags.Ephemeral
    });
  }

  const filePath = path.join(songsDir, filename);
  const connection = joinVoiceChannel({
    channelId: voiceChannel.id,
    guildId: interaction.guildId,
    adapterCreator: interaction.guild.voiceAdapterCreator,
    selfDeaf: true
  });

  try {
    await entersState(connection, VoiceConnectionStatus.Ready, 20_000);
    const player = createAudioPlayer({
      behaviors: { noSubscriber: NoSubscriberBehavior.Pause }
    });
    const resource = createAudioResource(filePath);
    const previous = sessions.get(interaction.guildId);
    if (previous) {
      previous.player.stop(true);
      try { previous.connection.destroy(); } catch {}
    }

    const session = { connection, player, filename };
    sessions.set(interaction.guildId, session);
    connection.subscribe(player);
    player.play(resource);

    player.once(AudioPlayerStatus.Idle, () => {
      if (sessions.get(interaction.guildId) === session) {
        try { connection.destroy(); } catch {}
        sessions.delete(interaction.guildId);
      }
    });

    player.on("error", error => {
      console.error("Music player error:", error);
      if (sessions.get(interaction.guildId) === session) {
        try { connection.destroy(); } catch {}
        sessions.delete(interaction.guildId);
      }
    });

    return interaction.reply({
      content: "🎵 الآن تعمل: **" + displayName(filename) + "**",
      flags: MessageFlags.Ephemeral
    });
  } catch (error) {
    try { connection.destroy(); } catch {}
    throw error;
  }
}

const commands = [
  new SlashCommandBuilder()
    .setName("music")
    .setDescription("تشغيل أغنية من ملفات البوت")
    .addSubcommand(sub =>
      sub.setName("play")
        .setDescription("اختيار أغنية محفوظة في ملفات البوت")
        .addStringOption(option => {
          option.setName("song").setDescription("الأغنية التي تريد تشغيلها").setRequired(true);
          const songs = listSongs().slice(0, 25);
          for (const song of songs) {
            option.addChoices({ name: displayName(song).slice(0, 100), value: song });
          }
          return option;
        })
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

    const filename = interaction.options.getString("song", true);
    return await playSong(interaction, filename);
  } catch (error) {
    console.error("Music command error:", error);
    const message = "تعذر تشغيل الأغنية. تأكد من أن الملف سليم وأن البوت يملك صلاحيات Connect وSpeak. (" +
      String(error.message || error).slice(0, 180) + ")";
    if (interaction.deferred || interaction.replied) {
      await interaction.followUp({ content: message, flags: MessageFlags.Ephemeral }).catch(() => {});
    } else {
      await interaction.reply({ content: message, flags: MessageFlags.Ephemeral }).catch(() => {});
    }
  }
});

client.on(Events.Error, error => console.error("Discord client error:", error));
client.login(process.env.DISCORD_TOKEN);
