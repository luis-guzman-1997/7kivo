import { Injectable } from '@angular/core';
import { initializeApp, FirebaseApp } from 'firebase/app';
import {
  getFirestore, Firestore, collection, doc, getDocs, getDoc, addDoc,
  updateDoc, deleteDoc, setDoc, query, where, orderBy, serverTimestamp,
  QueryConstraint, DocumentData, onSnapshot, limit, Unsubscribe
} from 'firebase/firestore';
import {
  getStorage, FirebaseStorage, ref, uploadBytes, getDownloadURL, deleteObject
} from 'firebase/storage';
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

  async setUserOrg(uid: string, data: { organizationId: string; email: string; role: string; name?: string }): Promise<void> {
    const userDocRef = doc(this.db, 'users', uid);
    await setDoc(userDocRef, { ...data, updatedAt: serverTimestamp() }, { merge: true });
  }

  // ==================== ORG MANAGEMENT ====================

  async createOrganization(orgData: {
    name: string;
    industry?: string;
    description?: string;
  }): Promise<string> {
    const orgId = orgData.name.toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '')
      .substring(0, 30);

    const orgDocRef = doc(this.db, 'organizations', orgId);
    await setDoc(orgDocRef, {
      name: orgData.name,
      industry: orgData.industry || 'general',
      description: orgData.description || '',
      createdAt: serverTimestamp(),
      active: true
    });

    // Create default config
    const configRef = doc(this.db, 'organizations', orgId, 'config', 'general');
    await setDoc(configRef, {
      orgName: orgData.name,
      description: orgData.description || '',
      industry: orgData.industry || 'general',
      welcomeMessage: `Bienvenido a ${orgData.name}`,
      inactivityTimeout: 180000,
      createdAt: serverTimestamp()
    });

    // Create default menu config
    const menuRef = doc(this.db, 'organizations', orgId, 'config', 'menu');
    await setDoc(menuRef, {
      greeting: `¡Hola{name}!\n\nBienvenido a *${orgData.name}*.\n\nSelecciona una opción:`,
      menuButtonText: 'Ver opciones',
      fallbackMessage: 'No entendí tu mensaje. Por favor selecciona una opción del menú.',
      items: [],
      createdAt: serverTimestamp()
    });

    // Create default bot messages
    const botMsgsRef = collection(this.db, 'organizations', orgId, 'botMessages');
    const defaultMessages = [
      { key: 'greeting', label: 'Saludo', category: 'greeting', content: `¡Hola{name}!\n\nBienvenido a *${orgData.name}*.` },
      { key: 'fallback', label: 'Mensaje no reconocido', category: 'fallback', content: 'No entendí tu mensaje. Escribe *hola* para ver el menú.' },
      { key: 'goodbye', label: 'Despedida', category: 'general', content: '¡Hasta luego! Escribe *hola* cuando necesites ayuda.' },
      { key: 'session_expired', label: 'Sesión expirada', category: 'general', content: 'Tu sesión se cerró por inactividad. Escribe *hola* cuando necesites ayuda.' }
    ];
    for (const msg of defaultMessages) {
      await addDoc(botMsgsRef, { ...msg, createdAt: serverTimestamp() });
    }

    return orgId;
  }

  async getOrganization(orgId: string): Promise<any | null> {
    const orgDocRef = doc(this.db, 'organizations', orgId);
    const snap = await getDoc(orgDocRef);
    return snap.exists() ? { id: snap.id, ...snap.data() } : null;
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

  async addAdmin(data: { email: string; name: string; role: string; uid?: string }): Promise<string> {
    return this.addDocument('admins', { ...data, active: true });
  }

  async updateAdmin(adminId: string, data: DocumentData): Promise<void> {
    await this.updateDocument('admins', adminId, data);
  }

  async deleteAdmin(adminId: string): Promise<void> {
    await this.deleteDocument('admins', adminId);
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

  // ==================== DYNAMIC COLLECTIONS ====================

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

  async getCollectionData(slug: string): Promise<any[]> {
    const items = await this.getCollection(slug);
    return items.sort((a, b) => {
      const dateA = a.createdAt?.seconds || 0;
      const dateB = b.createdAt?.seconds || 0;
      return dateB - dateA;
    });
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

  // ==================== FLOW SUBMISSIONS ====================

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

  onConversationMessages(phoneNumber: string, callback: (msgs: any[]) => void): Unsubscribe {
    const cleanPhone = phoneNumber.replace(/\D/g, '');
    const colRef = collection(this.db, this.orgPath(), 'conversations', cleanPhone, 'messages');
    const q = query(colRef, orderBy('timestamp', 'asc'));
    return onSnapshot(q, (snapshot) => {
      const msgs = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
      callback(msgs);
    });
  }

  onConversationsChange(callback: (convs: any[]) => void): Unsubscribe {
    const colRef = collection(this.db, this.orgPath(), 'conversations');
    const q = query(colRef, orderBy('lastMessageAt', 'desc'));
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

  // ==================== PLATFORM (SUPER ADMIN) ====================

  async getAllOrganizations(): Promise<any[]> {
    const colRef = collection(this.db, 'organizations');
    const snapshot = await getDocs(colRef);
    return snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
  }

  async updateOrganization(orgId: string, data: DocumentData): Promise<void> {
    const docRef = doc(this.db, 'organizations', orgId);
    await updateDoc(docRef, { ...data, updatedAt: serverTimestamp() });
  }

  async getOrgConfigByOrgId(orgId: string): Promise<any | null> {
    const docRef = doc(this.db, 'organizations', orgId, 'config', 'general');
    const snap = await getDoc(docRef);
    return snap.exists() ? snap.data() : null;
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

  async getPlatformPlans(): Promise<any | null> {
    const docRef = doc(this.db, 'platformConfig', 'plans');
    const snap = await getDoc(docRef);
    return snap.exists() ? snap.data() : null;
  }

  async savePlatformPlans(plans: any[]): Promise<void> {
    const docRef = doc(this.db, 'platformConfig', 'plans');
    await setDoc(docRef, { plans, updatedAt: serverTimestamp() }, { merge: true });
  }

  // ==================== STORAGE ====================

  async uploadFile(file: File, path: string): Promise<string> {
    const storageRef = ref(this.storage, path);
    await uploadBytes(storageRef, file);
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
}
