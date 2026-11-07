import { verifyKey } from 'https://esm.sh/discord-interactions';

const BOSS_COOLDOWNS = {
  "Queen Ant": 24,
  "Core": 36,
  "Orfen": 36,
  "Zaken": 48,
  "Baium": 120,
  "Antharas": 192,
  "Valakas": 192
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

        const matchedBoss = Object.keys(BOSS_COOLDOWNS).find(
          b => b.toLowerCase() === bossNameOpt.toLowerCase()
        );

        if (!matchedBoss) {
          return jsonResponse({
            content: `❌ Боса **${bossNameOpt}** немає у базовому списку респавну!`
          });
        }

        const now = Math.floor(Date.now() / 1000);
        let killTimestamp = now;

        if (timeStrOpt) {
          const [hours, minutes] = timeStrOpt.split(':').map(Number);
          if (!isNaN(hours) && !isNaN(minutes)) {
            const d = new Date();
            d.setHours(hours, minutes, 0, 0);
            killTimestamp = Math.floor(d.getTime() / 1000);
            if (killTimestamp > now) {
              killTimestamp -= 86400;
            }
          }
        }

        const cooldownHours = BOSS_COOLDOWNS[matchedBoss];
        const respawnTimestamp = killTimestamp + (cooldownHours * 3600);

        await env.DB.prepare(
          `INSERT INTO bosses (name, respawn_time) VALUES (?1, ?2) 
           ON CONFLICT(name) DO UPDATE SET respawn_time = ?2`
        ).bind(matchedBoss, respawnTimestamp).run();

        return jsonResponse({
          content: `⚔️ Зафіксовано вбивство **${matched_boss}**!\n⏳ Наступний респ: <t:${respawnTimestamp}:F> (<t:${respawnTimestamp}:R>)`
        });
      }

      if (name === 'status') {
        const { results } = await env.DB.prepare(
          `SELECT name, respawn_time FROM bosses ORDER BY respawn_time ASC`
        ).all();

        if (!results || results.length === 0) {
          return jsonResponse({
            content: `📋 Немає зафіксованих даних про респ босів.`
          });
        }

        let msg = `**📋 Поточний розклад респавну босів:**\n`;
        for (const row of results) {
          msg += `• **${row.name}**: <t:${row.respawn_time}:F> (<t:${row.respawn_time}:R>)\n`;
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
