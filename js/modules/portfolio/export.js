// export.js — utility di esportazione PDF/XLSX condivisa tra Movimenti e Posizioni.
// Richiede jsPDF + jspdf-autotable + SheetJS (XLSX) caricati via <script> in index.html.

function todayStr() {
    const d = new Date();
    const pad = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function nowStr() {
    const d = new Date();
    const pad = n => String(n).padStart(2, '0');
    return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export const ExportUtil = {
    todayStr,

    // columns: [{ key, label, align: 'left'|'right' }]
    // rows: array di oggetti già formattati come stringhe (pronte per la stampa)
    // summary: opzionale, [{ label, value }] mostrato come riquadri sopra la tabella
    toPDF({ title, subtitle, columns, rows, summary = [], filename, orientation = 'landscape' }) {
        const { jsPDF } = window.jspdf || {};
        if (!jsPDF) {
            console.error('jsPDF non caricato');
            return;
        }
        const doc = new jsPDF({ orientation, unit: 'pt', format: 'a4' });
        const pageWidth = doc.internal.pageSize.getWidth();
        const margin = 32;

        doc.setFontSize(15);
        doc.setFont(undefined, 'bold');
        doc.text(title, margin, 40);
        doc.setFontSize(9);
        doc.setFont(undefined, 'normal');
        doc.setTextColor(120);
        if (subtitle) doc.text(subtitle, margin, 56);
        doc.text(`Generato il ${todayStr()} ore ${nowStr()}`, pageWidth - margin, 40, { align: 'right' });
        doc.setTextColor(0);

        let cursorY = 70;

        if (summary.length) {
            const boxW = (pageWidth - margin * 2 - (summary.length - 1) * 10) / summary.length;
            summary.forEach((s, i) => {
                const x = margin + i * (boxW + 10);
                doc.setFillColor(241, 239, 232);
                doc.roundedRect(x, cursorY, boxW, 40, 4, 4, 'F');
                doc.setFontSize(8);
                doc.setTextColor(120);
                doc.text(s.label, x + 8, cursorY + 15);
                doc.setFontSize(11);
                doc.setFont(undefined, 'bold');
                doc.setTextColor(0);
                doc.text(String(s.value), x + 8, cursorY + 31);
                doc.setFont(undefined, 'normal');
            });
            cursorY += 55;
        }

        doc.autoTable({
            startY: cursorY,
            margin: { left: margin, right: margin },
            head: [columns.map(c => c.label)],
            body: rows.map(r => columns.map(c => r[c.key] ?? '—')),
            styles: { fontSize: 8.5, cellPadding: 5 },
            headStyles: { fillColor: [40, 40, 40], textColor: 255 },
            columnStyles: Object.fromEntries(
                columns.map((c, i) => [i, { halign: c.align || 'left' }])
            ),
            didDrawPage() {
                const str = `Pagina ${doc.internal.getNumberOfPages()}`;
                doc.setFontSize(8);
                doc.setTextColor(150);
                doc.text(str, pageWidth - margin, doc.internal.pageSize.getHeight() - 16, { align: 'right' });
            }
        });

        doc.save(filename);
    },

    // columns: [{ key, label }] — rows: array di oggetti (numeri o stringhe)
    toXLSX({ sheetName = 'Foglio1', columns, rows, filename }) {
        const XLSX = window.XLSX;
        if (!XLSX) {
            console.error('SheetJS (XLSX) non caricato');
            return;
        }
        const data = rows.map(r => {
            const obj = {};
            columns.forEach(c => { obj[c.label] = r[c.key] ?? ''; });
            return obj;
        });
        const ws = XLSX.utils.json_to_sheet(data);
        ws['!cols'] = columns.map(c => ({ wch: Math.max(c.label.length, 12) }));
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, sheetName);
        XLSX.writeFile(wb, filename);
    }
};

// ── Dropdown "Esporta ▾" riusabile (Movimenti + Posizioni) ─────────────────
let _exportOutsideClickBound = false;

export function renderExportDropdown(containerEl, { onPDF, onXLS }) {
    containerEl.innerHTML = `
        <div class="dropdown-esporta" style="position:relative;display:inline-block;">
            <button class="btn btn-dark btn-sm" id="btn-esporta-toggle">⬇ Esporta ▾</button>
            <div class="dropdown-esporta-menu" style="display:none;position:absolute;right:0;top:calc(100% + 4px);background:var(--card);border:1px solid var(--border);border-radius:8px;min-width:160px;box-shadow:0 6px 20px rgba(0,0,0,.15);overflow:hidden;z-index:50;">
                <button class="dropdown-esporta-item" data-fmt="pdf" style="display:flex;width:100%;padding:9px 14px;background:none;border:none;color:var(--text-primary);font-size:13px;text-align:left;cursor:pointer;">📄 Esporta PDF</button>
                <div style="height:1px;background:var(--border);"></div>
                <button class="dropdown-esporta-item" data-fmt="xlsx" style="display:flex;width:100%;padding:9px 14px;background:none;border:none;color:var(--text-primary);font-size:13px;text-align:left;cursor:pointer;">📊 Esporta Excel</button>
            </div>
        </div>`;

    const toggleBtn = containerEl.querySelector('#btn-esporta-toggle');
    const menu = containerEl.querySelector('.dropdown-esporta-menu');

    toggleBtn.onclick = (e) => {
        e.stopPropagation();
        document.querySelectorAll('.dropdown-esporta-menu').forEach(m => { if (m !== menu) m.style.display = 'none'; });
        menu.style.display = menu.style.display === 'none' ? 'block' : 'none';
    };

    menu.querySelectorAll('.dropdown-esporta-item').forEach(btn => {
        btn.onclick = (e) => {
            e.stopPropagation();
            menu.style.display = 'none';
            if (btn.dataset.fmt === 'pdf') onPDF();
            else onXLS();
        };
    });

    if (!_exportOutsideClickBound) {
        document.addEventListener('click', () => {
            document.querySelectorAll('.dropdown-esporta-menu').forEach(m => m.style.display = 'none');
        });
        _exportOutsideClickBound = true;
    }
}