import { verifyKey } from 'discord-interactions';

const BOSS_DATA = {
  "Queen Ant": { base: 17, window: 4 },
  "Core": { base: 48, window: 4 },
  "Orfen": { base: 33, window: 4 },
  "Baium": { base: 125, window: 4 },
  "Antharas": { base: 342, window: 4 },
  "Valakas": { base: 342, window: 4 },
  "Beleth": { base: 342, window: 4 }
};

export default {
  async fetch(request, env, ctx) {
    if (request.method !== 'POST') {
      return new Response('Only POST requests are allowed', { status: 405 });
    }

    const signature = request.headers.get('X-Signature-Ed25519');
    const timestamp = request.headers.get('X-Signature-Timestamp');
    const body = await request.text();

    const isValidRequest = await verifyKey(body, signature, timestamp, env.DISCORD_PUBLIC_KEY);
    if (!isValidRequest) {
      return new Response('Invalid request signature', { status: 401 });
    }

    const interaction = JSON.parse(body);

    if (interaction.type === 1) {
      return new Response(JSON.stringify({ type: 1 }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (interaction.type === 2) {
      const { name, options } = interaction.data;

      if (name === 'kill') {
        const bossNameOpt = options?.find(opt => opt.name === 'boss')?.value;
        const timeStrOpt = options?.find(opt => opt.name === 'time')?.value;

        const matchedBoss = Object.keys(BOSS_DATA).find(
          b => b.toLowerCase() === bossNameOpt?.toLowerCase()
        );

        if (!matchedBoss) {
          return jsonResponse({
            content: `❌ Боса **${bossNameOpt}** немає у списку епічних босів!`
          });
        }

        const now = Math.floor(Date.now() / 1000);
        let killTimestamp = now;

        if (timeStrOpt) {
          const [hours, minutes] = timeStrOpt.split(':').map(Number);
          if (!isNaN(hours)) {
            const d = new Date();
            // Якщо хвилини не вказали (наприклад, передали просто годинник або 00 хвилин), 
            // беремо початок години для максимального запасу безпеки
            d.setHours(hours, isNaN(minutes) ? 0 : minutes, 0, 0);
            killTimestamp = Math.floor(d.getTime() / 1000);
            if (killTimestamp > now) {
              killTimestamp -= 86400; // якщо час у майбутньому — це було вчора
            }
          }
        }

        const bossInfo = BOSS_DATA[matchedBoss];
        
        // Закладаємо додаткову годину запасу (зсуваємо мінімальний респ на 1 годину раніше)
        const safetyBuffer = 3600; 
        const minRespawn = killTimestamp + (bossInfo.base * 3600) - safetyBuffer;
        const maxRespawn = minRespawn + ((bossInfo.window + 1) * 3600); // розширюємо вікно на цей же час

        await env.DB.prepare(
          `INSERT INTO bosses (name, min_respawn, max_respawn) VALUES (?1, ?2, ?3) 
           ON CONFLICT(name) DO UPDATE SET min_respawn = ?2, max_respawn = ?3`
        ).bind(matchedBoss, minRespawn, maxRespawn).run();

        return jsonResponse({
          content: `⚔️ Зафіксовано вбивство **${matchedBoss}** (з урахуванням запасу часу)!\n⏳ Вікно респавну: з <t:${minRespawn}:F> по <t:${maxRespawn}:T> (<t:${minRespawn}:R>)`
        });
      }

      if (name === 'status') {
        const { results } = await env.DB.prepare(
          `SELECT name, min_respawn, max_respawn FROM bosses ORDER BY min_respawn ASC`
        ).all();

        if (!results || results.length === 0) {
          return jsonResponse({
            content: `📋 Немає зафіксованих даних про респ епік-босів.`
          });
        }

        let msg = `**📋 Поточний розклад респавну епіків (з урахуванням захисного інтервалу):**\n`;
        for (const row of results) {
          msg += `• **${row.name}**: з <t:${row.min_respawn}:F> по <t:${row.max_respawn}:T> (<t:${row.min_respawn}:R>)\n`;
        }

        return jsonResponse({ content: msg });
      }
    }

    return new Response('Unknown command', { status: 400 });
  },
};

function jsonResponse(data) {
  return new Response(
    JSON.stringify({ type: 4, data: data }),
    { headers: { 'Content-Type': 'application/json' } }
  );
}
