// Pattern fire-and-forget: ogni endpoint crea un job, risponde subito
// 202 { jobId } e lavora in background. Lo stato del job e i risultati
// vengono scritti su Firestore; l'app li osserva con listener realtime.
const crypto = require('crypto');
const { db, FieldValue } = require('./firebase');
const { runWith, recordJob, recordJobError } = require('./usage');

function jobRef(uid, jobId) {
  return db().doc(`users/${uid}/jobs/${jobId}`);
}

/**
 * Crea il job, risponde 202 e lancia `work(job)` in background.
 * `work` riceve { uid, jobId, update } e deve lanciare in caso di errore.
 *
 * type: etichetta leggibile ('run.generate', 'scan.menu', ...)
 * payload: campi extra scritti sul documento job (es. runId, scanId)
 */
function startJob(req, res, { type, payload = {}, work }) {
  const uid = req.uid;
  const jobId = crypto.randomUUID();

  jobRef(uid, jobId)
    .set({
      type,
      status: 'running',
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
      ...payload,
    })
    .then(() => {
      res.status(202).json({ jobId, ...payload });

      const update = (fields) =>
        jobRef(uid, jobId).set(
          { ...fields, updatedAt: FieldValue.serverTimestamp() },
          { merge: true }
        );

      Promise.resolve()
        .then(async () => {
          recordJob(uid, type);
          return runWith(uid, type, () => work({ uid, jobId, update }));
        })
        .then(() => update({ status: 'done' }))
        .catch((e) => {
          console.error(`[job ${type}] fallito:`, e);
          recordJobError(uid, type);
          return update({
            status: 'error',
            errorCode: e.code || 'internal',
            errorMessage: e.userMessage || e.message || 'Something went wrong',
          });
        });
    })
    .catch((e) => {
      console.error('[jobs] creazione job fallita:', e.message);
      res.status(500).json({ error: 'job_create_failed', details: e.message });
    });
}

/** Errore con codice + messaggio destinato all'utente. */
class JobError extends Error {
  constructor(code, userMessage) {
    super(userMessage);
    this.code = code;
    this.userMessage = userMessage;
  }
}

module.exports = { startJob, JobError };
