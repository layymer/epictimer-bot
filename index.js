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
    const url = new URL(request.url);

    // 1. ВЕБ-ДАШБОРД (HTTP GET)
    if (request.method === 'GET') {
      const { results } = await env.DB.prepare(
        `SELECT name, min_respawn, max_respawn FROM bosses`
      ).all();

      const dbDataJson = JSON.stringify(results || []);
      const htmlContent = getDashboardHtml(dbDataJson);

      return new Response(htmlContent, {
        headers: { 'Content-Type': 'text/html; charset=utf-8' }
      });
    }

    // 2. DISCORD INTERACTIONS (HTTP POST)
    if (request.method !== 'POST') {
      return new Response('Only POST/GET requests are allowed', { status: 405 });
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

        const now = Math.floor(Date.now() / 1000);
        let fields = [];
        let titleSuffix = "поточний розклад";

        let filteredResults = results;
        if (filterDateOpt) {
          const startOfDay = new Date(filterDateOpt);
          startOfDay.setHours(0, 0, 0, 0);
          const startSec = Math.floor(startOfDay.getTime() / 1000);

          const endOfDay = new Date(filterDateOpt);
          endOfDay.setHours(23, 59, 59, 999);
          const endSec = Math.floor(endOfDay.getTime() / 1000);

          filteredResults = results.filter(row => 
            (row.min_respawn <= endSec && row.max_respawn >= startSec)
          );

          titleSuffix = `на дату ${filterDateOpt.split('-').reverse().join('.')}`;
        }

        if (filteredResults.length === 0) {
          return jsonResponse({
            content: `📭 Немає респавнів епік-босів на обрану дату (${filterDateOpt}).`
          });
        }

        for (const row of filteredResults) {
          let statusText = "";
          if (now >= row.min_respawn && now <= row.max_respawn) {
            statusText = "🟢 **ВІКНО ВІДКРИТЕ ЗАРАЗ!**";
          } else if (now > row.max_respawn) {
            statusText = "🔴 **Вікно минуло**";
          } else {
            statusText = `⏳ Очікування (<t:${row.min_respawn}:R>)`;
          }

          fields.push({
            name: `⚔️ ${row.name}`,
            value: `▫️ **З:** <t:${row.min_respawn}:F>\n▫️ **По:** <t:${row.max_respawn}:T>\n▫️ **Статус:** ${statusText}`,
            inline: false
          });
        }

        return jsonResponse({
          embeds: [
            {
              title: `📋 Респавн епік-босів (${titleSuffix})`,
              color: 0x5865F2,
              fields: fields,
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

function getDashboardHtml(dbDataJson) {
  return `<!DOCTYPE html>
<html lang="uk">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Lineage 2 Epic Boss Spiral Timers</title>
    <script src="https://cdnjs.cloudflare.com/ajax/libs/d3/7.0.0/d3.min.js"></script>
    <style>
        body {
            background-color: #0b132b;
            color: #f8fafc;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            margin: 0;
            padding: 20px;
            display: flex;
            flex-direction: column;
            align-items: center;
            min-height: 100vh;
            box-sizing: border-box;
        }
        header { text-align: center; margin-bottom: 25px; }
        h1 { color: #38bdf8; font-size: 28px; margin: 0 0 15px 0; }
        .nav-controls {
            display: flex; gap: 15px; align-items: center;
            background: #1e293b; padding: 12px 28px; border-radius: 14px;
            box-shadow: 0 6px 20px rgba(0,0,0,0.4);
        }
        button {
            background: #0284c7; color: white; border: none;
            padding: 10px 20px; border-radius: 8px; cursor: pointer;
            font-weight: bold; font-size: 15px; transition: background 0.2s, transform 0.1s;
        }
        button:hover { background: #0369a1; }
        button:active { transform: scale(0.97); }
        #currentRange { font-weight: bold; color: #e2e8f0; font-size: 16px; }
        .spirals-grid {
            display: flex; gap: 30px; width: 100%; max-width: 1700px; justify-content: center;
        }
        .spiral-card {
            background: #1e293b; padding: 25px; border-radius: 22px;
            box-shadow: 0 15px 35px rgba(0, 0, 0, 0.5); text-align: center;
            flex: 1; max-width: 550px; cursor: pointer;
            transition: transform 0.2s, box-shadow 0.2s;
        }
        .spiral-card:hover {
            transform: translateY(-5px); box-shadow: 0 20px 40px rgba(56, 189, 248, 0.2);
        }
        .spiral-card h3 { margin: 0 0 15px 0; font-size: 20px; color: #38bdf8; }
        .spiral-container { width: 100%; aspect-ratio: 1 / 1; margin: 0 auto; }
        svg { width: 100%; height: 100%; overflow: visible; }
        .modal {
            display: none; position: fixed; top: 0; left: 0; width: 100vw; height: 100vh;
            background: rgba(11, 19, 43, 0.98); backdrop-filter: blur(12px);
            z-index: 1000; justify-content: center; align-items: center;
        }
        .modal.active { display: flex; }
        .modal-title {
            position: absolute; top: 25px; left: 35px; color: #38bdf8;
            font-size: 24px; font-weight: bold; margin: 0; pointer-events: none; z-index: 1002;
        }
        .modal-content {
            width: 98vw; height: 98vh; display: flex; justify-content: center; align-items: center;
        }
        .close-btn {
            position: absolute; top: 20px; right: 35px; font-size: 46px;
            color: #f8fafc; cursor: pointer; font-weight: bold; transition: color 0.2s; z-index: 1002;
        }
        .close-btn:hover { color: #ef4444; }
    </style>
</head>
<body>

    <header>
        <h1>Lineage 2 Epic Boss Spiral Timers</h1>
        <div class="nav-controls">
            <button onclick="changeDay(-1)">◀ Попередній день</button>
            <span id="currentRange">Завантаження...</span>
            <button onclick="changeDay(1)">Наступний день ▶</button>
            <button onclick="resetToToday()" style="background: #334155;">Сьогодні</button>
        </div>
    </header>

    <div class="spirals-grid" id="spiralsContainer">
        <div class="spiral-card" onclick="openModal(0)">
            <h3 id="title-0">День 1</h3>
            <div class="spiral-container"><svg id="spiral-0"></svg></div>
        </div>
        <div class="spiral-card" onclick="openModal(1)">
            <h3 id="title-1">День 2</h3>
            <div class="spiral-container"><svg id="spiral-1"></svg></div>
        </div>
        <div class="spiral-card" onclick="openModal(2)">
            <h3 id="title-2">День 3</h3>
            <div class="spiral-container"><svg id="spiral-2"></svg></div>
        </div>
    </div>

    <div class="modal" id="modal" onclick="closeModal()">
        <span class="close-btn" onclick="closeModal()">&times;</span>
        <div class="modal-title" id="modalTitle"></div>
        <div class="modal-content" onclick="event.stopPropagation()">
            <svg id="modal-spiral"></svg>
        </div>
    </div>

    <script>
        const BOSS_COLORS = {
            "Queen Ant": "#ec4899",
            "Core":      "#8b5cf6",
            "Orfen":     "#06b6d4",
            "Baium":     "#eab308",
            "Antharas":  "#10b981",
            "Valakas":   "#f97316",
            "Beleth":    "#ef4444"
        };

        const REAL_DB_DATA = ${dbDataJson};

        let baseDate = new Date();
        let activeModalIndex = null;

        const createSpiralPath = (startRadius, endRadius, width, startAngle, endAngle) => {
            const x1 = startRadius * Math.sin(startAngle);
            const y1 = startRadius * -Math.cos(startAngle);
            const x2 = (startRadius + width) * Math.sin(startAngle);
            const y2 = (startRadius + width) * -Math.cos(startAngle);
            const x3 = endRadius * Math.sin(endAngle);
            const y3 = endRadius * -Math.cos(endAngle);
            const x4 = (endRadius + width) * Math.sin(endAngle);
            const y4 = (endRadius + width) * -Math.cos(endAngle);
            return \`
                M \${x1},\${y1}
                L \${x2},\${y2}
                A \${startRadius+width},\${startRadius+width} 1 0 1 \${x4},\${y4}
                L \${x3},\${y3}
                A \${startRadius},\${startRadius} 0 0 0 \${x1},\${y1}\`;
        };

        function renderSpiral(selector, dateObj, isFullscreen = false) {
            const svg = d3.select(\`#\${selector}\`);
            svg.html('');
            
            const viewBoxSize = isFullscreen ? 1000 : 680;
            const center = viewBoxSize / 2;
            
            svg.attr("viewBox", \`0 0 \${viewBoxSize} \${viewBoxSize}\`);
            const g = svg.append('g').attr('transform', \`translate(\${center},\${center})\`);

            const scaleFactor = isFullscreen ? 1.5 : 1.0;
            const ARC_WIDTH = Math.round(42 * scaleFactor);
            const INITIAL_RADIUS = Math.round(55 * scaleFactor);
            const stepIncrement = 2.2 * scaleFactor;
            const ANGLE_STEP = Math.PI / 6;

            const startOfDaySec = Math.floor(new Date(dateObj).setHours(0,0,0,0) / 1000);
            const nowSec = Math.floor(Date.now() / 1000);

            const bossLabelsToDraw = [];
            const MAX_OUTER_SPIRAL_RADIUS = INITIAL_RADIUS + (48 * stepIncrement) + ARC_WIDTH;

            for (let i = 0; i < 48; i++) {
                const segStartSec = startOfDaySec + (i * 1800);
                const segEndSec = segStartSec + 1800;

                const startAngle = (i / 2) * ANGLE_STEP;
                const endAngle = ((i + 1) / 2) * ANGLE_STEP;
                
                const startRadius = INITIAL_RADIUS + (i * stepIncrement);
                const endRadius = INITIAL_RADIUS + ((i + 1) * stepIncrement);
                
                const path = createSpiralPath(startRadius, endRadius, ARC_WIDTH, startAngle, endAngle);

                let fillColor = '#1e293b';
                let matchedBoss = null;

                for (const boss of REAL_DB_DATA) {
                    if (boss.min_respawn < segEndSec && boss.max_respawn > segStartSec) {
                        fillColor = BOSS_COLORS[boss.name] || '#38bdf8';
                        matchedBoss = boss;
                        break;
                    }
                }

                let opacity = (segEndSec < nowSec) ? 0.35 : 0.95;

                g.append('path')
                    .attr('d', path)
                    .style('fill', fillColor)
                    .style('opacity', opacity)
                    .style('stroke', '#0b132b')
                    .style('stroke-width', isFullscreen ? '3px' : '2px');

                if (matchedBoss) {
                    const midSec = (matchedBoss.min_respawn + matchedBoss.max_respawn) / 2;
                    if (segStartSec <= midSec && segEndSec > midSec) {
                        const midRadius = (startRadius + endRadius) / 2 + ARC_WIDTH / 2;
                        const midAngle = (startAngle + endAngle) / 2;
                        bossLabelsToDraw.push({
                            name: matchedBoss.name,
                            color: BOSS_COLORS[matchedBoss.name],
                            x: midRadius * Math.sin(midAngle),
                            y: midRadius * -Math.cos(midAngle),
                            angle: midAngle,
                            segIndex: i
                        });
                    }
                }
            }

            for (let h = 0; h < 24; h++) {
                const i = h * 2;
                const angle = h * ANGLE_STEP + (ANGLE_STEP / 2);
                const radius = INITIAL_RADIUS + (i * stepIncrement) + ARC_WIDTH / 2;

                const textX = radius * Math.sin(angle);
                const textY = radius * -Math.cos(angle);

                g.append('text')
                    .attr('x', textX)
                    .attr('y', textY)
                    .attr('dy', '0.35em')
                    .attr('font-size', \`\${Math.round(16 * scaleFactor)}px\`)
                    .attr('font-weight', 'bold')
                    .attr('text-anchor', 'middle')
                    .attr('fill', '#ffffff')
                    .text(h);
            }

            bossLabelsToDraw.forEach(lbl => {
                const outerRadiusAtAngle = INITIAL_RADIUS + ((lbl.segIndex % 24 + 24) * stepIncrement) + ARC_WIDTH;
                const labelRadius = Math.max(MAX_OUTER_SPIRAL_RADIUS, outerRadiusAtAngle) + Math.round(75 * scaleFactor);

                const lx = labelRadius * Math.sin(lbl.angle);
                const ly = labelRadius * -Math.cos(lbl.angle);

                g.append('line')
                    .attr('x1', lbl.x)
                    .attr('y1', lbl.y)
                    .attr('x2', lx)
                    .attr('y2', ly)
                    .attr('stroke', lbl.color)
                    .attr('stroke-width', isFullscreen ? '4px' : '2.5px')
                    .attr('stroke-dasharray', '5,4');

                g.append('text')
                    .attr('x', lx + (lx >= 0 ? 12 : -12))
                    .attr('y', ly)
                    .attr('dy', '0.35em')
                    .attr('font-size', \`\${Math.round(18 * scaleFactor)}px\`)
                    .attr('font-weight', 'bold')
                    .attr('text-anchor', lx >= 0 ? 'start' : 'end')
                    .attr('fill', lbl.color)
                    .text(lbl.name);
            });
        }

        function updateView() {
            for (let i = 0; i < 3; i++) {
                let targetDate = new Date(baseDate);
                targetDate.setDate(baseDate.getDate() + i);
                
                let dayName = targetDate.toLocaleDateString('uk-UA', { weekday: 'short' });
                let dateStr = targetDate.toLocaleDateString('uk-UA', { day: '2-digit', month: '2-digit' });
                
                document.getElementById(\`title-\${i}\`).innerText = \`\${dayName.toUpperCase()} (\${dateStr})\`;
                renderSpiral(\`spiral-\${i}\`, targetDate, false);
            }

            let d1 = new Date(baseDate).toLocaleDateString('uk-UA', { day: 'numeric', month: 'short' });
            let d3 = new Date(baseDate);
            d3.setDate(baseDate.getDate() + 2);
            let d3Str = d3.toLocaleDateString('uk-UA', { day: 'numeric', month: 'short', year: 'numeric' });
            document.getElementById('currentRange').innerText = \`\${d1} — \${d3Str}\`;

            if (activeModalIndex !== null) {
                let targetDate = new Date(baseDate);
                targetDate.setDate(baseDate.getDate() + activeModalIndex);
                renderSpiral('modal-spiral', targetDate, true);
            }
        }

        function changeDay(days) {
            baseDate.setDate(baseDate.getDate() + days);
            updateView();
        }

        function resetToToday() {
            baseDate = new Date();
            updateView();
        }

        function openModal(index) {
            activeModalIndex = index;
            let targetDate = new Date(baseDate);
            targetDate.setDate(baseDate.getDate() + index);
            
            let dayName = targetDate.toLocaleDateString('uk-UA', { weekday: 'long' });
            let dateStr = targetDate.toLocaleDateString('uk-UA', { day: '2-digit', month: '2-digit', year: 'numeric' });
            
            document.getElementById('modalTitle').innerText = \`\${dayName.toUpperCase()} — \${dateStr}\`;
            document.getElementById('modal').classList.add('active');
            renderSpiral('modal-spiral', targetDate, true);
        }

        function closeModal() {
            activeModalIndex = null;
            document.getElementById('modal').classList.remove('active');
        }

        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') closeModal();
        });

        updateView();
    </script>
</body>
</html>`;
}
