import { Injectable } from '@angular/core';
import { initializeApp, FirebaseApp, getApps, getApp } from 'firebase/app';
import {
  getFirestore, Firestore, collection, doc, getDocs, getDoc, addDoc,
  updateDoc, deleteDoc, setDoc, query, where, orderBy, serverTimestamp,
  QueryConstraint, DocumentData, onSnapshot, limit, Unsubscribe, writeBatch, Timestamp, runTransaction, deleteField, arrayUnion, arrayRemove, getCountFromServer
} from 'firebase/firestore';
import {
  getStorage, FirebaseStorage, ref, uploadBytes, getDownloadURL, deleteObject, listAll
} from 'firebase/storage';
import { getAuth, createUserWithEmailAndPassword, signOut as firebaseSignOut } from 'firebase/auth';
import { environment } from '../../environments/environment';

@Injectable({ providedIn: 'root' })
export class FirebaseService {
  private app: FirebaseApp;
  private db: Firestore;
  private storage: FirebaseStorage;
  private _orgId: string | null = null;
  private _orgConfig: any = null;

  constructor() {
    this.app = initializeApp(environment.firebase);
    this.db = getFirestore(this.app);
    this.storage = getStorage(this.app);
  }

  getFirestore(): Firestore {
    return this.db;
  }

  // ==================== ORG RESOLUTION ====================

  setOrgId(orgId: string): void {
    this._orgId = orgId;
  }

  getOrgId(): string {
    if (!this._orgId) {
      throw new Error('Organization ID not set. User must be logged in.');
    }
    return this._orgId;
  }

  get isOrgSet(): boolean {
    return !!this._orgId;
  }

  private orgPath(): string {
    return `organizations/${this.getOrgId()}`;
  }

  async getUserOrg(uid: string): Promise<any | null> {
    const userDocRef = doc(this.db, 'users', uid);
    const snap = await getDoc(userDocRef);
    return snap.exists() ? snap.data() : null;
  }

  async updateUserSessionToken(uid: string, token: string): Promise<void> {
    const userDocRef = doc(this.db, 'users', uid);
    await updateDoc(userDocRef, { sessionToken: token });
  }

  watchUserSessionToken(uid: string, callback: (token: string | null) => void): Unsubscribe {
    const userDocRef = doc(this.db, 'users', uid);
    return onSnapshot(userDocRef, (snap) => {
      callback(snap.exists() ? (snap.data()?.['sessionToken'] ?? null) : null);
    });
  }

  watchUserExtraPermissions(uid: string, callback: (perms: string[], revoked: string[]) => void): Unsubscribe {
    return onSnapshot(doc(this.db, 'users', uid), (snap) => {
      const data = snap.exists() ? snap.data() : {};
      const perms = data?.['extraPermissions'] ?? [];
      const revoked = data?.['revokedPermissions'] ?? [];
      callback(perms, revoked);
    });
  }

  async setUserOrg(uid: string, data: { organizationId: string; email: string; role: string; name?: string; whatsappPhone?: string; vehicleType?: string }): Promise<void> {
    const userDocRef = doc(this.db, 'users', uid);
    await setDoc(userDocRef, { ...data, updatedAt: serverTimestamp() }, { merge: true });
  }

  // ==================== ORG MANAGEMENT ====================

  async createOrganization(orgData: {
    name: string;
    industry?: string;
    description?: string;
    plan?: string;
  }): Promise<string> {
    const orgId = orgData.name.toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '')
      .substring(0, 30);

    const orgName = orgData.name;
    const orgDocRef = doc(this.db, 'organizations', orgId);
    const ts = serverTimestamp;
    const orgPath = `organizations/${orgId}`;

    await setDoc(orgDocRef, {
      name: orgName,
      industry: orgData.industry || 'general',
      description: orgData.description || '',
      createdAt: ts(),
      active: true
    });

    // Config: general
    await setDoc(doc(this.db, orgPath, 'config', 'general'), {
      orgName, description: orgData.description || '',
      industry: orgData.industry || 'general',
      welcomeMessage: `Bienvenido a ${orgName}`,
      inactivityTimeout: 180000, personalWhatsApp: '',
      botApiUrl: '', createdAt: ts()
    });

    // Info: contact (template)
    await setDoc(doc(this.db, orgPath, 'info', 'contact'), {
      address: '', city: '', country: '',
      phone: '', email: '', createdAt: ts()
    });

    // Info: schedule
    await setDoc(doc(this.db, orgPath, 'info', 'schedule'), {
      days: [
        { name: 'Lunes',     active: false, shifts: [] },
        { name: 'Martes',    active: false, shifts: [] },
        { name: 'Miércoles', active: false, shifts: [] },
        { name: 'Jueves',    active: false, shifts: [] },
        { name: 'Viernes',   active: false, shifts: [] },
        { name: 'Sábado',    active: true,  shifts: [{ from: '08:00', to: '12:00' }] },
        { name: 'Domingo',   active: false, shifts: [] }
      ],
      slotDuration: 30, blockedDates: [], offersAppointments: false, createdAt: ts()
    });

    // Info: general
    await setDoc(doc(this.db, orgPath, 'info', 'general'), {
      name: orgName, description: orgData.description || '',
      focus: [], modality: '', services: '', note: '',
      createdAt: ts()
    });

    // ── Menu config: only 3 default builtin items ──
    // Flows and collections are created on-demand via the Flow Builder template system.

    const menuItems: any[] = [
      { id: 'm1', type: 'builtin', action: 'general', label: 'Sobre Nosotros', description: 'Conoce quiénes somos', order: 1, active: true }
    ];

    await setDoc(doc(this.db, orgPath, 'config', 'menu'), {
      greeting: `¡Hola{name}!\n\nBienvenido a *${orgName}*.\n\n¿Cómo podemos ayudarte?`,
      menuButtonText: 'Ver opciones',
      fallbackMessage: 'No logré entender tu mensaje.\n\nEscribe *hola* para ver las opciones disponibles.',
      exitMessage: `¡Hasta pronto!\n\nFue un gusto atenderte. Escribe *hola* cuando quieras volver.\n\n_${orgName}_`,
      items: menuItems,
      createdAt: ts()
    });

    // ── Bot messages ──

    const botMsgsRef = collection(this.db, orgPath, 'botMessages');
    const defaultMessages = [
      { key: 'greeting', label: 'Saludo principal', category: 'greeting', description: 'Mensaje de bienvenida', content: `¡Hola{name}!\n\nBienvenido a *${orgName}*.\n\n¿Cómo podemos ayudarte?` },
      { key: 'fallback', label: 'Mensaje no reconocido', category: 'fallback', description: 'Cuando el bot no entiende', content: 'No logré entender tu mensaje.\n\nEscribe *hola* para ver las opciones.' },
      { key: 'goodbye', label: 'Despedida', category: 'general', description: 'Cuando el usuario se despide', content: '¡Hasta pronto!\n\nFue un gusto atenderte. Escribe *hola* cuando quieras volver.' },
      { key: 'session_expired', label: 'Sesión expirada', category: 'general', description: 'Cierre por inactividad', content: 'Tu sesión se cerró por inactividad.\n\nEscribe *hola* cuando quieras retomar.' },
      { key: 'cancel', label: 'Cancelación', category: 'general', description: 'Cuando cancela un proceso', content: 'Proceso cancelado. Escribe *hola* para volver al menú.' },
      { key: 'flow_cancel_hint', label: 'Aviso de cancelación', category: 'flow', description: 'Al iniciar un flujo', content: 'Puedes escribir *cancelar* en cualquier momento para detener este proceso.\n' },
      { key: 'admin_farewell', label: 'Despedida de admin', category: 'admin', description: 'Cuando admin devuelve control', content: 'La conversación con nuestro equipo ha finalizado.\n\nEscribe *hola* para ver el menú.' },
      { key: 'no_registration', label: 'Registro no disponible', category: 'flow', description: 'Sin flujo de registro', content: 'El registro no está disponible en este momento.\n\nEscribe *hola* para ver otras opciones.' }
    ];
    for (const msg of defaultMessages) {
      await addDoc(botMsgsRef, { ...msg, createdAt: ts() });
    }

