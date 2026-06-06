// Descarga imágenes de producto verificadas y las sube a Firebase Storage,
// luego setea `imagen` en webdelivery de caluco-express.
const admin = require('firebase-admin');
const axios = require('axios');
const crypto = require('crypto');
const sa = require('./kivo7.json');
admin.initializeApp({ credential: admin.credential.cert(sa), projectId: 'kivo7-app', storageBucket: 'kivo7-app.firebasestorage.app' });
const db = admin.firestore();
const bucket = admin.storage().bucket();

const ORG = 'caluco-express';
const IMAGES = {
  '1XStouzfQI9r11iMM1Hq': 'https://images.openfoodfacts.org/images/products/770/209/004/1842/front_es.3.full.jpg',
  'Lxo093GQ8hJ9KshcY2SE': 'https://images.openfoodfacts.org/images/products/770/209/004/1859/front_es.4.full.jpg',
  'nr1RviA58Iy0cVfWzuzu': 'https://walmartsv.vtexassets.com/arquivos/ids/435729-800-600?v=638479070525170000&width=800&height=600&aspect=true',
  'H5GOBfTBBrVslAGiJ0BO': 'https://images.openfoodfacts.org/images/products/742/211/010/6749/front_en.3.full.jpg',
  'TnFKqOGRthPYKmLTkvfE': 'https://images.openfoodfacts.org/images/products/777/160/900/0960/front_es.43.400.jpg',
  'V3zS4WfBvswfk3c3Bdp6': 'https://images.openfoodfacts.org/images/products/544/900/002/8921/front_en.100.full.jpg',
  'ZEk3cZuam6X9DFa9RPiL': 'https://images.openfoodfacts.org/images/products/000/009/355/6095/front_en.38.full.jpg',
  'VvW21elvhxaV9OZc6nM0': 'https://walmartsv.vtexassets.com/arquivos/ids/384372/Gaseosa-Salva-Cola-Lata-355Ml-1-2854.jpg?v=638416543322300000',
  'lfeceW8yBtX7uopKkq2x': 'https://www.salvacola.com.sv/es/galeria/fotos-cascada/SC%20-%206_5onz.png',
  'yagnT1GqE82RBZSZ4aFL': 'https://images.openfoodfacts.org/images/products/005/557/742/0515/front_en.13.full.jpg',
  'B82Pz56v3uTo5n0fQy5o': 'https://img.superselectos.com/b453d4c4a119e552ea02859b2767a4cdc77b8800_Smallbw.jpg',
  'PKY1feoXiawQmCafJ7UZ': 'https://images.openfoodfacts.org/images/products/750/106/419/1527/front_en.3.400.jpg',
  'SawiDgVDIddWRKhgnVfR': 'https://facil.tienda/wp-content/uploads/2024/01/PILSENER-CERVEZA-1LITRO-RETORNABLE.png',
  'cgMkseKMfY4UXE3CLUR4': 'https://img.superselectos.com/6f9f02046954a2906470346e2b64d7492da81be2_Smallbw.jpg',
  'iET3lPITEfco4Lj3LEZU': 'https://firebasestorage.googleapis.com/v0/b/sumer-app-90b8f.appspot.com/o/product_photos%2F0ffd461ccc222a4f764d1895bfb79616%2F34f244b0-56b3-11ec-b8d2-c5b35c6f71dd?alt=media&token=63978e37-82ab-4983-8e83-702784ed22d4',
  'RajEnUeoasPYzZKT5Cmq': 'https://bitworks-multimedia.superselectos.com/api/selectos/multimedia/3ed152ed-f464-420a-9745-a7753a0f88a2/content',
  'cWbosMJTEn3c48ZRRPPw': 'https://bitworks-multimedia.superselectos.com/api/selectos/multimedia/3ed152ed-f464-420a-9745-a7753a0f88a2/content',
  'hwvE9BjJ7ROb2wSUOOvK': 'https://images.openfoodfacts.org/images/products/741/180/041/6961/front_it.5.400.jpg',
  'us1YLtggEnO0HPNZyDwz': 'https://bitworks-multimedia.superselectos.com/api/selectos/multimedia/c47a67b8-7c34-4a9d-aaa7-9e0bdb0f5b22/content',
  '655geOSMFO2vmdGCsMN5': 'https://images.openfoodfacts.org/images/products/750/222/377/0959/front_es.13.400.jpg',
  'GA1QkPaI1CcVAUsOOQFt': 'https://images.openfoodfacts.org/images/products/750/222/377/0959/front_es.13.400.jpg',
  'jihgG8sdCU33xN5wHcwa': 'https://images.openfoodfacts.org/images/products/758/891/023/5772/front_es.3.400.jpg',
  'ryZ6WmtbDEjL2z8U7022': 'https://images.openfoodfacts.org/images/products/758/891/023/5772/front_es.3.400.jpg',
  'PhnNDPF1U0wvUvMfaiw5': 'https://images.openfoodfacts.org/images/products/780/295/000/6612/front_es.59.400.jpg',
  'w1R9qhGiZQaYZ6qHlrP4': 'https://images.openfoodfacts.org/images/products/761/303/525/8235/front_fr.3.full.jpg',
  'bm4XbwY8HtM53VvitKrj': 'https://upload.wikimedia.org/wikipedia/commons/8/87/Baygon_Products_on_Philippine_Shelves.jpg',
  'CdNxDhsNYMCqbscZaC1F': 'https://upload.wikimedia.org/wikipedia/commons/7/7d/Al_Foil.JPG',
  'zhsQyYxVjl54wpXzoYoZ': 'https://upload.wikimedia.org/wikipedia/commons/7/7d/Al_Foil.JPG',
  'AANZX72nEh1f5v0JFuRv': 'https://upload.wikimedia.org/wikipedia/commons/9/9b/Eierkarton_32_%28fcm%29.jpg',
};

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const cache = {}; // url -> uploaded download URL (reutilizar imágenes repetidas)

(async () => {
  const col = db.collection('organizations').doc(ORG).collection('webdelivery');
  let ok = 0, fail = 0;
  for (const [docId, url] of Object.entries(IMAGES)) {
    try {
      let downloadUrl = cache[url];
      if (!downloadUrl) {
        const res = await axios.get(url, { responseType: 'arraybuffer', timeout: 30000, headers: { 'User-Agent': UA }, maxContentLength: 10 * 1024 * 1024 });
        const ct = (res.headers['content-type'] || '').toLowerCase();
        if (!ct.startsWith('image/')) throw new Error(`No es imagen: ${ct}`);
        const ext = ct.includes('png') ? 'png' : 'jpg';
        const path = `organizations/${ORG}/webdelivery/auto-${docId}.${ext}`;
        const token = crypto.randomUUID();
        await bucket.file(path).save(Buffer.from(res.data), {
          contentType: ct,
          metadata: { metadata: { firebaseStorageDownloadTokens: token } }
        });
        downloadUrl = `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodeURIComponent(path)}?alt=media&token=${token}`;
        cache[url] = downloadUrl;
      }
      await col.doc(docId).update({ imagen: downloadUrl, updatedAt: admin.firestore.FieldValue.serverTimestamp() });
      ok++;
      console.log('OK', docId);
    } catch (e) {
      fail++;
      console.log('FAIL', docId, e.message);
    }
  }
  console.log(`Listo: ${ok} con imagen, ${fail} fallidos`);
  process.exit(0);
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
