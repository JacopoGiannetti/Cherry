// Da dove il ricettario prende Firestore e Storage. Il backend usa il
// service account di lib/firebase; la dashboard su Cloud Run non ce l'ha
// e passa i suoi client (identità del servizio) con `configure`.
let provided = null;

function configure({ db, bucket }) {
  provided = { db, bucket };
}

function db() {
  return provided ? provided.db() : require('../firebase').db();
}

function bucket() {
  return provided ? provided.bucket() : require('../firebase').storage().bucket();
}

const COLLECTIONS = {
  catalog: 'catalog',
  exposures: 'catalogExposures',
  users: 'catalogUsers',
  config: 'catalogConfig',
  terms: 'catalogTerms',
};

module.exports = { configure, db, bucket, COLLECTIONS };
