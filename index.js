client.on(Events.MessageCreate, async (message) => {
  if (message.author.bot) return;

  const isStaff = message.guild && message.member?.roles.cache.some(role => role.name === "Staff");
  const modmailCategoryName = "modmails";

  // Handle user DM (create ticket)
  if (!message.guild) {
    console.log(`[DEBUG] DM received from ${message.author.tag}: ${message.content}`); // <-- Debug log here

    const userId = message.author.id;
    const guild = client.guilds.cache.first();
    const category = guild.channels.cache.find(c => c.name === modmailCategoryName && c.type === ChannelType.GuildCategory);

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
    const newTicket = {
      channelId: ticketChannel.id,
      messages: []
    };
    userTickets[userId].push(newTicket);
    saveTicketData();

    ticketChannel.send({
      content: `📬 New ticket from <@${message.author.id}> (**${message.author.tag}**)`,
      allowedMentions: { users: [] }
    });

    const firstMessage = {
      author: message.author.tag,
      content: message.content,
      timestamp: new Date().toISOString()
    };
    newTicket.messages.push(firstMessage);
    saveTicketData();
    ticketChannel.send(`**${firstMessage.author}:** ${firstMessage.content}`);
    return;
  }

  // rest of your command handling...
});
