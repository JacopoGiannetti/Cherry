// Legge Firestore e produce l'unico JSON che la pagina consuma.
//
// Il backend non conserva eventi grezzi: `lib/usage.js` scrive contatori
// aggregati su users/{uid}.usage, users/{uid}/usageDays/{giorno} e
// analytics/totals. Qui quindi non si interrogano eventi, si sommano
// contatori — ed è il motivo per cui non troverai un log navigabile né
// una metrica che il ledger non incrementi già.
const { keys } = require('../config/keys');
const { geminiRates, falUsdPerImage, rapidUsdPerCall, APP_OPEN_EVENT } = require('../lib/usage');
const {
  versions: ONBOARDING_VERSIONS,
  CURRENT: ONBOARDING_CURRENT,
  QUIZ_SKIP_EVENT,
  COMPLETE_EVENT,
} = require('../lib/onboarding-funnel');
const { loadProviders } = require('./providers');

/** Gli eventi che manda l'app (allowlist di routes/usage.js): uso, non costo. */
const ENGAGEMENT = [
  'onboarding.complete',
  'recipe.keep',
  'recipe.pass',
  'recipe.save',
  'list.finish',
  'inbox.open',
];

// Eventi webhook Superwall che segnalano un pagamento reale.
// trial_start da solo non basta: è prova gratuita, non subscriber pagante.
const PAID_SUB_EVENTS = new Set([
  'subscription_start',
  'subscription_renew',
  'trial_convert',
  'nonrenewing_purchase',
  'transaction_complete',
  'initial_purchase',
  'renewal',
  'non_renewing_purchase',
]);
// i contatori del ledger sotto un'etichetta comprensibile in dashboard.
const MAIN_FEATURES = {
  groceryPlanning: {
    label: 'Grocery list planning',
    keys: [
      'run.generate', 'run.generateMore', 'run.fromRecipes', 'run.merge',
      'grocery.substitute', 'grocery.substituteApply',
      'recipe.keep', 'recipe.pass', 'list.finish',
    ],
  },
  recipeSaving: {
    label: 'Recipe saving',
    keys: ['recipe.save'],
  },
  recipeVegamize: {
    label: 'Recipe vegamize',
    keys: ['swap.preview', 'swap.import', 'swap.finalize'],
  },
  menuScan: {
    label: 'Menu scan',
    keys: ['scan.menu'],
  },
  barcodeScan: {
    label: 'Barcode scan',
    keys: ['scan.product', 'scan.productCacheHit'],
  },
};

// `usage.features` mescola job AI, eventi dall'app, spazi e webhook
// abbonamento in una mappa sola. Separarli è l'unico modo per non
// confrontare un costo con uno swipe nello stesso grafico.
function groupOf(name) {
  if (name.startsWith('sub.')) return 'subscription';
  if (name.startsWith('space.')) return 'spaces';
  if (name === 'scan.productCacheHit') return 'cache';
  if (ENGAGEMENT.includes(name)) return 'engagement';
  // Dopo engagement: `onboarding.complete` è di casa lì da prima del
  // funnel, e spostarlo cambierebbe la tabella granulare senza motivo.
  if (name.startsWith('onboarding.')) return 'onboarding';
  return 'ai';
}

