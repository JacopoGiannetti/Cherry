// L'onboarding visto come funnel: un elenco per versione, nell'ordine
// in cui le schermate si vedono. Lo leggono l'allowlist di
// `routes/usage.js` e la dashboard (`dashboard/aggregate.js`).
//
// Uno step = una schermata che chiede un gesto all'utente: il drop-off
// si legge solo se il confine fra due step è una cosa che l'utente ha
// scelto di fare.
//
// Due versioni. La v1 è il percorso storico: i suoi contatori restano
// e si leggono ancora. La v2 ha un prefisso suo (`onboarding.step.v2.`)
// così le metriche ripartono da zero e la dashboard confronta le due
// senza che si mescolino. Il gemello Swift è `OnboardingStep` in
// OnboardingFlow.swift: gli id devono combaciare, o nella dashboard lo
// step resta fermo a zero.
const PREFIX = 'onboarding.step.';

/// Il quiz saltato non è uno step: è la scorciatoia che lo evita.
const QUIZ_SKIP_EVENT = 'onboarding.quiz.skip';

/// Esisteva prima del funnel, ed è già negli storici: si tiene il nome,
/// uguale per tutte le versioni.
const COMPLETE_EVENT = 'onboarding.complete';

const COMPLETE_STEP = { id: 'complete', label: 'Onboarding fatto', caption: 'Profilo salvato: da qui parte il paywall', event: COMPLETE_EVENT };

const V1_SEQUENCE = [
  { id: 'welcome', label: 'Welcome', caption: 'Logo Vego, “Swipe up to enter”' },
  { id: 'promise', label: 'La promessa', caption: '“Eating plant-based is hard → easy”, poi “Let’s go”' },
  { id: 'problems.intro', label: 'Tre momenti', caption: '“Vego makes plant-based simple”: spesa, ristorante, ricette' },
  { id: 'problems.grocery', label: 'Problema 1 · spesa', caption: '“What do I even buy?” con il deck che gira' },
  { id: 'problems.menu', label: 'Problema 2 · menu', caption: '“What can I order here?” con la scansione' },
  { id: 'problems.swap', label: 'Problema 3 · swap', caption: '“Every good recipe has meat in it”' },
  { id: 'founder', label: 'Founder', caption: '“Hi, I’m Jacopo”: chi c’è dietro l’app' },
  { id: 'trust', label: 'Fiducia', caption: '“Thank you for trusting us”: niente pubblicità, niente dati venduti, cancelli quando vuoi' },
  { id: 'hello', label: 'Nome', caption: '“What should we call you?”' },
  { id: 'referral', label: 'Canale', caption: '“And how did you find us?”: da dove arriva davvero la gente' },
  { id: 'quiz.intro', label: 'Intro quiz', caption: '“Let’s learn your taste”: cosa sta per chiedere' },
  { id: 'quiz.ingredients', label: 'Quiz · ingredienti', caption: 'Griglia dei no-go: cosa non finisce mai nel piatto' },
  { id: 'quiz.dishes', label: 'Quiz · piatti', caption: 'Quindici piatti votati uno a uno (un solo step)' },
  { id: 'quiz.done', label: 'Quiz finito', caption: 'Allergie, piccante, identità: “Build my profile”' },
  { id: 'profile.ready', label: 'Profilo pronto', caption: '“Your taste profile is ready”' },
  { id: 'blockers', label: 'Cosa deleghi', caption: '“Which of these feel familiar?”: sette fastidi, se ne sceglie più di uno' },
  { id: 'outcome', label: 'Il grafico', caption: '“84% go back”: la curva vera dell’abbandono e la risposta al suo blocco' },
  { id: 'audience', label: 'Per chi è', caption: '“Who is Vego for?”: chi taglia la carne, chi vuole ricette, chi c’è già' },
  { id: 'voices', label: 'Le voci', caption: 'Undici citazioni famose e nove dati di ricerca, su due colonne che scorrono' },
  { id: 'reviews', label: 'I primi utenti', caption: 'Cinque messaggi veri dei primi utenti — e qui chiediamo la recensione' },
  { id: 'movement', label: 'Movimento', caption: '“You’re not doing this alone”, poi “Count me in”' },
  { id: 'diet', label: 'Traguardo', caption: 'Vegano, vegetariano o pescetariano: l’ultimo passo prima del prezzo' },
  COMPLETE_STEP,
];

