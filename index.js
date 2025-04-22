const { 
  Client, GatewayIntentBits, Partials, ChannelType, Events, PermissionsBitField, EmbedBuilder 
} = require('discord.js');
require('dotenv').config();

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.DirectMessages
  ],
  partials: [Partials.Channel]
});

// In-memory logs
const userLogs = {}; // { userId: [ { author, content, timestamp } ] }
const userTickets = {}; // { userId: channelId }

client.once(Events.ClientReady, () => {
  console.log(`Logged in as ${client.user.tag}`);
});

client.on(Events.MessageCreate, async (message) => {
  if (message.author.bot) return;

  const guild = client.guilds.cache.first();

  // User sends a DM to the bot
  if (message.channel.type === ChannelType.DM) {
    const modmailCategory = guild.channels.cache.find(c => c.name.toLowerCase() === 'modmails' && c.type === ChannelType.GuildCategory);
    if (!modmailCategory) return console.error("No 'modmails' category found.");

    let channel = guild.channels.cache.find(c => c.topic === `UserID: ${message.author.id}`);
    if (!channel) {
      channel = await guild.channels.create({
        name: `ticket-${message.author.username.toLowerCase()}`,
        type: ChannelType.GuildText,
        parent: modmailCategory.id,
        topic: `UserID: ${message.author.id}`,
        permissionOverwrites: [
          {
            id: guild.roles.cache.find(r => r.name === "Staff").id,
            allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages]
          },
          {
            id: guild.roles.everyone,
            deny: [PermissionsBitField.Flags.ViewChannel]
          }
        ]
      });

      await channel.send(`New ticket from **${message.author.tag}** (${message.author.id})`);
    }

    userTickets[message.author.id] = channel.id;

    logMessage(message.author.id, message.author.tag, message.content);

    return channel.send(`**${message.author.tag}**: ${message.content}`);
  }

  // Inside a ticket channel
  if (message.channel.parent?.name.toLowerCase() === 'modmails') {
    const isStaff = message.member?.roles.cache.some(role => role.name === "Staff");
    if (!isStaff) return;

    const userId = message.channel.topic?.split("UserID: ")[1];
    if (!userId) return;

    if (message.content.startsWith('!r ')) {
      const reply = message.content.slice(3).trim();
      try {
        const user = await client.users.fetch(userId);
        await user.send(`**Staff Reply:** ${reply}`);
        await message.channel.send(`✉️ Replied to **${user.tag}**`);
        logMessage(userId, `Staff (${message.author.tag})`, reply);
      } catch (err) {
        console.error("Failed to DM user:", err);
        message.channel.send("❌ Could not send the message to the user.");
      }
    }

    else if (message.content === '!c') {
      await message.channel.send("Ticket has been closed.");
      await message.channel.setLocked(true).catch(() => {});
      await message.channel.setArchived(true).catch(() => {});
    }

    else if (message.content.startsWith('!logs')) {
      const target = message.mentions.users.first();
      if (!target) return message.reply("Mention a user to view logs.");

      const logs = userLogs[target.id];
      if (!logs || logs.length === 0) return message.reply("No logs found for that user.");

      let currentPage = 0;

      const formatEmbed = (index) => {
        const start = index * 10;
        const pageLogs = logs.slice(start, start + 10);
        const description = pageLogs.map(log =>
          `**${log.author}**: ${log.content} (${new Date(log.timestamp).toLocaleString()})`
        ).join('\n');

        return new EmbedBuilder()
          .setTitle(`Logs for ${target.tag} (Page ${index + 1}/${Math.ceil(logs.length / 10)})`)
          .setDescription(description || "No messages.")
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
            if ((currentPage + 1) * 10 < logs.length) currentPage++;
          } else if (reaction.emoji.name === '⬅️') {
            if (currentPage > 0) currentPage--;
          }
          dm.edit({ embeds: [formatEmbed(currentPage)] });
        });

      } catch (err) {
        console.error("DM error:", err);
        message.reply("Couldn't send logs via DM. Are your DMs open?");
      }
    }

    else {
      // Internal discussion
      logMessage(userId, `Internal (${message.author.tag})`, message.content);
    }
  }
});

function logMessage(userId, author, content) {
  if (!userLogs[userId]) userLogs[userId] = [];
  userLogs[userId].push({
    author,
    content,
    timestamp: Date.now()
  });
}

client.login(process.env.DISCORD_TOKEN);