// js/pages/portfolio/ui/ai.js
// Assistente AI del portafoglio (Gemini, chiave dell'utente nel suo browser).
// Il Worker Cloudflare fa solo da ponte: non conserva nessuna chiave.

// ⚠️ Sostituisci con l'URL del tuo Worker (lo stesso usato in yahoo.js),
// senza "/chat" e senza "?url=".
const WORKER_URL = 'https://finance-proxy.andrea-kampa.workers.dev/';

const KEY_STORAGE = 'gemini_api_key';
const CACHE_PREFIX = 'ai_analysis_';
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 ora

const ANALYSIS_PROMPT =
    'Analizza il mio portafoglio. Includi: (1) concentrazione e sbilanciamenti per peso, ' +
    '(2) drawdown delle posizioni rispetto al massimo a 52 settimane, ' +
    '(3) posizioni che oggi si muovono di più, (4) segnali di possibile sopravvalutazione o ' +
    'sottovalutazione che puoi dedurre SOLO dai dati forniti. ' +
    'Chiudi con una tabella riassuntiva e 3-5 punti di attenzione.';

let root = null;
let getContext = null;
let getPortfolioId = null;
let history = [];
let lastPid = null;
let busy = false;

// ───────────────────────── utilità ─────────────────────────

const store = {
    get(k) { try { return localStorage.getItem(k); } catch { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch { /* storage non disponibile */ } },
    del(k) { try { localStorage.removeItem(k); } catch { /* storage non disponibile */ } }
};

const esc = s => String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// Markdown minimale e sicuro: prima si fa l'escape dell'HTML, poi si applica il formato.
function inline(s) {
    return esc(s)
        .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
        .replace(/`([^`]+)`/g, '<code>$1</code>');
}

function md(text) {
    const lines = String(text).split('\n');
    const isRow = l => /^\s*\|.*\|\s*$/.test(l);
    const isSep = l => /^\s*\|[\s:|-]+\|\s*$/.test(l);
    const cells = l => l.trim().replace(/^\||\|$/g, '').split('|').map(c => c.trim());
    let html = '';
    let inList = false;
    let i = 0;

    const closeList = () => { if (inList) { html += '</ul>'; inList = false; } };

    while (i < lines.length) {
        const line = lines[i];

        if (isRow(line) && i + 1 < lines.length && isSep(lines[i + 1])) {
            closeList();
            const head = cells(line);
            i += 2;
            let rows = '';
            while (i < lines.length && isRow(lines[i])) {
                rows += '<tr>' + cells(lines[i]).map(c => `<td>${inline(c)}</td>`).join('') + '</tr>';
                i++;
            }
            html += '<div class="ai-tbl"><table><thead><tr>' +
                head.map(c => `<th>${inline(c)}</th>`).join('') +
                `</tr></thead><tbody>${rows}</tbody></table></div>`;
            continue;
        }

        const li = line.match(/^\s*[-*•]\s+(.*)$/);
        if (li) {
            if (!inList) { html += '<ul>'; inList = true; }
            html += `<li>${inline(li[1])}</li>`;
            i++;
            continue;
        }

        closeList();
        const h = line.match(/^#{1,4}\s+(.*)$/);
        if (h) html += `<div class="ai-h">${inline(h[1])}</div>`;
        else if (line.trim()) html += `<p>${inline(line)}</p>`;
        i++;
    }
    closeList();
    return html;
}

function errorHtml(code, status) {
    switch (code) {
        case 'chiave_mancante':
        case 'chiave_non_valida':
            return 'La chiave Gemini manca o non è valida. Controllala con il pulsante 🔑.';
        case 'quota_esaurita':
            return 'La quota gratuita di Gemini è esaurita per ora. Riprova più tardi.';
        case 'gemini_non_disponibile':
            return 'Gemini non risponde, oppure il modello non è disponibile sul tuo piano. Riprova più tardi.';
        case 'origine non consentita':
            return 'Il Worker non accetta questo indirizzo. Se stai provando da un altro dominio, aggiungilo a ALLOWED_ORIGINS nel Worker.';
        default:
            return `Errore imprevisto (${esc(code || status || 'sconosciuto')}). Riprova.`;
    }
}

// ───────────────────────── interfaccia ─────────────────────────

function injectStyles() {
    if (document.getElementById('ai-agent-style')) return;
    const st = document.createElement('style');
    st.id = 'ai-agent-style';
    st.textContent = `
#ai-fab { position: fixed; right: 16px; bottom: calc(16px + env(safe-area-inset-bottom, 0px)); z-index: 1400;
    width: 52px; height: 52px; border-radius: 50%; border: none; cursor: pointer;
    background: #16151a; color: #fff; font-size: 24px; box-shadow: 0 2px 10px rgba(0,0,0,.3); }
#ai-panel { position: fixed; right: 16px; bottom: calc(16px + env(safe-area-inset-bottom, 0px)); z-index: 1500;
    width: 400px; max-width: calc(100vw - 24px); height: min(600px, 82vh);
    display: none; flex-direction: column; background: #fff; color: #16151a;
    border: 1px solid #d5d3ca; border-radius: 12px; overflow: hidden; font-size: 13px;
    box-shadow: 0 6px 24px rgba(0,0,0,.25); }
