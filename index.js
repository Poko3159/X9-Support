const express = require("express");
const { Client, GatewayIntentBits, Events, EmbedBuilder, Partials, ChannelType, SlashCommandBuilder, REST, Routes } = require("discord.js");
const fs = require("fs");
const path = require("path");
require("dotenv").config();
const axios = require("axios");

const app = express();
app.get("/", (req, res) => res.send("Ticket bot is running!"));

const PORT = process.env.PORT || 3000;
app.listen(PORT, "0.0.0.0", () => console.log(`Server running on port ${PORT}`));

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.DirectMessages
  ],
  partials: [Partials.Channel]
});

const LOGS_DIR = path.join(__dirname, "logs");
if (!fs.existsSync(LOGS_DIR)) fs.mkdirSync(LOGS_DIR);

const DATA_FILE = path.join(__dirname, "ticketData.json");

let userTickets = {};
let channelToUserMap = {};

if (fs.existsSync(DATA_FILE)) {
  const raw = JSON.parse(fs.readFileSync(DATA_FILE));
  userTickets = raw.userTickets || {};
  channelToUserMap = raw.channelToUserMap || {};
}

let saveTimeout;
function saveTicketData() {
  clearTimeout(saveTimeout);
  saveTimeout = setTimeout(() => {
    const tempFile = DATA_FILE + ".tmp";
    fs.writeFile(tempFile, JSON.stringify({ userTickets, channelToUserMap }, null, 2), (err) => {
      if (err) {
        console.error("Error writing ticket data:", err);
        return;
      }
      fs.rename(tempFile, DATA_FILE, (err) => {
        if (err) console.error("Error renaming temp ticket data file:", err);
      });
    });
  }, 1000);
}

client.once(Events.ClientReady, async () => {
  console.log(`Logged in as ${client.user.tag}`);

  const commands = [
    new SlashCommandBuilder()
      .setName("infomember")
      .setDescription("Get info about a FiveM player")
      .addUserOption(option =>
        option.setName("user").setDescription("User to look up").setRequired(true)
      )
      .toJSON()
  ];

  const rest = new REST({ version: "10" }).setToken(process.env.DISCORD_TOKEN);
  try {
    await rest.put(
      Routes.applicationCommands(client.user.id),
      { body: commands }
    );
    console.log("Slash commands registered.");
  } catch (err) {
    console.error("Error registering commands:", err);
  }
});

client.on(Events.InteractionCreate, async interaction => {
  if (!interaction.isChatInputCommand()) return;

  if (interaction.commandName === "infomember") {
    const isStaff = interaction.member?.roles.cache.some(role => role.name === "Staff");
    if (!isStaff) return interaction.reply({ content: "Only staff can use this command.", ephemeral: true });

    const user = interaction.options.getUser("user");

    try {
      const response = await axios.get(`http://localhost:40120/api/playerinfo/${user.id}`, {
        headers: {
          Authorization: `Bearer ${process.env.TXADMIN_API_TOKEN}`
        }
      });

      const data = response.data;

      const embed = new EmbedBuilder()
        .setTitle(`Player Info: ${user.tag}`)
        .addFields(
          { name: "Warnings", value: data.warnings?.join("\n") || "None", inline: false },
          { name: "Bans", value: data.bans?.join("\n") || "None", inline: false },
          { name: "Playtime", value: data.playtime || "Unknown", inline: false },
          { name: "Notes", value: data.notes?.join("\n") || "None", inline: false }
        )
        .setColor(0x2f3136);

      return interaction.reply({ embeds: [embed] });
    } catch (err) {
      console.error("Failed to fetch player info:", err);
      return interaction.reply({ content: "Failed to fetch player data.", ephemeral: true });
    }
  }
});

client.login(process.env.DISCORD_TOKEN);
