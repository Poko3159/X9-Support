const express = require("express");
const fs = require("fs");
const path = require("path");
const {
  Client,
  GatewayIntentBits,
  Partials,
  Events,
  ChannelType,
  EmbedBuilder
} = require("discord.js");
require("dotenv").config();

const app = express();
app.get("/", (_, res) => res.send("Ticket bot is running!"));
const PORT = process.env.PORT || 3000;
app.listen(PORT, "0.0.0.0", () => console.log(`Server running on port ${PORT}`));

// Create logs directory if it doesn't exist
const logsDir = path.join(__dirname, "logs");
if (!fs.existsSync(logsDir)) fs.mkdirSync(logsDir);

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

client.on(Events.MessageCreate, async (message) => {
  if (message.author.bot) return;

  const guild = client.guilds.cache.first(); // assumes one server
  const staffRole = guild.roles.cache.find(r => r.name === "Staff");
  const modmailCategory = guild.channels.cache.find(
    c => c.name.toLowerCase() === "modmails" && c.type === ChannelType.GuildCategory
  );

  // Handle DMs from users
  if (message.channel.type === ChannelType.DM) {
    const existing = guild.channels.cache.find(c =>
      c.name === `ticket-${message.author.id}`
    );

    const logPath = path.join(logsDir, `${message.author.id}.json`);
    const log = fs.existsSync(logPath) ? JSON.parse(fs.readFileSync(logPath)) : [];

    log.push({
      author: message.author.tag,
      content: message.content,
      timestamp: new Date().toISOString()
    });
    fs.writeFileSync(logPath, JSON.stringify(log, null, 2));

    if (existing) {
      existing.send(`**${message.author.tag}:** ${message.content}`);
    } else {
      const ticketChannel = await guild.channels.create({
        name: `ticket-${message.author.id}`,
        type: ChannelType.GuildText,
        parent: modmailCategory?.id,
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

      ticketChannel.send(`New ticket from **${message.author.tag}**`);
      ticketChannel.send(`**${message.author.tag}:** ${message.content}`);
    }

    return;
  }

  // Handle messages in modmail channels
  if (message.channel.name.startsWith("ticket-")) {
    const isStaff = message.member.roles.cache.has(staffRole.id);
    const userId = message.channel.name.split("ticket-")[1];
    const user = await client.users.fetch(userId).catch(() => null);
    const logPath = path.join(logsDir, `${userId}.json`);
    const log = fs.existsSync(logPath) ? JSON.parse(fs.readFileSync(logPath)) : [];

    if (message.content.startsWith("!r ")) {
      if (!isStaff) return message.reply("Only staff can use this command.");
      const reply = message.content.slice(3).trim();

      if (user) user.send(`**Support:** ${reply}`).catch(() => null);
      message.channel.send(`**Replied to ${user?.tag || userId}:** ${reply}`);

      log.push({
        author: message.author.tag,
        content: `STAFF REPLY: ${reply}`,
        timestamp: new Date().toISOString()
      });
      fs.writeFileSync(logPath, JSON.stringify(log, null, 2));
      return;
    }

    // Internal message
    log.push({
      author: message.author.tag,
      content: `INTERNAL: ${message.content}`,
      timestamp: new Date().toISOString()
    });
    fs.writeFileSync(logPath, JSON.stringify(log, null, 2));
    return;
  }

  // Handle !logs @user
  if (message.content.startsWith("!logs")) {
    const isStaff = message.member.roles.cache.has(staffRole.id);
    if (!isStaff) return message.reply("Only staff can use this command.");

    const target = message.mentions.users.first();
    if (!target) return message.reply("Please mention a user.");

    const logPath = path.join(logsDir, `${target.id}.json`);
    if (!fs.existsSync(logPath)) return message.reply("No logs found for that user.");

    const logs = JSON.parse(fs.readFileSync(logPath));
    const pages = [];
    const chunkSize = 10;

    for (let i = 0; i < logs.length; i += chunkSize) {
      const chunk = logs.slice(i, i + chunkSize)
        .map(m => `**${m.author}**: ${m.content}`)
        .join("\n");

      pages.push(
        new EmbedBuilder()
          .setTitle(`Ticket Logs - ${target.tag}`)
          .setDescription(chunk)
          .setColor(0x2f3136)
          .setFooter({ text: `Page ${Math.floor(i / chunkSize) + 1}/${Math.ceil(logs.length / chunkSize)}` })
      );
    }

    let page = 0;
    const dm = await message.author.send({ embeds: [pages[page]] });
    await dm.react('⬅️');
    await dm.react('➡️');

    const collector = dm.createReactionCollector({
      filter: (r, u) => ['⬅️', '➡️'].includes(r.emoji.name) && u.id === message.author.id,
      time: 120000
    });

    collector.on("collect", r => {
      r.users.remove(message.author).catch(() => {});
      if (r.emoji.name === '➡️') page = (page + 1) % pages.length;
      if (r.emoji.name === '⬅️') page = (page - 1 + pages.length) % pages.length;
      dm.edit({ embeds: [pages[page]] });
    });

    return;
  }

  // Handle !c - close ticket
  if (message.content === "!c") {
    const isStaff = message.member.roles.cache.has(staffRole.id);
    if (!isStaff) return message.reply("Only staff can close tickets.");
    if (!message.channel.name.startsWith("ticket-")) return message.reply("This is not a ticket channel.");

    await message.channel.send("Ticket has been closed and this channel will be deleted.");
    await message.channel.delete().catch(() => {});
    return;
  }
});

client.login(process.env.DISCORD_TOKEN);