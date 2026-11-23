require("dotenv").config();
const fs = require("node:fs");
const path = require("node:path");
const {
  REST,
  Routes,
  Client,
  GatewayIntentBits,
  Events,
  SlashCommandBuilder
} = require("discord.js");

const songsDir = path.join(__dirname, "..", "songs");
const allowedExtensions = new Set([".mp3", ".wav", ".ogg", ".flac", ".m4a"]);
fs.mkdirSync(songsDir, { recursive: true });

const songs = fs.readdirSync(songsDir, { withFileTypes: true })
  .filter(entry => entry.isFile() && allowedExtensions.has(path.extname(entry.name).toLowerCase()))
  .map(entry => entry.name)
  .sort((a, b) => a.localeCompare(b))
  .slice(0, 25);

const displayName = filename => path.basename(filename, path.extname(filename));

const commands = [
  new SlashCommandBuilder()
    .setName("music")
    .setDescription("تشغيل أغنية من ملفات البوت")
    .addSubcommand(sub =>
      sub.setName("play")
        .setDescription("اختيار أغنية محفوظة في ملفات البوت")
        .addStringOption(option => {
          option.setName("song").setDescription("الأغنية التي تريد تشغيلها").setRequired(true);
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

(async () => {
  const { DISCORD_TOKEN, CLIENT_ID, GUILD_ID } = process.env;
  if (!DISCORD_TOKEN || !CLIENT_ID) throw new Error("Set DISCORD_TOKEN and CLIENT_ID.");

  const rest = new REST({ version: "10" }).setToken(DISCORD_TOKEN);
  const client = new Client({ intents: [GatewayIntentBits.Guilds] });
  const ready = new Promise(resolve => client.once(Events.ClientReady, resolve));
  await client.login(DISCORD_TOKEN);
  await ready;

  // Remove every old guild command, then register only /music.
  for (const guild of client.guilds.cache.values()) {
    if (GUILD_ID && guild.id === GUILD_ID) continue;
    await rest.put(Routes.applicationGuildCommands(CLIENT_ID, guild.id), { body: [] });
  }

  if (GUILD_ID) {
    await rest.put(Routes.applicationCommands(CLIENT_ID), { body: [] });
    await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), { body: commands });
  } else {
    await rest.put(Routes.applicationCommands(CLIENT_ID), { body: commands });
  }

  console.log("Registered only /music. Local songs: " + songs.length);
  if (songs.length === 0) {
    console.log("No audio files found. Add audio files to songs/ and rerun registration.");
  }

  client.destroy();
})().catch(error => {
  console.error(error);
  process.exit(1);
});