function num(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function iso(value) {
  return value && typeof value.toDate === 'function' ? value.toDate().toISOString() : null;
}

function dayKey(date) {
  return date.toISOString().slice(0, 10);
}

function bump(map, key) {
  map[key] = (map[key] || 0) + 1;
}

function quantile(sorted, q) {
  if (!sorted.length) return 0;
  const pos = (sorted.length - 1) * q;
  const low = Math.floor(pos);
  const high = Math.ceil(pos);
  if (low === high) return sorted[low];
  return sorted[low] + (sorted[high] - sorted[low]) * (pos - low);
}

/** Media di un bucket percentile (es. top 5% = utenti sopra P95). */
function bucketAvg(sorted, fromQ, toQ) {
  if (!sorted.length) return { avg: 0, count: 0, threshold: 0 };
  const fromIdx = Math.ceil(sorted.length * fromQ);
  const toIdx = Math.ceil(sorted.length * toQ);
  const slice = sorted.slice(fromIdx, toIdx);
  if (!slice.length) return { avg: 0, count: 0, threshold: quantile(sorted, toQ) };
  return {
    avg: slice.reduce((s, v) => s + v, 0) / slice.length,
    count: slice.length,
    threshold: quantile(sorted, toQ),
  };
}

function hasPaidOnce(subscription, usageFeatures) {
  const sub = subscription || {};
  if (sub.hasPaid) return true;
  if (sub.lastEvent && PAID_SUB_EVENTS.has(sub.lastEvent)) return true;
  for (const [name, count] of Object.entries(usageFeatures || {})) {
    if (!name.startsWith('sub.')) continue;
    if (PAID_SUB_EVENTS.has(name.slice(4)) && num(count) > 0) return true;
  }
  return false;
}

function isPaidSubscriber(user) {
  return Boolean(user.hasPaid);
}

function sumUsd(list, field) {
  return list.reduce((s, u) => s + num(u[field]), 0);
}

/** Le chiamate di un singolo utente, raggruppate per macro-feature. */
function userFeatureCalls(feats) {
  const out = {};
  for (const [id, def] of Object.entries(MAIN_FEATURES)) {
    let calls = 0;
    for (const key of def.keys) calls += num(feats[key]);
    out[id] = calls;
  }
  return out;
}

/**
 * Come si divide l'uso dentro una persona sola, mediato fra le persone.
 *
 * Non è la stessa cosa della quota di chiamate totali: lì chi genera
 * mille chiamate decide da solo la forma del grafico. Qui ogni utente
 * porta la sua ripartizione e pesa uno, quindi si legge "l'utente tipo
 * spende metà del suo tempo sulla lista", che è la domanda vera.
 */
function buildFeatureMix(users) {
  const ids = Object.keys(MAIN_FEATURES);
  const active = users.filter((u) => ids.some((id) => u.featureCalls[id] > 0));
  return {
    users: active.length,
    rows: ids.map((id) => {
      let sumShare = 0;
      let usersWith = 0;
      for (const user of active) {
        const total = ids.reduce((s, key) => s + user.featureCalls[key], 0);
        const calls = user.featureCalls[id];
        if (calls > 0) usersWith += 1;
        if (total) sumShare += calls / total;
      }
      return {
        id,
        label: MAIN_FEATURES[id].label,
        avgShare: active.length ? sumShare / active.length : 0,
        users: usersWith,
        pctUsers: active.length ? usersWith / active.length : 0,
      };
    }).sort((a, b) => b.avgShare - a.avgShare),
  };
}

function buildMainFeatures(featureMap) {
  return Object.entries(MAIN_FEATURES).map(([id, def]) => {
    let calls = 0;
    let usd = 0;
    let jobs = 0;
    let errors = 0;
    for (const key of def.keys) {
      const row = featureMap.get(key);
      if (!row) continue;
      calls += row.calls;
      usd += row.usd;
      jobs += row.jobs;
      errors += row.errors;
    }
    return {
      id,
      label: def.label,
      keys: def.keys,
      calls,
      usd,
      jobs,
      errors,
      costPerCall: calls ? usd / calls : 0,
    };
  }).sort((a, b) => b.calls - a.calls);
}

// Sotto questa soglia un tasso di pagamento non si mostra: due
// persone e un pagante direbbero 50% e non significa niente.
const PAID_RATE_MIN = 5;

function asText(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function asList(value) {
  return Array.isArray(value)
    ? [...new Set(value.filter((item) => typeof item === 'string' && item))]
    : [];
}

function asNights(value) {
  const n = Number(value);
  return Number.isInteger(n) && n >= 1 && n <= 7 ? n : null;
}

// Una domanda a scelta chiusa: quante persone per voce, e di quelle
// quante hanno pagato. `order` tiene l'ordine della slide (le sere
// 1–7); senza, si ordina per quante l'hanno toccata.
function mixClosed(users, getId, order) {
  const answered = users.filter((u) => {
    const id = getId(u);
    return id !== null && id !== undefined && id !== '';
  });
  const map = new Map();
  if (order) for (const id of order) map.set(String(id), { id: String(id), picked: 0, paid: 0 });
  for (const u of answered) {
    const id = String(getId(u));
    const row = map.get(id) || { id, picked: 0, paid: 0 };
    row.picked += 1;
    if (u.hasPaid) row.paid += 1;
    map.set(id, row);
  }
  const rows = [...map.values()].map((r) => ({
    ...r,
    pctPicked: answered.length ? r.picked / answered.length : 0,
    pctPaid: r.picked >= PAID_RATE_MIN ? r.paid / r.picked : null,
  }));
  if (!order) rows.sort((a, b) => b.picked - a.picked || a.id.localeCompare(b.id));
  return { answered: answered.length, rows, minForRate: PAID_RATE_MIN };
}

function mixMulti(users, getList) {
  const answered = users.filter((u) => (getList(u) || []).length);
  const map = new Map();
  let pickedTotal = 0;
  for (const u of answered) {
    const ids = [...new Set(getList(u))];
    pickedTotal += ids.length;
    for (const raw of ids) {
      const id = String(raw);
      const row = map.get(id) || { id, picked: 0, paid: 0 };
      row.picked += 1;
      if (u.hasPaid) row.paid += 1;
      map.set(id, row);
    }
  }
  return {
    answered: answered.length,
    avgPicked: answered.length ? pickedTotal / answered.length : 0,
    rows: [...map.values()]
      .map((r) => ({
        ...r,
        pctPicked: answered.length ? r.picked / answered.length : 0,
        pctPaid: r.picked >= PAID_RATE_MIN ? r.paid / r.picked : null,
      }))
      .sort((a, b) => b.picked - a.picked || a.id.localeCompare(b.id)),
    minForRate: PAID_RATE_MIN,
  };
}

/** Tutti i giorni da `from` a oggi: senza, il grafico salta i buchi e mente. */
function dayRange(from) {
  const out = [];
  const cursor = new Date(`${from}T00:00:00.000Z`);
  const today = new Date(`${dayKey(new Date())}T00:00:00.000Z`);
  if (Number.isNaN(cursor.getTime())) return out;
  while (cursor <= today) {
    out.push(dayKey(cursor));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return out;
}

// Il Firestore arriva da fuori: in locale è autenticato col service
// account, su Cloud Run con l'identità del servizio. `authAdmin` è
// opzionale: serve solo a sapere chi ha collegato Apple, e se manca (o
// se il service account non ha quel permesso) la dashboard perde una
// colonna invece di non aprirsi.
async function build(store, authAdmin, options = {}) {
  const [totalsSnap, usersSnap, daysSnap, spacesSnap] = await Promise.all([
    store.doc('analytics/totals').get(),
    store.collection('users').get(),
    // Una query sola invece di una per utente. Senza filtri non serve
    // nessun indice composito da creare a mano in console.
    store.collectionGroup('usageDays').get(),
    store.collection('spaces').get(),
  ]);

  // Un guasto qui non deve portarsi giù tutto il resto: senza permessi
  // su Auth si perdono i provider, non le altre trenta metriche.
  let providers = null;
  let providersError = null;
  if (authAdmin) {
    try {
      providers = await loadProviders(authAdmin);
    } catch (error) {
      providersError = error.message;
      console.warn('[dashboard] provider di accesso non leggibili:', error.message);
    }
  }

  const today = dayKey(new Date());
  const since7 = dayKey(new Date(Date.now() - 6 * 86400000));
  const since30 = dayKey(new Date(Date.now() - 29 * 86400000));
  const since365 = dayKey(new Date(Date.now() - 364 * 86400000));
  const features = new Map();
  const featureRow = (name) => {
    if (!features.has(name)) {
      features.set(name, {
        name,
        group: groupOf(name),
        calls: 0,
        jobs: 0,
        errors: 0,
        usd: 0,
        geminiCalls: 0,
        inputTokens: 0,
        outputTokens: 0,
        falImages: 0,
        rapidCalls: 0,
      });
    }
    return features.get(name);
  };

  const social = { linksPreviewed: 0, linksImported: 0, screenshots: 0, pastedText: 0 };
  const spaceCounters = { created: 0, joined: 0, left: 0, current: 0 };
  const subscriptions = { active: 0, inactive: 0, unknown: 0 };
  const byReferral = {};
  const byDiet = {};
  const byLanguage = {};
  // `let` perché la finestra temporale lo sostituisce con la coorte.
  let users = [];

  for (const doc of usersSnap.docs) {
    const data = doc.data() || {};
    const usage = data.usage || {};
    const costs = usage.costs || {};
    const profile = data.tasteProfile || {};
    const quotaToday = (data.dailyUsage || {})[today] || {};

    for (const [name, count] of Object.entries(usage.features || {})) {
      featureRow(name).calls += num(count);
    }
    for (const [name, count] of Object.entries(usage.featureErrors || {})) {
      featureRow(name).errors += num(count);
    }
    for (const [name, entry] of Object.entries(usage.byFeature || {})) {
      const row = featureRow(name);
      row.jobs += num(entry.jobs);
      row.usd += num(entry.usd);
      row.geminiCalls += num(entry.geminiCalls);
      row.inputTokens += num(entry.inputTokens);
      row.outputTokens += num(entry.outputTokens);
      row.falImages += num(entry.falImages);
      row.rapidCalls += num(entry.rapidCalls);
    }

    // Quale onboarding ha fatto, e lo step più avanti che ha raggiunto
    // in quello. Il funnel si conta dopo, quando si sa chi sta nella
    // finestra temporale: contarlo qui impedirebbe di isolare la
    // coorte. La versione la dicono gli eventi: chi ha anche un solo
    // ping della v2 è della v2, chi ha solo quelli vecchi è della v1.
    const events = usage.features || {};
    let onboardingVersion = null;
    for (const version of Object.values(ONBOARDING_VERSIONS)) {
      if (version.ownEvents.some((event) => num(events[event]) > 0)) onboardingVersion = version.id;
    }
    let deepest = -1;
    if (onboardingVersion) {
      for (const step of ONBOARDING_VERSIONS[onboardingVersion].steps) {
        if (num(events[step.event]) > 0) deepest = step.index;
      }
    }

    for (const key of Object.keys(social)) social[key] += num((usage.social || {})[key]);
    const spaces = usage.spaces || {};
    spaceCounters.created += num(spaces.created);
    spaceCounters.joined += num(spaces.joined);
    spaceCounters.left += num(spaces.left);
    spaceCounters.current += num(spaces.current);

    const status = (data.subscription || {}).status;
    const subscription = data.subscription || {};
    const hasPaid = hasPaidOnce(subscription, usage.features);

    // 'apple' = ha collegato l'Apple ID, 'anon' = sessione anonima,
    // 'missing' = c'è il documento ma l'utente Auth non esiste più
    // (account cancellato), null = i provider non sono disponibili.
    const authInfo = providers ? providers.get(doc.id) : null;
    let authKind = null;
    if (providers) authKind = authInfo ? (authInfo.apple ? 'apple' : 'anon') : 'missing';
    if (status === 'active') subscriptions.active += 1;
    else if (status === 'inactive') subscriptions.inactive += 1;
    else subscriptions.unknown += 1;

    bump(byReferral, data.referralSource || 'non dichiarato');
    bump(byDiet, profile.dietaryIdentity || 'non impostato');
    bump(byLanguage, profile.language || 'non impostata');

    const feats = usage.features || {};
    const used = (keys) => keys.some((key) => num(feats[key]) > 0);
    const activated = num(usage.jobs) > 0
      || num(feats['list.finish']) > 0
      || num(feats['recipe.keep']) > 0
      || num(feats['scan.menu']) > 0
      || num(feats['swap.import']) > 0;

    users.push({
      uid: doc.id,
      name: data.displayName || null,
      referral: data.referralSource || null,
      diet: profile.dietaryIdentity || null,
      language: profile.language || null,
      exclusions: Array.isArray(profile.exclusions) ? profile.exclusions.length : 0,
      subscription: status || null,
      productId: subscription.productId || null,
      lastSubEvent: subscription.lastEvent || null,
      hasPaid,
      // Quante volte ha aperto l'app, e a quante aperture era quando ha
      // pagato. Li manda solo l'app aggiornata: per chi è arrivato prima
      // restano zero e null, e le metriche che li usano lo dicono invece
      // di contarli come "ha aperto una volta sola".
      opens: num((usage.features || {})[APP_OPEN_EVENT]),
      opensAtPaid: Number.isFinite(subscription.opensAtPaid) ? subscription.opensAtPaid : null,
      paidAt: iso(subscription.firstPaidAt),
      // Risposta al prompt ATT (authorized / denied / restricted…).
      // La scrive solo l'app che lo chiede: per chi è arrivato prima
      // è null, che vuol dire "mai chiesto", non "ha detto no".
      tracking: typeof data.tracking === 'string' ? data.tracking : null,
      trackingAt: iso(data.trackingAskedAt),
      authKind,
      signedUpAt: authInfo ? authInfo.createdAt : null,
      lastSignInAt: authInfo ? authInfo.lastSignInAt : null,
      // In ordine di scelta: il primo è il problema che pesa di più.
      blockers: Array.isArray(data.blockers) ? data.blockers : [],
      // Quiz v2: restano sull'utente, non nel tasteProfile (le cucine
      // e gli elettrodomestici non vanno all'AI).
      tried: asText(data.plantBasedTried),
      cookingFor: asText(data.cookingFor),
      nights: asNights(data.plantBasedNights),
      dinnerTime: asText(data.dinnerTime),
      why: asList(data.whyPlantBased),
      otherApps: asText(data.triedOtherApps),
      audiencePick: asText(data.audience),
      cuisines: asList(data.favoriteCuisines),
      appliances: asList(data.kitchenAppliances),
      onboardingVersion,
      deepestStep: deepest,
      quizSkipped: num(feats[QUIZ_SKIP_EVENT]) > 0,
      onboarded: num(feats[COMPLETE_EVENT]) > 0,
      activated,
      featureCalls: userFeatureCalls(feats),
      usedGrocery: used(MAIN_FEATURES.groceryPlanning.keys),
      usedSave: used(MAIN_FEATURES.recipeSaving.keys),
      usedSwap: used(MAIN_FEATURES.recipeVegamize.keys),
      usedMenu: used(MAIN_FEATURES.menuScan.keys),
      usedBarcode: used(MAIN_FEATURES.barcodeScan.keys),
      jobs: num(usage.jobs),
      jobsFailed: num(usage.jobsFailed),
      usd: num(costs.totalUsd),
      geminiUsd: num(costs.geminiUsd),
      falUsd: num(costs.falUsd),
      rapidUsd: num(costs.rapidUsd),
      inputTokens: num(costs.geminiInputTokens),
      outputTokens: num(costs.geminiOutputTokens),
      images: num(costs.falImages),
      spaces: num(spaces.current),
      quotaJobs: num(quotaToday.jobs),
      quotaImages: num(quotaToday.images),
      lastAt: iso(usage.lastAt),
      // Riempiti scorrendo usageDays più sotto.
      usd7: 0,
      usd30: 0,
      usd365: 0,
      jobs30: 0,
    });
  }

  const byUid = new Map(users.map((user) => [user.uid, user]));

  const dayMap = new Map();
  const dayRow = (day) => {
    if (!dayMap.has(day)) {
      dayMap.set(day, {
        day,
        usd: 0,
        geminiUsd: 0,
        falUsd: 0,
        rapidUsd: 0,
        paidUsd: 0,
        jobs: 0,
        jobsFailed: 0,
        inputTokens: 0,
        outputTokens: 0,
        images: 0,
        events: {},
        uids: new Set(),
        // Chi quel giorno ha fatto qualcosa, non solo aperto: da quando
        // esiste il ping delle aperture le due cose non coincidono più.
        workUids: new Set(),
      });
    }
    return dayMap.get(day);
  };

  // Non esiste un createdAt sul documento utente, quindi il primo
  // giorno con attività è la migliore approssimazione della nascita
  // dell'utente: sottostima chi si iscrive e non usa nulla.
  const firstSeen = new Map();
  // Tutti i giorni attivi di ogni utente: servono per retention,
  // churn e "quanti giorni ha davvero aperto l'app".
  const daysByUid = new Map();
  // Solo i giorni in cui ha fatto qualcosa oltre ad aprire. Un non
  // pagante che riapre e trova il paywall lascia un giorno senza niente
  // dentro: è un ritorno, non un uso, e confonderli farebbe sembrare
  // attivo chi ha solo riguardato il prezzo.
  const workDaysByUid = new Map();
  // Quanto ha speso, giorno per giorno: serve alla curva del costo per
  // anzianità, dove conta quando è arrivata la spesa e non solo quanta.
  const spendByUid = new Map();

  for (const doc of daysSnap.docs) {
    const data = doc.data() || {};
    const day = typeof data.day === 'string' ? data.day : doc.id;
    const costs = data.costs || {};
    const row = dayRow(day);
    row.usd += num(costs.totalUsd);
    row.geminiUsd += num(costs.geminiUsd);
    row.falUsd += num(costs.falUsd);
    row.rapidUsd += num(costs.rapidUsd);
    row.jobs += num(data.jobs);
    row.jobsFailed += num(data.jobsFailed);
    row.inputTokens += num(costs.geminiInputTokens);
    row.outputTokens += num(costs.geminiOutputTokens);
    row.images += num(costs.falImages);
    for (const [name, count] of Object.entries(data.features || {})) {
      row.events[name] = (row.events[name] || 0) + num(count);
    }

    const uid = doc.ref.parent.parent ? doc.ref.parent.parent.id : null;
    if (!uid) continue;
    row.uids.add(uid);
    const seen = firstSeen.get(uid);
    if (!seen || day < seen) firstSeen.set(uid, day);
    if (!daysByUid.has(uid)) daysByUid.set(uid, new Set());
    daysByUid.get(uid).add(day);
    const onlyOpen = !num(data.jobs)
      && Object.keys(data.features || {}).every((name) => name === APP_OPEN_EVENT);
    if (!onlyOpen) {
      row.workUids.add(uid);
      if (!workDaysByUid.has(uid)) workDaysByUid.set(uid, new Set());
      workDaysByUid.get(uid).add(day);
    }
    // Serve dopo per la curva per anzianità: lì conta a che punto della
    // vita di quella persona è arrivata la spesa, e l'anzianità si sa
    // solo quando si conosce il suo primo giorno.
    if (!spendByUid.has(uid)) spendByUid.set(uid, []);
    spendByUid.get(uid).push({ day, usd: num(costs.totalUsd) });

    // Il margine ha senso solo confrontando una spesa mensile con un
    // prezzo mensile: il totale a vita direbbe tutt'altra cosa.
    const user = byUid.get(uid);
    if (user) {
      if (user.hasPaid) row.paidUsd += num(costs.totalUsd);
      if (day >= since7) user.usd7 += num(costs.totalUsd);
      if (day >= since30) {
        user.usd30 += num(costs.totalUsd);
        user.jobs30 += num(data.jobs);
      }
      if (day >= since365) user.usd365 += num(costs.totalUsd);
    }
  }

  const newPerDay = {};
  for (const day of firstSeen.values()) newPerDay[day] = (newPerDay[day] || 0) + 1;

  const dayDiff = (a, b) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000);
  for (const user of users) {
    const days = daysByUid.get(user.uid);
    user.firstDay = firstSeen.get(user.uid) || null;
    user.activeDays = days ? days.size : 0;
    user.workDays = workDaysByUid.has(user.uid) ? workDaysByUid.get(user.uid).size : 0;
    user.lastDay = days ? [...days].sort().pop() : null;
    user.ageDays = user.firstDay ? dayDiff(user.firstDay, today) : 0;
    user.returned = Boolean(days && days.size > 1);
    // Il giorno da cui contare la sua retention. La data vera del
    // pagamento la scrive il webhook aggiornato; per i pagamenti più
    // vecchi si usa il primo giorno, che sul paywall duro dista
    // dall'acquisto qualche minuto.
    user.paidDay = user.hasPaid ? ((user.paidAt ? dayKey(new Date(user.paidAt)) : null) || user.firstDay) : null;
    // Quando è nato l'account. La data di Firebase Auth è quella vera;
    // il primo giorno attivo è un ripiego per chi non l'ha (utente
    // cancellato, o provider non leggibili).
    user.bornAt = (user.signedUpAt ? dayKey(new Date(user.signedUpAt)) : null) || user.firstDay;
  }

  // La finestra temporale: da qui in avanti `users` e `daily` contengono
  // solo la coorte richiesta, e tutto quello che sta sotto — funnel,
  // costi, retention, tabella — la eredita senza saperlo.
  //
  // Serve perché i contatori per utente sono cumulativi e senza data:
  // `usage.features` dice "ha visto questa slide", non quando. Tagliare
  // per data si può solo escludendo chi è nato prima, ed è anche l'unico
  // taglio che ha senso — il vecchio onboarding non torna più.
  const allUsers = users.length;
  const since = options.since || null;
  if (since) {
    users = users.filter((u) => u.bornAt && u.bornAt >= since);
  }
  const cohortUids = new Set(users.map((u) => u.uid));

  // Retention per coorte settimanale: chi è nato in quella settimana,
  // quanti sono tornati almeno una volta, quanti nei giorni 1–7 e
  // quanti nei giorni 8–30. Una coorte troppo giovane per la finestra
  // resta null: dire "0% a 30 giorni" di gente iscritta ieri è falso.
  const weekOf = (day) => {
    const d = new Date(`${day}T00:00:00Z`);
    const dow = (d.getUTCDay() + 6) % 7; // lunedì = 0
    d.setUTCDate(d.getUTCDate() - dow);
    return dayKey(d);
  };
  const cohortMap = new Map();
  for (const user of users) {
    if (!user.firstDay) continue;
    const week = weekOf(user.firstDay);
    if (!cohortMap.has(week)) {
      cohortMap.set(week, {
        week,
        size: 0,
        returned: 0,
        d7: 0,
        d30: 0,
        matureD7: 0,
        matureD30: 0,
        paid: 0,
        activated: 0,
        // Le stesse colonne contate solo sui paganti. Su tutta la coorte
        // la retention misura soprattutto quanti non hanno pagato, che è
        // il tasso di conversione scritto al rovescio.
        paidReturned: 0,
        paidD7: 0,
        paidD30: 0,
        paidMatureD7: 0,
        paidMatureD30: 0,
      });
    }
    const c = cohortMap.get(week);
    const days = daysByUid.get(user.uid) || new Set();
    c.size += 1;
    if (user.hasPaid) c.paid += 1;
    if (user.activated) c.activated += 1;
    let inWeek = false;
    let inMonth = false;
    for (const day of days) {
      const offset = dayDiff(user.firstDay, day);
      if (offset >= 1 && offset <= 7) inWeek = true;
      if (offset >= 8 && offset <= 30) inMonth = true;
    }
    if (days.size > 1) c.returned += 1;
    if (user.ageDays >= 7) { c.matureD7 += 1; if (inWeek) c.d7 += 1; }
    if (user.ageDays >= 30) { c.matureD30 += 1; if (inMonth) c.d30 += 1; }
    if (user.hasPaid) {
      if (days.size > 1) c.paidReturned += 1;
      if (user.ageDays >= 7) { c.paidMatureD7 += 1; if (inWeek) c.paidD7 += 1; }
      if (user.ageDays >= 30) { c.paidMatureD30 += 1; if (inMonth) c.paidD30 += 1; }
    }
  }
  const cohorts = [...cohortMap.values()].sort((a, b) => a.week.localeCompare(b.week)).map((c) => ({
    ...c,
    pctReturned: c.size ? c.returned / c.size : 0,
    pctD7: c.matureD7 ? c.d7 / c.matureD7 : null,
    pctD30: c.matureD30 ? c.d30 / c.matureD30 : null,
    pctPaid: c.size ? c.paid / c.size : 0,
    pctActivated: c.size ? c.activated / c.size : 0,
    pctPaidReturned: c.paid ? c.paidReturned / c.paid : null,
    pctPaidD7: c.paidMatureD7 ? c.paidD7 / c.paidMatureD7 : null,
    pctPaidD30: c.paidMatureD30 ? c.paidD30 / c.paidMatureD30 : null,
  }));

  // Churn: attivi fra 31 e 60 giorni fa che negli ultimi 30 non si
  // sono più visti. Chi è nato negli ultimi 30 giorni non può essere
  // churnato per definizione.
  const since60 = dayKey(new Date(Date.now() - 59 * 86400000));
  let churnBase = 0;
  let churned = 0;
  for (const user of users) {
    const days = daysByUid.get(user.uid);
    if (!days) continue;
    let inPrev = false;
    let inCurr = false;
    for (const day of days) {
      if (day >= since60 && day < since30) inPrev = true;
      if (day >= since30) inCurr = true;
    }
    if (inPrev) { churnBase += 1; if (!inCurr) churned += 1; }
  }

  // I giorni prima del reset sparrebbero dal grafico ma resterebbero
  // nelle somme: qui si tagliano alla fonte, e gli attivi di ogni
  // giorno si contano solo dentro la coorte.
  const known = [...dayMap.keys()].sort().filter((day) => !since || day >= since);
  const firstKnown = known.length ? known[0] : null;
  const daily = (firstKnown ? dayRange(firstKnown) : []).map((day) => {
    const row = dayMap.get(day);
    if (!row) {
      return {
        day,
        usd: 0,
        geminiUsd: 0,
        falUsd: 0,
        rapidUsd: 0,
        paidUsd: 0,
        jobs: 0,
        jobsFailed: 0,
        inputTokens: 0,
        outputTokens: 0,
        images: 0,
        events: {},
        activeUsers: 0,
        workUsers: 0,
        newUsers: newPerDay[day] || 0,
      };
    }
    const { uids, workUids, ...rest } = row;
    const inWindow = (set) => (since ? [...set].filter((uid) => cohortUids.has(uid)).length : set.size);
    return {
      ...rest,
      activeUsers: inWindow(uids),
      workUsers: inWindow(workUids),
      newUsers: newPerDay[day] || 0,
    };
  });

  const spend = users.map((u) => u.usd).filter((v) => v > 0).sort((a, b) => a - b);
  const paidSubscribers = users.filter(isPaidSubscriber);
  const subscriberSpend = paidSubscribers.map((u) => u.usd).sort((a, b) => a - b);
  const totalUsd = users.reduce((sum, u) => sum + u.usd, 0);
  const totalUsdPaid = sumUsd(paidSubscribers, 'usd');
  const usd7Paid = sumUsd(paidSubscribers, 'usd7');
  const usd30Paid = sumUsd(paidSubscribers, 'usd30');
  const usd365Paid = sumUsd(paidSubscribers, 'usd365');
  const withUsage = users.filter((u) => u.jobs > 0 || u.usd > 0).length;
  const subscribers = users.filter((u) => u.subscription === 'active');
  const usd30 = users.reduce((sum, user) => sum + user.usd30, 0);
  const withSharedSpace = users.filter((u) => u.spaces > 0).length;
  const top5 = bucketAvg(subscriberSpend, 0.95, 1);
  const bottom5 = bucketAvg(subscriberSpend, 0, 0.05);
  const mainFeatures = buildMainFeatures(features);
  const paidCount = paidSubscribers.length;
  const trialOnly = users.filter((u) =>
    !u.hasPaid && u.subscription === 'active' && u.lastSubEvent === 'trial_start').length;

  const engagement = {};
  for (const name of ENGAGEMENT) {
    engagement[name] = features.has(name) ? features.get(name).calls : 0;
  }

  // Il funnel, contato solo su chi sta nella finestra: per ogni utente
  // lo step più avanti raggiunto vale anche per tutti quelli prima.
  // Sommare i contatori grezzi darebbe un funnel che risale — basta un
  // ping perso in galleria — e un funnel che risale non si legge.
  //
  // Un funnel per versione, ognuno sui soli utenti di quella versione:
  // i gradini sono diversi e le percentuali non si possono mischiare.
  // In coda a ciascuno i due numeri da confrontare: quanti arrivano al
  // paywall e, di quelli, quanti pagano.
  function buildFunnel(version) {
    const cohort = users.filter((u) => u.onboardingVersion === version.id);
    const reachedByStep = version.steps.map(() => 0);
    let quizSkipped = 0;
    for (const user of cohort) {
      for (let i = 0; i <= user.deepestStep; i += 1) reachedByStep[i] += 1;
      if (user.quizSkipped) quizSkipped += 1;
    }

    const funnelStart = reachedByStep[0];
    const completed = reachedByStep[reachedByStep.length - 1];
    // La v1 aveva una slide di intro al quiz, la v2 no: il "salta" si
    // misura su chi è arrivato alla prima schermata del quiz che c'è.
    const quizIntro = version.steps.find((step) => step.id === 'quiz.intro')
      || version.steps.find((step) => step.id === 'quiz.ingredients');
    const quizIntroReached = quizIntro ? reachedByStep[quizIntro.index] : 0;
    const quizStep = version.steps.find((step) => step.id === 'quiz.ingredients');
    const quizReached = quizStep ? reachedByStep[quizStep.index] : 0;
    const quizDone = version.steps.find((step) => step.id === 'quiz.done');
    const quizCompleted = quizDone ? reachedByStep[quizDone.index] : 0;
    const skipBase = Math.max(quizIntroReached, quizSkipped);
    const paid = cohort.filter((u) => u.hasPaid).length;
    const paidOfCompleted = cohort.filter((u) => u.hasPaid && u.deepestStep === version.steps.length - 1).length;

    return {
      version: version.id,
      label: version.label,
      started: funnelStart,
      completed,
      users: cohort.length,
      steps: version.steps.map((step) => {
        const reached = reachedByStep[step.index];
        const last = step.index === reachedByStep.length - 1;
        // Chi ha visto questa slide e non è arrivato alla prossima ha
        // chiuso qui. All'ultimo step non c'è un dopo: dropped = 0.
        const continued = last ? reached : reachedByStep[step.index + 1];
        const dropped = reached - continued;
        return {
          ...step,
          reached,
          continued,
          dropped,
          pctDropped: reached ? dropped / reached : 0,
          pctContinued: reached ? continued / reached : 0,
          pctOfStart: funnelStart ? reached / funnelStart : 0,
        };
      }),
      quiz: {
        introReached: quizIntroReached,
        reached: quizReached,
        completed: quizCompleted,
        skipped: quizSkipped,
        pctSkipped: skipBase ? quizSkipped / skipBase : 0,
      },
      pay: {
        paid,
        paidOfCompleted,
        // Dalla prima slide al paywall, e dal paywall al pagamento.
        pctPaywall: funnelStart ? completed / funnelStart : 0,
        pctPaidOfPaywall: completed ? paidOfCompleted / completed : 0,
        pctPaidOfStarted: funnelStart ? paid / funnelStart : 0,
      },
    };
  }

  const onboardingVersions = {};
  for (const version of Object.values(ONBOARDING_VERSIONS)) {
    onboardingVersions[version.id] = buildFunnel(version);
  }
  // `onboarding` resta la versione corrente, con le altre dentro:
  // la dashboard le mette in un menu e cambia solo la lettura.
  const onboarding = { ...onboardingVersions[ONBOARDING_CURRENT], current: ONBOARDING_CURRENT, versions: onboardingVersions };
  // Il funnel generale (download → pagamento) somma le versioni: chi
  // ha iniziato l'onboarding è chi ha iniziato uno dei due.
  const funnelStart = Object.values(onboardingVersions).reduce((s, v) => s + v.started, 0);
  const onboardingCompletedAll = Object.values(onboardingVersions).reduce((s, v) => s + v.completed, 0);

  const cutoff = (days) => Date.now() - days * 86400000;
  const activeSince = (days) =>
    users.filter((u) => u.lastAt && Date.parse(u.lastAt) >= cutoff(days)).length;
  const active30 = activeSince(30);
  const active7 = activeSince(7);

  const keeps = engagement['recipe.keep'] || 0;
  const passes = engagement['recipe.pass'] || 0;
  const swipes = keeps + passes;
  const lists = engagement['list.finish'] || 0;
  const lastDay = daily.length ? daily[daily.length - 1] : null;
  const dau = lastDay ? lastDay.activeUsers : 0;
  const jobsAll = users.reduce((s, u) => s + u.jobs, 0);
  const jobsFailedAll = users.reduce((s, u) => s + u.jobsFailed, 0);
  const activatedN = users.filter((u) => u.activated).length;
  const onboardedN = users.filter((u) => u.onboarded).length;
  const geminiUsd = users.reduce((s, u) => s + u.geminiUsd, 0);
  const falUsd = users.reduce((s, u) => s + u.falUsd, 0);
  const rapidUsd = users.reduce((s, u) => s + u.rapidUsd, 0);
  const jobSorted = users.map((u) => u.jobs).sort((a, b) => a - b);
  const p90Jobs = quantile(jobSorted, 0.9);
  const top10n = Math.max(1, Math.ceil(users.length * 0.1));
  const top10usd = [...users].sort((a, b) => b.usd - a.usd).slice(0, top10n)
    .reduce((s, u) => s + u.usd, 0);
  const worstOnboarding = onboarding.steps
    .filter((s) => s.index < onboarding.steps.length - 1 && s.reached >= 3)
    .reduce((w, s) => (!w || s.pctContinued < w.pctContinued ? s : w), null);

  const mean = (rows, key) => {
    if (!rows.length) return 0;
    return rows.reduce((s, r) => s + (r[key] || 0), 0) / rows.length;
  };
  const last7 = daily.slice(-7);
  const prev7 = daily.slice(-14, -7);
  const dau7 = mean(last7, 'activeUsers');
  const dauPrev7 = mean(prev7, 'activeUsers');
  const jobs7 = last7.reduce((s, d) => s + d.jobs, 0);
  const usd7All = last7.reduce((s, d) => s + d.usd, 0);
  const groceryUsers = users.filter((u) => u.usedGrocery).length;
  const saveUsers = users.filter((u) => u.usedSave).length;
  const swapUsers = users.filter((u) => u.usedSwap).length;
  const menuUsers = users.filter((u) => u.usedMenu).length;
  const barcodeUsers = users.filter((u) => u.usedBarcode).length;
  const ofActivated = (n) => (activatedN ? n / activatedN : 0);

  // ------------------------------------------------------------------
  // Quanto costa un pagante, settimana per settimana di vita
  //
  // La domanda vera è quanto costa tenere una persona per una
  // settimana, per un mese, per un anno. Sommare la spesa di una
  // finestra di calendario non risponde: mescola chi c'è da un giorno
  // con chi c'è da un mese, e alla prima settimana di vita del prodotto
  // i costi a 7, 30 e 365 giorni sono lo stesso numero scritto tre
  // volte.
  //
  // Qui ogni pagante viene allineato al suo primo giorno e si guarda
  // cosa ha speso nella sua settimana 1, nella sua settimana 2, e così
  // via. La media di una finestra usa solo chi l'ha vissuta tutta: chi
  // è dentro la settimana 3 da due giorni non entra nella media della
  // settimana 3, perché la abbasserebbe senza motivo. Chi sta ancora
  // attraversando la finestra viene contato a parte, come parziale,
  // così un numero c'è anche il primo giorno.
  //
  // Il primo giorno di vita è quello della prima attività registrata,
  // non quello dell'acquisto: Firestore non conserva la data di
  // acquisto, e sul paywall duro le due cose distano pochi minuti.
  const spendByOffset = new Map();
  for (const user of paidSubscribers) {
    if (!user.firstDay) continue;
    const byOffset = new Map();
    for (const entry of spendByUid.get(user.uid) || []) {
      const offset = dayDiff(user.firstDay, entry.day);
      if (offset >= 0) byOffset.set(offset, (byOffset.get(offset) || 0) + entry.usd);
    }
    spendByOffset.set(user.uid, byOffset);
  }

  // `from` e `to` sono offset in giorni dal primo giorno, estremi
  // inclusi: la settimana 1 è [0, 6], il mese 1 è [0, 29].
  const window = (from, to) => {
    let done = 0;
    let doneUsd = 0;
    let running = 0;
    let runningUsd = 0;
    let runningDays = 0;
    for (const user of paidSubscribers) {
      if (!user.firstDay || user.ageDays < from) continue;
      let usd = 0;
      const byOffset = spendByOffset.get(user.uid);
      if (byOffset) {
        for (const [offset, value] of byOffset) {
          if (offset >= from && offset <= to) usd += value;
        }
      }
      if (user.ageDays >= to) {
        done += 1;
        doneUsd += usd;
      } else {
        running += 1;
        runningUsd += usd;
        runningDays += user.ageDays - from + 1;
      }
    }
    return {
      from,
      to,
      days: to - from + 1,
      users: done,
      avg: done ? doneUsd / done : null,
      total: doneUsd,
      // Chi la sta ancora vivendo: media di quanto ha speso finora e
      // a che punto è arrivato, per non spacciare un pezzo di finestra
      // per una finestra intera.
      partialUsers: running,
      partialAvg: running ? runningUsd / running : null,
      partialDays: running ? runningDays / running : 0,
    };
  };

  const series = (size, count) => Array.from({ length: count }, (_, k) => ({
    index: k + 1,
    ...window(k * size, (k + 1) * size - 1),
  })).filter((row) => row.users > 0 || row.partialUsers > 0);

  const maxAgeDays = paidSubscribers.reduce((m, u) => Math.max(m, u.firstDay ? u.ageDays : 0), 0);
  const tenure = {
    paidCount,
    maxAgeDays,
    // Quattro settimane, dodici mesi, tre anni: oltre non ci sarà mai
    // niente da mostrare, e le righe vuote vengono scartate.
    weeks: series(7, 4),
    months: series(30, 12),
    years: series(365, 3),
  };

  // ------------------------------------------------------------------
  // Paganti e non paganti, contati separati
  //
  // "Quanti tornano" su tutti non è una metrica. Col paywall duro chi non
  // paga non ha niente da riaprire, quindi quel numero è il tasso di
  // conversione scritto al rovescio, e nel farlo affoga la sola retention
  // che conta: quella di chi ha pagato.
  //
  // Le due popolazioni rispondono a domande diverse. Dei paganti si vuole
  // sapere se restano e per quanto. Dei non paganti quante volte tornano
  // a guardare il prezzo prima di decidere — e di chi ha detto sì, a
  // quale ritorno l'ha detto: se si compra alla terza apertura, un'offerta
  // alla seconda ha senso; se si compra alla prima, non ne ha nessuno.
  //
  // Le aperture si contano da quando l’app manda il ping. Prima nessuno
  // le registrava, per cui `withOpens` e `known` dicono su quante il dato
  // esiste davvero, e le percentuali si fanno su quelle e non su tutti.
  const daysAgo = (n) => dayKey(new Date(Date.now() - n * 86400000));
  const seenSince = (user, day) => {
    const days = daysByUid.get(user.uid);
    if (!days) return false;
    for (const d of days) if (d >= day) return true;
    return false;
  };
  const bucketize = (values, buckets) => buckets.map(({ label, test }) => {
    const n = values.filter(test).length;
    return { label, n, pct: values.length ? n / values.length : 0 };
  });

  const freeUsers = users.filter((u) => !u.hasPaid);

  /// Giorni distinti in cui è tornato dopo aver pagato. Il giorno
  /// dell'acquisto non conta: quello è il giorno in cui è entrato.
  const daysAfterPaid = (user) => {
    if (!user.paidDay) return 0;
    const days = daysByUid.get(user.uid);
    if (!days) return 0;
    let n = 0;
    for (const day of days) if (dayDiff(user.paidDay, day) >= 1) n += 1;
    return n;
  };

  const paidAfter = paidSubscribers.map(daysAfterPaid);
  const paidRetention = {
    count: paidCount,
    // Settimana per settimana dopo l'acquisto: quanti l'hanno già
    // compiuta, e di quelli quanti si sono fatti vedere. Chi la sta
    // ancora attraversando non entra: direbbe "non è tornato" di
    // qualcuno che ha ancora giorni per tornare.
    weeks: Array.from({ length: 8 }, (_, k) => {
      const from = k * 7 + 1;
      const to = (k + 1) * 7;
      let mature = 0;
      let back = 0;
      for (const user of paidSubscribers) {
        if (!user.paidDay || dayDiff(user.paidDay, today) < to) continue;
        mature += 1;
        for (const day of daysByUid.get(user.uid) || []) {
          const offset = dayDiff(user.paidDay, day);
          if (offset >= from && offset <= to) { back += 1; break; }
        }
      }
      return { index: k + 1, mature, back, pct: mature ? back / mature : null };
    }).filter((row) => row.mature > 0),
    days: bucketize(paidAfter, [
      { label: 'mai più', test: (d) => d === 0 },
      { label: '1 giorno', test: (d) => d === 1 },
      { label: '2–3', test: (d) => d >= 2 && d <= 3 },
      { label: '4–7', test: (d) => d >= 4 && d <= 7 },
      { label: '8+', test: (d) => d >= 8 },
    ]),
    avgDays: paidAfter.length ? paidAfter.reduce((s, d) => s + d, 0) / paidAfter.length : 0,
    back7: paidSubscribers.filter((u) => seenSince(u, daysAgo(6))).length,
    back30: paidSubscribers.filter((u) => seenSince(u, daysAgo(29))).length,
    // Ha pagato da più di due settimane e nelle ultime due non si è
    // visto: l'abbonamento corre, il prodotto no. È la lista da cui
    // escono le disdette del mese prossimo.
    silent: paidSubscribers.filter((u) => u.ageDays >= 14 && !seenSince(u, daysAgo(13))).length,
    silentBase: paidSubscribers.filter((u) => u.ageDays >= 14).length,
    usedProduct: paidSubscribers.filter((u) => u.workDays > 0).length,
  };

  const openBuckets = [
    { label: '1', test: (n) => n === 1 },
    { label: '2', test: (n) => n === 2 },
    { label: '3', test: (n) => n === 3 },
    { label: '4', test: (n) => n === 4 },
    { label: '5+', test: (n) => n >= 5 },
  ];
  const freeOpens = freeUsers.map((u) => u.opens).filter((n) => n > 0);
  // `opensAtPaid` a zero vuol dire che il pagamento è arrivato prima che
  // il ping dell'apertura toccasse terra: era la prima volta, e come
  // prima va contata.
  const paidOpensAt = paidSubscribers
    .map((u) => u.opensAtPaid)
    .filter((n) => Number.isFinite(n))
    .map((n) => Math.max(1, n));
  const reopenedFree = freeOpens.filter((n) => n >= 2).length;

  const freeBehaviour = {
    count: freeUsers.length,
    withOpens: freeOpens.length,
    avgOpens: freeOpens.length ? freeOpens.reduce((s, n) => s + n, 0) / freeOpens.length : 0,
    reopened: reopenedFree,
    pctReopened: freeOpens.length ? reopenedFree / freeOpens.length : 0,
    // Ha aperto una volta e non è più tornato: la risposta l'ha data
    // subito, e nessuna offerta la cambierà.
    oneAndDone: freeOpens.filter((n) => n === 1).length,
    opens: bucketize(freeOpens, openBuckets),
  };

  // A quale apertura compra chi compra, e quanti non paganti sono fermi
  // a quel numero adesso. Le due barre affiancate sono la domanda vera:
  // dove si accumula gente che torna e non ha ancora deciso.
  const buyMoment = {
    known: paidOpensAt.length,
    paidCount,
    rows: openBuckets.map(({ label, test }) => ({
      label,
      paid: paidOpensAt.filter(test).length,
      waiting: freeOpens.filter(test).length,
    })),
    pctFirst: paidOpensAt.length
      ? paidOpensAt.filter((n) => n === 1).length / paidOpensAt.length
      : 0,
    median: paidOpensAt.length ? quantile([...paidOpensAt].sort((a, b) => a - b), 0.5) : 0,
  };

  // Cosa chiede di risolvere, e quale di quelle richieste porta soldi.
  //
  // L'array è in ordine di tocco, quindi il primo elemento è il problema
  // che pesa di più per quella persona: raggruppando su quello si vede
  // su quale promessa l'app viene comprata, che è una cosa diversa da
  // quale problema è più diffuso.
  //
  // `pctPaid` resta null sotto le cinque persone: una percentuale su
  // due utenti sembra precisa e non lo è.
  const withBlockers = users.filter((u) => u.blockers.length);
  const blockerMap = new Map();
  const blockerRow = (id) => {
    if (!blockerMap.has(id)) blockerMap.set(id, { id, picked: 0, primary: 0, primaryPaid: 0 });
    return blockerMap.get(id);
  };
  for (const user of withBlockers) {
    for (const id of new Set(user.blockers)) blockerRow(id).picked += 1;
    const first = blockerRow(user.blockers[0]);
    first.primary += 1;
    if (user.hasPaid) first.primaryPaid += 1;
  }
  // Da dove arriva chi paga. Non basta sapere quale canale porta più
  // gente: conta quanta di quella gente compra, perché un canale piccolo
  // che converte vale più di uno grande che riempie e basta.
  const sourceMap = new Map();
  for (const user of users) {
    const id = user.referral || 'non dichiarato';
    const row = sourceMap.get(id) || { id, users: 0, paid: 0 };
    row.users += 1;
    if (user.hasPaid) row.paid += 1;
    sourceMap.set(id, row);
  }
  const sourceConversion = {
    // Sotto questa soglia il tasso non viene mostrato: una fonte con
    // due persone e un pagante direbbe 50% e non significa niente.
    minForRate: PAID_RATE_MIN,
    rows: [...sourceMap.values()]
      .map((r) => ({ ...r, rate: r.users >= PAID_RATE_MIN ? r.paid / r.users : null }))
      .sort((a, b) => (b.rate ?? -1) - (a.rate ?? -1) || b.paid - a.paid || b.users - a.users),
    totalPaid: users.filter((u) => u.hasPaid).length,
  };

  // Il permesso di tracciamento (ATT), chiesto sulla slide delle
  // promesse. Conta solo chi ha visto il prompt: chi è arrivato con una
  // versione che non lo chiedeva non è un "no", non c'è proprio.
  // "system" è chi non ha scelto: interruttore di sistema spento,
  // restrizioni, o iOS che non ha presentato l'alert.
  const asked = users.filter((u) => u.tracking);
  const countTracking = (list, value) => list.filter((u) => u.tracking === value).length;
  const trackingDays = new Map();
  for (const user of asked) {
    const day = (user.trackingAt ? dayKey(new Date(user.trackingAt)) : null) || user.firstDay;
    if (!day) continue;
    const row = trackingDays.get(day) || { day, asked: 0, yes: 0 };
    row.asked += 1;
    if (user.tracking === 'authorized') row.yes += 1;
    trackingDays.set(day, row);
  }
  const paidAsked = asked.filter((u) => u.hasPaid);
  const tracking = {
    asked: asked.length,
    yes: countTracking(asked, 'authorized'),
    no: countTracking(asked, 'denied'),
    system: asked.length - countTracking(asked, 'authorized') - countTracking(asked, 'denied'),
    paidAsked: paidAsked.length,
    paidYes: countTracking(paidAsked, 'authorized'),
    byDay: [...trackingDays.values()].sort((a, b) => a.day.localeCompare(b.day)).slice(-14),
  };

  // Di chi ha pagato, quali problemi aveva dichiarato. Il punteggio
  // pesa la posizione perché su quella slide il primo tocco è la
  // ragione vera e gli altri sono contorno: 3 punti al primo, 2 al
  // secondo, 1 al terzo, il resto non conta.
  const blockerScoreMap = new Map();
  for (const user of withBlockers) {
    if (!user.hasPaid) continue;
    [...new Set(user.blockers)].slice(0, 3).forEach((id, pos) => {
      const row = blockerScoreMap.get(id) || { id, score: 0, first: 0, second: 0, third: 0, people: 0 };
      row.score += 3 - pos;
      row[['first', 'second', 'third'][pos]] += 1;
      row.people += 1;
      blockerScoreMap.set(id, row);
    });
  }
  const scoredBlockers = [...blockerScoreMap.values()].sort((a, b) => b.score - a.score || b.first - a.first);
  const totalBlockerScore = scoredBlockers.reduce((s, r) => s + r.score, 0);

  const blockers = {
    // Chi ha pagato e perché, a punti pesati sulla posizione.
    paidScore: {
      rows: scoredBlockers.map((r) => ({ ...r, pctScore: totalBlockerScore ? r.score / totalBlockerScore : 0 })),
      total: totalBlockerScore,
      voters: withBlockers.filter((u) => u.hasPaid).length,
    },
    answered: withBlockers.length,
    // Chi è arrivato alla slide, in qualunque versione: sotto, la
    // differenza è chi non l'ha ancora vista perché è entrato prima
    // che esistesse.
    asked: Object.values(onboardingVersions).reduce((sum, funnel) => {
      const step = funnel.steps.find((s) => s.id === 'blockers');
      return sum + (step ? step.reached : 0);
    }, 0),
    avgPicked: withBlockers.length
      ? withBlockers.reduce((s, u) => s + new Set(u.blockers).size, 0) / withBlockers.length
      : 0,
    rows: [...blockerMap.values()]
      .map((row) => ({
        ...row,
        pctPicked: withBlockers.length ? row.picked / withBlockers.length : 0,
        pctPaid: row.primary >= PAID_RATE_MIN ? row.primaryPaid / row.primary : null,
      }))
      .sort((a, b) => b.picked - a.picked),
    minForRate: PAID_RATE_MIN,
  };

  const nightsAnswered = users.filter((u) => u.nights != null);
  const quizChoices = {
    minForRate: PAID_RATE_MIN,
    tried: mixClosed(users, (u) => u.tried),
    household: mixClosed(users, (u) => u.cookingFor),
    time: mixClosed(users, (u) => u.dinnerTime),
    apps: mixClosed(users, (u) => u.otherApps),
    audience: mixClosed(users, (u) => u.audiencePick),
    nights: {
      ...mixClosed(users, (u) => (u.nights == null ? null : String(u.nights)), ['1', '2', '3', '4', '5', '6', '7']),
      avg: nightsAnswered.length
        ? nightsAnswered.reduce((s, u) => s + u.nights, 0) / nightsAnswered.length
        : 0,
    },
    why: mixMulti(users, (u) => u.why),
    cuisines: mixMulti(users, (u) => u.cuisines),
    appliances: mixMulti(users, (u) => u.appliances),
  };

  // Chi è entrato con Apple e chi no, incrociato con chi ha pagato.
  //
  // Il confronto che conta è `appleNotPaid`: nel flusso il sign-in arriva
  // subito dopo l'acquisto, quindi ogni Apple dovrebbe avere un pagamento
  // attaccato. Ogni account in quella casella è un abbonamento che
  // esiste su Apple e che noi non stiamo attribuendo.
  const appleUsers = users.filter((u) => u.authKind === 'apple');
  const accounts = providers
    ? {
      available: true,
      authUsers: providers.size,
      apple: appleUsers.length,
      anonymous: users.filter((u) => u.authKind === 'anon').length,
      // Documento su Firestore senza utente Auth: resta dopo una
      // cancellazione account.
      orphanDocs: users.filter((u) => u.authKind === 'missing').length,
      // Utente Auth senza documento: sessione anonima aperta e chiusa
      // prima che l'app scrivesse qualsiasi cosa.
      authWithoutDoc: Math.max(0, providers.size - users.filter((u) => u.authKind !== 'missing').length),
      appleAndPaid: appleUsers.filter((u) => u.hasPaid).length,
      appleNotPaid: appleUsers.filter((u) => !u.hasPaid).length,
      paidNotApple: users.filter((u) => u.hasPaid && u.authKind === 'anon').length,
      paidWithoutAuth: users.filter((u) => u.hasPaid && u.authKind === 'missing').length,
    }
    : { available: false, error: providersError };

  const insights = {
    funnel: {
      accounts: users.length,
      started: funnelStart,
      completed: onboardingCompletedAll,
      onboarded: onboardedN,
      activated: activatedN,
      paid: paidCount,
      ghosts: users.length - activatedN,
      activationRate: users.length ? activatedN / users.length : 0,
      onboardRate: funnelStart ? onboardingCompletedAll / funnelStart : 0,
      payOfOnboarded: onboardedN ? paidCount / onboardedN : 0,
      payOfActivated: activatedN ? paidCount / activatedN : 0,
    },
    stickiness: {
      dau,
      dau7,
      dauPrev7,
      wow: dauPrev7 ? (dau7 - dauPrev7) / dauPrev7 : 0,
      wau: active7,
      mau: active30,
      dauMau: active30 ? dau / active30 : 0,
    },
    product: {
      keepRate: swipes ? keeps / swipes : 0,
      keeps,
      passes,
      swipes,
      lists,
      inbox: engagement['inbox.open'] || 0,
      groceryUsers,
      saveUsers,
      swapUsers,
      menuUsers,
      barcodeUsers,
      ofActivated: {
        grocery: ofActivated(groceryUsers),
        save: ofActivated(saveUsers),
        swap: ofActivated(swapUsers),
        menu: ofActivated(menuUsers),
        barcode: ofActivated(barcodeUsers),
      },
    },
    cost: {
      total: totalUsd,
      usd7: usd7All,
      usd30,
      paidUsd: totalUsdPaid,
      freeUsd: totalUsd - totalUsdPaid,
      paidShare: totalUsd ? totalUsdPaid / totalUsd : 0,
      perAccount: users.length ? totalUsd / users.length : 0,
      perActive30: active30 ? usd30 / active30 : 0,
      perActivated: activatedN ? totalUsd / activatedN : 0,
      perJob: jobsAll ? totalUsd / jobsAll : 0,
      perKeep: keeps ? totalUsd / keeps : 0,
      perList: lists ? totalUsd / lists : 0,
      jobs: jobsAll,
      jobsFailed: jobsFailedAll,
      jobs7,
      errorRate: jobsAll ? jobsFailedAll / jobsAll : 0,
      gemini: geminiUsd,
      fal: falUsd,
      rapid: rapidUsd,
    },
    power: {
      p90Jobs,
      heavy: p90Jobs > 0 ? users.filter((u) => u.jobs >= p90Jobs).length : 0,
      top10CostShare: totalUsd ? top10usd / totalUsd : 0,
    },
    retention: {
      cohorts,
      returnedRate: users.filter((u) => u.firstDay).length
        ? users.filter((u) => u.returned).length / users.filter((u) => u.firstDay).length
        : 0,
      avgActiveDays: users.filter((u) => u.activeDays > 0).length
        ? users.reduce((s, u) => s + u.activeDays, 0) / users.filter((u) => u.activeDays > 0).length
        : 0,
      churnBase,
      churned,
      churnRate: churnBase ? churned / churnBase : 0,
    },
    // Quale piano comprano. Gli identificativi arrivano da App Store
    // via Superwall e non sono scritti da nessuna parte nel codice, per
    // cui si classificano leggendo la stringa; quelli non riconosciuti
    // restano visibili come "sconosciuto" invece di sparire in un
    // secchio generico.
    paidPlans: (() => {
      const kindOf = (id) => {
        const s = String(id || '').toLowerCase();
        if (/year|annual|yr|12m/.test(s)) return 'yearly';
        if (/week|wk|7d/.test(s)) return 'weekly';
        if (/month|monthly|1m|30d/.test(s)) return 'monthly';
        return 'unknown';
      };
      const counts = { weekly: 0, yearly: 0, monthly: 0, unknown: 0 };
      const rawIds = new Map();
      for (const u of paidSubscribers) {
        counts[kindOf(u.productId)] += 1;
        const key = u.productId || 'nessun productId';
        rawIds.set(key, (rawIds.get(key) || 0) + 1);
      }
      const total = paidSubscribers.length;
      return {
        total,
        counts,
        share: Object.fromEntries(Object.entries(counts).map(([k, v]) => [k, total ? v / total : 0])),
        rawIds: [...rawIds.entries()].map(([id, n]) => ({ id, n })).sort((a, b) => b.n - a.n),
      };
    })(),
    paidMix: paidSubscribers.reduce((acc, u) => {
      const key = u.productId || 'sconosciuto';
      acc[key] = (acc[key] || 0) + 1;
      return acc;
    }, {}),
    worstOnboarding: worstOnboarding
      ? { label: worstOnboarding.label, pctContinued: worstOnboarding.pctContinued, dropped: worstOnboarding.dropped, reached: worstOnboarding.reached }
      : null,
  };

  const rates = geminiRates();

  return {
    generatedAt: new Date().toISOString(),
    window: {
      since,
      allUsers,
      users: users.length,
      excluded: allUsers - users.length,
    },
    blockers,
    quizChoices,
    sourceConversion,
    tracking,
    paidRetention,
    freeBehaviour,
    buyMoment,
    pricing: {
      geminiInputPerMillion: rates.input,
      geminiOutputPerMillion: rates.output,
      falPerImage: falUsdPerImage(),
      rapidPerCall: rapidUsdPerCall(),
      geminiModel: keys.gemini.model,
    },
    limits: {
      dailyJobs: keys.server.dailyJobLimit,
      dailyImages: keys.server.dailyImageLimit,
    },
    totals: totalsSnap.exists ? { ...totalsSnap.data(), lastAt: iso(totalsSnap.get('lastAt')) } : null,
    audience: {
      users: users.length,
      paidSubscribers: paidCount,
      trialOnly,
      nonSubscribers: users.length - paidCount - trialOnly,
      withUsage,
      active7,
      active30,
      byReferral,
      byDiet,
      byLanguage,
    },
    accounts,
    economics: {
      since7,
      since30,
      since365,
      usd30,
      totalUsd,
      tenure,
      paidSubscribers: {
        count: paidCount,
        active: paidSubscribers.filter((u) => u.subscription === 'active').length,
        lapsed: paidSubscribers.filter((u) => u.subscription === 'inactive').length,
        trialOnly,
        totalUsd: totalUsdPaid,
        usd7: usd7Paid,
        usd30: usd30Paid,
        usd365: usd365Paid,
        avgPerWeek: paidCount ? usd7Paid / paidCount : 0,
        avgPerMonth: paidCount ? usd30Paid / paidCount : 0,
        avgPerYear: paidCount ? usd365Paid / paidCount : 0,
        avgLifetime: paidCount ? totalUsdPaid / paidCount : 0,
      },
      avgPerUser: paidCount ? totalUsdPaid / paidCount : 0,
      avgPerActiveUser: withUsage ? totalUsd / withUsage : 0,
      avgUsd30PerUser: users.length ? usd30 / users.length : 0,
      avgUsd30PerActive: active30 ? usd30 / active30 : 0,
      avgPerSubscriber: subscribers.length ? subscribers.reduce((s, u) => s + u.usd, 0) / subscribers.length : 0,
      avgUsd30PerSubscriber: subscribers.length ? subscribers.reduce((s, u) => s + u.usd30, 0) / subscribers.length : 0,
      medianPerSpender: quantile(spend, 0.5),
      p90PerSpender: quantile(spend, 0.9),
      p95PerSpender: quantile(subscriberSpend, 0.95),
      p5PerSpender: quantile(subscriberSpend, 0.05),
      top5Pct: top5,
      bottom5Pct: bottom5,
      maxPerUser: spend.length ? spend[spend.length - 1] : 0,
      spenders: spend.length,
    },
    insights,
    subscriptions,
    engagement,
    onboarding,
    social,
    spaces: {
      ...spaceCounters,
      liveSpaces: spacesSnap.size,
      usersWithSpace: withSharedSpace,
      pctWithSpace: users.length ? withSharedSpace / users.length : 0,
    },
    mainFeatures,
    featureMix: buildFeatureMix(users),
    features: [...features.values()].sort((a, b) => b.usd - a.usd || b.calls - a.calls),
    daily,
    users: users.sort((a, b) => b.usd - a.usd),
  };
}

module.exports = { build };
