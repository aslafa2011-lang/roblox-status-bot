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
    EmbedBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle
} = require('discord.js');

const axios = require('axios');
const fs = require('fs');

const token = process.env.TOKEN;
const clientId = process.env.CLIENT_ID;

// Format Cookie safely
const rawCookie = process.env.ROBLOX_COOKIE || "";
const formattedCookie = rawCookie.includes(".ROBLOSECURITY=") 
    ? rawCookie 
    : `.ROBLOSECURITY=${rawCookie}`;

const robloxHeaders = {
    "Content-Type": "application/json",
    "Cookie": formattedCookie
};

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

// ===== BULLETPROOF GAME NAME FUNCTION =====
async function getGameName(presence) {
    const placeId = presence.rootPlaceId || presence.placeId;

    if (placeId) {
        try {
            const assetRes = await axios.get(`https://economy.roblox.com/v2/assets/${placeId}/details`);
            if (assetRes.data && assetRes.data.Name) {
                return assetRes.data.Name;
            }
        } catch {}
    }

    if (presence.universeId) {
        try {
            const gameRes = await axios.get(`https://games.roblox.com/v1/games?universeIds=${presence.universeId}`);
            if (gameRes.data.data && gameRes.data.data.length > 0) {
                return gameRes.data.data[0].name;
            }
        } catch {}
    }

    if (presence.lastLocation && presence.lastLocation.trim() !== "" && presence.lastLocation !== "Website") {
        return presence.lastLocation;
    }

    return "Unknown Game";
}

// ===== Slash Commands =====
const commands = [
    new SlashCommandBuilder()
        .setName('track')
        .setDescription('Track a Roblox player')
        .addStringOption(o => o.setName('username').setDescription('Roblox username').setRequired(true)),
    new SlashCommandBuilder()
        .setName('untrack')
        .setDescription('Stop tracking a player')
        .addStringOption(o => o.setName('username').setDescription('Roblox username').setRequired(true)),
    new SlashCommandBuilder()
        .setName('list')
        .setDescription('List tracked users'),
    new SlashCommandBuilder()
        .setName('clear')
        .setDescription('Remove ALL tracked users'),
    new SlashCommandBuilder()
        .setName('status')
        .setDescription('Check Roblox player status')
        .addStringOption(o => o.setName('username').setDescription('Roblox username').setRequired(true))
].map(c => c.toJSON());

const rest = new REST({ version: '10' }).setToken(token);

(async () => {
    try {
        await rest.put(Routes.applicationCommands(clientId), { body: commands });
        console.log("Commands registered.");
    } catch (e) {
        console.error(e);
    }
})();

