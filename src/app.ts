import Fastify, { type FastifyInstance } from 'fastify';
import {
  registerIntegrationRoutes,
  type IntegrationRouteDependencies,
} from './routes/integrations.js';

export interface BuildAppOptions {
  now?: () => Date;
  integrationRoutes?: IntegrationRouteDependencies;
}

export function buildApp(options: BuildAppOptions = {}): FastifyInstance {
  const app = Fastify({ logger: false });
  const now = options.now ?? (() => new Date());

  app.get('/healthz', async () => ({
    ok: true,
    service: 'brandname-marketing-erp',
    timestamp: now().toISOString(),
  }));

  app.get('/', async (request, reply) => {
    const html = `<!doctype html>
<html lang="th">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Marketing ERP - CRM Integration Hub</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@300;400;500;600;700&display=swap" rel="stylesheet">
  <style>
    :root {
      --bg-primary: #0b0f19;
      --bg-surface: rgba(22, 28, 45, 0.6);
      --bg-card: rgba(30, 41, 59, 0.4);
      --border-color: rgba(255, 255, 255, 0.08);
      --text-primary: #f8fafc;
      --text-secondary: #94a3b8;
      --accent-violet: #8b5cf6;
      --accent-pink: #ec4899;
      --accent-cyan: #06b6d4;
      --success: #10b981;
      --warning: #f59e0b;
      --danger: #ef4444;
      --glow-violet: rgba(139, 92, 246, 0.15);
      --glow-pink: rgba(236, 72, 153, 0.15);
      --font-family: 'Plus Jakarta Sans', sans-serif;
    }

    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }

    body {
      background-color: var(--bg-primary);
      background-image: 
        radial-gradient(at 0% 0%, rgba(139, 92, 246, 0.12) 0px, transparent 50%),
        radial-gradient(at 100% 100%, rgba(236, 72, 153, 0.12) 0px, transparent 50%);
      background-attachment: fixed;
      font-family: var(--font-family);
      color: var(--text-primary);
      min-height: 100vh;
      padding: 2.5rem 1.5rem;
      line-height: 1.5;
    }

    .container {
      max-width: 1400px;
      margin: 0 auto;
    }

    header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 2.5rem;
      border-bottom: 1px solid var(--border-color);
      padding-bottom: 1.5rem;
    }

    .brand h1 {
      font-size: 2rem;
      font-weight: 700;
      background: linear-gradient(135deg, var(--text-primary) 30%, var(--accent-violet) 70%, var(--accent-pink) 100%);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      letter-spacing: -0.5px;
    }

    .brand p {
      color: var(--text-secondary);
      font-size: 0.875rem;
      margin-top: 0.25rem;
    }

    .badge {
      display: inline-flex;
      align-items: center;
      padding: 0.35rem 0.85rem;
      border-radius: 9999px;
      font-size: 0.75rem;
      font-weight: 600;
      letter-spacing: 0.5px;
      text-transform: uppercase;
    }

    .badge-success { background: rgba(16, 185, 129, 0.12); color: var(--success); border: 1px solid rgba(16, 185, 129, 0.2); }
    .badge-warning { background: rgba(245, 158, 11, 0.12); color: var(--warning); border: 1px solid rgba(245, 158, 11, 0.2); }
    .badge-danger { background: rgba(239, 68, 68, 0.12); color: var(--danger); border: 1px solid rgba(239, 68, 68, 0.2); }
    .badge-info { background: rgba(6, 182, 212, 0.12); color: var(--accent-cyan); border: 1px solid rgba(6, 182, 212, 0.2); }

    .grid-stats {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
      gap: 1.5rem;
      margin-bottom: 2.5rem;
    }

    .card {
      background: var(--bg-surface);
      backdrop-filter: blur(16px);
      -webkit-backdrop-filter: blur(16px);
      border: 1px solid var(--border-color);
      border-radius: 1.25rem;
      padding: 1.75rem;
      box-shadow: 0 10px 30px -10px rgba(0, 0, 0, 0.3);
      transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
      position: relative;
      overflow: hidden;
    }

    .card::before {
      content: '';
      position: absolute;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      background: linear-gradient(135deg, rgba(139, 92, 246, 0.05) 0%, transparent 100%);
      opacity: 0;
      transition: opacity 0.3s ease;
      pointer-events: none;
    }

    .card:hover {
      transform: translateY(-4px);
      border-color: rgba(255, 255, 255, 0.15);
      box-shadow: 0 15px 35px -5px rgba(0, 0, 0, 0.4);
    }

    .card:hover::before {
      opacity: 1;
    }

    .card-stat-title {
      font-size: 0.875rem;
      font-weight: 500;
      color: var(--text-secondary);
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }

    .card-stat-value {
      font-size: 2.25rem;
      font-weight: 700;
      margin-top: 0.5rem;
      letter-spacing: -1px;
    }

    .card-stat-value.glow-violet { text-shadow: 0 0 15px var(--glow-violet); color: #c084fc; }
    .card-stat-value.glow-pink { text-shadow: 0 0 15px var(--glow-pink); color: #f472b6; }
    .card-stat-value.glow-cyan { text-shadow: 0 0 15px rgba(6, 182, 212, 0.2); color: #22d3ee; }

    .main-grid {
      display: grid;
      grid-template-columns: 2fr 1fr;
      gap: 1.5rem;
      margin-bottom: 2.5rem;
    }

    @media (max-width: 1024px) {
      .main-grid {
        grid-template-columns: 1fr;
      }
    }

    .panel-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 1.5rem;
    }

    .panel-title {
      font-size: 1.25rem;
      font-weight: 600;
      letter-spacing: -0.2px;
    }

    /* Table styling */
    .table-container {
      width: 100%;
      overflow-x: auto;
    }

    table {
      width: 100%;
      border-collapse: collapse;
      text-align: left;
    }

    th {
      padding: 1rem;
      font-size: 0.85rem;
      font-weight: 600;
      color: var(--text-secondary);
      border-bottom: 1px solid var(--border-color);
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }

    td {
      padding: 1.15rem 1rem;
      font-size: 0.95rem;
      border-bottom: 1px solid rgba(255, 255, 255, 0.04);
      color: var(--text-primary);
    }

    tr:last-child td {
      border-bottom: none;
    }

    tr:hover td {
      background: rgba(255, 255, 255, 0.02);
    }

    .btn {
      background: linear-gradient(135deg, var(--accent-violet) 0%, var(--accent-pink) 100%);
      color: #fff;
      border: none;
      padding: 0.75rem 1.75rem;
      font-size: 0.95rem;
      font-weight: 600;
      border-radius: 0.75rem;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      gap: 0.5rem;
      transition: all 0.2s ease;
      box-shadow: 0 4px 15px rgba(139, 92, 246, 0.3);
    }

    .btn:hover {
      opacity: 0.95;
      transform: translateY(-1px);
      box-shadow: 0 6px 20px rgba(139, 92, 246, 0.4);
    }

    .btn:active {
      transform: translateY(1px);
    }

    .btn:disabled {
      background: #334155;
      cursor: not-allowed;
      box-shadow: none;
      transform: none;
      opacity: 0.6;
    }

    .sync-status-indicator {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      margin-top: 1rem;
      font-size: 0.875rem;
      color: var(--text-secondary);
    }

    .pulse-dot {
      width: 8px;
      height: 8px;
      background-color: var(--success);
      border-radius: 50%;
      box-shadow: 0 0 8px var(--success);
    }

    .pulse-dot.running {
      background-color: var(--warning);
      box-shadow: 0 0 8px var(--warning);
      animation: pulse 1.5s infinite ease-in-out;
    }

    .pulse-dot.idle {
      background-color: var(--text-secondary);
      box-shadow: none;
    }

    @keyframes pulse {
      0% { transform: scale(0.9); opacity: 0.4; }
      50% { transform: scale(1.1); opacity: 1; }
      100% { transform: scale(0.9); opacity: 0.4; }
    }

    .pipeline-board {
      display: grid;
      grid-template-columns: repeat(5, 1fr);
      gap: 1rem;
      margin-top: 1.5rem;
    }

    @media (max-width: 768px) {
      .pipeline-board {
        grid-template-columns: 1fr;
      }
    }

    .pipeline-column {
      background: rgba(22, 28, 45, 0.3);
      border: 1px solid var(--border-color);
      border-radius: 1rem;
      padding: 1rem;
      min-height: 250px;
    }

    .pipeline-column-header {
      font-size: 0.8rem;
      font-weight: 700;
      color: var(--text-secondary);
      text-transform: uppercase;
      margin-bottom: 1rem;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }

    .pipeline-column-count {
      background: var(--border-color);
      color: var(--text-primary);
      padding: 0.15rem 0.4rem;
      border-radius: 4px;
      font-size: 0.75rem;
    }

    .lead-card {
      background: rgba(30, 41, 59, 0.6);
      border: 1px solid rgba(255, 255, 255, 0.05);
      border-radius: 0.5rem;
      padding: 0.75rem;
      margin-bottom: 0.75rem;
      font-size: 0.85rem;
      box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);
      transition: all 0.2s ease;
    }

    .lead-card:hover {
      border-color: rgba(255, 255, 255, 0.12);
      transform: translateY(-1px);
    }

    .lead-name {
      font-weight: 600;
      margin-bottom: 0.25rem;
    }

    .lead-meta {
      color: var(--text-secondary);
      font-size: 0.75rem;
      margin-top: 0.25rem;
      display: flex;
      justify-content: space-between;
    }

    .spinner {
      animation: spin 1s linear infinite;
      display: inline-block;
      width: 1rem;
      height: 1rem;
      border: 2px solid currentColor;
      border-right-color: transparent;
      border-radius: 50%;
      vertical-align: text-bottom;
    }

    @keyframes spin {
      to { transform: rotate(360deg); }
    }
  </style>
</head>
<body>
  <div class="container">
    <header>
      <div class="brand">
        <h1>Marketing ERP - Integration Hub</h1>
        <p>ระบบบูรณาการและเชื่อมต่อข้อมูล CRM & Airtable ประจำแบรนด์ GO Mall & Rent A Coat</p>
      </div>
      <div id="connection-status">
        <span class="badge badge-success">Online & Healthy</span>
      </div>
    </header>

    <div class="grid-stats">
      <div class="card">
        <div class="card-stat-title">ลูกค้าเป้าหมายทั้งหมด (Total Leads)</div>
        <div class="card-stat-value glow-violet" id="total-leads-val">-</div>
      </div>
      <div class="card">
        <div class="card-stat-title">มูลค่าตระกร้าประเมิน (Estimated Value)</div>
        <div class="card-stat-value glow-pink" id="total-value-val">฿-</div>
      </div>
      <div class="card">
        <div class="card-stat-title">การซิงค์ข้อมูลรอบถัดไป (Sync Status)</div>
        <div class="card-stat-value glow-cyan" id="sync-run-status">Idle</div>
        <div class="sync-status-indicator">
          <div class="pulse-dot idle" id="sync-pulse"></div>
          <span id="sync-status-text">พร้อมสั่งรันซิงค์ข้อมูล</span>
        </div>
      </div>
    </div>

    <div class="main-grid">
      <div class="card">
        <div class="panel-header">
          <h2 class="panel-title">กระดานการขาย CRM (CRM Pipeline Board)</h2>
        </div>
        <div class="pipeline-board">
          <div class="pipeline-column">
            <div class="pipeline-column-header">
              <span>New</span>
              <span class="pipeline-column-count" id="count-new">0</span>
            </div>
            <div class="pipeline-list" id="list-new"></div>
          </div>
          <div class="pipeline-column">
            <div class="pipeline-column-header">
              <span>Qualified</span>
              <span class="pipeline-column-count" id="count-qualified">0</span>
            </div>
            <div class="pipeline-list" id="list-qualified"></div>
          </div>
          <div class="pipeline-column">
            <div class="pipeline-column-header">
              <span>Reserved</span>
              <span class="pipeline-column-count" id="count-reserved">0</span>
            </div>
            <div class="pipeline-list" id="list-reserved"></div>
          </div>
          <div class="pipeline-column">
            <div class="pipeline-column-header">
              <span>Paid</span>
              <span class="pipeline-column-count" id="count-paid">0</span>
            </div>
            <div class="pipeline-list" id="list-paid"></div>
          </div>
          <div class="pipeline-column">
            <div class="pipeline-column-header">
              <span>Completed</span>
              <span class="pipeline-column-count" id="count-completed">0</span>
            </div>
            <div class="pipeline-list" id="list-completed"></div>
          </div>
        </div>
      </div>

      <div class="card" style="display: flex; flex-direction: column; justify-content: space-between;">
        <div>
          <div class="panel-header">
            <h2 class="panel-title">ตัวจัดการ Airtable (Sync Control)</h2>
          </div>
          <p style="color: var(--text-secondary); font-size: 0.9rem; margin-bottom: 1.5rem;">
            ระบบจะดึงข้อมูลบิลและขนาดสัดส่วนสแปมลูกค้า (Sizing Info) จาก Airtable บัญชีสาขา Rama9, Vibhavadi และ PFS เพื่อซิงค์ลง PostgreSQL Supabase ทันที
          </p>
        </div>
        <div>
          <button class="btn" id="sync-btn" onclick="triggerAirtableSync()" style="width: 100%; justify-content: center;">
            <svg style="width: 1.25rem; height: 1.25rem;" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 1121.213 6h-3.07M4 9h3.07m-3.07 0l2.122 2.122"></path>
            </svg>
            ดึงข้อมูลจาก Airtable เดี๋ยวนี้
          </button>
          <div id="sync-progress" style="margin-top: 1rem; display: none;">
            <p style="font-size: 0.8rem; color: var(--warning); font-weight: 500;">
              <span class="spinner"></span> กำลังดึงข้อมูลจาก Airtable และอัปเดตลง Supabase...
            </p>
          </div>
        </div>
      </div>
    </div>
  </div>

  <script>
    let isSyncing = false;

    async function loadStats() {
      try {
        const response = await fetch('/api/crm/summary');
        const data = await response.json();
        
        document.getElementById('total-leads-val').textContent = data.totalLeads.toLocaleString();
        document.getElementById('total-value-val').textContent = '฿' + data.totalValueBaht.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        
        // Update column counts
        const stages = {
          'new': data.stageCounts.new || 0,
          'qualified': data.stageCounts.qualified || 0,
          'reserved_or_added_to_cart': data.stageCounts.reserved_or_added_to_cart || 0,
          'paid': data.stageCounts.paid || 0,
          'completed': data.stageCounts.completed || 0
        };

        document.getElementById('count-new').textContent = stages.new;
        document.getElementById('count-qualified').textContent = stages.qualified;
        document.getElementById('count-reserved').textContent = stages.reserved_or_added_to_cart;
        document.getElementById('count-paid').textContent = stages.paid;
        document.getElementById('count-completed').textContent = stages.completed;

        // Clear previous cards
        document.getElementById('list-new').innerHTML = '';
        document.getElementById('list-qualified').innerHTML = '';
        document.getElementById('list-reserved').innerHTML = '';
        document.getElementById('list-paid').innerHTML = '';
        document.getElementById('list-completed').innerHTML = '';

        // Populate recent leads into stages
        data.recentLeads.forEach(lead => {
          const card = document.createElement('div');
          card.className = 'lead-card';
          
          let brandText = lead.brandRoute === 'go_mall' ? 'GO Mall' : lead.brandRoute === 'rent_a_coat' ? 'Rent A Coat' : 'General';
          
          card.innerHTML = \`
            <div class="lead-name">\${lead.customerName}</div>
            <div style="font-size:0.75rem; color: var(--text-secondary);">ปลายทาง: \${lead.destination || 'ไม่ได้ระบุ'}</div>
            <div class="lead-meta">
              <span style="font-weight:600; color:var(--accent-pink)">฿\${lead.estimatedBasketValue.toLocaleString()}</span>
              <span>\${brandText}</span>
            </div>
          \`;

          const stageListId = lead.stage === 'reserved_or_added_to_cart' ? 'list-reserved' : 'list-' + (lead.stage || 'new');
          const targetCol = document.getElementById(stageListId);
          if (targetCol) {
            targetCol.appendChild(card);
          }
        });

      } catch (err) {
        console.error('Failed to load stats:', err);
      }
    }

    async function checkSyncStatus() {
      try {
        const response = await fetch('/api/integrations/airtable/status');
        const data = await response.json();
        
        const statusElement = document.getElementById('sync-run-status');
        const statusText = document.getElementById('sync-status-text');
        const pulse = document.getElementById('sync-pulse');
        const syncBtn = document.getElementById('sync-btn');
        const progress = document.getElementById('sync-progress');

        if (data.status === 'running') {
          isSyncing = true;
          statusElement.textContent = 'Syncing...';
          statusElement.className = 'card-stat-value glow-cyan';
          statusText.textContent = 'กำลังทำการดึงข้อมูลล่าสุด...';
          pulse.className = 'pulse-dot running';
          syncBtn.disabled = true;
          progress.style.display = 'block';
        } else {
          if (isSyncing) {
            isSyncing = false;
            // Reload stats when a sync run completes
            loadStats();
          }
          statusElement.textContent = data.status.toUpperCase();
          if (data.status === 'completed') {
            statusElement.className = 'card-stat-value glow-cyan';
            statusText.textContent = 'ดึงข้อมูลสำเร็จล่าสุดเรียบร้อย';
            pulse.className = 'pulse-dot';
            pulse.style.backgroundColor = 'var(--success)';
            pulse.style.boxShadow = '0 0 8px var(--success)';
          } else if (data.status === 'failed') {
            statusElement.className = 'card-stat-value glow-cyan';
            statusText.textContent = 'ดึงข้อมูลล้มเหลว: ' + (data.errorCode || 'UNKNOWN_ERROR');
            pulse.className = 'pulse-dot';
            pulse.style.backgroundColor = 'var(--danger)';
            pulse.style.boxShadow = '0 0 8px var(--danger)';
          } else {
            statusElement.className = 'card-stat-value glow-cyan';
            statusText.textContent = 'พร้อมสั่งรันซิงค์ข้อมูล';
            pulse.className = 'pulse-dot idle';
          }
          syncBtn.disabled = false;
          progress.style.display = 'none';
        }
      } catch (err) {
        console.error('Failed to check sync status:', err);
      }
    }

    async function triggerAirtableSync() {
      const syncBtn = document.getElementById('sync-btn');
      syncBtn.disabled = true;
      try {
        const response = await fetch('/api/integrations/airtable/sync', { method: 'POST' });
        if (response.status === 202) {
          isSyncing = true;
          checkSyncStatus();
        } else {
          const errData = await response.json();
          alert('ไม่สามารถเริ่มซิงค์ข้อมูลได้: ' + (errData.error || 'Unknown Error'));
          syncBtn.disabled = false;
        }
      } catch (err) {
        alert('เกิดข้อผิดพลาดในการเชื่อมต่อเซิร์ฟเวอร์');
        syncBtn.disabled = false;
      }
    }

    // Initial load
    loadStats();
    checkSyncStatus();

    // Auto-update summary every 10 seconds
    setInterval(loadStats, 10000);
    // Poll sync status every 3 seconds
    setInterval(checkSyncStatus, 3000);
  </script>
</body>
</html>`;
    reply.type('text/html').send(html);
  });

  if (options.integrationRoutes !== undefined) {
    registerIntegrationRoutes(app, options.integrationRoutes);
  }

  return app;
}
