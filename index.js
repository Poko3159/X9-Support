const express = require("express");
const { Client, GatewayIntentBits, Events, EmbedBuilder, Partials, ChannelType } = require("discord.js");
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
const channelToUserMap = {};

client.once(Events.ClientReady, () => {
  console.log(`Logged in as ${client.user.tag}`);
});

client.on(Events.MessageCreate, async (message) => {
  if (message.author.bot) return;

  const isStaff = message.guild && message.member?.roles.cache.some(role => role.name === "Staff");
  const modmailCategoryName = "modmails";

  // Handle user DM (create ticket)
  if (!message.guild) {
    const userId = message.author.id;
    const guild = client.guilds.cache.first();
    const category = guild.channels.cache.find(c => c.name === modmailCategoryName && c.type === ChannelType.GuildCategory);

    const existingChannel = Object.entries(channelToUserMap).find(([, id]) => id === userId);
    if (existingChannel) {
      const existing = guild.channels.cache.get(existingChannel[0]);
      if (existing) {
        const ticket = userTickets[userId]?.find(t => t.channelId === existing.id);
        ticket?.messages.push({
          author: message.author.tag,
          content: message.content,
          timestamp: new Date().toISOString()
        });
        return existing.send(`New message from **${message.author.tag}**: ${message.content}`);
      }
    }

    const ticketChannel = await guild.channels.create({
      name: `ticket-${message.author.username}`,
      type: ChannelType.GuildText,
      parent: category?.id,
      permissionOverwrites: [
        {
          id: guild.roles.everyone,
          deny: ['ViewChannel']
        },
        {
          id: guild.roles.cache.find(role => role.name === "Staff").id,
          allow: ['ViewChannel', 'SendMessages']
        }
      ]
    });

    channelToUserMap[ticketChannel.id] = userId;
    if (!userTickets[userId]) userTickets[userId] = [];
    userTickets[userId].push({
      channelId: ticketChannel.id,
      messages: [
        {
          author: message.author.tag,
          content: message.content,
          timestamp: new Date().toISOString()
        }
      ]
    });

    ticketChannel.send(`New ticket from <@${message.author.id}> (**${message.author.tag}**)`);
    return;
  }

  // Handle commands and logging inside ticket channel
  const ticketChannel = message.channel;
  const userId = channelToUserMap[ticketChannel.id];
  if (!userId) return;

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
    const user = await client.users.fetch(userId);
    user.send(`**Staff Reply:** ${replyContent}`).catch(() => {
      ticketChannel.send("Failed to send DM to the user.");
    });
    return ticketChannel.send(`**Staff Reply:** ${replyContent}`);
  }

  if (message.content === '!logs') {
    if (!isStaff) return message.reply("Only staff can use this command.");
    
    const logs = userTickets[userId];
    if (!logs || logs.length === 0) return message.reply("No logs found for this user.");

    let currentPage = 0;

    const formatLogEmbed = (index) => {
      const ticket = logs[index];
      const header = `--- Ticket ${index + 1} ---\n`;
      const body = ticket.messages.map(m => `**${m.author}**: ${m.content}`).join('\n');
      const footer = ticket.closedBy ? `\nClosed by ${ticket.closedBy} on ${new Date(ticket.closedAt).toLocaleString()}` : "";
      return new EmbedBuilder()
        .setTitle(`Ticket Logs for <@${userId}>`)
        .setDescription(header + body + footer)
        .setColor(0x2f3136);
    };

    try {
      const logMessage = await message.author.send({ embeds: [formatLogEmbed(currentPage)] });
      await logMessage.react('⬅️');
      await logMessage.react('➡️');

      const filter = (reaction, user) => 
        ['⬅️', '➡️'].includes(reaction.emoji.name) && user.id === message.author.id;

      const collector = logMessage.createReactionCollector({
        filter,
        time: 60000 // 1 minute for reaction collection
      });

      collector.on('collect', (reaction) => {
        reaction.users.remove(message.author);
        if (reaction.emoji.name === '➡️') {
          currentPage = (currentPage + 1) % logs.length;
        } else if (reaction.emoji.name === '⬅️') {
          currentPage = (currentPage - 1 + logs.length) % logs.length;
        }
        logMessage.edit({ embeds: [formatLogEmbed(currentPage)] });
      });

    } catch (err) {
      console.error("Error sending logs:", err);
      message.reply("Couldn't send logs via DM. Are your DMs open?");
    }
  }

  if (message.content === '!c') {
    if (!isStaff) return message.reply("Only staff can close tickets.");

    const ticket = userTickets[userId].find(t => t.channelId === ticketChannel.id);
    if (ticket) {
      ticket.closedBy = message.author.tag;
      ticket.closedAt = new Date().toISOString();
    }

    await ticketChannel.send("Ticket has been closed and will be deleted in 5 seconds.");
    setTimeout(() => {
      ticketChannel.delete().catch(() => {});
      delete channelToUserMap[ticketChannel.id];
    }, 5000);
    return;
  }
});

client.login(process.env.DISCORD_TOKEN);
