// ===== tiny web server to stay online =====
const express = require('express');
const app = express();
app.get("/", (req, res) => res.send("Bot is alive!"));
const listener = app.listen(process.env.PORT || 3000, () => {
  const addr = listener.address();
  console.log('Bot is listening on port ' + (addr ? addr.port : 'unknown'));
});

// ===== Discord + Roblox bot =====
const { Client, GatewayIntentBits, SlashCommandBuilder, REST, Routes } = require('discord.js');
const axios = require('axios');

const token = process.env.TOKEN;
const clientId = process.env.CLIENT_ID;

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

// ===== Slash command registration =====
const commands = [
    new SlashCommandBuilder()
        .setName('status')
        .setDescription('Check Roblox player status')
        .addStringOption(option =>
            option.setName('username')
                .setDescription('Roblox username')
                .setRequired(true))
].map(c => c.toJSON());

const rest = new REST({ version: '10' }).setToken(token);

(async () => {
    try {
        await rest.put(Routes.applicationCommands(clientId), { body: commands });
        console.log('Slash command registered.');
    } catch (e) { console.error(e); }
})();

// ===== Handle slash command =====
client.on('interactionCreate', async interaction => {
    if (!interaction.isChatInputCommand()) return;
    if (interaction.commandName !== 'status') return;

    const username = interaction.options.getString('username');

    try {
        // Step 1: Get user ID from username
        const userRes = await axios.post('https://users.roblox.com/v1/usernames/users', { usernames: [username], excludeBannedUsers: true });
        if (!userRes.data.data.length) return interaction.reply("User not found.");
        const userId = userRes.data.data[0].id;

        // Step 2: Check official Roblox presence API
        let status = 0; // default offline
        try {
            const presenceRes = await axios.post('https://presence.roblox.com/v1/presence/users', { userIds: [userId] });
            if (presenceRes.data.userPresences && presenceRes.data.userPresences.length > 0) {
                // The correct field is userPresenceType
                status = presenceRes.data.userPresences[0].userPresenceType ?? 0;
            }
        } catch (err) {
            console.log("Presence API failed, assuming offline", err.message);
        }

        // Step 3: Prepare message
        let message;
        if (status === 2) message = "🎮 In Game";
        else if (status === 3) message = "🛠️ In Studio";
        else if (status === 1) message = "🟢 Online (not in game/studio)";
        else message = "🔴 Offline or not detectable";

        await interaction.reply(`${username} is currently: ${message}`);
    } catch (err) {
        console.error(err);
        await interaction.reply("Error checking status.");
    }
});

client.login(token);