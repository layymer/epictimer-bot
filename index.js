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

      // ОБРОБКА КОМАНДИ /kill
      if (name === 'kill') {
        const bossNameOpt = options?.find(opt => opt.name === 'boss')?.value;
        const timeStrOpt = options?.find(opt => opt.name === 'time')?.value;
        const dateStrOpt = options?.find(opt => opt.name === 'date')?.value;

        const matchedBoss = Object.keys(BOSS_DATA).find(
          b => b.toLowerCase() === bossNameOpt?.toLowerCase()
        );

        if (!matchedBoss) {
          return jsonResponse({
            content: `❌ Боса **${bossNameOpt}** немає у списку епічних босів!`
          });
        }

        if (dateStrOpt && !timeStrOpt) {
          return jsonResponse({
            content: `❌ Якщо ви вказуєте дату, **обов'язково** потрібно вказати й точний час вбивства!`
          });
        }

        const targetDate = new Date();

        if (dateStrOpt) {
          const parsed = new Date(dateStrOpt);
          if (!isNaN(parsed.getTime())) {
            targetDate.setFullYear(parsed.getFullYear(), parsed.getMonth(), parsed.getDate());
          }
        }

        let hours = targetDate.getHours();
        let minutes = targetDate.getMinutes();

        if (timeStrOpt) {
          const cleanTime = timeStrOpt.trim().replace('.', ':');
          if (cleanTime.includes(':')) {
            const parts = cleanTime.split(':').map(Number);
            hours = parts[0];
            minutes = parts[1] || 0;
          } else if (cleanTime.length === 4) {
            hours = parseInt(cleanTime.slice(0, 2), 10);
            minutes = parseInt(cleanTime.slice(2, 4), 10);
          } else if (cleanTime.length <= 2) {
            hours = parseInt(cleanTime, 10);
            minutes = 0;
          }
        }

        targetDate.setHours(hours, minutes, 0, 0);
        const killTimestamp = Math.floor(targetDate.getTime() / 1000);

        const bossInfo = BOSS_DATA[matchedBoss];
        const minRespawn = killTimestamp + (bossInfo.base * 3600);
        const maxRespawn = minRespawn + (bossInfo.window * 3600);

        await env.DB.prepare(
          `INSERT INTO bosses (name, min_respawn, max_respawn) VALUES (?1, ?2, ?3) 
           ON CONFLICT(name) DO UPDATE SET min_respawn = ?2, max_respawn = ?3`
        ).bind(matchedBoss, minRespawn, maxRespawn).run();

        return jsonResponse({
          content: `⚔️ Зафіксовано вбивство **${matchedBoss}**!\n⏳ Вікно респавну: з <t:${minRespawn}:F> по <t:${maxRespawn}:T> (<t:${minRespawn}:R>)`
        });
      }

      // ОБРОБКА КОМАНДИ /status (ГЕНЕРАЦІЯ КРУГОВОГО ЦИФЕРБЛАТУ)
      if (name === 'status') {
        const filterDateOpt = options?.find(opt => opt.name === 'date')?.value;

        const { results } = await env.DB.prepare(
          `SELECT name, min_respawn, max_respawn FROM bosses ORDER BY min_respawn ASC`
        ).all();

        if (!results || results.length === 0) {
          return jsonResponse({
            content: `📋 Немає зафіксованих даних про респ епік-босів.`
          });
        }

        const targetDay = filterDateOpt ? new Date(filterDateOpt) : new Date();
        targetDay.setHours(0, 0, 0, 0);
        const startSec = Math.floor(targetDay.getTime() / 1000);
        const endSec = startSec + 86400;

        const activeBosses = results.filter(row => 
          (row.min_respawn <= endSec && row.max_respawn >= startSec)
        );

        const dateStrFormatted = targetDay.toLocaleDateString('uk-UA', { day: 'numeric', month: 'long', year: 'numeric' });

        if (activeBosses.length === 0) {
          return jsonResponse({
            content: `📭 Немає респавнів епік-босів на дату **${dateStrFormatted}**.`
          });
        }

        const datasets = [];
        const now = Math.floor(Date.now() / 1000);

        // 24 години доби (00:00 - 23:00)
        const hoursLabels = Array.from({ length: 24 }, (_, i) => `${i}:00`);

        activeBosses.forEach((row) => {
          const hourData = Array(24).fill(0);
          const bgColors = Array(24).fill('rgba(235, 238, 242, 0.4)'); // Неактивні години (сірі)

          for (let h = 0; h < 24; h++) {
            const hStart = startSec + (h * 3600);
            const hEnd = hStart + 3600;

            if (row.min_respawn < hEnd && row.max_respawn > hStart) {
              hourData[h] = 1; // Займає сектор години
              if (now >= row.min_respawn && now <= row.max_respawn) {
                bgColors[h] = '#2ecc71'; // Зелений (зараз)
              } else if (now > row.max_respawn) {
                bgColors[h] = '#e74c3c'; // Червоний (минуло)
              } else {
                bgColors[h] = '#5865F2'; // Синій/Фіолетовий (очікування)
              }
            }
          }

          datasets.push({
            label: row.name,
            data: hourData,
            backgroundColor: bgColors,
            borderWidth: 1,
            borderColor: '#ffffff'
          });
        });

        const chartConfig = {
          type: 'doughnut',
          data: {
            labels: hoursLabels,
            datasets: datasets
          },
          options: {
            responsive: true,
            plugins: {
              legend: {
                position: 'bottom',
                labels: { font: { size: 12, weight: 'bold' } }
              },
              title: {
                display: true,
                text: `Круговий графік респавнів: ${dateStrFormatted}`,
                font: { size: 16, weight: 'bold' }
              }
            }
          }
        };

        const chartUrl = `https://quickchart.io/chart?w=500&h=500&bkg=white&c=${encodeURIComponent(JSON.stringify(chartConfig))}`;

        return jsonResponse({
          embeds: [
            {
              title: `⭕ Круговий графік респавнів епік-босів`,
              description: `Дата: **${dateStrFormatted}**\n🟢 Відкрито зараз | 🔵 Очікування | 🔴 Минуло`,
              color: 0x5865F2,
              image: { url: chartUrl },
              footer: { text: "Lineage 2 Epic Timer" },
              timestamp: new Date().toISOString()
            }
          ]
        });
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
