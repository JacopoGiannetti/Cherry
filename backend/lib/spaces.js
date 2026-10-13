// Spazi condivisi: due persone, una sola lista della spesa.
//
// Il resto dell'app vive sotto users/{uid}. Uno spazio è un secondo
// albero, spaces/{spaceId}, con la stessa forma per la parte "liste":
// così ogni rotta deve solo sapere QUALE radice usare, non riscrivere
// la propria logica. Tutto ciò che è personale (profilo gusti, ricette
// salvate, quote, abbonamento) resta sotto users/{uid} in ogni caso.
const crypto = require('crypto');
const { db, FieldValue } = require('./firebase');
const { JobError } = require('./jobs');
const { recordEvent, snapshotSpaces } = require('./usage');

const MAX_MEMBERS = 2;
// Niente 0/O/1/I: il codice si detta al telefono.
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 6;

function spaceRef(spaceId) {
  return db().doc(`spaces/${spaceId}`);
}

function codeRef(code) {
  return db().doc(`inviteCodes/${code}`);
}

function generateCode() {
  const bytes = crypto.randomBytes(CODE_LENGTH);
  let code = '';
  for (let i = 0; i < CODE_LENGTH; i += 1) {
    code += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
  }
  return code;
}

/** Un codice libero, riprovando in caso di collisione. */
async function reserveCode(spaceId) {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const code = generateCode();
    const ref = codeRef(code);
    const created = await db().runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (snap.exists) return false;
      tx.set(ref, { spaceId, createdAt: FieldValue.serverTimestamp() });
      return true;
    });
    if (created) return code;
  }
  throw new JobError('code_unavailable', 'Could not create an invite code. Try again.');
}

async function releaseCode(code) {
  if (!code) return;
  await codeRef(code).delete().catch(() => {});
}

/**
 * La radice dei dati per questa richiesta. Senza spaceId è l'albero
 * personale; con spaceId si verifica SEMPRE l'appartenenza, perché il
 * client potrebbe chiedere uno spazio che non è suo.
 */
async function resolveRoot(uid, spaceId) {
  if (!spaceId) return `users/${uid}`;
  const snap = await spaceRef(spaceId).get();
  if (!snap.exists) throw new JobError('space_not_found', 'That shared space no longer exists.');
  const memberUids = snap.data().memberUids || [];
  if (!memberUids.includes(uid)) {
    throw new JobError('not_a_member', "You're not part of that space.");
  }
  return `spaces/${spaceId}`;
}

/** Come resolveRoot, ma restituisce anche i dati dello spazio. */
async function requireMembership(uid, spaceId) {
  const snap = await spaceRef(spaceId).get();
  if (!snap.exists) throw new JobError('space_not_found', 'That shared space no longer exists.');
  const space = snap.data();
  if (!(space.memberUids || []).includes(uid)) {
    throw new JobError('not_a_member', "You're not part of that space.");
  }
  return { ref: snap.ref, space };
}

function cleanName(value, fallback) {
  const name = String(value || '').trim().slice(0, 40);
  return name || fallback;
}

async function createSpace(uid, { name, displayName }) {
  const spaceId = crypto.randomUUID();
  const code = await reserveCode(spaceId);
  const member = { uid, name: cleanName(displayName, 'Me') };

  await spaceRef(spaceId).set({
    name: cleanName(name, 'Our kitchen'),
    memberUids: [uid],
    members: [member],
    inviteCode: code,
    createdBy: uid,
    createdAt: FieldValue.serverTimestamp(),
  });

  recordEvent(uid, 'space.create', { spaces: { created: 1 } });
  snapshotSpaces(uid);

  return { spaceId, inviteCode: code };
}

/**
 * Ingresso con codice. In transazione: il codice vale per una persona
 * sola, quindi due tentativi simultanei non possono riempire lo spazio
 * oltre il limite.
 */
