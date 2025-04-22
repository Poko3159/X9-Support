const express = require("express");
const { Client, GatewayIntentBits, Events, EmbedBuilder, Partials } = require("discord.js");
require("dotenv").config();

// Create the express app
const app = express();
app.get("/", (req, res) => res.send("Ticket bot is running!"));

const PORT = process.env.PORT || 3000;
app.listen(PORT, "0.0.0.0", () => console.log(`Server running on port ${PORT}`));

// Discord bot setup
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.DirectMessages
  ],
  partials: [Partials.Channel] // needed for DMs
});

// In-memory ticket log structure
const userTickets = {};

// Handle bot login
client.once(Events.ClientReady, () => {
  console.log(`Logged in as ${client.user.tag}`);
});

// Handle incoming messages
client.on(Events.MessageCreate, async (message) => {
  if (message.author.bot) return;

  const isStaff = message.member?.roles.cache.some(role => role.name === "Staff");
  const ticketChannel = message.channel;
  const userId = message.author.id;

  // Store messages by user and channel
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

  // Handle !r <message>
  if (message.content.startsWith('!r ')) {
    if (!isStaff) return message.reply("Only staff can use this command.");
    const replyContent = message.content.slice(3).trim();
    return ticketChannel.send(`**Staff Reply:** ${replyContent}`);
  }

  // Handle !logs @user with reaction-based pagination
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
      return new EmbedBuilder()
        .setTitle(`Ticket ${index + 1} of ${logs.length}`)
        .setDescription(messages)
        .setFooter({ text: `Channel ID: ${ticket.channelId}` })
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

  // Handle !c - close ticket
  if (message.content === '!c') {
    if (!isStaff) return message.reply("Only staff can close tickets.");
    await ticketChannel.send("Ticket has been closed by staff.");
    await ticketChannel.setLocked(true).catch(() => {});
    await ticketChannel.setArchived(true).catch(() => {});
    return;
  }
});

// Start the bot
client.login(process.env.DISCORD_TOKEN);