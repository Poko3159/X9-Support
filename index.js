const { Client, GatewayIntentBits, Events, EmbedBuilder, ChannelType, PermissionsBitField } = require('discord.js');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.DirectMessages
  ],
  partials: ['CHANNEL']
});

const LOGS_FILE = path.join(__dirname, "logs.json");
let userTickets = fs.existsSync(LOGS_FILE)
  ? JSON.parse(fs.readFileSync(LOGS_FILE, "utf-8"))
  : {};

function saveLogsToFile() {
  fs.writeFileSync(LOGS_FILE, JSON.stringify(userTickets, null, 2));
}

const MODMAIL_CATEGORY_NAME = 'modmails';

client.once(Events.ClientReady, () => {
  console.log(`Logged in as ${client.user.tag}`);
});

client.on(Events.MessageCreate, async (message) => {
  if (message.author.bot) return;

  // Handle DMs from users (create ticket)
  if (message.channel.type === ChannelType.DM) {
    const guild = client.guilds.cache.first();
    if (!guild) return;

    const category = guild.channels.cache.find(c =>
      c.type === ChannelType.GuildCategory &&
      c.name.toLowerCase() === MODMAIL_CATEGORY_NAME
    );

    if (!category) {
      console.error(`Category '${MODMAIL_CATEGORY_NAME}' not found.`);
      return;
    }

    let channel = guild.channels.cache.find(c => c.topic === `UserID: ${message.author.id}`);

    if (!channel) {
      channel = await guild.channels.create({
        name: `ticket-${message.author.username}`,
        type: ChannelType.GuildText,
        parent: category.id,
        topic: `UserID: ${message.author.id}`,
        permissionOverwrites: [
          {
            id: guild.roles.everyone,
            deny: [PermissionsBitField.Flags.ViewChannel],
          },
          {
            id: guild.roles.cache.find(r => r.name === "Staff").id,
            allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages],
          }
        ]
      });

      channel.send(`New ticket opened by **${message.author.tag}** (${message.author.id})`);
    }

    channel.send(`**User:** ${message.content}`);

    if (!userTickets[message.author.id]) {
      userTickets[message.author.id] = [];
    }

    let ticket = userTickets[message.author.id].find(t => t.channelId === channel.id);
    if (!ticket) {
      ticket = { channelId: channel.id, messages: [] };
      userTickets[message.author.id].push(ticket);
    }

    ticket.messages.push({
      author: message.author.tag,
      content: message.content,
      timestamp: new Date().toISOString()
    });

    saveLogsToFile();
    return;
  }

  // From inside a modmail channel
  const isStaff = message.member?.roles.cache.some(r => r.name === "Staff");
  const ticketChannel = message.channel;
  const ticketOwnerId = Object.keys(userTickets).find(uid =>
    userTickets[uid].some(t => t.channelId === ticketChannel.id)
  );

  if (!ticketOwnerId) return;

  const ticket = userTickets[ticketOwnerId].find(t => t.channelId === ticketChannel.id);

  ticket.messages.push({
    author: message.author.tag,
    content: message.content,
    timestamp: new Date().toISOString()
  });

  saveLogsToFile();

  // Staff replies with !r
  if (message.content.startsWith('!r ')) {
    if (!isStaff) return message.reply("Only staff can use this command.");
    const replyContent = message.content.slice(3).trim();
    const user = await client.users.fetch(ticketOwnerId);
    user.send(`**Staff:** ${replyContent}`).catch(() => {
      message.reply("Failed to send message to user.");
    });
    return;
  }

  // Staff closes ticket
  if (message.content === '!c') {
    if (!isStaff) return message.reply("Only staff can close tickets.");
    await ticketChannel.send("Ticket has been closed by staff.");
    await ticketChannel.setLocked(true).catch(() => {});
    await ticketChannel.setArchived(true).catch(() => {});
    return;
  }

  // Staff views logs
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

  // Any other message = internal note
  if (isStaff) {
    ticketChannel.send(`*Internal note by ${message.author.tag}:* ${message.content}`);
  }
});

client.login(process.env.DISCORD_TOKEN);