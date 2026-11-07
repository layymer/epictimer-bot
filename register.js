const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const APP_ID = process.env.DISCORD_APP_ID;
const GUILD_ID = process.env.DISCORD_GUILD_ID; // необов'язково, якщо хочете глобальні

if (!DISCORD_TOKEN || !APP_ID) {
  console.error("❌ Будь ласка, вкажіть DISCORD_TOKEN та DISCORD_APP_ID у змінних середовища!");
  process.exit(1);
}

const commands = [
  {
    name: "kill",
    description: "Зафіксувати час вбивства епік-боса",
    options: [
      {
        name: "boss",
        description: "Назва боса",
        type: 3,
        required: true
      },
      {
        name: "time",
        description: "Час вбивства (наприклад: 17:00)",
        type: 3,
        required: false
      }
    ]
  },
  {
    name: "status",
    description: "Показати поточний розклад респавну епік-босів"
  }
];

async function registerCommands() {
  const url = GUILD_ID 
    ? `https://discord.com/api/v10/applications/${APP_ID}/guilds/${GUILD_ID}/commands`
    : `https://discord.com/api/v10/applications/${APP_ID}/commands`;

  console.log(`⏳ Реєстрація команд у Discord...`);

  const response = await fetch(url, {
    method: "PUT",
    headers: {
      "Authorization": `Bot ${DISCORD_TOKEN}`,
      "Content-Type": "application/json",
      "User-Agent": "DiscordBot (Custom, 1.0)"
    },
    body: JSON.stringify(commands)
  });

  if (response.ok) {
    const data = await response.json();
    console.log(`✅ Успішно зареєстровано команд: ${data.length}!`);
  } else {
    const errorText = await response.text();
    console.error(`❌ Помилка реєстрації (${response.status}):`, errorText);
  }
}

registerCommands();
