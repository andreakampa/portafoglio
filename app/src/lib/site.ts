// Indirizzi del sito. La v2 vive sia su GitHub Pages (/portafoglio/v2/) sia, come Gruzzolo, su Cloudflare Pages
// (miogruzzolo.pages.dev): i collegamenti (inviti, email) usano l'indirizzo da cui si sta usando l'app.
export const OLD_SITE_URL = 'https://andreakampa.github.io/portafoglio/'
export const DEFAULT_APP_URL = 'https://andreakampa.github.io/portafoglio/v2/'

/** Indirizzo dell'app da mettere nei collegamenti; in locale (sviluppo, test) quello pubblicato. */
export function appUrl(origin: string = globalThis.location?.origin ?? '', base: string = import.meta.env.BASE_URL): string {
  if (!/^https:\/\//.test(origin) || /\/\/(localhost|127\.0\.0\.1)(:|$)/.test(origin)) return DEFAULT_APP_URL
  return `${origin}${base.endsWith('/') ? base : `${base}/`}`
}