#ai-panel.open { display: flex; }
#ai-panel .ai-head { display: flex; align-items: center; justify-content: space-between;
    padding: 10px 12px; border-bottom: 1px solid #e5e3da; }
#ai-panel .ai-head button { background: none; border: none; cursor: pointer; font-size: 16px;
    color: #16151a; padding: 4px 6px; }
#ai-panel .ai-keybox { padding: 10px 12px; border-bottom: 1px solid #e5e3da; background: #f7f6f1;
    display: none; font-size: 12px; line-height: 1.4; }
#ai-panel .ai-keybox.open { display: block; }
#ai-panel .ai-keybox input { width: 100%; box-sizing: border-box; margin: 6px 0; padding: 7px 8px;
    border: 1px solid #d5d3ca; border-radius: 6px; font-size: 13px; }
#ai-panel .ai-keybox button { border: 1px solid #d5d3ca; background: #fff; color: #16151a;
    border-radius: 6px; padding: 6px 12px; cursor: pointer; font-size: 12px; margin-right: 6px; }
#ai-panel .ai-keybox button.primary { background: #16151a; color: #fff; border-color: #16151a; }
#ai-panel .ai-keymsg { color: #a33a3a; margin-bottom: 4px; }
#ai-msgs { flex: 1; overflow-y: auto; padding: 12px; display: flex; flex-direction: column; gap: 8px; }
#ai-msgs .ai-msg { max-width: 92%; padding: 8px 10px; border-radius: 10px; line-height: 1.45; word-wrap: break-word; }
#ai-msgs .ai-user { align-self: flex-end; background: #16151a; color: #fff; }
#ai-msgs .ai-model { align-self: flex-start; background: #f7f6f1; border: 1px solid #e5e3da; }
#ai-msgs .ai-msg p { margin: 0 0 6px; }
#ai-msgs .ai-msg p:last-child { margin-bottom: 0; }
#ai-msgs .ai-msg ul { margin: 4px 0 6px; padding-left: 18px; }
#ai-msgs .ai-h { font-weight: 700; margin: 6px 0 4px; }
#ai-msgs .ai-note { font-size: 11px; color: #6a6960; margin-bottom: 6px; }
#ai-msgs .ai-tbl { overflow-x: auto; margin: 6px 0; }
#ai-msgs table { border-collapse: collapse; font-size: 11px; }
#ai-msgs th, #ai-msgs td { border: 1px solid #d5d3ca; padding: 3px 6px; text-align: left; white-space: nowrap; }
#ai-msgs th { background: #ecebe3; }
#ai-panel .ai-actions { display: flex; gap: 6px; padding: 6px 12px 0; }
#ai-panel .ai-actions button { border: 1px solid #d5d3ca; background: #fff; color: #16151a;
    border-radius: 6px; padding: 6px 10px; cursor: pointer; font-size: 12px; }
#ai-panel .ai-input { display: flex; gap: 6px; padding: 8px 12px; align-items: flex-end; }
#ai-panel .ai-input textarea { flex: 1; resize: none; max-height: 90px; padding: 8px; font: inherit;
    border: 1px solid #d5d3ca; border-radius: 8px; }
