const admin = require('firebase-admin');
const sa = require('./kivo7.json');
admin.initializeApp({ credential: admin.credential.cert(sa), projectId: 'kivo7-app' });
const db = admin.firestore();
const ORG = 'caluco-express';
(async () => {
  const cols = await db.collection('organizations').doc(ORG).collection('_collections').get();
  for (const c of cols.docs) {
    const x = c.data();
    console.log('COLLECTION', c.id, JSON.stringify({ name: x.name, slug: x.slug, flowId: x.flowId, fields: (x.fields || []).map(f => f.key) }));
  }
  // últimos pedidos de cada colección
  for (const c of cols.docs) {
    const slug = c.data().slug || c.id;
    const snap = await db.collection('organizations').doc(ORG).collection(slug).orderBy('createdAt', 'desc').limit(2).get().catch(() => null);
    if (!snap) continue;
    snap.docs.forEach(d => console.log('DOC en', slug, '→', JSON.stringify(d.data(), null, 1).slice(0, 2500)));
  }
  process.exit(0);
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
