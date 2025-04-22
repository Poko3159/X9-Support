const express = require("express");
const { Client, GatewayIntentBits, Events, EmbedBuilder, Partials } = require("discord.js");
const fs = require("fs");
const path = require("path");
require("dotenv").config();

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

const userTickets = {};

client.once(Events.ClientReady, () => {
  console.log(`Logged in as ${client.user.tag}`);
});

client.on(Events.MessageCreate, async (message) => {
  if (message.author.bot) return;

  const isStaff = message.member?.roles.cache.some(role => role.name === "Staff");
  const ticketChannel = message.channel;
  const userId = message.author.id;

  if (!userTickets[userId]) userTickets[userId] = [];

  let ticket = userTickets[userId].find(t => t.channelId === ticketChannel.id);
  if (!ticket) {
    ticket = { channelId: ticketChannel.id, messages: [] };
    userTickets[userId].push(ticket);
  }

  ticket.messages.push({
    author: message.author.tag,
    content: message.content,
    timestamp: new Date().toISOString()
  });

  if (message.content.startsWith('!r ')) {
    if (!isStaff) return message.reply("Only staff can use this command.");
    const replyContent = message.content.slice(3).trim();
    return ticketChannel.send(`**Staff Reply:** ${replyContent}`);
  }

  if (message.content.startsWith('!logs')) {
    if (!isStaff) return message.reply("Only staff can use this command.");
    const target = message.mentions.users.first();
    if (!target) return message.reply("Mention a user to view logs.");

    const logs = userTickets[target.id];
    if (!logs || logs.length === 0) return message.reply("No logs found for that user.");

    let currentPage = 0;

    const formatEmbed = (index) => {
      const ticket = logs[index];
      const messages = ticket.messages.map(m => `**${m.author}**: ${m.content}`).join('\n').slice(0, 4000) || "No messages.";
      let footer = `Channel ID: ${ticket.channelId}`;
      if (ticket.closedBy && ticket.closedAt) {
        footer += ` • Closed by ${ticket.closedBy} on ${new Date(ticket.closedAt).toLocaleString()}`;
      }
      return new EmbedBuilder()
        .setTitle(`Ticket ${index + 1} of ${logs.length}`)
        .setDescription(messages)
        .setFooter({ text: footer })
        .setColor(0x2f3136);
    };

    try {
      const dm = await message.author.send({ embeds: [formatEmbed(currentPage)] });
      await dm.react('⬅️');
      await dm.react('➡️');

      const collector = dm.createReactionCollector({
        filter: (reaction, user) =>
          ['⬅️', '➡️'].includes(reaction.emoji.name) && user.id === message.author.id,
        time: 120000
      });

      collector.on('collect', (reaction) => {
        reaction.users.remove(message.author).catch(() => {});
        if (reaction.emoji.name === '➡️') {
          currentPage = (currentPage + 1) % logs.length;
        } else if (reaction.emoji.name === '⬅️') {
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

  if (message.content === '!c') {
    if (!isStaff) return message.reply("Only staff can close tickets.");

    // Find ticket for this channel and mark it closed
    for (const [uid, tickets] of Object.entries(userTickets)) {
      const t = tickets.find(t => t.channelId === ticketChannel.id);
      if (t) {
        t.closedBy = message.author.tag;
        t.closedAt = new Date().toISOString();
        break;
      }
    }

    await ticketChannel.send("Ticket has been closed and will be deleted in 5 seconds.");
    setTimeout(() => {
      ticketChannel.delete().catch(() => {});
    }, 5000);
    return;
  }
});

client.login(process.env.DISCORD_TOKEN);