#ai-panel .ai-input button { border: none; background: #16151a; color: #fff; border-radius: 8px;
    width: 38px; height: 36px; cursor: pointer; font-size: 15px; }
#ai-panel button:disabled { opacity: .5; cursor: default; }
#ai-panel .ai-foot { padding: 0 12px 8px; font-size: 11px; color: #8a8878; }
#ai-panel button:focus-visible, #ai-fab:focus-visible, #ai-panel textarea:focus-visible,
#ai-panel input:focus-visible { outline: 2px solid #16151a; outline-offset: 2px; }
@media (max-width: 600px) {
    #ai-panel { left: 0; right: 0; bottom: 0; width: 100%; max-width: 100%; height: 86vh;
        border-radius: 12px 12px 0 0; padding-bottom: env(safe-area-inset-bottom, 0px); }
}`;
    document.head.appendChild(st);
}

const $ = id => document.getElementById(id);

function openPanel() {
    $('ai-panel').classList.add('open');
    $('ai-fab').style.display = 'none';
    if (!store.get(KEY_STORAGE)) showKeyBox('Per usare l\'assistente inserisci la tua chiave Gemini.');
}

function closePanel() {
    $('ai-panel').classList.remove('open');
    $('ai-fab').style.display = '';
}

function showKeyBox(message) {
    $('ai-keybox').classList.add('open');
    $('ai-keymsg').textContent = message || '';
}

function addMsg(role, html) {
    const d = document.createElement('div');
    d.className = `ai-msg ai-${role}`;
    d.innerHTML = html;
    const box = $('ai-msgs');
    box.appendChild(d);
    box.scrollTop = box.scrollHeight;
    return d;
}

function setBusy(v) {
    busy = v;
    ['ai-send', 'ai-analyze'].forEach(id => { const b = $(id); if (b) b.disabled = v; });
}

function build() {
    injectStyles();
    root = document.createElement('div');
    root.id = 'ai-agent-root';
    root.innerHTML = `
