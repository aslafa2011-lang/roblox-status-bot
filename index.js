// ===== tiny web server to stay online =====
const express = require('express');
const app = express();
app.get("/", (req, res) => res.send("Bot is alive!"));
app.listen(process.env.PORT || 3000);

// ===== Discord + Roblox bot =====
const { Client, GatewayIntentBits, SlashCommandBuilder, REST, Routes } = require('discord.js');
const axios = require('axios');

const token = process.env.TOKEN;
const clientId = process.env.CLIENT_ID;

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

// Memory storage for tracked users (Resets if bot restarts)
let trackedUsers = new Map(); 

// ===== Slash command registration =====
const commands = [
    new SlashCommandBuilder()
        .setName('status')
        .setDescription('Check Roblox player status')
        .addStringOption(option => 
            option.setName('username').setDescription('Roblox username').setRequired(true)),
    new SlashCommandBuilder()
        .setName('track')
        .setDescription('Get notified when a player’s status changes')
        .addStringOption(option => 
            option.setName('username').setDescription('Roblox username').setRequired(true))
].map(c => c.toJSON());

const rest = new REST({ version: '10' }).setToken(token);

(async () => {
    try {
        await rest.put(Routes.applicationCommands(clientId), { body: commands });
        console.log('Commands registered successfully.');
    } catch (e) { console.error(e); }
})();

// ===== Background Tracker Loop (Every 60 seconds) =====
setInterval(async () => {
    if (trackedUsers.size === 0) return;

    for (const [userId, data] of trackedUsers.entries()) {
        try {
            const presenceRes = await axios.post('https://presence.roblox.com/v1/presence/users', { userIds: [userId] });
            const presence = presenceRes.data.userPresences[0];

            if (presence && presence.userPresenceType !== data.lastStatus) {
                let statusText = "";
                let gameLink = "";

                if (presence.userPresenceType === 2) {
                    statusText = "🎮 **In Game**";
                    if (presence.rootPlaceId) {
                        gameLink = `\n🔗 **Game Link:** https://www.roblox.com/games/${presence.rootPlaceId}`;
                    }
                } else if (presence.userPresenceType === 1) {
                    statusText = "🟢 **Online**";
                } else if (presence.userPresenceType === 0) {
                    statusText = "🔴 **Offline**";
                }

                if (statusText !== "") {
                    data.channels.forEach(async (channelId) => {
                        const channel = await client.channels.fetch(channelId);
                        if (channel) channel.send(`🔔 **Track Update:** **${data.username}** is now ${statusText}${gameLink}`);
                    });
                }

                // Update the last known status
                trackedUsers.set(userId, { ...data, lastStatus: presence.userPresenceType });
            }
        } catch (err) {
            console.error(`Tracking error for ${userId}:`, err.message);
        }
    }
}, 60000);

// ===== Handle interactions =====
client.on('interactionCreate', async interaction => {
    if (!interaction.isChatInputCommand()) return;

    const username = interaction.options.getString('username');

    try {
        // Step 1: Get user ID
        const userRes = await axios.post('https://users.roblox.com/v1/usernames/users', { usernames: [username], excludeBannedUsers: true });
        if (!userRes.data.data.length) return interaction.reply("User not found.");
        const userId = userRes.data.data[0].id;

        // Command: /track
        if (interaction.commandName === 'track') {
            if (!trackedUsers.has(userId)) {
                trackedUsers.set(userId, { username: username, lastStatus: null, channels: [interaction.channelId] });
            } else {
                const existing = trackedUsers.get(userId);
                if (!existing.channels.includes(interaction.channelId)) existing.channels.push(interaction.channelId);
            }
            return interaction.reply(`✅ Now tracking **${username}**. I will notify this channel when their status changes.`);
        }

        // Command: /status
        if (interaction.commandName === 'status') {
            const presenceRes = await axios.post('https://presence.roblox.com/v1/presence/users', { userIds: [userId] });
            const presence = presenceRes.data.userPresences[0];

            let message = "🔴 Offline or not detectable";
            let gameLink = "";

            if (presence) {
                const status = presence.userPresenceType;
                if (status === 2) {
                    message = "🎮 In Game";
                    if (presence.rootPlaceId) {
                        gameLink = `\n🔗 **Game Link:** https://www.roblox.com/games/${presence.rootPlaceId}`;
                    }
                }
                else if (status === 3) message = "🛠️ In Studio";
                else if (status === 1) message = "🟢 Online (not in game)";
            }

            await interaction.reply(`${username} is currently: ${message}${gameLink}`);
        }

    } catch (err) {
        console.error(err);
        await interaction.reply("Error processing your request.");
    }
});

client.login(token);