// ===== TRACK LOOP =====
setInterval(async () => {
    for (const [userId, data] of trackedUsers.entries()) {
        try {
            const presenceRes = await axios.post(
                'https://presence.roblox.com/v1/presence/users',
                { userIds: [Number(userId)] },
                { headers: robloxHeaders }
            );

            const presence = presenceRes.data.userPresences[0];
            if (!presence) continue;

            const prev = data.lastStatus;
            const curr = presence.userPresenceType;
            const placeId = presence.rootPlaceId || presence.placeId;

            let embed = null;
            let components = [];

            if ((prev === 1 || prev === 0 || prev === null) && curr === 2) {

                const gameName = await getGameName(presence);

                embed = new EmbedBuilder()
                    .setTitle("🎮 Player Joined Game")
                    .setDescription(`**${data.username}** joined **${gameName}**`)
                    .setColor(0x00ff00)
                    .setTimestamp();

                if (placeId) {
                    const joinURL = presence.gameId
                        ? `https://www.roblox.com/games/${placeId}?jobId=${presence.gameId}`
                        : `https://www.roblox.com/games/${placeId}`;

                    const joinButton = new ButtonBuilder()
                        .setLabel("Join Game")
                        .setStyle(ButtonStyle.Link)
                        .setURL(joinURL);

                    const row = new ActionRowBuilder().addComponents(joinButton);
                    components = [row];
                }
            }

            else if (prev === 2 && curr === 0) {
                embed = new EmbedBuilder()
                    .setTitle("🔴 Player Offline")
                    .setDescription(`**${data.username}** went Offline`)
                    .setColor(0xff0000)
                    .setTimestamp();
            }

            else if ((prev === 0 || prev === null) && curr === 1) {
                embed = new EmbedBuilder()
                    .setTitle("🟢 Player Online")
                    .setDescription(`**${data.username}** is now Online`)
                    .setColor(0x0099ff)
                    .setTimestamp();
            }

            if (embed) {
                for (const channelId of data.channels) {
                    try {
                        const channel = await client.channels.fetch(channelId);
                        if (channel) {
                            channel.send({
                                embeds: [embed],
                                components: components
                            });
                        }
                    } catch {}
                }
            }

            trackedUsers.set(userId, {
                ...data,
                lastStatus: curr
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
            { usernames: [username], excludeBannedUsers: true },
            { headers: robloxHeaders }
        );

        if (!userRes.data.data.length)
            return interaction.reply("User not found.");

        const userId = userRes.data.data[0].id.toString();

        if (interaction.commandName === 'track') {
            if (!trackedUsers.has(userId)) {
                trackedUsers.set(userId, {
                    username,
                    lastStatus: null,
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
                { userIds: [Number(userId)] },
                { headers: robloxHeaders }
            );

            const presence = presenceRes.data.userPresences[0];

            let message = "🔴 Offline";
            let link = "";

            if (presence) {
                const status = presence.userPresenceType;

                if (status === 2) {
                    const gameName = await getGameName(presence);
                    const placeId = presence.rootPlaceId || presence.placeId;

                    message = `🎮 In Game: **${gameName}**`;

                    if (placeId) {
                        const joinURL = presence.gameId
                            ? `https://www.roblox.com/games/${placeId}?jobId=${presence.gameId}`
                            : `https://www.roblox.com/games/${placeId}`;

                        link = `\n🔗 **Join Server:** ${joinURL}`;
                    }
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

client.login(token);        .setName('clear')
        .setDescription('Remove ALL tracked users'),
    new SlashCommandBuilder()
        .setName('status')
        .setDescription('Check Roblox player status')
        .addStringOption(o => o.setName('username').setDescription('Roblox username').setRequired(true))
].map(c => c.toJSON());

const rest = new REST({ version: '10' }).setToken(token);

(async () => {
    try {
        await rest.put(Routes.applicationCommands(clientId), { body: commands });
        console.log("Commands registered.");
    } catch (e) {
        console.error(e);
    }
})();

// ===== TRACK LOOP =====
setInterval(async () => {
    for (const [userId, data] of trackedUsers.entries()) {
        try {
            const presenceRes = await axios.post(
                'https://presence.roblox.com/v1/presence/users',
                { userIds: [Number(userId)] },
                { headers: robloxHeaders }
            );

            const presence = presenceRes.data.userPresences[0];
            if (!presence) continue;

            const prev = data.lastStatus;
            const curr = presence.userPresenceType;
            let embed = null;

            const placeId = presence.rootPlaceId || presence.placeId;
            let gameName = "Unknown Game";
            let gameLink = "Unavailable (Privacy Settings)";

            if (curr === 2) {
                gameName = await getGameName(presence);
                if (placeId) {
                    gameLink = presence.gameId
                        ? `https://www.roblox.com/games/${placeId}?jobId=${presence.gameId}`
                        : `https://www.roblox.com/games/${placeId}`;
                }
            }

            if ((prev === 1 || prev === 0 || prev === null) && curr === 2) {
                embed = new EmbedBuilder()
                    .setTitle("🎮 Player Joined Game")
                    .setDescription(`**${data.username}** joined **${gameName}**`)
                    .setColor(0x00ff00)
                    .addFields({ name: "Join Game", value: gameLink })
                    .setTimestamp();
            } else if (prev === 2 && curr === 2 && placeId !== data.lastPlaceId) {
                embed = new EmbedBuilder()
                    .setTitle("🔄 Game Changed")
                    .setDescription(`**${data.username}** switched to **${gameName}**`)
                    .setColor(0xff9900)
                    .addFields({ name: "Join Game", value: gameLink })
                    .setTimestamp();
            } else if (prev === 2 && curr === 0) {
                embed = new EmbedBuilder()
                    .setTitle("🔴 Player Offline")
                    .setDescription(`**${data.username}** went Offline`)
                    .setColor(0xff0000)
                    .setTimestamp();
            } else if ((prev === 0 || prev === null) && curr === 1) {
                embed = new EmbedBuilder()
                    .setTitle("🟢 Player Online")
                    .setDescription(`**${data.username}** is now Online`)
                    .setColor(0x0099ff)
                    .setTimestamp();
            }

            if (embed) {
                for (const channelId of data.channels) {
                    try {
                        const channel = await client.channels.fetch(channelId);
                        if (channel) channel.send({ embeds: [embed] });
                    } catch (e) {
                        console.error(`Failed to send to channel ${channelId}:`, e.message);
                    }
                }
            }

            trackedUsers.set(userId, {
                ...data,
                lastStatus: curr,
                lastPlaceId: placeId || null
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
            // Intentionally removing auth header here so it doesn't fail if the cookie dies
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
                { userIds: [Number(userId)] },
                { headers: robloxHeaders }
            );

            const presence = presenceRes.data.userPresences[0];
            let message = "🔴 Offline";
            let link = "";

            if (presence) {
                const status = presence.userPresenceType;

                if (status === 2) {
                    const gameName = await getGameName(presence);
                    const placeId = presence.rootPlaceId || presence.placeId;

                    message = `🎮 In Game: **${gameName}**`;

                    if (placeId) {
                        link = presence.gameId
                            ? `\n🔗 **Join Server:** https://www.roblox.com/games/${placeId}?jobId=${presence.gameId}`
                            : `\n🔗 **Game Page:** https://www.roblox.com/games/${placeId}`;
                    }
                }
                else if (status === 3) message = "🛠️ In Studio";
                else if (status === 1) message = "🟢 Online";
            }

            return interaction.reply(`${username} is currently: ${message}${link}`);
        }

    } catch (err) {
        console.error(err);
        interaction.reply("Error processing request. See console for details.");
    }
});

client.login(token);