    return orgId;
  }

  async getOrganization(orgId: string): Promise<any | null> {
    const orgDocRef = doc(this.db, 'organizations', orgId);
    const snap = await getDoc(orgDocRef);
    return snap.exists() ? { id: snap.id, ...snap.data() } : null;
  }

  async setBotStatus(paused: boolean, reason: string | null = null): Promise<void> {
    const orgId = this.getOrgId();
    await this.updateOrganization(orgId, { botPaused: paused, botPausedReason: reason });
  }

  async setBotBlockedByOrgId(orgId: string, blocked: boolean): Promise<void> {
    await this.updateOrganization(orgId, { botBlocked: blocked });
  }

  async deleteAdminByOrgId(orgId: string, adminId: string): Promise<void> {
    const docRef = doc(this.db, 'organizations', orgId, 'admins', adminId);
    await deleteDoc(docRef);
  }

  async updateOrgAdminByOrgId(orgId: string, adminId: string, data: DocumentData): Promise<void> {
    const docRef = doc(this.db, 'organizations', orgId, 'admins', adminId);
    await setDoc(docRef, { ...data, updatedAt: serverTimestamp() }, { merge: true });
    // Si se cambió el rol, sincronizar en users/{uid} (que es lo que lee el login)
    if (data['role']) {
      const adminSnap = await getDoc(docRef);
      const adminData = adminSnap.data();
      const uid = adminData?.['uid'];
      if (uid) {
        // Camino rápido: uid guardado en el doc
        await setDoc(doc(this.db, 'users', uid), { role: data['role'], updatedAt: serverTimestamp() }, { merge: true });
      } else if (adminData?.['email']) {
        // Fallback: buscar por email en la colección users
        const q = query(collection(this.db, 'users'), where('email', '==', adminData['email']));
        const snap = await getDocs(q);
        for (const userDoc of snap.docs) {
          await setDoc(userDoc.ref, { role: data['role'], updatedAt: serverTimestamp() }, { merge: true });
        }
      }
    }
  }

  // Creates a Firebase Auth user without affecting the current admin session
  async createUserForOrg(orgId: string, email: string, password: string, name: string, role: string, whatsappPhone?: string, vehicleType?: string): Promise<string> {
    const secondaryName = 'secondary-user-creation';
    const secondaryApp = getApps().find(a => a.name === secondaryName)
      || initializeApp(getApp().options, secondaryName);
    const secondaryAuth = getAuth(secondaryApp);
    try {
      const credential = await createUserWithEmailAndPassword(secondaryAuth, email, password);
      const uid = credential.user.uid;
      const extraFields: any = {};
      if (whatsappPhone) extraFields.whatsappPhone = whatsappPhone;
      if (vehicleType)   extraFields.vehicleType   = vehicleType;
      await setDoc(doc(this.db, 'users', uid), {
        email, organizationId: orgId, role, name, ...extraFields, updatedAt: serverTimestamp()
      });
      await addDoc(collection(this.db, `organizations/${orgId}/admins`), {
        email, name, role, uid, active: true, ...extraFields, createdAt: serverTimestamp()
      });
      return uid;
    } finally {
      await firebaseSignOut(secondaryAuth).catch(() => {});
    }
  }

  // Uses bot Admin SDK to change another user's password
  async setUserPassword(botApiUrl: string, targetUid: string, newPassword: string): Promise<void> {
    if (!botApiUrl) throw new Error('URL del bot no configurada. Contacta a soporte.');
    const auth = getAuth();
    const idToken = await auth.currentUser?.getIdToken();
    if (!idToken) throw new Error('Sesión no válida');
    const response = await fetch(`${botApiUrl}/api/admin/set-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${idToken}` },
      body: JSON.stringify({ targetUid, newPassword })
    });
    const data = await response.json();
    if (!data.ok) throw new Error(data.error || 'Error al cambiar contraseña');
  }

  // Triggers immediate campaign send via bot API
  async triggerCampaign(botApiUrl: string, orgId: string, campaignId: string): Promise<{ sentCount: number; failedCount: number; total: number }> {
    if (!botApiUrl) throw new Error('URL del bot no configurada');
    const auth = getAuth();
    const idToken = await auth.currentUser?.getIdToken();
    if (!idToken) throw new Error('Sesión no válida');
    const response = await fetch(`${botApiUrl}/api/campaigns/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${idToken}` },
      body: JSON.stringify({ orgId, campaignId })
    });
    const data = await response.json();
    if (!data.ok) throw new Error(data.error || 'Error al enviar campaña');
    return data;
  }

  // Lista las plantillas de WhatsApp aprobadas en Meta (vía el bot)
  async getApprovedTemplates(botApiUrl: string, orgId: string): Promise<any[]> {
    if (!botApiUrl) throw new Error('URL del bot no configurada');
    const auth = getAuth();
    const idToken = await auth.currentUser?.getIdToken();
    if (!idToken) throw new Error('Sesión no válida');
    const base = botApiUrl.replace(/\/$/, '');
    const response = await fetch(`${base}/api/campaigns/templates?orgId=${encodeURIComponent(orgId)}&status=APPROVED`, {
      method: 'GET',
      headers: { 'Authorization': `Bearer ${idToken}` }
    });
    const data = await response.json();
    if (!data.ok) throw new Error(data.error || 'Error al obtener plantillas');
    return data.templates || [];
  }

  // Prueba credenciales de WhatsApp (token + WABA) contra Meta, sin guardar. Devuelve el cuerpo tal cual.
  async testWhatsAppTemplates(botApiUrl: string, creds: { token: string; wabaId: string; version?: string }): Promise<any> {
    if (!botApiUrl) throw new Error('URL del bot no configurada');
    const auth = getAuth();
    const idToken = await auth.currentUser?.getIdToken();
    if (!idToken) throw new Error('Sesión no válida');
    const base = botApiUrl.replace(/\/$/, '');
    const response = await fetch(`${base}/api/campaigns/test-wa`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${idToken}` },
      body: JSON.stringify(creds)
    });
    return response.json();
  }

  // Crea una plantilla en Meta (queda PENDING). Devuelve el cuerpo tal cual.
  async createTemplate(botApiUrl: string, payload: any): Promise<any> {
    if (!botApiUrl) throw new Error('URL del bot no configurada');
    const auth = getAuth();
    const idToken = await auth.currentUser?.getIdToken();
    if (!idToken) throw new Error('Sesión no válida');
    const base = botApiUrl.replace(/\/$/, '');
    const response = await fetch(`${base}/api/campaigns/create-template`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${idToken}` },
      body: JSON.stringify(payload)
    });
    return response.json();
  }

  // Borra una plantilla por nombre. Devuelve el cuerpo tal cual.
  async deleteTemplate(botApiUrl: string, payload: any): Promise<any> {
    if (!botApiUrl) throw new Error('URL del bot no configurada');
    const auth = getAuth();
    const idToken = await auth.currentUser?.getIdToken();
    if (!idToken) throw new Error('Sesión no válida');
    const base = botApiUrl.replace(/\/$/, '');
    const response = await fetch(`${base}/api/campaigns/delete-template`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${idToken}` },
      body: JSON.stringify(payload)
    });
    return response.json();
  }

  // Lista TODAS las plantillas (cualquier estado) para gestión
  async getAllTemplates(botApiUrl: string, orgId: string): Promise<any[]> {
    if (!botApiUrl) throw new Error('URL del bot no configurada');
    const auth = getAuth();
    const idToken = await auth.currentUser?.getIdToken();
    if (!idToken) throw new Error('Sesión no válida');
    const base = botApiUrl.replace(/\/$/, '');
    const response = await fetch(`${base}/api/campaigns/templates?orgId=${encodeURIComponent(orgId)}`, {
      method: 'GET',
      headers: { 'Authorization': `Bearer ${idToken}` }
    });
    const data = await response.json();
    if (!data.ok) throw new Error(data.error || 'Error al obtener plantillas');
    return data.templates || [];
  }

  // ==================== ORG CONFIG ====================

  async getOrgConfig(): Promise<any | null> {
    return this.getDocument('config', 'general');
  }

  async saveOrgConfig(data: DocumentData): Promise<void> {
    const docRef = doc(this.db, this.orgPath(), 'config', 'general');
    await setDoc(docRef, { ...data, updatedAt: serverTimestamp() }, { merge: true });
  }

  async getWhatsAppConfig(): Promise<any | null> {
    return this.getDocument('config', 'whatsapp');
  }

  async saveWhatsAppConfig(data: DocumentData): Promise<void> {
    const docRef = doc(this.db, this.orgPath(), 'config', 'whatsapp');
    await setDoc(docRef, { ...data, updatedAt: serverTimestamp() }, { merge: true });
  }

  // ==================== GENERIC HELPERS ====================

  async getCollection(subcollection: string, constraints: QueryConstraint[] = []): Promise<any[]> {
    const colRef = collection(this.db, this.orgPath(), subcollection);
    const q = constraints.length > 0 ? query(colRef, ...constraints) : query(colRef);
    const snapshot = await getDocs(q);
    return snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
  }

  async getDocument(subcollection: string, docId: string): Promise<any | null> {
    const docRef = doc(this.db, this.orgPath(), subcollection, docId);
    const snap = await getDoc(docRef);
    return snap.exists() ? { id: snap.id, ...snap.data() } : null;
  }

  async addDocument(subcollection: string, data: DocumentData): Promise<string> {
    const colRef = collection(this.db, this.orgPath(), subcollection);
    const docRef = await addDoc(colRef, {
      ...data,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });
    return docRef.id;
  }

  async updateDocument(subcollection: string, docId: string, data: DocumentData): Promise<void> {
    const docRef = doc(this.db, this.orgPath(), subcollection, docId);
    await updateDoc(docRef, { ...data, updatedAt: serverTimestamp() });
  }

  async deleteDocument(subcollection: string, docId: string): Promise<void> {
    const docRef = doc(this.db, this.orgPath(), subcollection, docId);
    await deleteDoc(docRef);
  }

  // ==================== CONTACTS (replaces applicants) ====================

  async getContacts(): Promise<any[]> {
    const items = await this.getCollection('contacts');
    return items.sort((a, b) => {
      const dateA = a.createdAt?.seconds || 0;
      const dateB = b.createdAt?.seconds || 0;
      return dateB - dateA;
    });
  }

  async updateContactStatus(contactId: string, status: string): Promise<void> {
    await this.updateDocument('contacts', contactId, { status });
  }

  async convertContact(contact: any): Promise<string> {
    const clientData: any = { ...contact };
    delete clientData.id;
    delete clientData.createdAt;
    delete clientData.updatedAt;
    clientData.status = 'active';
    clientData.contactId = contact.id;
    clientData.convertedAt = serverTimestamp();

    const clientId = await this.addDocument('clients', clientData);
    await this.updateDocument('contacts', contact.id, { status: 'converted', clientId });
    return clientId;
  }

  // ==================== CLIENTS (replaces students) ====================

  async getClients(): Promise<any[]> {
    const items = await this.getCollection('clients');
    return items.sort((a, b) => {
      const dateA = a.createdAt?.seconds || 0;
      const dateB = b.createdAt?.seconds || 0;
      return dateB - dateA;
    });
  }

  async updateClientStatus(clientId: string, status: string): Promise<void> {
    await this.updateDocument('clients', clientId, { status });
  }

  // ==================== ADMINS (org-scoped) ====================

  async getAdmins(): Promise<any[]> {
    return this.getCollection('admins');
  }

  async getActiveSubmissionPhonesByUid(uid: string, slugs: string[]): Promise<{ phone: string; takenAt: number | null }[]> {
    const result = new Map<string, number | null>();
    for (const slug of slugs) {
      const colRef = collection(this.db, this.orgPath(), slug);
      const q = query(colRef, where('assignedTo.uid', '==', uid));
      const snap = await getDocs(q);
      snap.docs.forEach(d => {
        const data = d.data();
        if (data['status'] !== 'resolved' && data['phoneNumber']) {
          const at = data['assignedAt'];
          const takenAt: number | null = at?.toMillis?.()
            ?? (at?.seconds ? at.seconds * 1000 : null);
          if (!result.has(data['phoneNumber'])) {
            result.set(data['phoneNumber'], takenAt);
          }
        }
      });
    }
    return Array.from(result.entries()).map(([phone, takenAt]) => ({ phone, takenAt }));
  }

  async getAdminByUid(uid: string): Promise<any | null> {
    const snap = await getDocs(collection(this.db, this.orgPath(), 'admins'));
    const doc = snap.docs.find(d => d.data()['uid'] === uid);
    return doc ? { id: doc.id, ...doc.data() } : null;
  }

  async addAdmin(data: { email: string; name: string; role: string; uid?: string }): Promise<string> {
    return this.addDocument('admins', { ...data, active: true });
  }

  async updateAdmin(adminId: string, data: DocumentData): Promise<void> {
    await this.updateDocument('admins', adminId, data);
  }

  async setAdminTempPermission(adminId: string, key: string, value: { label: string; expiresAt: Date | null } | null): Promise<void> {
    const ref = doc(this.db, this.orgPath(), 'admins', adminId);
    await updateDoc(ref, { [`tempPermissions.${key}`]: value ?? deleteField() });
  }

  async blockAdminUser(adminId: string, uid: string, blockedUntil: Date | null): Promise<void> {
    const data: any = {
      blocked: true,
      blockedUntil: blockedUntil ? Timestamp.fromDate(blockedUntil) : null
    };
    await Promise.all([
      updateDoc(doc(this.db, this.orgPath(), 'admins', adminId), data),
      updateDoc(doc(this.db, 'users', uid), data)
    ]);
  }

  async unblockAdminUser(adminId: string, uid: string): Promise<void> {
    const data = { blocked: false, blockedUntil: null };
    await Promise.all([
      updateDoc(doc(this.db, this.orgPath(), 'admins', adminId), data),
      updateDoc(doc(this.db, 'users', uid), data)
    ]);
  }

  async clearExpiredBlock(uid: string): Promise<void> {
    await updateDoc(doc(this.db, 'users', uid), { blocked: false, blockedUntil: null });
  }

  async grantUserExtraPermission(uid: string, key: string): Promise<void> {
    await updateDoc(doc(this.db, 'users', uid), { extraPermissions: arrayUnion(key) });
  }

  async revokeUserExtraPermission(uid: string, key: string): Promise<void> {
    await updateDoc(doc(this.db, 'users', uid), { extraPermissions: arrayRemove(key) });
  }

  async revokeRolePermission(adminId: string, uid: string, key: string): Promise<void> {
    await Promise.all([
      updateDoc(doc(this.db, this.orgPath(), 'admins', adminId), { revokedPermissions: arrayUnion(key) }),
      updateDoc(doc(this.db, 'users', uid), { revokedPermissions: arrayUnion(key) })
    ]);
  }

  async restoreRolePermission(adminId: string, uid: string, key: string): Promise<void> {
    await Promise.all([
      updateDoc(doc(this.db, this.orgPath(), 'admins', adminId), { revokedPermissions: arrayRemove(key) }),
      updateDoc(doc(this.db, 'users', uid), { revokedPermissions: arrayRemove(key) })
    ]);
  }

  async deleteAdmin(adminId: string): Promise<void> {
    await this.deleteDocument('admins', adminId);
  }

  // Lee las dos bolsas del wallet. Saldo legado (sin bolsas) se considera CORTESÍA.
  private walletPools(w: any): { paid: number; gift: number } {
    if (!w) return { paid: 0, gift: 0 };
    if (w.paidBalance !== undefined || w.giftBalance !== undefined) {
      return { paid: w.paidBalance || 0, gift: w.giftBalance || 0 };
    }
    return { paid: 0, gift: w.balance || 0 };
  }

  // Assign a submission to a delivery agent (transactional — prevents double-take
  // AND cobra la comisión del crédito del delivery de forma atómica).
  // El cobro consume CORTESÍA primero y luego crédito pagado.
  async assignSubmission(
    collName: string,
    docId: string,
    agent: { uid: string; name: string; email: string; whatsappPhone?: string; deliveryCode?: string },
    startCoords?: { lat: number; lng: number } | null
  ): Promise<{ ok: boolean; takenBy?: string; reason?: string; commission?: number; balance?: number }> {
    const commission = await this.getCommissionFor(collName);
    const docRef = doc(this.db, this.orgPath(), collName, docId);
    const walletRef = doc(this.db, this.orgPath(), 'delivery_wallets', agent.uid);
    const ledgerRef = doc(collection(this.db, this.orgPath(), 'credit_transactions'));
    let takenBy: string | undefined;
    let reason: string | undefined;
    let balance = 0;
    const ok = await runTransaction(this.db, async (transaction) => {
      const snap = await transaction.get(docRef);
      if (!snap.exists()) { reason = 'not_found'; return false; }
      const data = snap.data();
      if (data['assignedTo'] != null) {
        takenBy = data['assignedTo']?.name || 'otro Delivery';
        reason = 'taken';
        return false;
      }
      // Verificar crédito ANTES de asignar (todas las lecturas antes de escribir).
      let fromPaid = 0, fromGift = 0, newPaid = 0, newGift = 0;
      if (commission > 0) {
        const wSnap = await transaction.get(walletRef);
        const pools = this.walletPools(wSnap.exists() ? wSnap.data() : null);
        balance = pools.paid + pools.gift;
        if (balance < commission) { reason = 'insufficient_credit'; return false; }
        fromGift = Math.min(pools.gift, commission);   // cortesía primero
        fromPaid = commission - fromGift;
        newGift = pools.gift - fromGift;
        newPaid = pools.paid - fromPaid;
      }
      const assignedToData: any = { ...agent };
      if (agent.deliveryCode) {
        assignedToData.deliveryCode = agent.deliveryCode;
      }
      const updateData: any = {
        assignedTo: assignedToData,
        assignedAt: serverTimestamp(),
        status: 'read',
        updatedAt: serverTimestamp(),
        ...(agent.deliveryCode && { deliveryCode: agent.deliveryCode }),
        ...(startCoords && { startLat: startCoords.lat, startLng: startCoords.lng })
      };
      if (commission > 0) {
        const newBalance = newPaid + newGift;
        updateData.commissionCharged = commission;
        updateData.commissionFromPaid = fromPaid;
        updateData.commissionFromGift = fromGift;
        transaction.update(docRef, updateData);
        transaction.set(walletRef, { uid: agent.uid, paidBalance: newPaid, giftBalance: newGift, balance: newBalance, updatedAt: serverTimestamp() }, { merge: true });
        transaction.set(ledgerRef, {
          deliveryUid: agent.uid, deliveryName: agent.name || '', type: 'debit',
          amount: commission, fromPaid, fromGift, balanceAfter: newBalance, orderId: docId, collection: collName,
          reason: 'Comisión por tomar pedido', createdAt: serverTimestamp()
        });
        balance = newBalance;
      } else {
        transaction.update(docRef, updateData);
      }
      return true;
    });
    return { ok, takenBy, reason, commission, balance };
  }

  // ==================== CRÉDITOS DE DELIVERY ====================

  // Config de delivery: comisiones por servicio + si cada servicio pide código de confirmación.
  async getDeliveryConfig(): Promise<{ commissions: Record<string, number>; defaultCommission: number; requireCode: Record<string, boolean> }> {
    const snap = await getDoc(doc(this.db, this.orgPath(), 'config', 'delivery'));
    const data: any = snap.exists() ? snap.data() : {};
    return { commissions: data.commissions || {}, defaultCommission: data.defaultCommission || 0, requireCode: data.requireCode || {} };
  }

  async saveDeliveryConfig(commissions: Record<string, number>, defaultCommission: number, requireCode: Record<string, boolean> = {}): Promise<void> {
    await setDoc(
      doc(this.db, this.orgPath(), 'config', 'delivery'),
      { commissions, defaultCommission, requireCode, updatedAt: serverTimestamp() },
      { merge: true }
    );
  }

  // Comisión aplicable a un servicio (colección). 'promo' para pedidos promo.
  async getCommissionFor(collName: string): Promise<number> {
    const cfg = await this.getDeliveryConfig();
    const c = cfg.commissions?.[collName];
    return (typeof c === 'number' && c >= 0) ? c : (cfg.defaultCommission || 0);
  }

  // ¿Este servicio pide código de confirmación al cerrar? Default: sí.
  async isDeliveryCodeRequired(collName: string): Promise<boolean> {
    const cfg = await this.getDeliveryConfig();
    return cfg.requireCode?.[collName] !== false;
  }

  // Saldo de UN delivery en tiempo real (para que vea su crédito en vivo)
  watchDeliveryWallet(uid: string, callback: (balance: number) => void): () => void {
    const ref = doc(this.db, this.orgPath(), 'delivery_wallets', uid);
    return onSnapshot(ref, (snap) => {
      callback(snap.exists() ? (snap.data()['balance'] || 0) : 0);
    });
  }

  // Saldos de todos los deliveries → mapa uid -> balance
  async getDeliveryWallets(): Promise<Record<string, number>> {
    const snap = await getDocs(collection(this.db, this.orgPath(), 'delivery_wallets'));
    const out: Record<string, number> = {};
    snap.docs.forEach(d => { out[d.id] = d.data()['balance'] || 0; });
    return out;
  }

  // Recarga manual de crédito (owner) — transaccional + asiento en el ledger.
  // source: 'paid' = el delivery pagó este crédito | 'gift' = cortesía / crédito regalado.
  async rechargeCredit(
    deliveryUid: string, deliveryName: string, amount: number,
    by: { uid: string; name: string }, source: 'paid' | 'gift' = 'paid'
  ): Promise<{ ok: boolean; balance: number }> {
    const walletRef = doc(this.db, this.orgPath(), 'delivery_wallets', deliveryUid);
    const ledgerRef = doc(collection(this.db, this.orgPath(), 'credit_transactions'));
    let newBalance = 0;
    const ok = await runTransaction(this.db, async (transaction) => {
      const wSnap = await transaction.get(walletRef);
      const pools = this.walletPools(wSnap.exists() ? wSnap.data() : null);
      let paid = pools.paid, gift = pools.gift;
      if (source === 'paid') paid += amount; else gift += amount;
      newBalance = paid + gift;
      transaction.set(walletRef, { uid: deliveryUid, paidBalance: paid, giftBalance: gift, balance: newBalance, updatedAt: serverTimestamp() }, { merge: true });
      transaction.set(ledgerRef, {
        deliveryUid, deliveryName: deliveryName || '', type: 'recharge', source,
        amount, balanceAfter: newBalance,
        reason: source === 'paid' ? 'Recarga pagada por el delivery' : 'Crédito de cortesía',
        createdBy: by, createdAt: serverTimestamp()
      });
      return true;
    });
    return { ok, balance: newBalance };
  }

  // Ajuste manual de saldo (owner/admin): suma o resta sobre una bolsa, con motivo.
  // signedAmount > 0 agrega, < 0 descuenta. bucket: 'paid' | 'gift'.
  async adjustCredit(
    deliveryUid: string, deliveryName: string, signedAmount: number,
    bucket: 'paid' | 'gift', reason: string, by: { uid: string; name: string }
  ): Promise<{ ok: boolean; balance: number; error?: string }> {
    const walletRef = doc(this.db, this.orgPath(), 'delivery_wallets', deliveryUid);
    const ledgerRef = doc(collection(this.db, this.orgPath(), 'credit_transactions'));
    let newBalance = 0;
    let error: string | undefined;
    const ok = await runTransaction(this.db, async (transaction) => {
      const wSnap = await transaction.get(walletRef);
      const pools = this.walletPools(wSnap.exists() ? wSnap.data() : null);
      let paid = pools.paid, gift = pools.gift;
      if (bucket === 'paid') paid += signedAmount; else gift += signedAmount;
      if (paid < 0 || gift < 0) { error = 'insufficient'; return false; }
      newBalance = paid + gift;
      transaction.set(walletRef, { uid: deliveryUid, paidBalance: paid, giftBalance: gift, balance: newBalance, updatedAt: serverTimestamp() }, { merge: true });
      transaction.set(ledgerRef, {
        deliveryUid, deliveryName: deliveryName || '', type: 'adjustment', source: bucket,
        amount: signedAmount, balanceAfter: newBalance,
        reason: reason || 'Ajuste manual', createdBy: by, createdAt: serverTimestamp()
      });
      return true;
    });
    return { ok, balance: newBalance, error };
  }

  // Movimientos de crédito (ledger) para contabilidad del dashboard.
  async getCreditTransactions(max = 2000): Promise<any[]> {
    const colRef = collection(this.db, this.orgPath(), 'credit_transactions');
    const snap = await getDocs(query(colRef, orderBy('createdAt', 'desc'), limit(max)));
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  }

  // Cancel an assigned submission (soft) — keeps the document for history/audit.
  // Transactional so it doesn't race with a concurrent assign/resolve.
  async cancelSubmission(
    collName: string,
    docId: string,
    canceller: { uid: string; name: string; email: string },
    reason?: string
  ): Promise<{ ok: boolean; refundRequested?: boolean }> {
    const docRef = doc(this.db, this.orgPath(), collName, docId);
    let charged = 0;
    let delUid = '';
    let delName = '';
    let cFromPaid: number | undefined;
    let cFromGift: number | undefined;
    const ok = await runTransaction(this.db, async (transaction) => {
      const snap = await transaction.get(docRef);
      if (!snap.exists()) return false;
      const d = snap.data();
      charged = d['commissionCharged'] || 0;
      cFromPaid = d['commissionFromPaid'];
      cFromGift = d['commissionFromGift'];
      delUid = d['assignedTo']?.uid || '';
      delName = d['assignedTo']?.name || '';
      const data: any = {
        status: 'cancelled',
        cancelledBy: canceller,
        cancelledAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      };
      if (reason) data.cancelReason = reason;
      if (charged > 0 && delUid) data.refundRequested = true;
      transaction.update(docRef, data);
      return true;
    });
    // Si se había cobrado comisión, generar solicitud de reembolso para que el admin la resuelva.
    let refundRequested = false;
    if (ok && charged > 0 && delUid) {
      await this.createRefundRequest({
        orderId: docId, collection: collName, deliveryUid: delUid, deliveryName: delName,
        amount: charged, fromPaid: cFromPaid, fromGift: cFromGift,
        reason: reason || 'Pedido cancelado por administración'
      });
      refundRequested = true;
    }
    return { ok, refundRequested };
  }

  // ==================== REEMBOLSOS ====================

  async createRefundRequest(data: {
    orderId: string; collection: string; deliveryUid: string; deliveryName: string;
    amount: number; reason: string; fromPaid?: number; fromGift?: number;
  }): Promise<void> {
    await addDoc(collection(this.db, this.orgPath(), 'refund_requests'), {
      orderId: data.orderId, collection: data.collection,
      deliveryUid: data.deliveryUid, deliveryName: data.deliveryName,
      amount: data.amount, reason: data.reason,
      fromPaid: typeof data.fromPaid === 'number' ? data.fromPaid : null,
      fromGift: typeof data.fromGift === 'number' ? data.fromGift : null,
      status: 'pending', adminMessage: '', requestedAt: serverTimestamp()
    });
  }

  // Realtime: solicitudes pendientes (para owner/admin)
  watchPendingRefunds(callback: (reqs: any[]) => void): () => void {
    const colRef = collection(this.db, this.orgPath(), 'refund_requests');
    return onSnapshot(colRef, (snap) => {
      const list = snap.docs.map(d => ({ id: d.id, ...d.data() }))
        .filter((r: any) => r.status === 'pending')
        .sort((a: any, b: any) => (b.requestedAt?.seconds || 0) - (a.requestedAt?.seconds || 0));
      callback(list);
    });
  }

  // Realtime: reembolsos de un delivery (para que vea el resultado)
  watchMyRefunds(uid: string, callback: (reqs: any[]) => void): () => void {
    const colRef = collection(this.db, this.orgPath(), 'refund_requests');
    return onSnapshot(query(colRef, where('deliveryUid', '==', uid)), (snap) => {
      const list = snap.docs.map(d => ({ id: d.id, ...d.data() }))
        .sort((a: any, b: any) => (b.requestedAt?.seconds || 0) - (a.requestedAt?.seconds || 0));
      callback(list);
    });
  }

  // Resolver (aprobar/rechazar) una solicitud de reembolso. Aprobar acredita el saldo.
  async resolveRefundRequest(
    requestId: string, approve: boolean, adminMessage: string, by: { uid: string; name: string }
  ): Promise<{ ok: boolean; reason?: string }> {
    const reqRef = doc(this.db, this.orgPath(), 'refund_requests', requestId);
    let reason: string | undefined;
    const ok = await runTransaction(this.db, async (transaction) => {
      const snap = await transaction.get(reqRef);
      if (!snap.exists()) { reason = 'not_found'; return false; }
      const r: any = snap.data();
      if (r.status !== 'pending') { reason = 'already_resolved'; return false; }

      if (approve) {
        const walletRef = doc(this.db, this.orgPath(), 'delivery_wallets', r.deliveryUid);
        const ledgerRef = doc(collection(this.db, this.orgPath(), 'credit_transactions'));
        const wSnap = await transaction.get(walletRef);
        const pools = this.walletPools(wSnap.exists() ? wSnap.data() : null);
        // Devolver a la bolsa de la que salió; si es legado (sin split), a cortesía.
        let addPaid = 0, addGift = 0;
        if (typeof r.fromPaid === 'number' || typeof r.fromGift === 'number') {
          addPaid = r.fromPaid || 0; addGift = r.fromGift || 0;
        } else {
          addGift = r.amount || 0;
        }
        const newPaid = pools.paid + addPaid;
        const newGift = pools.gift + addGift;
        const newBalance = newPaid + newGift;
        transaction.set(walletRef, { uid: r.deliveryUid, paidBalance: newPaid, giftBalance: newGift, balance: newBalance, updatedAt: serverTimestamp() }, { merge: true });
        transaction.set(ledgerRef, {
          deliveryUid: r.deliveryUid, deliveryName: r.deliveryName || '', type: 'refund',
          amount: r.amount || 0, fromPaid: addPaid, fromGift: addGift, balanceAfter: newBalance,
          orderId: r.orderId, collection: r.collection,
          reason: 'Reembolso aprobado', createdBy: by, createdAt: serverTimestamp()
        });
      }
      transaction.update(reqRef, {
        status: approve ? 'approved' : 'rejected',
        adminMessage: adminMessage || '',
        resolvedBy: by,
        resolvedAt: serverTimestamp()
      });
      return true;
    });
    return { ok, reason };
  }

  async isOrgAdmin(email: string): Promise<boolean> {
    const admins = await this.getCollection('admins');
    return admins.some(a => a.email === email && a.active !== false);
  }

  // ==================== BOT MESSAGES ====================

  async getBotMessages(): Promise<any[]> {
    return this.getCollection('botMessages');
  }

  async getBotMessage(messageId: string): Promise<any | null> {
    return this.getDocument('botMessages', messageId);
  }

  async updateBotMessage(messageId: string, data: DocumentData): Promise<void> {
    await this.updateDocument('botMessages', messageId, data);
  }

  async addBotMessage(data: any): Promise<string> {
    return this.addDocument('botMessages', data);
  }

  // ==================== CONFIG / INFO ====================

  async getConfig(): Promise<any | null> {
    return this.getDocument('config', 'general');
  }

  async updateConfig(data: DocumentData): Promise<void> {
    await this.updateDocument('config', 'general', data);
  }

  async getInfo(infoId: string): Promise<any | null> {
    return this.getDocument('info', infoId);
  }

  async updateInfo(infoId: string, data: DocumentData): Promise<void> {
    await this.updateDocument('info', infoId, data);
  }

  // ==================== PROGRAMS ====================

  async getPrograms(): Promise<any[]> {
    const items = await this.getCollection('programs');
    return items.sort((a, b) => (a.order || 0) - (b.order || 0));
  }

  async addProgram(data: DocumentData): Promise<string> {
    return this.addDocument('programs', { ...data, active: true });
  }

  async updateProgram(programId: string, data: DocumentData): Promise<void> {
    await this.updateDocument('programs', programId, data);
  }

  async deleteProgram(programId: string): Promise<void> {
    await this.deleteDocument('programs', programId);
  }

  // ==================== FLOWS ====================

  async getFlows(): Promise<any[]> {
    const items = await this.getCollection('flows');
    return items.sort((a, b) => (a.order || 0) - (b.order || 0));
  }

  async getFlow(flowId: string): Promise<any | null> {
    return this.getDocument('flows', flowId);
  }

  async addFlow(data: DocumentData): Promise<string> {
    return this.addDocument('flows', { ...data, active: true });
  }

  async updateFlow(flowId: string, data: DocumentData): Promise<void> {
    await this.updateDocument('flows', flowId, data);
  }

  async deleteFlow(flowId: string): Promise<void> {
    await this.deleteDocument('flows', flowId);
  }

  // ==================== MENU CONFIG ====================

  async getMenuConfig(): Promise<any | null> {
    return this.getDocument('config', 'menu');
  }

  async saveMenuConfig(data: DocumentData): Promise<void> {
    const docRef = doc(this.db, this.orgPath(), 'config', 'menu');
    await setDoc(docRef, { ...data, updatedAt: serverTimestamp() }, { merge: true });
  }

  // ==================== KEYWORDS ====================

  async getKeywords(): Promise<any[]> {
    const result = await this.getDocument('config', 'keywords');
    return result?.keywords || [];
  }

  async saveKeywords(keywords: any[]): Promise<void> {
    const docRef = doc(this.db, this.orgPath(), 'config', 'keywords');
    await setDoc(docRef, { keywords, updatedAt: serverTimestamp() }, { merge: true });
  }

  // ==================== DYNAMIC COLLECTIONS ====================

  async getAppointmentCollections(): Promise<{ slug: string; name: string }[]> {
    const flows = await this.getFlows();
    const seen = new Set<string>();
    const result: { slug: string; name: string }[] = [];
    for (const flow of flows) {
      const hasAppt = flow.steps?.some((s: any) => s.type === 'appointment_slot');
      if (hasAppt && flow.saveToCollection && !seen.has(flow.saveToCollection)) {
        seen.add(flow.saveToCollection);
        result.push({ slug: flow.saveToCollection, name: flow.name || flow.saveToCollection });
      }
    }
    return result;
  }

  async getAppointmentItems(slug: string, from: string, to: string, status: string): Promise<any[]> {
    const orgId = this.getOrgId();
    const colRef = collection(this.db, `organizations/${orgId}/${slug}`);
    const snap = await getDocs(query(colRef, orderBy('createdAt', 'desc'), limit(500)));
    let items = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    if (from) items = items.filter((i: any) => (i._apptFecha || '') >= from);
    if (to) items = items.filter((i: any) => (i._apptFecha || '') <= to);
    if (status && status !== 'all') items = items.filter((i: any) => (i.status || 'pending') === status);
    items.sort((a: any, b: any) => {
      const da = (a._apptFecha || '') + (a._apptHora || '');
      const db2 = (b._apptFecha || '') + (b._apptHora || '');
      return da.localeCompare(db2);
    });
    return items;
  }

  async cancelAppointmentItem(slug: string, itemId: string): Promise<void> {
    await this.updateDocument(slug, itemId, { status: 'cancelled', updatedAt: serverTimestamp() });
  }

  async cancelCollectionItem(slug: string, itemId: string): Promise<void> {
    await this.updateDocument(slug, itemId, { status: 'cancelled', cancelledAt: serverTimestamp() });
  }

  async getCollectionDefs(): Promise<any[]> {
    const items = await this.getCollection('_collections');
    return items.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  }

  async getCollectionDef(defId: string): Promise<any | null> {
    return this.getDocument('_collections', defId);
  }

  async saveCollectionDef(data: any): Promise<string> {
    if (data.id) {
      const id = data.id;
      const rest = { ...data };
      delete rest.id;
      await this.updateDocument('_collections', id, rest);
      return id;
    }
    return this.addDocument('_collections', data);
  }

  async deleteCollectionDef(defId: string): Promise<void> {
    await this.deleteDocument('_collections', defId);
  }

  async deleteCollectionWithData(slug: string): Promise<void> {
    // Delete collection definition doc
    const defsSnap = await getDocs(collection(this.db, this.orgPath(), '_collections'));
    for (const d of defsSnap.docs) {
      if (d.data()['slug'] === slug) {
        await deleteDoc(d.ref);
        break;
      }
    }
    // Delete all data items in batches
    const itemsSnap = await getDocs(collection(this.db, this.orgPath(), slug));
    const batch = writeBatch(this.db);
    itemsSnap.docs.forEach(d => batch.delete(d.ref));
    if (itemsSnap.docs.length > 0) await batch.commit();
  }

  // Sync flow steps → collection fields (add missing fields, never removes existing ones)
  async syncFlowToCollection(slug: string, steps: any[]): Promise<void> {
    const colDefs = await this.getCollectionDefs();
    const col = colDefs.find((c: any) => c.slug === slug);
    if (!col) return;

    const existingKeys = new Set(col.fields.map((f: any) => f.key));
    let changed = false;

    for (const step of steps) {
      if (step.type === 'message') continue;

      if (step.type === 'appointment_slot') {
        const apptFields = [
          { key: step.fieldKey || 'fecha', label: 'Fecha' },
          { key: step.timeFieldKey || 'hora', label: 'Hora' },
          { key: '_apptService', label: 'Servicio' }
        ];
        for (const af of apptFields) {
          if (af.key && !existingKeys.has(af.key)) {
            col.fields.push({ key: af.key, label: af.label, type: 'text', required: false });
            existingKeys.add(af.key);
            changed = true;
          }
        }
        continue;
      }

      if (!step.fieldKey || existingKeys.has(step.fieldKey)) continue;
      col.fields.push({
        key: step.fieldKey,
        label: step.fieldLabel || step.fieldKey,
        type: step.type === 'number_input' ? 'number' : 'text',
        required: false
      });
      existingKeys.add(step.fieldKey);
      changed = true;
    }

    if (changed) await this.saveCollectionDef(col);
  }

  // Remove flow steps whose fieldKey matches deleted collection fields
  async removeFlowStepsForFields(slug: string, removedKeys: string[]): Promise<void> {
    if (!removedKeys.length) return;
    const flows = await this.getFlows();
    for (const flow of flows) {
      if (flow.saveToCollection !== slug) continue;
      const original = flow.steps || [];
      const updated = original.filter((s: any) =>
        s.type === 'message' || !removedKeys.includes(s.fieldKey)
      );
      if (updated.length !== original.length) {
        await this.updateFlow(flow.id, { steps: updated });
      }
    }
  }

  // SA: reset org bot to default state (clears flows, collections, menu, conversations)
  async resetOrgBotToDefault(orgId: string): Promise<void> {
    const orgBase = `organizations/${orgId}`;

    // 1. Delete all collection data + definitions
    const colDefsSnap = await getDocs(collection(this.db, orgBase, '_collections'));
    for (const colDoc of colDefsSnap.docs) {
      const slug: string = colDoc.data()['slug'];
      if (slug) {
        const dataSnap = await getDocs(collection(this.db, orgBase, slug));
        if (!dataSnap.empty) {
          for (let i = 0; i < dataSnap.docs.length; i += 400) {
            const batch = writeBatch(this.db);
            dataSnap.docs.slice(i, i + 400).forEach(d => batch.delete(d.ref));
            await batch.commit();
          }
        }
      }
      await deleteDoc(colDoc.ref);
    }

    // 2. Delete all flows
    const flowsSnap = await getDocs(collection(this.db, orgBase, 'flows'));
    if (!flowsSnap.empty) {
      for (let i = 0; i < flowsSnap.docs.length; i += 400) {
        const batch = writeBatch(this.db);
        flowsSnap.docs.slice(i, i + 400).forEach(d => batch.delete(d.ref));
        await batch.commit();
      }
    }

    // 3. Reset schedule: only Saturday active 08-12, appointments disabled
    const scheduleRef = doc(this.db, orgBase, 'info', 'schedule');
    await setDoc(scheduleRef, {
      days: [
        { name: 'Lunes',     active: false, shifts: [] },
        { name: 'Martes',    active: false, shifts: [] },
        { name: 'Miércoles', active: false, shifts: [] },
        { name: 'Jueves',    active: false, shifts: [] },
        { name: 'Viernes',   active: false, shifts: [] },
        { name: 'Sábado',    active: true,  shifts: [{ from: '08:00', to: '12:00' }] },
        { name: 'Domingo',   active: false, shifts: [] }
      ],
      slotDuration: 30, blockedDates: [], offersAppointments: false,
      updatedAt: serverTimestamp()
    }, { merge: true });

    // 4. Delete all conversations (with nested messages)
    const convsSnap = await getDocs(collection(this.db, orgBase, 'conversations'));
    for (const convDoc of convsSnap.docs) {
      const msgsSnap = await getDocs(collection(this.db, convDoc.ref.path, 'messages'));
      if (!msgsSnap.empty) {
        for (let i = 0; i < msgsSnap.docs.length; i += 400) {
          const batch = writeBatch(this.db);
          msgsSnap.docs.slice(i, i + 400).forEach(d => batch.delete(d.ref));
          await batch.commit();
        }
      }
      await deleteDoc(convDoc.ref);
    }

    // 5. Reset menu config to 3 builtins (preserve text customizations)
    const menuRef = doc(this.db, orgBase, 'config', 'menu');
    const menuSnap = await getDoc(menuRef);
    const existing = menuSnap.exists() ? menuSnap.data() : {};
    await setDoc(menuRef, {
      greeting: existing['greeting'] || '¡Hola{name}!\n\n¿Cómo podemos ayudarte?',
      menuButtonText: existing['menuButtonText'] || 'Ver opciones',
      fallbackMessage: existing['fallbackMessage'] || 'No logré entender tu mensaje.\n\nEscribe *hola* para ver las opciones.',
      exitMessage: existing['exitMessage'] || '¡Hasta pronto!',
      items: [
        { id: 'm1', type: 'builtin', action: 'general', label: 'Sobre Nosotros', description: 'Conoce quiénes somos', order: 1, active: true }
      ],
      updatedAt: serverTimestamp()
    });
  }

  async applyOrgSeedConfig(orgId: string, seed: any): Promise<void> {
    const orgBase = `organizations/${orgId}`;

    // 1. Limpiar colecciones existentes + sus datos
    const colDefsSnap = await getDocs(collection(this.db, orgBase, '_collections'));
    for (const colDoc of colDefsSnap.docs) {
      const slug: string = colDoc.data()['slug'];
      if (slug) {
        const dataSnap = await getDocs(collection(this.db, orgBase, slug));
        for (let i = 0; i < dataSnap.docs.length; i += 400) {
          const batch = writeBatch(this.db);
          dataSnap.docs.slice(i, i + 400).forEach(d => batch.delete(d.ref));
          await batch.commit();
        }
      }
      await deleteDoc(colDoc.ref);
    }

    // 2. Limpiar flujos
    const flowsSnap = await getDocs(collection(this.db, orgBase, 'flows'));
    for (let i = 0; i < flowsSnap.docs.length; i += 400) {
      const batch = writeBatch(this.db);
      flowsSnap.docs.slice(i, i + 400).forEach(d => batch.delete(d.ref));
      await batch.commit();
    }

    // 3. Limpiar botMessages
    const botMsgSnap = await getDocs(collection(this.db, orgBase, 'botMessages'));
    for (let i = 0; i < botMsgSnap.docs.length; i += 400) {
      const batch = writeBatch(this.db);
      botMsgSnap.docs.slice(i, i + 400).forEach(d => batch.delete(d.ref));
      await batch.commit();
    }

    // 4. Crear flujos y construir mapa nombre→nuevo ID
    const flowNameToId: { [name: string]: string } = {};
    if (seed.flows?.length) {
      for (const flow of seed.flows) {
        const newRef = await addDoc(collection(this.db, orgBase, 'flows'), {
          ...flow,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp()
        });
        if (flow.name) flowNameToId[flow.name] = newRef.id;
      }
    }

    // 5. Crear definiciones de colecciones
    if (seed.collections?.length) {
      for (const col of seed.collections) {
        await addDoc(collection(this.db, orgBase, '_collections'), {
          ...col,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp()
        });
      }
    }

    // 6. Crear menú (resolviendo flowName → nuevo flowId)
    if (seed.menu) {
      const menuItems = (seed.menu.items || []).map((item: any) => {
        if (item.type === 'flow' && item.flowName) {
          const { flowName, ...rest } = item;
          return { ...rest, flowId: flowNameToId[flowName] || '' };
        }
        return item;
      });
      await setDoc(doc(this.db, orgBase, 'config', 'menu'), {
        ...seed.menu,
        items: menuItems,
        updatedAt: serverTimestamp()
      });
    }

    // 7. Crear botMessages
    if (seed.botMessages?.length) {
      for (const msg of seed.botMessages) {
        await addDoc(collection(this.db, orgBase, 'botMessages'), {
          ...msg,
          createdAt: serverTimestamp()
        });
      }
    }

    // 8. Actualizar info (NO toca config/general ni config/whatsapp)
    if (seed.info?.contact) {
      await setDoc(doc(this.db, orgBase, 'info', 'contact'), {
        ...seed.info.contact,
        updatedAt: serverTimestamp()
      });
    }
    if (seed.info?.schedule) {
      await setDoc(doc(this.db, orgBase, 'info', 'schedule'), {
        ...seed.info.schedule,
        updatedAt: serverTimestamp()
      });
    }
    if (seed.info?.general) {
      await setDoc(doc(this.db, orgBase, 'info', 'general'), {
        ...seed.info.general,
        updatedAt: serverTimestamp()
      });
    }
  }

  async getCollectionData(slug: string, limitCount?: number): Promise<any[]> {
    const constraints: QueryConstraint[] = [orderBy('createdAt', 'desc')];
    if (limitCount) constraints.push(limit(limitCount));
    return this.getCollection(slug, constraints);
  }

  async addCollectionItem(slug: string, data: DocumentData): Promise<string> {
    return this.addDocument(slug, data);
  }

  async updateCollectionItem(slug: string, itemId: string, data: DocumentData): Promise<void> {
    await this.updateDocument(slug, itemId, data);
  }

  async deleteCollectionItem(slug: string, itemId: string): Promise<void> {
    await this.deleteDocument(slug, itemId);
  }

  async copyCollectionDef(source: any, newName: string, newSlug: string, withData: boolean): Promise<void> {
    const orgId = this.getOrgId();
    // Create new collection definition (strip id)
    const newDef = { ...source, name: newName, slug: newSlug };
    delete newDef.id;
    await this.addDocument('_collections', newDef);

    if (withData) {
      const srcSnap = await getDocs(collection(this.db, `organizations/${orgId}/${source.slug}`));
      const destRef = collection(this.db, `organizations/${orgId}/${newSlug}`);
      for (let i = 0; i < srcSnap.docs.length; i += 500) {
        const batch = writeBatch(this.db);
        srcSnap.docs.slice(i, i + 500).forEach(d => {
          batch.set(doc(destRef), d.data());
        });
        await batch.commit();
      }
    }
  }

  async batchWriteCollectionItems(
    slug: string,
    items: any[],
    mode: 'overwrite' | 'merge',
    uniqueField?: string
  ): Promise<{ added: number; updated: number }> {
    const orgId = this.getOrgId();
    const colRef = collection(this.db, `organizations/${orgId}/${slug}`);

    if (mode === 'overwrite') {
      const existing = await getDocs(colRef);
      for (let i = 0; i < existing.docs.length; i += 500) {
        const batch = writeBatch(this.db);
        existing.docs.slice(i, i + 500).forEach(d => batch.delete(d.ref));
        await batch.commit();
      }
      for (let i = 0; i < items.length; i += 500) {
        const batch = writeBatch(this.db);
        items.slice(i, i + 500).forEach(item => {
          const newRef = doc(colRef);
          batch.set(newRef, { ...item, active: true, createdAt: serverTimestamp() });
        });
        await batch.commit();
      }
      return { added: items.length, updated: 0 };
    }

    // Merge mode
    let added = 0, updated = 0;
    const existingMap: Record<string, string> = {};
    if (uniqueField) {
      const existing = await getDocs(colRef);
      existing.docs.forEach(d => {
        const val = d.data()[uniqueField];
        if (val !== undefined && val !== null) {
          existingMap[String(val)] = d.id;
        }
      });
    }

    for (let i = 0; i < items.length; i += 500) {
      const batch = writeBatch(this.db);
      items.slice(i, i + 500).forEach(item => {
        const fieldVal = uniqueField ? String(item[uniqueField] ?? '') : '';
        const existingId = uniqueField ? existingMap[fieldVal] : undefined;
        if (existingId) {
          const ref = doc(this.db, `organizations/${orgId}/${slug}/${existingId}`);
          batch.update(ref, { ...item, updatedAt: serverTimestamp() });
          updated++;
        } else {
          const newRef = doc(colRef);
          batch.set(newRef, { ...item, active: true, createdAt: serverTimestamp() });
          added++;
        }
      });
      await batch.commit();
    }
    return { added, updated };
  }

  // ==================== FLOW SUBMISSIONS ====================

  async clearCollectionData(slug: string): Promise<number> {
    const colRef = collection(this.db, this.orgPath(), slug);
    const snap = await getDocs(colRef);
    let deleted = 0;
    for (let i = 0; i < snap.docs.length; i += 400) {
      const batch = writeBatch(this.db);
      snap.docs.slice(i, i + 400).forEach(d => { batch.delete(d.ref); deleted++; });
      await batch.commit();
    }
    return deleted;
  }

  async getFlowSubmissions(collectionName: string): Promise<any[]> {
    const items = await this.getCollection(collectionName);
    return items.sort((a, b) => {
      const dateA = a.createdAt?.seconds || 0;
      const dateB = b.createdAt?.seconds || 0;
      return dateB - dateA;
    });
  }

  // ==================== CONVERSATIONS ====================

  async getConversations(): Promise<any[]> {
    const colRef = collection(this.db, this.orgPath(), 'conversations');
    const q = query(colRef, orderBy('lastMessageAt', 'desc'));
    const snapshot = await getDocs(q);
    return snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
  }

  async getConversationMessages(phoneNumber: string, limitCount = 100): Promise<any[]> {
    const cleanPhone = phoneNumber.replace(/\D/g, '');
    const colRef = collection(this.db, this.orgPath(), 'conversations', cleanPhone, 'messages');
    const q = query(colRef, orderBy('timestamp', 'asc'));
    const snapshot = await getDocs(q);
    return snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
  }

  onConversationMessages(
    phoneNumber: string,
    callback: (msgs: any[]) => void,
    sinceMs?: number
  ): Unsubscribe {
    const cleanPhone = phoneNumber.replace(/\D/g, '');
    const colRef = collection(this.db, this.orgPath(), 'conversations', cleanPhone, 'messages');
    // Para modo delivery: filtrar por createdMs en Firestore para que onSnapshot
    // capture siempre los mensajes nuevos sin importar cuántos mensajes históricos haya
    const q = sinceMs
      ? query(colRef, where('createdMs', '>=', sinceMs), orderBy('createdMs', 'asc'))
      : query(colRef, orderBy('timestamp', 'asc'), limit(100));
    return onSnapshot(q, (snapshot) => {
      const msgs = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
      callback(msgs);
    });
  }

  onConversationsChange(callback: (convs: any[]) => void): Unsubscribe {
    const colRef = collection(this.db, this.orgPath(), 'conversations');
    const q = query(colRef, orderBy('lastMessageAt', 'desc'), limit(100));
    return onSnapshot(q, (snapshot) => {
      const convs = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
      callback(convs);
    });
  }

  async markConversationRead(phoneNumber: string): Promise<void> {
    const cleanPhone = phoneNumber.replace(/\D/g, '');
    const docRef = doc(this.db, this.orgPath(), 'conversations', cleanPhone);
    await updateDoc(docRef, { unreadCount: 0 });
  }

  async clearConversationMessages(phoneNumber: string): Promise<void> {
    const cleanPhone = phoneNumber.replace(/\D/g, '');
    const colRef = collection(this.db, this.orgPath(), 'conversations', cleanPhone, 'messages');
    const snapshot = await getDocs(colRef);
    if (snapshot.empty) return;
    const batch = writeBatch(this.db);
    snapshot.docs.forEach(d => batch.delete(d.ref));
    await batch.commit();
  }

  async deleteConversation(phoneNumber: string): Promise<void> {
    const cleanPhone = phoneNumber.replace(/\D/g, '');
    // Delete messages subcollection first
    const msgsRef = collection(this.db, this.orgPath(), 'conversations', cleanPhone, 'messages');
    const msgsSnap = await getDocs(msgsRef);
    if (!msgsSnap.empty) {
      const batch = writeBatch(this.db);
      msgsSnap.docs.forEach(d => batch.delete(d.ref));
      await batch.commit();
    }
    // Delete conversation doc
    const convRef = doc(this.db, this.orgPath(), 'conversations', cleanPhone);
    await deleteDoc(convRef);
  }

  // ==================== DELIVERY LOCATIONS ====================

  async updateDeliveryLocation(userId: string, data: {
    userId: string; userName: string; lat: number; lng: number;
    status: 'available' | 'active';
    activeCaseId: string | null; activeCollection: string | null; activePhone: string | null;
    vehicleType?: string;
  }): Promise<void> {
    const docRef = doc(this.db, this.orgPath(), 'delivery_locations', userId);
    await setDoc(docRef, { ...data, updatedAt: serverTimestamp() }, { merge: true });
  }

  async updateDeliveryVehicleType(userId: string, vehicleType: string): Promise<void> {
    const docRef = doc(this.db, this.orgPath(), 'delivery_locations', userId);
    await setDoc(docRef, { vehicleType }, { merge: true });
  }

  async clearDeliveryLocation(userId: string): Promise<void> {
    try {
      const docRef = doc(this.db, this.orgPath(), 'delivery_locations', userId);
      await deleteDoc(docRef);
    } catch { /* silent */ }
  }

  watchDeliveryLocations(callback: (users: any[]) => void): () => void {
    const colRef = collection(this.db, this.orgPath(), 'delivery_locations');
    const STALE_MS = 5 * 60 * 1000; // 5 minutos — los deliveries actualizan cada 15s
    return onSnapshot(colRef, (snap) => {
      const now = Date.now();
      const users = snap.docs
        .map(d => ({ id: d.id, ...d.data() }))
        .filter((u: any) => {
          const updatedMs = u.updatedAt?.toMillis?.() ?? (u.updatedAt?.seconds ? u.updatedAt.seconds * 1000 : null);
          return updatedMs && (now - updatedMs) < STALE_MS;
        });
      callback(users);
    });
  }

  watchUserVehicleType(uid: string, callback: (vehicleType: string) => void): () => void {
    const docRef = doc(this.db, 'users', uid);
    return onSnapshot(docRef, (snap) => {
      if (snap.exists()) {
        const vehicleType = snap.data()['vehicleType'] || '';
        callback(vehicleType);
      }
    });
  }

  // ==================== PROMO ORDERS ====================

  watchCampaigns(callback: (campaigns: any[]) => void): () => void {
    const colRef = collection(this.db, this.orgPath(), 'campaigns');
    const q = query(colRef, where('actionKeywordEnabled', '==', true));
    return onSnapshot(q, (snap) => {
      const campaigns = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      callback(campaigns);
    });
  }

  watchPromoOrders(callback: (orders: any[]) => void): () => void {
    const colRef = collection(this.db, this.orgPath(), 'promo_orders');
    return onSnapshot(colRef, (snap) => {
      const orders = snap.docs
        .map(d => ({ id: d.id, ...d.data() }))
        .filter((o: any) => o.status !== 'resolved'  /* resolved = oculto; cancelled = histórico */)
        .sort((a: any, b: any) => {
          const ta = a.createdAt?.seconds || 0;
          const tb = b.createdAt?.seconds || 0;
          return tb - ta;
        });
      callback(orders);
    });
  }

  async takePromoOrder(
    orderId: string,
    agent: { uid: string; name: string; email: string; deliveryCode?: string },
    startCoords?: { lat: number; lng: number } | null
  ): Promise<{ ok: boolean; takenBy?: string; reason?: string; commission?: number; balance?: number }> {
    const commission = await this.getCommissionFor('promo');
    const ref = doc(this.db, this.orgPath(), 'promo_orders', orderId);
    const walletRef = doc(this.db, this.orgPath(), 'delivery_wallets', agent.uid);
    const ledgerRef = doc(collection(this.db, this.orgPath(), 'credit_transactions'));
    let takenBy: string | undefined;
    let reason: string | undefined;
    let balance = 0;
    const ok = await runTransaction(this.db, async (transaction) => {
      const snap = await transaction.get(ref);
      if (!snap.exists()) { reason = 'not_found'; return false; }
      const data = snap.data();
      if (data['status'] === 'taken') { takenBy = data['assignedTo']?.name || 'otro Delivery'; reason = 'taken'; return false; }
      let fromPaid = 0, fromGift = 0, newPaid = 0, newGift = 0;
      if (commission > 0) {
        const wSnap = await transaction.get(walletRef);
        const pools = this.walletPools(wSnap.exists() ? wSnap.data() : null);
        balance = pools.paid + pools.gift;
        if (balance < commission) { reason = 'insufficient_credit'; return false; }
        fromGift = Math.min(pools.gift, commission);   // cortesía primero
        fromPaid = commission - fromGift;
        newGift = pools.gift - fromGift;
        newPaid = pools.paid - fromPaid;
      }
      const updateData: any = {
        status: 'taken',
        assignedTo: agent,
        takenAt: serverTimestamp(),
        ...(startCoords && { startLat: startCoords.lat, startLng: startCoords.lng })
      };
      if (commission > 0) {
        const newBalance = newPaid + newGift;
        updateData.commissionCharged = commission;
        updateData.commissionFromPaid = fromPaid;
        updateData.commissionFromGift = fromGift;
        transaction.update(ref, updateData);
        transaction.set(walletRef, { uid: agent.uid, paidBalance: newPaid, giftBalance: newGift, balance: newBalance, updatedAt: serverTimestamp() }, { merge: true });
        transaction.set(ledgerRef, {
          deliveryUid: agent.uid, deliveryName: agent.name || '', type: 'debit',
          amount: commission, fromPaid, fromGift, balanceAfter: newBalance, orderId, collection: 'promo',
          reason: 'Comisión por tomar pedido promo', createdAt: serverTimestamp()
        });
        balance = newBalance;
      } else {
        transaction.update(ref, updateData);
      }
      return true;
    });
    return { ok, takenBy, reason, commission, balance };
  }

  async resolvePromoOrder(orderId: string): Promise<void> {
    const ref = doc(this.db, this.orgPath(), 'promo_orders', orderId);
    await updateDoc(ref, { status: 'resolved' });
  }

  async getPromoOrder(orderId: string): Promise<any | null> {
    const ref = doc(this.db, this.orgPath(), 'promo_orders', orderId);
    const snap = await getDoc(ref);
    return snap.exists() ? { id: snap.id, ...snap.data() } : null;
  }

  async cancelPromoOrder(orderId: string, reason?: string): Promise<void> {
    const ref = doc(this.db, this.orgPath(), 'promo_orders', orderId);
    const snap = await getDoc(ref);
    if (!snap.exists()) return;
    const d = snap.data();
    const charged = d['commissionCharged'] || 0;
    const delUid = d['assignedTo']?.uid || '';
    const delName = d['assignedTo']?.name || '';
    const data: any = { status: 'cancelled', cancelledAt: serverTimestamp() };
    if (reason) data['cancelReason'] = reason;
    if (charged > 0 && delUid) data['refundRequested'] = true;
    await updateDoc(ref, data);
    if (charged > 0 && delUid) {
      await this.createRefundRequest({
        orderId, collection: 'promo', deliveryUid: delUid, deliveryName: delName,
        amount: charged, fromPaid: d['commissionFromPaid'], fromGift: d['commissionFromGift'],
        reason: reason || 'Pedido promo cancelado'
      });
    }
  }

  // ==================== DELIVERY HISTORY ====================

  async addDeliveryHistory(data: {
    status: 'completed' | 'cancelled';
    startLat: number | null; startLng: number | null;
    endLat: number | null; endLng: number | null;
    deliveryAgent: { uid: string; name: string; email: string };
    clientPhone: string; clientName: string;
    type: 'promo' | 'submission';
    promoOrderId?: string; campaignId?: string; campaignName?: string;
    imageUrl?: string; promoMessage?: string;
    submissionId?: string; collection?: string;
    cancelReason?: string;
    takenAt?: number;
  }): Promise<void> {
    const colRef = collection(this.db, this.orgPath(), 'delivery_history');
    await addDoc(colRef, { ...data, completedAt: serverTimestamp() });
  }

  watchDeliveryHistory(
    callback: (records: any[]) => void,
    fromMs?: number,
    toMs?: number,
    limitCount = 200
  ): () => void {
    const colRef = collection(this.db, this.orgPath(), 'delivery_history');
    const constraints: QueryConstraint[] = [orderBy('completedAt', 'desc')];
    if (fromMs) constraints.push(where('completedAt', '>=', Timestamp.fromMillis(fromMs)));
    if (toMs)   constraints.push(where('completedAt', '<=', Timestamp.fromMillis(toMs)));
    constraints.push(limit(limitCount));
    const q = query(colRef, ...constraints);
    return onSnapshot(q, (snap) => {
      callback(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    });
  }

  // ==================== PLATFORM (SUPER ADMIN) ====================

  async getAllOrganizations(): Promise<any[]> {
    const colRef = collection(this.db, 'organizations');
    const snapshot = await getDocs(colRef);
    return snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
  }

  async killAllSessions(): Promise<number> {
    const orgsSnap = await getDocs(collection(this.db, 'organizations'));
    let count = 0;
    for (const orgDoc of orgsSnap.docs) {
      const convsSnap = await getDocs(collection(this.db, 'organizations', orgDoc.id, 'conversations'));
      for (const convDoc of convsSnap.docs) {
        if (convDoc.data()['session']) {
          await updateDoc(convDoc.ref, { session: deleteField() });
          count++;
        }
      }
    }
    return count;
  }

  /**
   * Índice público slug → orgId + nombre/logo (colección `orgPublicSlugs`).
   * La página /admin/login/:slug se abre sin sesión: las reglas suelen bloquear `organizations`,
   * pero este documento debe ser legible con `allow read: if true`.
   *
   * Añade en Firestore Rules (dentro de `match /databases/{database}/documents`):
   *   match /orgPublicSlugs/{slug} {
   *     allow read: if true;
   *     allow write: if request.auth != null;
   *   }
   */
  private readonly orgPublicSlugsCol = 'orgPublicSlugs';

  /**
   * Índice público del slug → org (nombre/logo para la pantalla de login sin estar logueado).
   */
  async syncPublicOrgLoginSlug(params: {
    orgId: string;
    slug: string | null;
    previousSlug: string | null;
    orgName: string;
    orgLogo: string | null;
  }): Promise<void> {
    const prev = (params.previousSlug || '').trim().toLowerCase().replace(/[^a-z0-9-]/g, '-') || null;
    const next = (params.slug || '').trim().toLowerCase().replace(/[^a-z0-9-]/g, '-') || null;

    if (prev && prev !== next) {
      try {
        await deleteDoc(doc(this.db, this.orgPublicSlugsCol, prev));
      } catch (e) {
        console.warn('[syncPublicOrgLoginSlug] delete old', e);
      }
    }

    if (!next) {
      return;
    }

    await setDoc(
      doc(this.db, this.orgPublicSlugsCol, next),
      {
        orgId: params.orgId,
        orgName: params.orgName || params.orgId,
        orgLogo: params.orgLogo || null,
        updatedAt: serverTimestamp()
      },
      { merge: true }
    );
  }

  /**
   * Resuelve organización por slug: primero índice público (funciona sin auth), luego organizations.
   */
  async getOrgByLoginSlug(slug: string): Promise<any | null> {
    const normalized = (slug || '').trim().toLowerCase().replace(/[^a-z0-9-]/g, '-');
    if (!normalized) return null;

    try {
      const pub = await getDoc(doc(this.db, this.orgPublicSlugsCol, normalized));
      if (pub.exists()) {
        const d = pub.data();
        const orgId = d['orgId'] as string;
        if (orgId) {
          return {
            id: orgId,
            orgName: d['orgName'] || orgId,
            orgLogo: d['orgLogo'] || '',
            loginSlug: normalized
          };
        }
      }
    } catch (e) {
      console.warn('[getOrgByLoginSlug] public slug doc', e);
    }

    try {
      const colRef = collection(this.db, 'organizations');
      const q = query(colRef, where('loginSlug', '==', normalized));
      const snapshot = await getDocs(q);
      if (!snapshot.empty) {
        const d = snapshot.docs[0];
        return { id: d.id, ...d.data() };
      }
    } catch (e) {
      console.warn('[getOrgByLoginSlug] query', e);
    }

    try {
      const byId = await this.getOrganization(normalized);
      if (byId?.loginSlug === normalized) {
        return byId;
      }
    } catch (e) {
      console.warn('[getOrgByLoginSlug] get by id', e);
    }

    return null;
  }

  async updateOrganization(orgId: string, data: DocumentData): Promise<void> {
    const docRef = doc(this.db, 'organizations', orgId);
    // merge: true — crea el doc raíz si aún no existe (solo subcolecciones); updateDoc fallaría y no guardaría loginSlug
    await setDoc(docRef, { ...data, updatedAt: serverTimestamp() }, { merge: true });
  }

  async getOrgConfigByOrgId(orgId: string): Promise<any | null> {
    const docRef = doc(this.db, 'organizations', orgId, 'config', 'general');
    const snap = await getDoc(docRef);
    return snap.exists() ? snap.data() : null;
  }

  async getPublicOrgInfo(orgId: string): Promise<any | null> {
    const docRef = doc(this.db, 'organizations', orgId, 'public', 'info');
    const snap = await getDoc(docRef);
    return snap.exists() ? snap.data() : null;
  }

  // ==================== WEB DELIVERY ====================

  async getWebDeliveryItems(flowId: string): Promise<any[]> {
    const colRef = collection(this.db, this.orgPath(), 'webdelivery');
    const q = query(colRef, where('flowId', '==', flowId));
    const snap = await getDocs(q);
    return snap.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .sort((a: any, b: any) => (a.createdAt?.seconds || 0) - (b.createdAt?.seconds || 0));
  }

  async addWebDeliveryItem(flowId: string, data: DocumentData): Promise<string> {
    return this.addDocument('webdelivery', { ...data, flowId });
  }

  async updateWebDeliveryItem(itemId: string, data: DocumentData): Promise<void> {
    await this.updateDocument('webdelivery', itemId, data);
  }

  async deleteWebDeliveryItem(itemId: string): Promise<void> {
    await this.deleteDocument('webdelivery', itemId);
  }

  async syncPublicStore(flowId: string): Promise<void> {
    const orgId = this.getOrgId();
    const [items, flow, publicInfo] = await Promise.all([
      this.getWebDeliveryItems(flowId),
      this.getFlow(flowId),
      getDoc(doc(this.db, 'organizations', orgId, 'public', 'info')),
    ]);
    if (!flow) return;
    const waPhone = (publicInfo.exists() ? (publicInfo.data() as any)?.waPhone : '') || '';
    const webSteps = (flow.steps || [])
      .filter((s: any) => s.source === 'web')
      .map((s: any) => ({
        id: s.id, type: s.type, prompt: s.prompt,
        fieldKey: s.fieldKey, fieldLabel: s.fieldLabel,
        required: s.required !== false,
        customOptions: s.customOptions || [],
        optionsSource: s.optionsSource || 'custom',
      }));
    const storeDoc = doc(this.db, 'organizations', orgId, 'public', 'stores');
    await setDoc(
      doc(this.db, 'organizations', orgId, 'public', 'store_' + flowId),
      {
        flowId,
        storeImage: flow.storeImage || '',
        storeColor: flow.storeColor || '#2e7d32',
        menuLabel:  flow.menuLabel  || flow.name || '',
        storeAlert: flow.storeAlert || '',
        storeAlertEnabled: flow.storeAlertEnabled === true,
        webSteps,
        products: items,
        waPhone,
        updatedAt: serverTimestamp(),
      },
      { merge: false }
    );
  }

  async getPublicStore(orgId: string, flowId: string): Promise<any | null> {
    const docRef = doc(this.db, 'organizations', orgId, 'public', 'store_' + flowId);
    const snap = await getDoc(docRef);
    return snap.exists() ? snap.data() : null;
  }

  async saveOrderPublic(orgId: string, data: DocumentData): Promise<string> {
    const colRef = collection(this.db, 'organizations', orgId, 'orders');
    const docRef = await addDoc(colRef, { ...data, createdAt: serverTimestamp() });
    return docRef.id;
  }

  async savePublicOrgInfo(orgId: string, data: { privacyPolicy?: string; orgName?: string; orgLogo?: string; botApiUrl?: string; waPhone?: string }): Promise<void> {
    const docRef = doc(this.db, 'organizations', orgId, 'public', 'info');
    await setDoc(docRef, { ...data, updatedAt: serverTimestamp() }, { merge: true });
  }

  async getOrgAdminsByOrgId(orgId: string): Promise<any[]> {
    const colRef = collection(this.db, 'organizations', orgId, 'admins');
    const snapshot = await getDocs(colRef);
    return snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
  }

  async getWhatsAppConfigByOrgId(orgId: string): Promise<any | null> {
    const docRef = doc(this.db, 'organizations', orgId, 'config', 'whatsapp');
    const snap = await getDoc(docRef);
    return snap.exists() ? snap.data() : null;
  }

  async saveWhatsAppConfigByOrgId(orgId: string, data: DocumentData): Promise<void> {
    const docRef = doc(this.db, 'organizations', orgId, 'config', 'whatsapp');
    await setDoc(docRef, { ...data, updatedAt: serverTimestamp() }, { merge: true });
  }

  async saveOrgConfigByOrgId(orgId: string, data: DocumentData): Promise<void> {
    const docRef = doc(this.db, 'organizations', orgId, 'config', 'general');
    await setDoc(docRef, { ...data, updatedAt: serverTimestamp() }, { merge: true });
  }

  async getGoogleCalendarConfigByOrgId(orgId: string): Promise<any | null> {
    const docRef = doc(this.db, 'organizations', orgId, 'config', 'googleCalendar');
    const snap = await getDoc(docRef);
    return snap.exists() ? snap.data() : null;
  }

  async saveGoogleCalendarConfigByOrgId(orgId: string, data: DocumentData): Promise<void> {
    const docRef = doc(this.db, 'organizations', orgId, 'config', 'googleCalendar');
    await setDoc(docRef, { ...data, updatedAt: serverTimestamp() }, { merge: true });
  }

  async uploadFileByPath(file: File, path: string): Promise<string> {
    const storageRef = ref(this.storage, path);
    await uploadBytes(storageRef, file);
    return getDownloadURL(storageRef);
  }

  async getPlatformBilling(): Promise<any[]> {
    const colRef = collection(this.db, 'platformBilling');
    const q = query(colRef, orderBy('createdAt', 'desc'));
    const snapshot = await getDocs(q);
    return snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
  }

  async addPlatformBilling(data: DocumentData): Promise<string> {
    const colRef = collection(this.db, 'platformBilling');
    const docRef = await addDoc(colRef, { ...data, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
    return docRef.id;
  }

  async updatePlatformBilling(billingId: string, data: DocumentData): Promise<void> {
    const docRef = doc(this.db, 'platformBilling', billingId);
    await updateDoc(docRef, { ...data, updatedAt: serverTimestamp() });
  }

  async deletePlatformBilling(billingId: string): Promise<void> {
    const docRef = doc(this.db, 'platformBilling', billingId);
    await deleteDoc(docRef);
  }

  async getPlatformClients(): Promise<{ name: string; logo: string }[]> {
    const snap = await getDoc(doc(this.db, 'platformConfig', 'clients'));
    return snap.exists() ? (snap.data()?.['clients'] ?? []) : [];
  }

  async savePlatformClients(clients: { name: string; logo: string }[]): Promise<void> {
    await setDoc(doc(this.db, 'platformConfig', 'clients'), { clients, updatedAt: serverTimestamp() }, { merge: true });
  }

  async getPlatformPlans(): Promise<any | null> {
    const docRef = doc(this.db, 'platformConfig', 'plans');
    const snap = await getDoc(docRef);
    return snap.exists() ? snap.data() : null;
  }

  async savePlatformPlans(plans: any[]): Promise<void> {
    const docRef = doc(this.db, 'platformConfig', 'plans');
    await setDoc(docRef, { plans, updatedAt: serverTimestamp() }, { merge: true });
  }

  async savePlatformPlansMeta(meta: { sectionTitle: string; sectionDesc: string }): Promise<void> {
    const docRef = doc(this.db, 'platformConfig', 'plans');
    await setDoc(docRef, { ...meta, updatedAt: serverTimestamp() }, { merge: true });
  }

  // ==================== STORAGE ====================

  async uploadFile(file: File, path: string): Promise<string> {
    const storageRef = ref(this.storage, path);
    await uploadBytes(storageRef, file);
    return getDownloadURL(storageRef);
  }

  async uploadBlob(blob: Blob, path: string, contentType: string): Promise<string> {
    const storageRef = ref(this.storage, path);
    await uploadBytes(storageRef, blob, { contentType });
    return getDownloadURL(storageRef);
  }

  async uploadOrgLogo(file: File): Promise<string> {
    const ext = file.name.split('.').pop() || 'png';
    const path = `organizations/${this.getOrgId()}/logo.${ext}`;
    return this.uploadFile(file, path);
  }

  async deleteFile(path: string): Promise<void> {
    try {
      const storageRef = ref(this.storage, path);
      await deleteObject(storageRef);
    } catch (e: any) {
      if (e?.code !== 'storage/object-not-found') throw e;
    }
  }

  // ==================== DELETE ORGANIZATION (full) ====================

  async deleteOrganizationFull(orgId: string): Promise<{ deletedUsers: string[] }> {
    const orgDocRef = doc(this.db, 'organizations', orgId);
    const deletedUsers: string[] = [];

    const deleteSubcollection = async (parentRef: any, subName: string) => {
      const colRef = collection(this.db, parentRef.path, subName);
      const snap = await getDocs(colRef);
      for (const d of snap.docs) {
        await deleteDoc(d.ref);
      }
      return snap.size;
    };

    const deleteConversationsNested = async () => {
      const convsRef = collection(this.db, orgDocRef.path, 'conversations');
      const convsSnap = await getDocs(convsRef);
      let total = 0;
      for (const convDoc of convsSnap.docs) {
        const msgsRef = collection(this.db, convDoc.ref.path, 'messages');
        const msgsSnap = await getDocs(msgsRef);
        for (const msgDoc of msgsSnap.docs) {
          await deleteDoc(msgDoc.ref);
        }
        await deleteDoc(convDoc.ref);
        total += msgsSnap.size + 1;
      }
      return total;
    };

    // 1. Delete all known subcollections
    const knownSubcollections = [
      '_collections', 'flows', 'botMessages', 'admins',
      'contacts', 'clients', 'programs', 'instruments',
      'applicants', 'students', 'teacherRequests',
      'inquiries', 'programas', 'instrumentos', 'aspirantes',
      'consultas', 'citas', 'courseTypes'
    ];
    for (const sub of knownSubcollections) {
      await deleteSubcollection(orgDocRef, sub);
    }

    // Also delete dynamic collection data by reading _collections defs first
    // (already deleted defs above, but data slugs may differ)

    // 2. Delete config docs
    const configDocs = ['general', 'menu', 'whatsapp'];
    for (const docName of configDocs) {
      const d = doc(this.db, orgDocRef.path, 'config', docName);
      try { await deleteDoc(d); } catch (_) {}
    }

    // 3. Delete info docs
    const infoDocs = ['contact', 'schedule', 'general'];
    for (const docName of infoDocs) {
      const d = doc(this.db, orgDocRef.path, 'info', docName);
      try { await deleteDoc(d); } catch (_) {}
    }

    // 4. Delete conversations (with nested messages)
    await deleteConversationsNested();

    // 5. Delete Storage files under organizations/{orgId}/
    try {
      const folderRef = ref(this.storage, `organizations/${orgId}`);
      const fileList = await listAll(folderRef);
      for (const item of fileList.items) {
        await deleteObject(item);
      }
      for (const prefix of fileList.prefixes) {
        const subList = await listAll(prefix);
        for (const item of subList.items) {
          await deleteObject(item);
        }
      }
    } catch (e: any) {
      if (e?.code !== 'storage/object-not-found') {
        console.warn('Storage cleanup partial:', e);
      }
    }

    // 6. Delete user documents referencing this org
    const usersRef = collection(this.db, 'users');
    const usersQuery = query(usersRef, where('organizationId', '==', orgId));
    const usersSnap = await getDocs(usersQuery);
    for (const userDoc of usersSnap.docs) {
      deletedUsers.push(userDoc.data()['email'] || userDoc.id);
      await deleteDoc(userDoc.ref);
    }

    // 7. Delete billing records for this org
    const billingRef = collection(this.db, 'platformBilling');
    const billingQuery = query(billingRef, where('orgId', '==', orgId));
    const billingSnap = await getDocs(billingQuery);
    for (const bDoc of billingSnap.docs) {
      await deleteDoc(bDoc.ref);
    }

    // 8. Delete the organization document itself
    await deleteDoc(orgDocRef);

    return { deletedUsers };
  }

  // ── Export / Import ──────────────────────────────────────────────────────

  private stripTimestamps(obj: any): any {
    if (!obj || typeof obj !== 'object') return obj;
    if (Array.isArray(obj)) return obj.map(v => this.stripTimestamps(v));
    const result: any = {};
    for (const [k, v] of Object.entries(obj)) {
      if (k === 'createdAt' || k === 'updatedAt') continue;
      if (v && typeof v === 'object' && typeof (v as any).toDate === 'function') continue;
      result[k] = this.stripTimestamps(v);
    }
    return result;
  }

  async exportOrgData(orgId: string): Promise<any> {
    const orgBase = `organizations/${orgId}`;

    const [orgDoc, configGenDoc, configWaDoc, configMenuDoc] = await Promise.all([
      getDoc(doc(this.db, 'organizations', orgId)),
      getDoc(doc(this.db, orgBase, 'config', 'general')),
      getDoc(doc(this.db, orgBase, 'config', 'whatsapp')),
      getDoc(doc(this.db, orgBase, 'config', 'menu'))
    ]);

    const flowsSnap = await getDocs(collection(this.db, orgBase, 'flows'));
    const flows = flowsSnap.docs.map(d => ({ id: d.id, data: this.stripTimestamps(d.data()) }));

    const colDefsSnap = await getDocs(collection(this.db, orgBase, '_collections'));
    const collections = colDefsSnap.docs.map(d => ({ id: d.id, data: this.stripTimestamps(d.data()) }));

    const collectionData: any = {};
    for (const colDoc of colDefsSnap.docs) {
      const slug: string = colDoc.data()['slug'];
      if (slug) {
        const dataSnap = await getDocs(collection(this.db, orgBase, slug));
        collectionData[slug] = dataSnap.docs.map(d => ({ id: d.id, data: this.stripTimestamps(d.data()) }));
      }
    }

    const botMsgSnap = await getDocs(collection(this.db, orgBase, 'botMessages'));
    const botMessages = botMsgSnap.docs.map(d => ({ id: d.id, data: this.stripTimestamps(d.data()) }));

    const [contactDoc, scheduleDoc, infoGenDoc] = await Promise.all([
      getDoc(doc(this.db, orgBase, 'info', 'contact')),
      getDoc(doc(this.db, orgBase, 'info', 'schedule')),
      getDoc(doc(this.db, orgBase, 'info', 'general'))
    ]);

    const adminsSnap = await getDocs(collection(this.db, orgBase, 'admins'));
    const admins = adminsSnap.docs.map(d => ({ id: d.id, data: this.stripTimestamps(d.data()) }));

    return {
      id: orgId,
      data: orgDoc.exists() ? this.stripTimestamps(orgDoc.data()) : {},
      config: {
        general: configGenDoc.exists() ? this.stripTimestamps(configGenDoc.data()) : null,
        whatsapp: configWaDoc.exists() ? this.stripTimestamps(configWaDoc.data()) : null,
        menu: configMenuDoc.exists() ? this.stripTimestamps(configMenuDoc.data()) : null
      },
      flows,
      collections,
      collectionData,
      botMessages,
      info: {
        contact: contactDoc.exists() ? this.stripTimestamps(contactDoc.data()) : null,
        schedule: scheduleDoc.exists() ? this.stripTimestamps(scheduleDoc.data()) : null,
        general: infoGenDoc.exists() ? this.stripTimestamps(infoGenDoc.data()) : null
      },
      admins
    };
  }

  async importOrgData(orgExport: any, overwrite: boolean): Promise<void> {
    const orgId: string = orgExport.id;
    const orgBase = `organizations/${orgId}`;

    if (!overwrite) {
      const existing = await getDoc(doc(this.db, 'organizations', orgId));
      if (existing.exists()) throw new Error(`La organización "${orgId}" ya existe`);
    }

    // Org doc
    await setDoc(doc(this.db, 'organizations', orgId), {
      ...orgExport.data,
      updatedAt: serverTimestamp()
    });

    // Config docs
    if (orgExport.config?.general) {
      await setDoc(doc(this.db, orgBase, 'config', 'general'), { ...orgExport.config.general, updatedAt: serverTimestamp() });
    }
    if (orgExport.config?.whatsapp) {
      await setDoc(doc(this.db, orgBase, 'config', 'whatsapp'), { ...orgExport.config.whatsapp, updatedAt: serverTimestamp() });
    }
    if (orgExport.config?.menu) {
      await setDoc(doc(this.db, orgBase, 'config', 'menu'), { ...orgExport.config.menu, updatedAt: serverTimestamp() });
    }

    // Clear + recreate flows (preserve original IDs so menu flowId refs stay valid)
    const existingFlows = await getDocs(collection(this.db, orgBase, 'flows'));
    for (let i = 0; i < existingFlows.docs.length; i += 400) {
      const batch = writeBatch(this.db);
      existingFlows.docs.slice(i, i + 400).forEach(d => batch.delete(d.ref));
      await batch.commit();
    }
    for (const flow of (orgExport.flows || [])) {
      await setDoc(doc(this.db, orgBase, 'flows', flow.id), { ...flow.data, updatedAt: serverTimestamp() });
    }

    // Clear + recreate collection defs + data
    const existingColDefs = await getDocs(collection(this.db, orgBase, '_collections'));
    for (const colDoc of existingColDefs.docs) {
      const slug: string = colDoc.data()['slug'];
      if (slug) {
        const dataSnap = await getDocs(collection(this.db, orgBase, slug));
        for (let i = 0; i < dataSnap.docs.length; i += 400) {
          const batch = writeBatch(this.db);
          dataSnap.docs.slice(i, i + 400).forEach(d => batch.delete(d.ref));
          await batch.commit();
        }
      }
      await deleteDoc(colDoc.ref);
    }
    for (const col of (orgExport.collections || [])) {
      await setDoc(doc(this.db, orgBase, '_collections', col.id), { ...col.data, updatedAt: serverTimestamp() });
    }
    for (const [slug, docs] of Object.entries(orgExport.collectionData || {})) {
      for (const item of (docs as any[])) {
        await setDoc(doc(this.db, orgBase, slug, item.id), item.data);
      }
    }

    // Clear + recreate botMessages
    const existingBotMsg = await getDocs(collection(this.db, orgBase, 'botMessages'));
    for (let i = 0; i < existingBotMsg.docs.length; i += 400) {
      const batch = writeBatch(this.db);
      existingBotMsg.docs.slice(i, i + 400).forEach(d => batch.delete(d.ref));
      await batch.commit();
    }
    for (const msg of (orgExport.botMessages || [])) {
      await setDoc(doc(this.db, orgBase, 'botMessages', msg.id), msg.data);
    }

    // Info docs
    if (orgExport.info?.contact) {
      await setDoc(doc(this.db, orgBase, 'info', 'contact'), { ...orgExport.info.contact, updatedAt: serverTimestamp() });
    }
    if (orgExport.info?.schedule) {
      await setDoc(doc(this.db, orgBase, 'info', 'schedule'), { ...orgExport.info.schedule, updatedAt: serverTimestamp() });
    }
    if (orgExport.info?.general) {
      await setDoc(doc(this.db, orgBase, 'info', 'general'), { ...orgExport.info.general, updatedAt: serverTimestamp() });
    }

    // Admins (Firestore records only — Firebase Auth users deben existir o crearse aparte)
    const existingAdmins = await getDocs(collection(this.db, orgBase, 'admins'));
    for (let i = 0; i < existingAdmins.docs.length; i += 400) {
      const batch = writeBatch(this.db);
      existingAdmins.docs.slice(i, i + 400).forEach(d => batch.delete(d.ref));
      await batch.commit();
    }
    for (const adm of (orgExport.admins || [])) {
      await setDoc(doc(this.db, orgBase, 'admins', adm.id), adm.data);
    }
  }

  // ── Campaigns ──
  async getCampaigns(orgId: string): Promise<any[]> {
    const colRef = collection(this.db, 'organizations', orgId, 'campaigns');
    const q = query(colRef, orderBy('createdAt', 'desc'));
    const snap = await getDocs(q);
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  }

  async createCampaign(orgId: string, data: any): Promise<string> {
    const colRef = collection(this.db, 'organizations', orgId, 'campaigns');
    const docRef = await addDoc(colRef, {
      ...data,
      sentTotal: 0, failedTotal: 0, sentToday: 0, sentTodayDate: '',
      optedOutPhones: [],
      createdAt: serverTimestamp(), updatedAt: serverTimestamp()
    });
    return docRef.id;
  }

  async updateCampaign(orgId: string, campaignId: string, data: any): Promise<void> {
    const docRef = doc(this.db, 'organizations', orgId, 'campaigns', campaignId);
    await setDoc(docRef, { ...data, updatedAt: serverTimestamp() }, { merge: true });
  }

  async deleteCampaign(orgId: string, campaignId: string): Promise<void> {
    const docRef = doc(this.db, 'organizations', orgId, 'campaigns', campaignId);
    await deleteDoc(docRef);
  }

  // Log de envíos individuales de una campaña (escrito por el bot en campaigns/{id}/sends)
  async getCampaignSends(orgId: string, campaignId: string): Promise<any[]> {
    const colRef = collection(this.db, 'organizations', orgId, 'campaigns', campaignId, 'sends');
    const q = query(colRef, orderBy('at', 'desc'), limit(500));
    const snap = await getDocs(q);
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  }

  // ── Facturación mensual de campañas (organizations/{orgId}/billing/{YYYY-MM}) ──
  async getOrgBilling(orgId: string): Promise<any[]> {
    const colRef = collection(this.db, 'organizations', orgId, 'billing');
    const q = query(colRef, orderBy('month', 'desc'));
    const snap = await getDocs(q);
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  }

  // Registra un abono (pago parcial o total) en el mes indicado y recalcula el estado
  async addBillingPayment(orgId: string, month: string, payment: { amount: number; note?: string }): Promise<any> {
    const docRef = doc(this.db, 'organizations', orgId, 'billing', month);
    const snap = await getDoc(docRef);
    const data: any = snap.exists() ? snap.data() : { month, sentTotal: 0, totalCost: 0 };
    const payments = Array.isArray(data['payments']) ? [...data['payments']] : [];
    payments.push({ amount: payment.amount, note: payment.note || '', at: new Date().toISOString() });
    const paidAmount = payments.reduce((s: number, p: any) => s + (Number(p.amount) || 0), 0);
    const totalCost = Number(data['totalCost']) || 0;
    const paymentStatus = paidAmount >= totalCost - 0.005 ? 'paid' : (paidAmount > 0 ? 'partial' : 'pending');
    await setDoc(docRef, { month, payments, paidAmount, paymentStatus }, { merge: true });
    return { payments, paidAmount, paymentStatus };
  }

  async setCampaignKeywordTrigger(orgId: string, campaignId: string, keyword: string, flowId: string, active: boolean): Promise<void> {
    const docRef = doc(this.db, 'organizations', orgId, 'config', 'campaign_keywords');
    const snap = await getDoc(docRef);
    const triggers: any[] = snap.exists() ? (snap.data()['triggers'] || []) : [];
    const idx = triggers.findIndex((t: any) => t.campaignId === campaignId);
    const entry = { campaignId, keyword: keyword.toUpperCase().trim(), flowId, active };
    if (idx >= 0) triggers[idx] = entry; else triggers.push(entry);
    await setDoc(docRef, { triggers }, { merge: true });
  }

  async removeCampaignKeywordTrigger(orgId: string, campaignId: string): Promise<void> {
    const docRef = doc(this.db, 'organizations', orgId, 'config', 'campaign_keywords');
    const snap = await getDoc(docRef);
    if (!snap.exists()) return;
    const triggers = (snap.data()['triggers'] || []).filter((t: any) => t.campaignId !== campaignId);
    await setDoc(docRef, { triggers }, { merge: true });
  }

  async getDeliveryFlowsForOrg(orgId: string): Promise<any[]> {
    const colRef = collection(this.db, 'organizations', orgId, 'flows');
    const snap = await getDocs(colRef);
    return snap.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .filter((f: any) => f.notifyDelivery === true && f.active !== false);
  }

  // Cuenta (aproximada) de registros de una colección, para mostrar destinatarios estimados
  async countCollectionRecipients(orgId: string, collectionId: string): Promise<number> {
    try {
      const defRef = doc(this.db, 'organizations', orgId, '_collections', collectionId);
      const defSnap = await getDoc(defRef);
      if (!defSnap.exists()) return 0;
      const slug = (defSnap.data() as any).slug || collectionId;
      const snap = await getCountFromServer(collection(this.db, 'organizations', orgId, slug));
      return snap.data().count;
    } catch {
      return 0;
    }
  }

  async getOrgCollectionDefs(orgId: string): Promise<any[]> {
    const colRef = collection(this.db, 'organizations', orgId, '_collections');
    const snap = await getDocs(colRef);
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  }

  // ==================== PRESENCE ====================

  async updatePresence(uid: string, data: any): Promise<void> {
    const docRef = doc(this.db, this.orgPath(), 'presence', uid);
    await setDoc(docRef, { ...data, updatedAt: serverTimestamp() }, { merge: true });
  }

  watchPresence(callback: (list: any[]) => void): () => void {
    const colRef = collection(this.db, this.orgPath(), 'presence');
    return onSnapshot(colRef, snap => {
      callback(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    });
  }

  // ==================== PUSH SUBSCRIPTIONS ====================

  async savePushSubscription(userId: string, subscription: any): Promise<void> {
    const docRef = doc(this.db, this.orgPath(), 'pushSubscriptions', userId);
    await setDoc(docRef, { userId, subscription, updatedAt: serverTimestamp() }, { merge: true });
  }

  async deletePushSubscription(userId: string): Promise<void> {
    const docRef = doc(this.db, this.orgPath(), 'pushSubscriptions', userId);
    await deleteDoc(docRef);
  }
}
