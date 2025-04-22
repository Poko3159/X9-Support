const express = require("express");
const fs = require("fs");
const path = require("path");
const {
  Client,
  GatewayIntentBits,
  Events,
  Partials,
  ChannelType,
  EmbedBuilder
} = require("discord.js");
require("dotenv").config();

const app = express();
app.get("/", (req, res) => res.send("Ticket bot is running!"));
const PORT = process.env.PORT || 3000;
app.listen(PORT, "0.0.0.0", () => console.log(`Server running on port ${PORT}`));

// Discord setup
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

client.once(Events.ClientReady, () => {
  console.log(`Logged in as ${client.user.tag}`);
});

// Utility: Save logs to file
function saveLog(userId, channelId, messageData) {
  const dir = path.join(__dirname, "logs");
  const file = path.join(dir, `${userId}.json`);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir);
  let data = [];
  if (fs.existsSync(file)) data = JSON.parse(fs.readFileSync(file));
  const ticket = data.find(t => t.channelId === channelId) || { channelId, messages: [] };
  ticket.messages.push(messageData);
  if (!data.includes(ticket)) data.push(ticket);
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

// Utility: Get user ID from ticket channel name (ticket-username-userid)
function getUserIdFromTicketChannel(name) {
  const parts = name.split("-");
  return parts[parts.length - 1];
}

client.on(Events.MessageCreate, async (message) => {
  if (message.author.bot) return;

  const isDM = message.channel.type === ChannelType.DM;
  const isStaff = message.member?.roles.cache.some(role => role.name === "Staff");

  if (isDM) {
    const user = message.author;
    const guild = client.guilds.cache.first();
    const modmailCategory = guild.channels.cache.find(
      c => c.name.toLowerCase() === "modmails" && c.type === ChannelType.GuildCategory
    );
    const staffRole = guild.roles.cache.find(r => r.name === "Staff");
    if (!modmailCategory || !staffRole) return;

    let ticketChannel = guild.channels.cache.find(c =>
      c.name === `ticket-${user.username.toLowerCase()}-${user.id}`
    );

    if (!ticketChannel) {
      ticketChannel = await guild.channels.create({
        name: `ticket-${user.username.toLowerCase()}-${user.id}`,
        type: ChannelType.GuildText,
        parent: modmailCategory.id,
        permissionOverwrites: [
          {
            id: guild.roles.everyone,
            deny: ['ViewChannel']
          },
          {
            id: staffRole.id,
            allow: ['ViewChannel', 'SendMessages', 'ReadMessageHistory']
          }
        ]
      });
    }

    ticketChannel.send(`**New message from ${user.tag}:**\n${message.content}`);

    saveLog(user.id, ticketChannel.id, {
      author: user.tag,
      content: message.content,
      timestamp: new Date().toISOString()
    });

    return;
  }

  // Guild message: likely from a ticket channel
  if (!isStaff) return;

  if (message.content.startsWith("!r ")) {
    const userId = getUserIdFromTicketChannel(message.channel.name);
    const user = await client.users.fetch(userId).catch(() => null);
    if (!user) return message.reply("Couldn't find user.");

    const replyContent = message.content.slice(3).trim();
    user.send(`**Staff Reply:** ${replyContent}`).catch(() =>
      message.reply("Couldn't DM the user.")
    );
    message.channel.send(`**Replied to ${user.tag}**`);

    saveLog(userId, message.channel.id, {
      author: message.author.tag,
      content: message.content,
      timestamp: new Date().toISOString()
    });

    return;
  }

  if (message.content === "!c") {
    message.channel.send("Ticket has been closed by staff.");
    await message.channel.setLocked(true).catch(() => {});
    await message.channel.setArchived(true).catch(() => {});
    return;
  }

  if (message.content.startsWith("!logs")) {
    const target = message.mentions.users.first();
    if (!target) return message.reply("Mention a user to view logs.");

    const file = path.join(__dirname, "logs", `${target.id}.json`);
    if (!fs.existsSync(file)) return message.reply("No logs found for that user.");

    const logs = JSON.parse(fs.readFileSync(file));
    if (!logs || logs.length === 0) return message.reply("No logs found for that user.");

    let currentPage = 0;

    const formatEmbed = (index) => {
      const ticket = logs[index];
      const messages = ticket.messages
        .map(m => `**${m.author}**: ${m.content}`)
        .join("\n")
        .slice(0, 4000) || "No messages.";
      return new EmbedBuilder()
        .setTitle(`Ticket ${index + 1} of ${logs.length}`)
        .setDescription(messages)
        .setFooter({ text: `Channel ID: ${ticket.channelId}` })
        .setColor(0x2f3136);
    };

    try {
      const dm = await message.author.send({ embeds: [formatEmbed(currentPage)] });
      await dm.react("⬅️");
      await dm.react("➡️");

      const collector = dm.createReactionCollector({
        filter: (reaction, user) =>
          ["⬅️", "➡️"].includes(reaction.emoji.name) && user.id === message.author.id,
        time: 120000
      });

      collector.on("collect", (reaction) => {
        reaction.users.remove(message.author).catch(() => {});
        if (reaction.emoji.name === "➡️") {
          currentPage = (currentPage + 1) % logs.length;
        } else if (reaction.emoji.name === "⬅️") {
          currentPage = (currentPage - 1 + logs.length) % logs.length;
        }
        dm.edit({ embeds: [formatEmbed(currentPage)] });
      });
    } catch (err) {
      console.error("DM error:", err);
      message.reply("Couldn't send logs via DM. Are your DMs open?");
    }

    return;
  }

  // Save internal staff discussion
  const userId = getUserIdFromTicketChannel(message.channel.name);
  saveLog(userId, message.channel.id, {
    author: message.author.tag,
    content: message.content,
    timestamp: new Date().toISOString()
  });
});

client.login(process.env.DISCORD_TOKEN);