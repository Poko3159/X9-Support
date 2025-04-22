const express = require("express");
const fs = require("fs");
const path = require("path");
const { Client, GatewayIntentBits, Events, EmbedBuilder, Partials, ChannelType, PermissionsBitField } = require("discord.js");
require("dotenv").config();

// Express to keep bot alive
const app = express();
app.get("/", (req, res) => res.send("Bot is running!"));
app.listen(process.env.PORT || 3000, () => console.log("Express server ready"));

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

const TICKET_LOG_DIR = './logs';
if (!fs.existsSync(TICKET_LOG_DIR)) fs.mkdirSync(TICKET_LOG_DIR);

client.once(Events.ClientReady, () => {
  console.log(`Logged in as ${client.user.tag}`);
});

// Util: Save a ticket log to disk
function saveTicket(userId, ticket) {
  const filePath = path.join(TICKET_LOG_DIR, `${userId}.json`);
  let logs = [];
  if (fs.existsSync(filePath)) {
    logs = JSON.parse(fs.readFileSync(filePath));
  }
  logs.push(ticket);
  fs.writeFileSync(filePath, JSON.stringify(logs, null, 2));
}

// Handle DMs and commands
client.on(Events.MessageCreate, async (message) => {
  if (message.author.bot) return;

  // Check if DM
  if (message.channel.type === ChannelType.DM) {
    const guild = client.guilds.cache.first(); // assumes bot is only in one server
    const modmailCategory = guild.channels.cache.find(c => c.name.toLowerCase() === 'modmails' && c.type === ChannelType.GuildCategory);
    if (!modmailCategory) return console.error("Modmails category not found");

    const existingChannel = guild.channels.cache.find(c => c.name === `ticket-${message.author.id}`);
    let channel = existingChannel;

    if (!channel) {
      const staffRole = guild.roles.cache.find(role => role.name === "Staff");
      channel = await guild.channels.create({
        name: `ticket-${message.author.id}`,
        type: ChannelType.GuildText,
        parent: modmailCategory.id,
        permissionOverwrites: [
          { id: guild.roles.everyone, deny: [PermissionsBitField.Flags.ViewChannel] },
          { id: staffRole.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages] }
        ]
      });

      channel.send(`New ticket from **${message.author.tag}**`);
    }

    channel.send(`**${message.author.tag}:** ${message.content}`);

    // Save the message
    const ticket = {
      channelId: channel.id,
      messages: [{
        author: message.author.tag,
        content: message.content,
        timestamp: new Date().toISOString()
      }]
    };
    saveTicket(message.author.id, ticket);
    return;
  }

  // In guild: handle commands
  const isStaff = message.member?.roles.cache.some(role => role.name === "Staff");
  const ticketOwnerId = message.channel.name?.startsWith('ticket-') ? message.channel.name.split('-')[1] : null;

  if (message.content.startsWith("!r ")) {
    if (!isStaff || !ticketOwnerId) return;
    const user = await client.users.fetch(ticketOwnerId);
    const reply = message.content.slice(3).trim();
    user.send(`**Staff Reply:** ${reply}`).catch(() => message.reply("Couldn't DM user."));
    message.channel.send(`**Replied to ${user.tag}:** ${reply}`);
    return;
  }

  if (message.content === "!c") {
    if (!isStaff || !ticketOwnerId) return;
    await message.channel.send("Ticket closed.");
    await message.channel.setLocked(true).catch(() => {});
    await message.channel.setArchived(true).catch(() => {});
    return;
  }

  if (message.content.startsWith("!logs")) {
    if (!isStaff) return message.reply("Only staff can use this.");
    const target = message.mentions.users.first();
    if (!target) return message.reply("Mention a user to view logs.");
    const filePath = path.join(TICKET_LOG_DIR, `${target.id}.json`);
    if (!fs.existsSync(filePath)) return message.reply("No logs found.");
    const logs = JSON.parse(fs.readFileSync(filePath));

    let currentPage = 0;

    const formatEmbed = (index) => {
      const ticket = logs[index];
      const messages = ticket.messages.map(m => `**${m.author}**: ${m.content}`).join('\n').slice(0, 4000);
      return new EmbedBuilder()
        .setTitle(`Ticket ${index + 1} of ${logs.length}`)
        .setDescription(messages || "No messages")
        .setFooter({ text: `Channel ID: ${ticket.channelId}` })
        .setColor(0x2f3136);
    };

    try {
      const dm = await message.author.send({ embeds: [formatEmbed(currentPage)] });
      await dm.react("⬅️");
      await dm.react("➡️");

      const collector = dm.createReactionCollector({
        filter: (r, u) => ["⬅️", "➡️"].includes(r.emoji.name) && u.id === message.author.id,
        time: 120000
      });

      collector.on("collect", (r) => {
        r.users.remove(message.author).catch(() => {});
        currentPage = r.emoji.name === "➡️" ? (currentPage + 1) % logs.length : (currentPage - 1 + logs.length) % logs.length;
        dm.edit({ embeds: [formatEmbed(currentPage)] });
      });
    } catch (err) {
      message.reply("Couldn't DM you the logs.");
    }

    return;
  }

  // Internal staff discussion in ticket
  if (ticketOwnerId && isStaff && !message.content.startsWith("!")) {
    return message.react("📝"); // just mark as an internal note
  }
});

client.login(process.env.DISCORD_TOKEN);