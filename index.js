const { Client, GatewayIntentBits, Partials, Events, PermissionsBitField } = require('discord.js');
require('dotenv').config();

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.DirectMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers
  ],
  partials: [Partials.Channel]
});

const MODMAIL_CATEGORY_NAME = 'modmails';
const STAFF_ROLE_NAME = 'Staff';
const ADMIN_ROLE_NAME = 'Admin';

const activeTickets = new Map(); // userId -> channel

client.once(Events.ClientReady, () => {
  console.log(`Logged in as ${client.user.tag}`);
});

client.on(Events.MessageCreate, async (message) => {
  // Ignore bot messages
  if (message.author.bot) return;

  // 1. Handle user DMs to create ticket
  if (message.channel.type === 1) {
    const guild = client.guilds.cache.first(); // assumes bot is in one guild
    if (!guild) return;

    let modmailCategory = guild.channels.cache.find(
      c => c.name === MODMAIL_CATEGORY_NAME && c.type === 4
    );

    if (!modmailCategory) {
      modmailCategory = await guild.channels.create({
        name: MODMAIL_CATEGORY_NAME,
        type: 4 // category
      });
    }

    let ticketChannel = activeTickets.get(message.author.id);

    if (!ticketChannel) {
      ticketChannel = await guild.channels.create({
        name: `ticket-${message.author.username}`,
        type: 0, // text
        parent: modmailCategory.id,
        permissionOverwrites: [
          {
            id: guild.roles.everyone,
            deny: [PermissionsBitField.Flags.ViewChannel]
          },
          {
            id: client.user.id,
            allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages]
          },
          {
            id: guild.roles.cache.find(r => r.name === STAFF_ROLE_NAME)?.id,
            allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages]
          }
        ]
      });

      activeTickets.set(message.author.id, ticketChannel);
      ticketChannel.send(`New ticket opened by **${message.author.tag}**`);
    }

    ticketChannel.send(`**${message.author.tag}:** ${message.content}`);
    return;
  }

  // 2. Handle staff replies or internal notes
  const guild = message.guild;
  if (!guild) return;

  const isStaff = message.member.roles.cache.some(r => r.name === STAFF_ROLE_NAME);
  const isAdmin = message.member.roles.cache.some(r => r.name === ADMIN_ROLE_NAME);
  if (!isStaff) return;

  const ticketOwnerId = [...activeTickets.entries()].find(([, ch]) => ch.id === message.channel.id)?.[0];
  const ticketUser = ticketOwnerId ? await client.users.fetch(ticketOwnerId) : null;

  // !r reply to user
  if (message.content.startsWith('!r ')) {
    if (!ticketUser) return message.channel.send('Cannot find user to reply to.');
    const reply = message.content.slice(3).trim();
    try {
      await ticketUser.send(`**Staff:** ${reply}`);
      message.channel.send(`Replied to **${ticketUser.tag}**`);
    } catch {
      message.channel.send('Failed to send DM. The user may have DMs disabled.');
    }
    return;
  }

  // Internal note (admin-only)
  if (!isAdmin) {
    message.delete().catch(() => {});
    message.channel.send("Only admins can send internal notes without using `!r`.")
      .then(m => setTimeout(() => m.delete().catch(() => {}), 5000));
  }
});
  
client.login(process.env.DISCORD_TOKEN);