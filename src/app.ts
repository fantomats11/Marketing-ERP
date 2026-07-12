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
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap" rel="stylesheet">
  <style>
    :root {
      --bg-primary: #0f172a;
      --bg-surface: #1e293b;
      --border-color: #334155;
      --text-primary: #f8fafc;
      --text-secondary: #94a3b8;
      --accent: #6366f1;
      --accent-hover: #4f46e5;
      --success: #10b981;
      --warning: #f59e0b;
      --danger: #ef4444;
      --font-family: 'Inter', sans-serif;
    }

    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }

    body {
      background-color: var(--bg-primary);
      font-family: var(--font-family);
      color: var(--text-primary);
      min-height: 100vh;
      padding: 2rem;
      line-height: 1.6;
    }

    .container {
      max-width: 1400px;
      margin: 0 auto;
    }

    header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      margin-bottom: 2rem;
      border-bottom: 1px solid var(--border-color);
      padding-bottom: 1.5rem;
    }

    .brand h1 {
      font-size: 1.75rem;
      font-weight: 700;
      color: var(--text-primary);
      letter-spacing: -0.025em;
    }

    .brand p {
      color: var(--text-secondary);
      font-size: 0.875rem;
      margin-top: 0.25rem;
    }

    .badge {
      display: inline-flex;
      align-items: center;
      padding: 0.25rem 0.75rem;
      border-radius: 4px;
      font-size: 0.75rem;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }

    .badge-success { background: rgba(16, 185, 129, 0.1); color: var(--success); border: 1px solid rgba(16, 185, 129, 0.2); }
    .badge-warning { background: rgba(245, 158, 11, 0.1); color: var(--warning); border: 1px solid rgba(245, 158, 11, 0.2); }
    .badge-danger { background: rgba(239, 68, 68, 0.1); color: var(--danger); border: 1px solid rgba(239, 68, 68, 0.2); }

    .grid-stats {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
      gap: 1rem;
      margin-bottom: 2rem;
    }

    .card {
      background: var(--bg-surface);
      border: 1px solid var(--border-color);
      border-radius: 6px;
      padding: 1.5rem;
    }

    .card-stat-title {
      font-size: 0.75rem;
      font-weight: 600;
      color: var(--text-secondary);
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }

    .card-stat-value {
      font-size: 2rem;
      font-weight: 700;
      margin-top: 0.5rem;
      color: var(--text-primary);
    }

    .main-grid {
      display: grid;
      grid-template-columns: 3fr 1fr;
      gap: 1.5rem;
      margin-bottom: 2rem;
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
      margin-bottom: 1.25rem;
      border-bottom: 1px solid var(--border-color);
      padding-bottom: 0.75rem;
    }

    .panel-title {
      font-size: 1.1rem;
      font-weight: 600;
      color: var(--text-primary);
    }

    .btn {
      background-color: var(--accent);
      color: #fff;
      border: none;
      padding: 0.5rem 1rem;
      font-size: 0.875rem;
      font-weight: 600;
      border-radius: 4px;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      gap: 0.5rem;
      transition: background-color 0.15s ease;
    }

    .btn:hover {
      background-color: var(--accent-hover);
    }

    .btn:disabled {
      background-color: #475569;
      cursor: not-allowed;
      opacity: 0.6;
    }

    .sync-status-indicator {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      margin-top: 0.75rem;
      font-size: 0.8rem;
      color: var(--text-secondary);
    }

    .pulse-dot {
      width: 6px;
      height: 6px;
      background-color: var(--success);
      border-radius: 50%;
    }

    .pulse-dot.running {
      background-color: var(--warning);
      animation: pulse 1s infinite ease-in-out;
    }

    .pulse-dot.idle {
      background-color: var(--text-secondary);
    }

    @keyframes pulse {
      0% { opacity: 0.4; }
      50% { opacity: 1; }
      100% { opacity: 0.4; }
    }

    .pipeline-board {
      display: grid;
      grid-template-columns: repeat(5, 1fr);
      gap: 0.75rem;
      margin-top: 1rem;
    }

    @media (max-width: 768px) {
      .pipeline-board {
        grid-template-columns: 1fr;
      }
    }

    .pipeline-column {
      background: #111827;
      border: 1px solid var(--border-color);
      border-radius: 4px;
      padding: 0.75rem;
      min-height: 400px;
    }

    .pipeline-column-header {
      font-size: 0.75rem;
      font-weight: 700;
      color: var(--text-secondary);
      text-transform: uppercase;
      margin-bottom: 0.75rem;
      display: flex;
      justify-content: space-between;
      align-items: center;
      border-bottom: 1px solid var(--border-color);
      padding-bottom: 0.5rem;
    }

    .pipeline-column-count {
      background: var(--border-color);
      color: var(--text-primary);
      padding: 0.1rem 0.3rem;
      border-radius: 2px;
      font-size: 0.7rem;
    }

    .lead-card {
      background: var(--bg-surface);
      border: 1px solid var(--border-color);
      border-radius: 4px;
      padding: 0.75rem;
      margin-bottom: 0.5rem;
      font-size: 0.8rem;
    }

    .lead-name {
      font-weight: 600;
      margin-bottom: 0.25rem;
      color: var(--text-primary);
    }

    .lead-meta {
      color: var(--text-secondary);
      font-size: 0.75rem;
      margin-top: 0.5rem;
      display: flex;
      flex-direction: column;
      gap: 0.25rem;
    }

    .sizing-badge-grid {
      display: flex;
      flex-wrap: wrap;
      gap: 0.25rem;
      margin-top: 0.5rem;
    }

    .sizing-badge {
      background: #334155;
      color: #cbd5e1;
      padding: 0.1rem 0.35rem;
      border-radius: 2px;
      font-size: 0.65rem;
      font-weight: 500;
    }

    .meta-item {
      display: flex;
      justify-content: space-between;
      border-top: 1px dashed rgba(255, 255, 255, 0.05);
      padding-top: 0.25rem;
    }

    .spinner {
      animation: spin 1s linear infinite;
      display: inline-block;
      width: 0.85rem;
      height: 0.85rem;
      border: 2px solid currentColor;
      border-right-color: transparent;
      border-radius: 50%;
      vertical-align: text-bottom;
    }

    .freshness-tag {
      font-size: 0.75rem;
      color: var(--text-secondary);
      margin-top: 0.5rem;
      display: block;
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
        <h1>GO Mall & Rent A Coat - CRM Hub</h1>
        <p>Operational CRM Board & Real-time Integration Ingestion Control</p>
      </div>
      <div>
        <span class="badge badge-success">System Stable</span>
      </div>
    </header>

    <div class="grid-stats">
      <div class="card">
        <div class="card-stat-title">Total Active CRM Leads</div>
        <div class="card-stat-value" id="total-leads-val">-</div>
        <span class="freshness-tag">Source: public.leads</span>
      </div>
      <div class="card">
        <div class="card-stat-title">Estimated Basket Value</div>
        <div class="card-stat-value" id="total-value-val">฿-</div>
        <span class="freshness-tag">Source: Airtable document totals</span>
      </div>
      <div class="card">
        <div class="card-stat-title">Ingestion Service Status</div>
        <div class="card-stat-value" id="sync-run-status">IDLE</div>
        <div class="sync-status-indicator">
          <div class="pulse-dot idle" id="sync-pulse"></div>
          <span id="sync-status-text">Ready to run sync</span>
        </div>
      </div>
    </div>

    <div class="main-grid">
      <div class="card">
        <div class="panel-header">
          <h2 class="panel-title">CRM Lead Sales Kanban Board</h2>
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

      <div class="card" style="display: flex; flex-direction: column; justify-content: space-between; gap: 1.5rem;">
        <div>
          <div class="panel-header">
            <h2 class="panel-title">Airtable Ingest Controller</h2>
          </div>
          <p style="color: var(--text-secondary); font-size: 0.85rem; margin-bottom: 1rem;">
            Triggers incremental transaction ingestion from Airtable bases (GO Mall & Rent A Coat) into Supabase PostgreSQL.
          </p>
          <div style="background: #1e293b; border: 1px solid var(--border-color); padding: 0.75rem; border-radius: 4px; font-size: 0.75rem; color: var(--text-secondary);">
            <strong>Actionable Decisions:</strong><br>
            If records mismatch or data is delayed, click trigger button below to sync manually.
          </div>
        </div>
        <div>
          <button class="btn" id="sync-btn" onclick="triggerAirtableSync()" style="width: 100%; justify-content: center;">
            <svg style="width: 1rem; height: 1rem;" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 1121.213 6h-3.07M4 9h3.07m-3.07 0l2.122 2.122"></path>
            </svg>
            Trigger Sync Now
          </button>
          <div id="sync-progress" style="margin-top: 0.75rem; display: none;">
            <p style="font-size: 0.75rem; color: var(--warning); font-weight: 500;">
              <span class="spinner"></span> Sync in progress...
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

        document.getElementById('list-new').innerHTML = '';
        document.getElementById('list-qualified').innerHTML = '';
        document.getElementById('list-reserved').innerHTML = '';
        document.getElementById('list-paid').innerHTML = '';
        document.getElementById('list-completed').innerHTML = '';

        data.recentLeads.forEach(lead => {
          const card = document.createElement('div');
          card.className = 'lead-card';
          
          let brandText = lead.brandRoute === 'go_mall' ? 'GO Mall' : lead.brandRoute === 'rent_a_coat' ? 'Rent A Coat' : 'General';
          
          card.innerHTML = \`
            <div class="lead-name">\${lead.customerName}</div>
            <div class="lead-meta">
              <div class="meta-item"><span>Brand:</span><span>\${brandText}</span></div>
              <div class="meta-item"><span>Dest:</span><span>\${lead.destination || 'N/A'}</span></div>
              <div class="meta-item"><span>Date:</span><span>\${lead.tripDate || 'N/A'}</span></div>
              <div class="meta-item"><span>Est. Basket:</span><span style="font-weight:600; color:#38bdf8;">฿\${lead.estimatedBasketValue.toLocaleString()}</span></div>
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
          statusElement.textContent = 'RUNNING';
          statusText.textContent = 'Sync in progress...';
          pulse.className = 'pulse-dot running';
          syncBtn.disabled = true;
          progress.style.display = 'block';
        } else {
          if (isSyncing) {
            isSyncing = false;
            loadStats();
          }
          statusElement.textContent = data.status.toUpperCase();
          if (data.status === 'completed') {
            statusText.textContent = 'Last sync completed successfully';
            pulse.className = 'pulse-dot';
            pulse.style.backgroundColor = 'var(--success)';
          } else if (data.status === 'failed') {
            statusText.textContent = 'Sync failed: ' + (data.errorCode || 'ERROR');
            pulse.className = 'pulse-dot';
            pulse.style.backgroundColor = 'var(--danger)';
          } else {
            statusText.textContent = 'Ready to trigger';
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
          alert('Sync trigger rejected: ' + (errData.error || 'Unknown Error'));
          syncBtn.disabled = false;
        }
      } catch (err) {
        alert('Server connection error');
        syncBtn.disabled = false;
      }
    }

    loadStats();
    checkSyncStatus();

    setInterval(loadStats, 10000);
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
