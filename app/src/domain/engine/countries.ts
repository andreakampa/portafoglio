// Codici degli Stati esteri usati nei quadri RM e RW (tabella "Elenco Paesi e Territori esteri",
// appendice al Fascicolo 1 delle istruzioni Redditi PF 2026). Chiave: codice ISO a due lettere,
// cioè le prime due lettere dell'ISIN. Solo gli Stati più comuni per un investitore: per gli altri
// la pagina mostra il codice ISO e chiede di cercarlo nella tabella.

export interface Country {
  code: string
  name: string
}

const TABLE: Record<string, [string, string]> = {
  US: ['069', 'Stati Uniti'],
  IE: ['040', 'Irlanda'],
  LU: ['092', 'Lussemburgo'],
  DE: ['094', 'Germania'],
  FR: ['029', 'Francia'],
  NL: ['050', 'Paesi Bassi'],
  GB: ['031', 'Regno Unito'],
  CH: ['071', 'Svizzera'],
  CA: ['013', 'Canada'],
  JP: ['088', 'Giappone'],
  ES: ['067', 'Spagna'],
  BE: ['009', 'Belgio'],
  AT: ['008', 'Austria'],
  PT: ['055', 'Portogallo'],
  DK: ['021', 'Danimarca'],
  SE: ['068', 'Svezia'],
  NO: ['048', 'Norvegia'],
  FI: ['028', 'Finlandia'],
  GR: ['032', 'Grecia'],
  CN: ['016', 'Cina'],
  HK: ['103', 'Hong Kong'],
  TW: ['022', 'Taiwan'],
  KR: ['084', 'Corea del Sud'],
  IN: ['114', 'India'],
  SG: ['147', 'Singapore'],
  AU: ['007', 'Australia'],
  NZ: ['049', 'Nuova Zelanda'],
  IL: ['182', 'Israele'],
  KY: ['211', 'Cayman (isole)'],
  BM: ['207', 'Bermuda'],
  JE: ['202', 'Jersey'],
  GG: ['201', 'Guernsey'],
  IM: ['203', 'Isola di Man'],
  UY: ['080', 'Uruguay'],
  AR: ['006', 'Argentina'],
  BR: ['011', 'Brasile'],
  MX: ['046', 'Messico'],
  ZA: ['078', 'Sudafrica'],
  PL: ['054', 'Polonia'],
  CY: ['101', 'Cipro'],
  MT: ['105', 'Malta'],
  PA: ['051', 'Panama'],
  VG: ['249', 'Isole Vergini britanniche'],
}

/** Stato estero dal codice ISO (o dalle prime due lettere di un ISIN). null se non è in tabella. */
export function countryOf(iso: string | undefined | null): Country | null {
  const k = (iso || '').slice(0, 2).toUpperCase()
  const hit = TABLE[k]
  return hit ? { code: hit[0], name: hit[1] } : null
}
