require("dotenv").config();
const fs = require("node:fs");
const path = require("node:path");
const { REST, Routes, Client, GatewayIntentBits, Events, SlashCommandBuilder } = require("discord.js");

const songsDir = path.join(__dirname, "..", "songs");
const allowedExtensions = new Set([".mp3", ".wav", ".ogg", ".flac", ".m4a"]);
fs.mkdirSync(songsDir, { recursive: true });
const songs = fs.readdirSync(songsDir, { withFileTypes: true })
  .filter(entry => entry.isFile() && allowedExtensions.has(path.extname(entry.name).toLowerCase()))
  .map(entry => entry.name).sort((a, b) => a.localeCompare(b)).slice(0, 25);
const displayName = filename => path.basename(filename, path.extname(filename));

const musicCommand = new SlashCommandBuilder()
  .setName("music").setDescription("تشغيل الموسيقى")
  .addSubcommand(sub => sub.setName("play").setDescription("تشغيل ملف أو رابط YouTube أو Spotify")
    .addStringOption(option => {
      option.setName("song").setDescription("أغنية محفوظة في songs").setRequired(false);
      for (const song of songs) option.addChoices({ name: displayName(song).slice(0, 100), value: song });
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

const commands = [musicCommand, talkingCommand].map(command => command.toJSON());

(async () => {
  const { DISCORD_TOKEN, CLIENT_ID, GUILD_ID } = process.env;
  if (!DISCORD_TOKEN || !CLIENT_ID) throw new Error("Set DISCORD_TOKEN and CLIENT_ID.");
  const rest = new REST({ version: "10" }).setToken(DISCORD_TOKEN);
  const client = new Client({ intents: [GatewayIntentBits.Guilds] });
  const ready = new Promise(resolve => client.once(Events.ClientReady, resolve));
  await client.login(DISCORD_TOKEN);
  await ready;
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
  console.log("Registered /music and /talking.");
  client.destroy();
})().catch(error => { console.error(error); process.exit(1); });
