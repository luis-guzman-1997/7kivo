// Temporal: intenta descubrir el WABA ID correcto accesible por el token.
const axios = require('axios');
const { db } = require('./src/config/firebase');
const ORG_ID = process.argv[2] || 'instituto-canzion-sonsonate';

const g = async (label, url, token, params) => {
  try {
    const res = await axios.get(url, { params, headers: { Authorization: `Bearer ${token}` } });
    console.log(`\n✅ ${label}`);
    console.log(JSON.stringify(res.data, null, 2).slice(0, 1500));
    return res.data;
  } catch (err) {
    console.log(`\n❌ ${label}: ${err?.response?.status} ${JSON.stringify(err?.response?.data?.error?.message || '')}`);
    return null;
  }
};

(async () => {
  const snap = await db.collection('organizations').doc(ORG_ID).collection('config').doc('whatsapp').get();
  const cfg = snap.exists ? snap.data() : {};
  const v = cfg.version || 'v21.0';
  const token = cfg.token;
  const B = 'https://graph.facebook.com/' + v;
  console.log('phoneNumberId:', cfg.phoneNumberId, '| wabaId guardado:', cfg.wabaId);

  const me = await g('/me', `${B}/me`, token, { fields: 'id,name' });
  const meId = me?.id;

  if (meId) {
    await g('system user → assigned_whatsapp_business_accounts',
      `${B}/${meId}/assigned_whatsapp_business_accounts`, token, { fields: 'id,name' });
    await g('system user → owned_whatsapp_business_accounts',
      `${B}/${meId}/owned_whatsapp_business_accounts`, token, { fields: 'id,name' });
    await g('businesses', `${B}/${meId}/businesses`, token,
      { fields: 'id,name,owned_whatsapp_business_accounts{id,name},client_whatsapp_business_accounts{id,name}' });
  }
  // El número trae su WABA en el campo whatsapp_business_account?
  await g('phone number → whatsapp_business_account',
    `${B}/${cfg.phoneNumberId}`, token, { fields: 'id,display_phone_number,verified_name,whatsapp_business_account{id,name}' });

  process.exit(0);
})();