// v2: niente intro del quiz né piatti da votare; i problemi vanno
// dopo le domande, in coppie problema → soluzione ordinate dai
// blockers (quindi contate per posizione, non per argomento); c'è il
// quarto problema, il barcode.
const V2_SEQUENCE = [
  { id: 'welcome', label: 'Welcome', caption: 'Logo Vego, “Swipe up to enter”' },
  { id: 'promise', label: 'La promessa', caption: '“Eating plant-based is hard → easy”, poi “Let’s go”' },
  { id: 'founder', label: 'Founder', caption: 'La missione, firmata: plant-based come un piacere, non una rinuncia' },
  { id: 'trust', label: 'Fiducia', caption: '“Thank you for trusting us”: niente pubblicità, niente dati venduti, cancelli quando vuoi' },
  { id: 'hello', label: 'Nome', caption: '“What should we call you?”' },
  { id: 'referral', label: 'Canale', caption: '“And how did you find us?”: loghi veri, con Facebook' },
  { id: 'quiz.ingredients', label: 'Quiz · no-go', caption: 'Griglia dei no-go: cosa non finisce mai nel piatto' },
  { id: 'quiz.cant_eat', label: 'Quiz · non posso', caption: '“Anything you really can’t eat?”: allergie e intolleranze scritte a mano' },
  { id: 'quiz.spice', label: 'Quiz · piccante', caption: '“How spicy do you like it?”' },
  { id: 'quiz.cuisines', label: 'Quiz · cucine', caption: '“Which cuisines do you love?”: si chiede, non va all’AI' },
  { id: 'quiz.kitchen', label: 'Quiz · cucina', caption: '“What’s in your kitchen?”: gli elettrodomestici' },
  { id: 'quiz.tried', label: 'Quiz · già provato', caption: 'Mai / ci ho provato e ho mollato / lo faccio già' },
  { id: 'quiz.household', label: 'Quiz · tavola', caption: 'Per chi cucini: solo io, in due, famiglia, tavola mista' },
  { id: 'quiz.nights', label: 'Quiz · sere', caption: 'Quante sere plant-based a settimana, da 1 a 7' },
  { id: 'quiz.nights_ok', label: 'Quiz · conferma sere', caption: '“That’s a solid week”: la conferma sul numero scelto' },
  { id: 'quiz.time', label: 'Quiz · tempo', caption: 'Quanto deve durare la cena: 15 min, 30 min, mi piace cucinare' },
  { id: 'quiz.why', label: 'Quiz · perché', caption: 'Salute, animali, pianeta, gusto. Si può sceglierne più di uno' },
  { id: 'quiz.apps', label: 'Quiz · altre app', caption: 'Hai già usato un’app per questo? Poi “Build my profile”' },
  { id: 'quiz.done', label: 'Quiz finito', caption: 'Ha premuto “Build my profile”' },
  { id: 'profile.ready', label: 'Profilo pronto', caption: '“Your taste profile is ready”: no-go, cucine, piccante' },
  { id: 'blockers', label: 'Cosa deleghi', caption: '“Which of these feel familiar?”: sette fastidi, se ne sceglie più di uno' },
  { id: 'outcome', label: 'Il grafico', caption: '“84% go back”: la curva vera dell’abbandono e la risposta al suo blocco' },
  { id: 'pair1.problem', label: 'Problema 1', caption: 'Il primo dei suoi: l’illustrazione con i pensieri sopra la testa' },
  { id: 'pair1.solution', label: 'Soluzione 1', caption: 'L’iPhone finto con la funzione che lo risolve' },
  { id: 'pair2.problem', label: 'Problema 2', caption: 'Il secondo problema, in ordine di blockers' },
  { id: 'pair2.solution', label: 'Soluzione 2', caption: 'La seconda funzione che gira' },
  { id: 'pair3.problem', label: 'Problema 3', caption: 'Il terzo problema' },
  { id: 'pair3.solution', label: 'Soluzione 3', caption: 'La terza funzione che gira' },
  { id: 'pair4.problem', label: 'Problema 4', caption: 'L’ultimo problema (spesa, menu, ricetta o barcode)' },
  { id: 'pair4.solution', label: 'Soluzione 4', caption: 'L’ultima funzione, poi “I want this”' },
  { id: 'audience', label: 'Chi sei', caption: '“Which one is you?”: tre persone illustrate, si tocca la propria' },
  { id: 'voices', label: 'Le voci', caption: 'Undici citazioni famose e nove dati di ricerca, su due colonne che scorrono' },
  { id: 'reviews', label: 'I primi utenti', caption: 'Cinque messaggi veri dei primi utenti — e qui chiediamo la recensione' },
  { id: 'movement', label: 'Movimento', caption: '“You’re not doing this alone”, poi “Count me in”' },
  { id: 'diet', label: 'Traguardo', caption: 'Vegano, vegetariano o pescetariano: l’ultimo passo prima del prezzo' },
  COMPLETE_STEP,
];

function build(id, label, sequence) {
  // La v1 non aveva versione nel nome: i suoi eventi restano
  // `onboarding.step.<id>`, e gli screenshot in `shots/`.
  const stepPrefix = id === 'v1' ? PREFIX : `${PREFIX}${id}.`;
  const shotDir = id === 'v1' ? 'shots' : `shots/${id}`;
  const steps = sequence.map((step, index) => ({
    index,
    id: step.id,
    label: step.label,
    caption: step.caption,
    event: step.event || stepPrefix + step.id,
    // Lo screenshot dello step, in `dashboard/public`. Il nome esce
    // dall'id: niente terzo elenco da tenere allineato a mano.
    shot: `${shotDir}/${step.id.replace(/\./g, '-')}.png`,
  }));
  return {
    id,
    label,
    steps,
    events: steps.map((step) => step.event),
    // Gli eventi che dicono "questa persona ha fatto QUESTA versione":
    // tutti tranne `onboarding.complete`, che è uguale per tutte.
    ownEvents: steps.filter((step) => step.event !== COMPLETE_EVENT).map((step) => step.event),
  };
}

const versions = {
  v1: build('v1', 'Onboarding v1 · storico', V1_SEQUENCE),
  v2: build('v2', 'Onboarding v2 · coppie problema/soluzione', V2_SEQUENCE),
};

const CURRENT = 'v2';

/// Tutti gli eventi di tutte le versioni, senza doppioni: l'allowlist
/// del server deve accettare anche i ping delle app vecchie.
const events = [...new Set(Object.values(versions).flatMap((version) => version.events))];

module.exports = {
  versions,
  CURRENT,
  steps: versions[CURRENT].steps,
  events,
  PREFIX,
  QUIZ_SKIP_EVENT,
  COMPLETE_EVENT,
};