async function joinSpace(uid, { code, displayName }) {
  const normalized = String(code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (normalized.length !== CODE_LENGTH) {
    throw new JobError('bad_code', 'That code doesn\'t look right.');
  }

  const invite = codeRef(normalized);
  const result = await db().runTransaction(async (tx) => {
    const inviteSnap = await tx.get(invite);
    if (!inviteSnap.exists) throw new JobError('code_not_found', 'That code is not valid anymore.');

    const id = inviteSnap.data().spaceId;
    const ref = spaceRef(id);
    const snap = await tx.get(ref);
    if (!snap.exists) throw new JobError('space_not_found', 'That shared space no longer exists.');

    const space = snap.data();
    const memberUids = space.memberUids || [];
    if (memberUids.includes(uid)) return { spaceId: id, joined: false };
    if (memberUids.length >= MAX_MEMBERS) {
      throw new JobError('space_full', 'That space already has two people in it.');
    }

    tx.set(
      ref,
      {
        memberUids: [...memberUids, uid],
        members: [...(space.members || []), { uid, name: cleanName(displayName, 'Partner') }],
        inviteCode: FieldValue.delete(),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
    tx.delete(invite);
    return { spaceId: id, joined: true };
  });

  if (result.joined) {
    recordEvent(uid, 'space.join', { spaces: { joined: 1 } });
    snapshotSpaces(uid);
  }

  return { spaceId: result.spaceId };
}

/**
 * Uscita. Se resta una persona sola lo spazio sopravvive con un codice
 * nuovo (può invitare qualcun altro); se non resta nessuno, sparisce
 * con tutte le sue liste.
 */
async function leaveSpace(uid, spaceId) {
  const { ref, space } = await requireMembership(uid, spaceId);
  const remaining = (space.memberUids || []).filter((id) => id !== uid);

  if (!remaining.length) {
    await releaseCode(space.inviteCode);
    await db().recursiveDelete(ref);
    recordEvent(uid, 'space.leave', { spaces: { left: 1 } });
    snapshotSpaces(uid);
    return { deleted: true };
  }

  await releaseCode(space.inviteCode);
  const code = await reserveCode(spaceId);
  await ref.set(
    {
      memberUids: remaining,
      members: (space.members || []).filter((m) => m.uid !== uid),
      inviteCode: code,
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true }
  );
  recordEvent(uid, 'space.leave', { spaces: { left: 1 } });
  snapshotSpaces(uid);
  return { deleted: false };
}

/**
 * Toglie l'utente da OGNI spazio, in vista della cancellazione
 * dell'account. Stessa logica di leaveSpace, ma senza analytics: quelle
 * scrivono su users/{uid}, che sta per sparire, e lo farebbero rinascere.
 */
async function purgeMembership(uid) {
  const snap = await db().collection('spaces').where('memberUids', 'array-contains', uid).get();

  for (const doc of snap.docs) {
    const space = doc.data();
    const remaining = (space.memberUids || []).filter((id) => id !== uid);
    await releaseCode(space.inviteCode);

    if (!remaining.length) {
      await db().recursiveDelete(doc.ref);
      continue;
    }

    // Resta l'altra persona: lo spazio e le sue liste sopravvivono, con
    // un codice nuovo per poter invitare qualcun altro.
    const code = await reserveCode(doc.id);
    await doc.ref.set(
      {
        memberUids: remaining,
        members: (space.members || []).filter((m) => m.uid !== uid),
        inviteCode: code,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
  }

  return snap.size;
}

async function renameSpace(uid, spaceId, name) {
  const { ref } = await requireMembership(uid, spaceId);
  await ref.set(
    { name: cleanName(name, 'Our kitchen'), updatedAt: FieldValue.serverTimestamp() },
    { merge: true }
  );
}

module.exports = {
  MAX_MEMBERS,
  resolveRoot,
  requireMembership,
  createSpace,
  joinSpace,
  leaveSpace,
  purgeMembership,
  renameSpace,
};
