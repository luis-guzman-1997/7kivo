// Endpoints HTTP para vincular/gestionar la sesión conector de una org desde el
// panel superadmin: iniciar (devuelve QR), consultar estado, desvincular.
// Además: generar un enlace público (token) y servir una página con el QR en vivo
// para que el cliente escanee desde otra localidad, sin acceso al panel.

const {
  startSession,
  getStatus,
  logoutSession,
} = require("../connector/sessionManager");
const { invalidate } = require("../connector/connectionType");
const { createLinkToken, checkLinkToken } = require("../connector/linkToken");

// POST /api/:orgId/connector/start  → inicia la sesión y empieza a generar QR
const startConnector = async (req, res) => {
  try {
    const orgId = req.params.orgId;
    if (!orgId) return res.status(400).json({ ok: false, error: "orgId requerido" });
    // Si la petición viene del enlace público (trae ?t=), exige token válido.
    if (req.query?.t && !(await checkLinkToken(orgId, req.query.t))) {
      return res.status(403).json({ ok: false, error: "Enlace inválido o expirado" });
    }
    invalidate(orgId); // por si recién se cambió a modo conector
    const status = await startSession(orgId, { force: !!req.body?.force });
    return res.json({ ok: true, ...status });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
};

// GET /api/:orgId/connector/status  → { status, qr } para que el panel haga polling
const connectorStatus = async (req, res) => {
  try {
    const orgId = req.params.orgId;
    if (!orgId) return res.status(400).json({ ok: false, error: "orgId requerido" });
    if (req.query?.t && !(await checkLinkToken(orgId, req.query.t))) {
      return res.status(403).json({ ok: false, error: "Enlace inválido o expirado" });
    }
    return res.json({ ok: true, ...getStatus(orgId) });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
};

// POST /api/:orgId/connector/logout  → cierra sesión y borra credenciales
const logoutConnector = async (req, res) => {
  try {
    const orgId = req.params.orgId;
    if (!orgId) return res.status(400).json({ ok: false, error: "orgId requerido" });
    const r = await logoutSession(orgId);
    invalidate(orgId);
    return res.json({ ok: true, ...r });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
};

// POST /api/:orgId/connector/link  → genera un token y devuelve el enlace público
const createConnectorLink = async (req, res) => {
  try {
    const orgId = req.params.orgId;
    if (!orgId) return res.status(400).json({ ok: false, error: "orgId requerido" });
    const { token, expiresAt } = await createLinkToken(orgId);
    return res.json({ ok: true, token, expiresAt });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
};

// GET /link/:orgId?t=TOKEN  → página pública con el QR en vivo (para el cliente)
const connectorLinkPage = async (req, res) => {
  const orgId = req.params.orgId;
  const token = req.query?.t || "";
  const ok = orgId && (await checkLinkToken(orgId, token));
  res.set("Content-Type", "text/html; charset=utf-8");
  if (!ok) {
    return res.status(403).send(errorPage());
  }
  return res.send(qrPage(orgId, token));
};

module.exports = {
  startConnector,
  connectorStatus,
  logoutConnector,
  createConnectorLink,
  connectorLinkPage,
};

// ── Páginas HTML (autocontenidas) ──────────────────────────────────────────

function errorPage() {
  return `<!doctype html><html lang="es"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Enlace no válido</title>${baseStyle()}</head>
<body><div class="card">
<div class="logo">7kivo</div>
<h1>Enlace no válido o vencido</h1>
<p class="muted">Pídele a tu proveedor un enlace nuevo para vincular tu WhatsApp.</p>
</div></body></html>`;
}

function qrPage(orgId, token) {
  const oid = JSON.stringify(orgId);
  const tok = JSON.stringify(token);
  return `<!doctype html><html lang="es"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Vincular WhatsApp</title>${baseStyle()}</head>
<body><div class="card">
<div class="logo">7kivo</div>
<h1>Vincular WhatsApp</h1>
<ol class="steps">
<li>Abre <b>WhatsApp</b> en tu teléfono.</li>
<li>Toca <b>Dispositivos vinculados</b>.</li>
<li>Toca <b>Vincular un dispositivo</b>.</li>
<li>Escanea el código de abajo.</li>
</ol>
<div id="stage" class="stage">
  <div id="spinner" class="spinner"></div>
  <img id="qr" class="qr" alt="Código QR" style="display:none">
  <div id="done" class="done" style="display:none">
    <div class="check">✓</div>
    <p><b>¡WhatsApp vinculado!</b></p>
    <p class="muted" id="doneId"></p>
  </div>
</div>
<p id="status" class="status">Generando código…</p>
<button id="regen" class="btn" style="display:none">Regenerar código</button>
</div>
<script>
(function(){
  var ORG=${oid}, T=${tok};
  var qs="?t="+encodeURIComponent(T);
  var qr=document.getElementById('qr'), sp=document.getElementById('spinner'),
      st=document.getElementById('status'), done=document.getElementById('done'),
      doneId=document.getElementById('doneId'), regen=document.getElementById('regen');
  var timer=null, finished=false;
  var LABEL={connected:'Conectado',qr:'Escanea el código con tu WhatsApp',connecting:'Conectando…',logged_out:'Desvinculado',disconnected:'Desconectado'};
  function show(el){ [qr,sp,done].forEach(function(e){e.style.display='none';}); if(el) el.style.display=(el===qr?'block':(el===sp?'block':'block')); }
  function render(d){
    var s=d.status||'disconnected';
    st.textContent=LABEL[s]||s;
    if(s==='connected'){
      finished=true; if(timer) clearInterval(timer);
      show(done); doneId.textContent=(d.me&&d.me.id)?d.me.id.split(':')[0].replace('@s.whatsapp.net',''):'';
      regen.style.display='none';
    } else if(s==='qr'&&d.qr){
      qr.src=d.qr; show(qr); regen.style.display='inline-block';
    } else {
      show(sp); regen.style.display='none';
    }
  }
  function poll(){
    fetch('/api/'+ORG+'/connector/status'+qs).then(function(r){return r.json();})
      .then(function(d){ if(!finished) render(d); }).catch(function(){ st.textContent='Sin conexión con el servidor…'; });
  }
  function start(force){
    show(sp); st.textContent='Generando código…';
    fetch('/api/'+ORG+'/connector/start'+qs,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({force:!!force})})
      .then(function(r){return r.json();}).then(function(d){ if(d&&d.ok===false){ st.textContent=d.error||'No se pudo iniciar'; return; } render(d); })
      .catch(function(){ st.textContent='No se pudo iniciar la vinculación'; });
  }
  regen.addEventListener('click',function(){ start(true); });
  start(false);
  timer=setInterval(poll,2500);
})();
</script>
</body></html>`;
}

function baseStyle() {
  return `<style>
*{box-sizing:border-box}body{margin:0;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;
background:#0b141a;color:#e9edef;display:flex;min-height:100vh;align-items:center;justify-content:center;padding:20px}
.card{background:#111b21;border:1px solid #243138;border-radius:16px;max-width:420px;width:100%;padding:28px 24px;text-align:center;box-shadow:0 10px 40px rgba(0,0,0,.4)}
.logo{font-weight:800;letter-spacing:.5px;color:#00a884;margin-bottom:14px}
h1{font-size:20px;margin:0 0 16px}
.steps{text-align:left;color:#aebac1;font-size:14px;line-height:1.7;margin:0 0 18px;padding-left:20px}
.stage{min-height:280px;display:flex;align-items:center;justify-content:center;background:#fff;border-radius:12px;padding:12px;margin:0 auto 14px;width:296px}
.qr{width:272px;height:272px;display:block}
.spinner{width:44px;height:44px;border:4px solid #d9e0e3;border-top-color:#00a884;border-radius:50%;animation:spin 1s linear infinite}
@keyframes spin{to{transform:rotate(360deg)}}
.done{color:#111b21}.check{width:64px;height:64px;border-radius:50%;background:#00a884;color:#fff;font-size:36px;line-height:64px;margin:0 auto 10px}
.status{color:#8696a0;font-size:14px;margin:6px 0 14px;min-height:20px}
.muted{color:#8696a0;font-size:13px}
.btn{background:#00a884;color:#fff;border:0;border-radius:8px;padding:10px 18px;font-size:14px;font-weight:600;cursor:pointer}
.btn:hover{background:#02735e}
</style>`;
}
