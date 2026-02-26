// ===== tiny web server =====
const express = require('express');
const app = express();
app.get("/", (req, res) => res.send("Bot is alive!"));
app.listen(process.env.PORT || 3000);

// ===== Discord + Roblox bot =====
const {
    Client,
    GatewayIntentBits,
    SlashCommandBuilder,
    REST,
    Routes,
    EmbedBuilder
} = require('discord.js');

const axios = require('axios');
const fs = require('fs');

const token = process.env.TOKEN;
const clientId = process.env.CLIENT_ID;

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

const DATA_FILE = "./tracked.json";
let trackedUsers = new Map();

// ===== Load Saved Data =====
if (fs.existsSync(DATA_FILE)) {
    const raw = JSON.parse(fs.readFileSync(DATA_FILE));
    for (const id in raw) {
        trackedUsers.set(id, raw[id]);
    }
}

function saveData() {
    const obj = Object.fromEntries(trackedUsers);
    fs.writeFileSync(DATA_FILE, JSON.stringify(obj, null, 2));
}

// ===== Slash Commands =====
const commands = [
    new SlashCommandBuilder()
        .setName('track')
        .setDescription('Track a Roblox player')
        .addStringOption(o =>
            o.setName('username').setDescription('Roblox username').setRequired(true)),

    new SlashCommandBuilder()
        .setName('untrack')
        .setDescription('Stop tracking a player')
        .addStringOption(o =>
            o.setName('username').setDescription('Roblox username').setRequired(true)),

    new SlashCommandBuilder()
        .setName('list')
        .setDescription('List tracked users'),

    new SlashCommandBuilder()
        .setName('clear')
        .setDescription('Remove ALL tracked users'),

    new SlashCommandBuilder()
        .setName('status')
        .setDescription('Check Roblox player status')
        .addStringOption(o =>
            o.setName('username').setDescription('Roblox username').setRequired(true))

].map(c => c.toJSON());

const rest = new REST({ version: '10' }).setToken(token);

(async () => {
    try {
        await rest.put(Routes.applicationCommands(clientId), { body: commands });
        console.log("Commands registered.");
    } catch (e) { console.error(e); }
})();

// ===== Helper: Get Game Name =====
async function getGameName(placeId) {
    try {
        const res = await axios.get(`https://games.roblox.com/v1/games?universeIds=${placeId}`);
        if (res.data.data.length > 0) {
            return res.data.data[0].name;
        }
    } catch (err) {}
    return "Unknown Game";
}

// ===== TRACK LOOP (15 seconds) =====
setInterval(async () => {

    for (const [userId, data] of trackedUsers.entries()) {

        try {
            const presenceRes = await axios.post(
                'https://presence.roblox.com/v1/presence/users',
                { userIds: [Number(userId)] }
            );

            const presence = presenceRes.data.userPresences[0];
            if (!presence) continue;

            const prev = data.lastStatus;
            const curr = presence.userPresenceType;

            let embed = null;

            // OFFLINE -> ONLINE
            if ((prev === 0 || prev === null) && curr === 1) {
                embed = new EmbedBuilder()
                    .setTitle("🟢 Player Online")
                    .setDescription(`**${data.username}** is now Online`)
                    .setColor(0x0099ff)
                    .setTimestamp();
            }

            // ONLINE -> IN GAME
            if (prev === 1 && curr === 2) {

                let gameName = "Unknown Game";
                let gameLink = "";

                if (presence.rootPlaceId) {
                    gameName = await getGameName(presence.rootPlaceId);
                    gameLink = `https://www.roblox.com/games/${presence.rootPlaceId}`;
                }

                embed = new EmbedBuilder()
                    .setTitle("🎮 Player Joined Game")
                    .setDescription(`**${data.username}** joined **${gameName}**`)
                    .setColor(0x00ff00)
                    .addFields({ name: "Join Game", value: gameLink || "Unavailable" })
                    .setTimestamp();
            }

            // GAME CHANGE (Game A -> Game B)
            if (prev === 2 && curr === 2 && presence.rootPlaceId !== data.lastPlaceId) {

                let gameName = await getGameName(presence.rootPlaceId);
                let gameLink = `https://www.roblox.com/games/${presence.rootPlaceId}`;

                embed = new EmbedBuilder()
                    .setTitle("🔄 Game Changed")
                    .setDescription(`**${data.username}** switched to **${gameName}**`)
                    .setColor(0xff9900)
                    .addFields({ name: "Join Game", value: gameLink })
                    .setTimestamp();
            }

            // IN GAME -> OFFLINE (Optional)
            if (prev === 2 && curr === 0) {
                embed = new EmbedBuilder()
                    .setTitle("🔴 Player Offline")
                    .setDescription(`**${data.username}** went Offline`)
                    .setColor(0xff0000)
                    .setTimestamp();
            }

            if (embed) {
                for (const channelId of data.channels) {
                    const channel = await client.channels.fetch(channelId);
                    if (channel) channel.send({ embeds: [embed] });
                }
            }

            trackedUsers.set(userId, {
                ...data,
                lastStatus: curr,
                lastPlaceId: presence.rootPlaceId || null
            });

            saveData();

        } catch (err) {
            console.error("Tracking error:", err.message);
        }
    }

}, 15000);

// ===== Handle Commands =====
client.on('interactionCreate', async interaction => {

    if (!interaction.isChatInputCommand()) return;

    try {

        if (interaction.commandName === 'list') {
            if (trackedUsers.size === 0)
                return interaction.reply("No users are being tracked.");

            const list = [...trackedUsers.values()]
                .map(u => `• ${u.username}`)
                .join("\n");

            return interaction.reply(`📋 **Tracked Users:**\n${list}`);
        }

        if (interaction.commandName === 'clear') {
            trackedUsers.clear();
            saveData();
            return interaction.reply("🗑️ All tracked users removed.");
        }

        const username = interaction.options.getString('username');

        const userRes = await axios.post(
            'https://users.roblox.com/v1/usernames/users',
            { usernames: [username], excludeBannedUsers: true }
        );

        if (!userRes.data.data.length)
            return interaction.reply("User not found.");

        const userId = userRes.data.data[0].id.toString();

        if (interaction.commandName === 'track') {

            if (!trackedUsers.has(userId)) {
                trackedUsers.set(userId, {
                    username,
                    lastStatus: null,
                    lastPlaceId: null,
                    channels: [interaction.channelId]
                });
            }

            saveData();
            return interaction.reply(`✅ Now tracking **${username}**.`);
        }

        if (interaction.commandName === 'untrack') {

            if (!trackedUsers.has(userId))
                return interaction.reply("Not tracking that user.");

            trackedUsers.delete(userId);
            saveData();
            return interaction.reply(`🛑 Stopped tracking **${username}**.`);
        }

        if (interaction.commandName === 'status') {

            const presenceRes = await axios.post(
                'https://presence.roblox.com/v1/presence/users',
                { userIds: [Number(userId)] }
            );

            const presence = presenceRes.data.userPresences[0];

            let message = "🔴 Offline";
            let link = "";

            if (presence) {
                const status = presence.userPresenceType;

                if (status === 2) {
                    let gameName = await getGameName(presence.rootPlaceId);
                    message = `🎮 In Game: ${gameName}`;
                    link = `\nhttps://www.roblox.com/games/${presence.rootPlaceId}`;
                }
                else if (status === 3) message = "🛠️ In Studio";
                else if (status === 1) message = "🟢 Online";
            }

            return interaction.reply(`${username} is currently: ${message}${link}`);
        }

    } catch (err) {
        console.error(err);
        interaction.reply("Error processing request.");
    }

});

client.login(token);
