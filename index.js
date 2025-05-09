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

const DATA_FILE = path.join(__dirname, "ticketData.json");

let userTickets = {};
let channelToUserMap = {};

if (fs.existsSync(DATA_FILE)) {
  const raw = JSON.parse(fs.readFileSync(DATA_FILE));
  userTickets = raw.userTickets || {};
  channelToUserMap = raw.channelToUserMap || {};
}

// Debounced file save
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
        if (err) console.error("Error renaming temp file:", err);
      });
    });
  }, 1000);
}

client.once(Events.ClientReady, () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
});

client.on(Events.MessageCreate, async (message) => {
  if (message.author.bot) return;

  const isStaff = message.guild && message.member?.roles.cache.some(role => role.name === "Staff");
  const modmailCategoryName = "modmails";

  // 🔍 Handle DMs (ticket creation)
  if (!message.guild) {
    console.log(`📩 DM from ${message.author.tag}: ${message.content}`);

    const userId = message.author.id;
    const guild = client.guilds.cache.first();
    if (!guild) return console.error("❌ No guilds found!");

    const category = guild.channels.cache.find(c => c.name === modmailCategoryName && c.type === ChannelType.GuildCategory);
    if (!category) return console.error("❌ Modmail category not found!");

    const staffRole = guild.roles.cache.find(role => role.name === "Staff");
    if (!staffRole) return console.error("❌ Staff role not found!");

    const existingChannel = Object.entries(channelToUserMap).find(([, id]) => id === userId);
    if (existingChannel) {
      const existing = guild.channels.cache.get(existingChannel[0]);
      if (existing) {
        const ticket = userTickets[userId]?.find(t => t.channelId === existing.id);
        const msg = {
          author: message.author.tag,
          content: message.content,
          timestamp: new Date().toISOString()
        };
        ticket?.messages.push(msg);
        saveTicketData();
        existing.send(`**${message.author.tag}:** ${message.content}`);
        return;
      }
    }

    const ticketChannel = await guild.channels.create({
      name: `ticket-${message.author.username}`,
      type: ChannelType.GuildText,
      parent: category.id,
      permissionOverwrites: [
        {
          id: guild.roles.everyone,
          deny: ['ViewChannel']
        },
        {
          id: staffRole.id,
          allow: ['ViewChannel', 'SendMessages']
        }
      ]
    });

    console.log(`🆕 Created ticket channel: ${ticketChannel.name}`);

    channelToUserMap[ticketChannel.id] = userId;
    if (!userTickets[userId]) userTickets[userId] = [];

    const newTicket = {
      channelId: ticketChannel.id,
      messages: []
    };
    userTickets[userId].push(newTicket);
    saveTicketData();

    const firstMessage = {
      author: message.author.tag,
      content: message.content,
      timestamp: new Date().toISOString()
    };
    newTicket.messages.push(firstMessage);
    saveTicketData();

    ticketChannel.send({
      content: `📬 New ticket from <@${message.author.id}> (**${message.author.tag}**)\n<@&${staffRole.id}> **A new ticket has arrived**`,
      allowedMentions: { roles: [staffRole.id] }
    });

    ticketChannel.send(`**${firstMessage.author}:** ${firstMessage.content}`);
    return;
  }

  // 🎯 Ticket channel message handling
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
  saveTicketData();

  if (message.content.startsWith('!r ')) {
    if (!isStaff) return message.reply("Only staff can use this command.");
    const replyContent = message.content.slice(3).trim();
    const user = await client.users.fetch(userId);
    user.send(`**Staff Reply:** ${replyContent}`).catch(() => {
      ticketChannel.send("⚠️ Failed to send DM to the user.");
    });
    return ticketChannel.send(`**Staff Reply:** ${replyContent}`);
  }

  if (message.content.toLowerCase() === '!awaitingresponse') {
    if (!isStaff) return message.reply("Only staff can use this command.");
    const user = await client.users.fetch(userId);
    user.send("Hello. We are still awaiting a response. Please reply at your earliest convenience. The X9 Staff Team").catch(() => {
      ticketChannel.send("⚠️ Failed to send DM to the user.");
    });
    return ticketChannel.send("**Reminder sent:** Awaiting response.");
  }

  if (message.content.toLowerCase() === '!hi') {
    if (!isStaff) return message.reply("Only staff can use this command.");
    const user = await client.users.fetch(userId);
    user.send("Hello! How can we help?").catch(() => {
      ticketChannel.send("⚠️ Failed to send DM to the user.");
    });
    return ticketChannel.send("**Greeting sent:** Hello message sent.");
  }

  if (message.content === '!logs') {
    if (!isStaff) return message.reply("Only staff can use this command.");
    const logs = userTickets[userId];
    if (!logs || logs.length === 0) return message.reply("No logs found for this user.");

    const formattedLogs = logs.map((ticket, index) => {
      const header = `--- Ticket ${index + 1} (Channel: ${ticket.channelId}) ---\n`;
      const body = ticket.messages.map(m => `**${m.author}**: ${m.content}`).join('\n');
      const footer = ticket.closedBy ? `\nClosed by ${ticket.closedBy} on ${new Date(ticket.closedAt).toLocaleString()}` : "";
      return `${header}${body}${footer}`;
    }).join('\n\n');

    return message.reply({
      embeds: [
        new EmbedBuilder()
          .setTitle("Ticket Logs")
          .setDescription(formattedLogs.slice(0, 4000))
          .setColor(0x2f3136)
      ]
    });
  }

  if (message.content === '!c') {
    if (!isStaff) return message.reply("Only staff can close tickets.");

    const ticket = userTickets[userId].find(t => t.channelId === ticketChannel.id);
    if (ticket) {
      ticket.closedBy = message.author.tag;
      ticket.closedAt = new Date().toISOString();
      saveTicketData();
    }

    const user = await client.users.fetch(userId);
    user.send("Your ticket has been closed by the X9 Staff team. If you need further assistance, feel free to message us again.").catch(() => {
      ticketChannel.send("⚠️ Could not notify the user about ticket closure.");
    });

    await ticketChannel.send("🗑 Ticket will be deleted in 5 seconds.");
    setTimeout(() => {
      ticketChannel.delete().catch(() => {});
      delete channelToUserMap[ticketChannel.id];
      saveTicketData();
    }, 5000);
    return;
  }
});

client.login(process.env.DISCORD_TOKEN);