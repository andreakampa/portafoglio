// Esporta una tabella in PDF o Excel (come js/modules/portfolio/export.js del sito vecchio).
// Le librerie si scaricano solo al primo uso, così l'app resta leggera.

export interface ExportTable {
  title: string
  subtitle: string
  headers: string[]
  /** Valori per Excel (numeri veri, così si possono sommare) … */
  values: (string | number | null)[][]
  /** … e gli stessi già formattati per il PDF. */
  texts: string[][]
  /** Nome del file senza estensione. */
  fileName: string
}

export async function exportPdf(t: ExportTable): Promise<void> {
  const [{ jsPDF }, { autoTable }] = await Promise.all([import('jspdf'), import('jspdf-autotable')])
  const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' })
  doc.setFontSize(14)
  doc.text(t.title, 32, 36)
  doc.setFontSize(9)
  doc.setTextColor(110)
  doc.text(t.subtitle, 32, 52)
  autoTable(doc, {
    startY: 64,
    head: [t.headers],
    body: t.texts,
    margin: { left: 32, right: 32 },
    styles: { fontSize: 8, cellPadding: 4 },
    headStyles: { fillColor: [31, 42, 46] },
    columnStyles: Object.fromEntries(t.headers.map((_, i) => [i, { halign: i === 0 ? 'left' : 'right' }])),
  })
  doc.save(`${t.fileName}.pdf`)
}

export async function exportXlsx(t: ExportTable): Promise<void> {
  const { default: writeExcelFile } = await import('write-excel-file/browser')
  const data = [t.headers.map(h => ({ value: h, fontWeight: 'bold' as const })), ...t.values.map(row => row.map(v => (v === null ? null : { value: v })))]
  await writeExcelFile(data, { columns: t.headers.map((_, i) => ({ width: i === 0 ? 22 : 14 })) }).toFile(`${t.fileName}.xlsx`)
}
