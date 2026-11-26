// Le recensioni mostrate nell'onboarding. SOLO parole vere di utenti veri, con il loro
// permesso: finché l'elenco è vuoto la schermata non esiste per il pubblico (in anteprima
// si vede con dei segnaposto dichiarati, per giudicare l'impaginazione).
export type Review = { quote: string; name: string; detail?: string; plate?: string };

export const REVIEWS: Review[] = [];

export const REVIEW_PLACEHOLDERS: Review[] = [
  { quote: 'Placeholder. Paste a real review here: what they cooked, what changed.', name: 'Real name', detail: 'Member since…', plate: 'v-tacos' },
  { quote: 'Placeholder. A second real review, ideally about cook mode.', name: 'Real name', detail: 'Member since…', plate: 'v-ramen' },
  { quote: 'Placeholder. A third one, ideally about groceries or money saved.', name: 'Real name', detail: 'Member since…', plate: 'v-gnocchi' },
];