<button id="ai-fab" type="button" title="Assistente AI" aria-label="Apri l'assistente AI">🤖</button>
<div id="ai-panel" role="dialog" aria-label="Assistente AI del portafoglio">
  <div class="ai-head">
    <b>🤖 Assistente portafoglio</b>
    <span>
      <button id="ai-key-toggle" type="button" title="Chiave Gemini" aria-label="Chiave Gemini">🔑</button>
      <button id="ai-close" type="button" title="Chiudi" aria-label="Chiudi">✕</button>
    </span>
  </div>
  <div class="ai-keybox" id="ai-keybox">
    <div class="ai-keymsg" id="ai-keymsg"></div>
    Chiave Gemini (si crea gratis su <a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener">Google AI Studio</a>).
    Resta salvata solo in questo browser.
    <input id="ai-key-input" type="password" placeholder="Chiave…" autocomplete="off" spellcheck="false">
    <button id="ai-key-save" class="primary" type="button">Salva chiave</button>
    <button id="ai-key-remove" type="button">Rimuovi</button>
    <div style="margin-top:6px;color:#6a6960;">
      Con il piano gratuito Google gestisce i dati in modo diverso dal piano a pagamento (vedi i termini della Gemini API).
      Vengono inviati solo ticker, pesi e percentuali, senza importi in euro.
    </div>
  </div>
  <div id="ai-msgs"></div>
  <div class="ai-actions">
    <button id="ai-analyze" type="button">📊 Analizza portafoglio</button>
    <button id="ai-clear" type="button">Pulisci chat</button>
  </div>
  <div class="ai-input">
    <textarea id="ai-q" rows="1" placeholder="Chiedi qualcosa sul tuo portafoglio"></textarea>
    <button id="ai-send" type="button" aria-label="Invia">➤</button>
  </div>
  <div class="ai-foot">Analisi automatica, non è consulenza finanziaria.</div>
</div>`;
    document.body.appendChild(root);

    $('ai-fab').addEventListener('click', openPanel);
    $('ai-close').addEventListener('click', closePanel);
    $('ai-key-toggle').addEventListener('click', () => {
        const box = $('ai-keybox');
        if (box.classList.contains('open')) box.classList.remove('open');
        else showKeyBox('');
    });

    $('ai-key-save').addEventListener('click', () => {
        const v = $('ai-key-input').value.trim();
        if (!/^[A-Za-z0-9._-]{20,300}$/.test(v)) {
            $('ai-keymsg').textContent = 'La chiave non sembra valida: controlla di averla copiata per intero, senza spazi.';
            return;
        }
        store.set(KEY_STORAGE, v);
        $('ai-key-input').value = '';
        $('ai-keybox').classList.remove('open');
        addMsg('model', 'Chiave salvata. Puoi farmi una domanda o toccare "Analizza portafoglio".');
    });

    $('ai-key-remove').addEventListener('click', () => {
        store.del(KEY_STORAGE);
        $('ai-key-input').value = '';
        $('ai-keymsg').textContent = 'Chiave rimossa da questo browser.';
    });

    $('ai-clear').addEventListener('click', () => {
        history = [];
        $('ai-msgs').innerHTML = '';
    });

    $('ai-send').addEventListener('click', sendFromInput);
    $('ai-q').addEventListener('keydown', e => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendFromInput();
        }
    });
    $('ai-analyze').addEventListener('click', analyze);
}

// ───────────────────────── logica ─────────────────────────

function sendFromInput() {
    const ta = $('ai-q');
    const q = ta.value.trim();
    if (!q || busy) return;
    ta.value = '';
    ask(q);
}

async function ask(question, opts = {}) {
    if (busy) return;

    const key = store.get(KEY_STORAGE);
    if (!key) {
        showKeyBox('Per usare l\'assistente inserisci la tua chiave Gemini.');
        return;
    }

    const pid = getPortfolioId ? getPortfolioId() : null;
    if (pid !== lastPid) { history = []; lastPid = pid; }

    setBusy(true);
    addMsg('user', esc(opts.label || question));
    const wait = addMsg('model', '<i>Sto analizzando i dati…</i>');

    try {
        const context = await getContext();
        const res = await fetch(`${WORKER_URL}/chat`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Gemini-Key': key },
            body: JSON.stringify({ question, context, history: history.slice(-6) })
        });

        let data = {};
        try { data = await res.json(); } catch { /* risposta non JSON */ }

        if (!res.ok || !data.answer) {
            wait.innerHTML = errorHtml(data.error, res.status);
            if (data.error === 'chiave_mancante' || data.error === 'chiave_non_valida') {
                showKeyBox('Controlla o sostituisci la chiave.');
            }
            return;
        }

        wait.innerHTML = md(data.answer);
        history.push({ role: 'user', text: question }, { role: 'model', text: data.answer });
        history = history.slice(-12);

        if (opts.isAnalysis && pid) {
            store.set(CACHE_PREFIX + pid, JSON.stringify({ ts: Date.now(), text: data.answer }));
        }
    } catch {
        wait.innerHTML = 'Non riesco a contattare il server. Controlla la connessione e riprova.';
    } finally {
        setBusy(false);
        $('ai-msgs').scrollTop = $('ai-msgs').scrollHeight;
    }
}

async function analyze() {
    if (busy) return;
    const pid = getPortfolioId ? getPortfolioId() : null;
    const raw = pid ? store.get(CACHE_PREFIX + pid) : null;

    if (raw) {
        try {
            const c = JSON.parse(raw);
            const age = Date.now() - c.ts;
            if (age < CACHE_TTL_MS) {
                const min = Math.max(1, Math.round(age / 60000));
                const regenerate = confirm(
                    `Hai già un'analisi di ${min} min fa.\nRigenerarla? Usa una richiesta Gemini.`
                );
                if (!regenerate) {
                    addMsg('model', `<div class="ai-note">Analisi di ${min} min fa</div>${md(c.text)}`);
                    return;
                }
            }
        } catch { /* cache corrotta: si rigenera */ }
    }

    await ask(ANALYSIS_PROMPT, { isAnalysis: true, label: '📊 Analizza portafoglio' });
}

// ───────────────────────── API pubblica ─────────────────────────

export const AiAgent = {
    init({ getContext: gc, getPortfolioId: gp }) {
        getContext = gc;
        getPortfolioId = gp;
        if (root) return;
        build();
    },
    destroy() {
        if (root) root.remove();
        root = null;
        history = [];
        lastPid = null;
        busy = false;
    }
};
