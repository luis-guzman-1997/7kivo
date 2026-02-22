import { Injectable } from '@angular/core';
import { initializeApp, FirebaseApp } from 'firebase/app';
import {
  getFirestore, Firestore, collection, doc, getDocs, getDoc, addDoc,
  updateDoc, deleteDoc, setDoc, query, where, orderBy, serverTimestamp,
  QueryConstraint, DocumentData, onSnapshot, limit, Unsubscribe
} from 'firebase/firestore';
import { environment } from '../../environments/environment';

@Injectable({ providedIn: 'root' })
export class FirebaseService {
  private app: FirebaseApp;
  private db: Firestore;
  private schoolId: string;

  constructor() {
    this.app = initializeApp(environment.firebase);
    this.db = getFirestore(this.app);
    this.schoolId = environment.schoolId;
  }

  getFirestore(): Firestore {
    return this.db;
  }

  getSchoolId(): string {
    return this.schoolId;
  }

  private schoolPath(): string {
    return `schools/${this.schoolId}`;
  }

  // ==================== GENERIC HELPERS ====================

  async getCollection(subcollection: string, constraints: QueryConstraint[] = []): Promise<any[]> {
    const colRef = collection(this.db, this.schoolPath(), subcollection);
    const q = constraints.length > 0 ? query(colRef, ...constraints) : query(colRef);
    const snapshot = await getDocs(q);
    return snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
  }

  async getDocument(subcollection: string, docId: string): Promise<any | null> {
    const docRef = doc(this.db, this.schoolPath(), subcollection, docId);
    const snap = await getDoc(docRef);
    return snap.exists() ? { id: snap.id, ...snap.data() } : null;
  }

  async addDocument(subcollection: string, data: DocumentData): Promise<string> {
    const colRef = collection(this.db, this.schoolPath(), subcollection);
    const docRef = await addDoc(colRef, {
      ...data,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });
    return docRef.id;
  }

  async updateDocument(subcollection: string, docId: string, data: DocumentData): Promise<void> {
    const docRef = doc(this.db, this.schoolPath(), subcollection, docId);
    await updateDoc(docRef, { ...data, updatedAt: serverTimestamp() });
  }

  async deleteDocument(subcollection: string, docId: string): Promise<void> {
    const docRef = doc(this.db, this.schoolPath(), subcollection, docId);
    await deleteDoc(docRef);
  }

  // ==================== ASPIRANTES (registros del bot) ====================

  async getApplicants(): Promise<any[]> {
    const items = await this.getCollection('applicants');
    return items.sort((a, b) => {
      const dateA = a.createdAt?.seconds || 0;
      const dateB = b.createdAt?.seconds || 0;
      return dateB - dateA;
    });
  }

  async updateApplicantStatus(applicantId: string, status: string): Promise<void> {
    await this.updateDocument('applicants', applicantId, { status });
  }

  async acceptApplicant(applicant: any): Promise<string> {
    const studentData: any = { ...applicant };
    delete studentData.id;
    delete studentData.createdAt;
    delete studentData.updatedAt;
    studentData.status = 'active';
    studentData.applicantId = applicant.id;
    studentData.acceptedAt = serverTimestamp();

    const studentId = await this.addDocument('students', studentData);
    await this.updateDocument('applicants', applicant.id, { status: 'accepted', studentId });
    return studentId;
  }

  // ==================== ESTUDIANTES (aceptados) ====================

  async getStudents(): Promise<any[]> {
    const items = await this.getCollection('students');
    return items.sort((a, b) => {
      const dateA = a.createdAt?.seconds || 0;
      const dateB = b.createdAt?.seconds || 0;
      return dateB - dateA;
    });
  }

  async updateStudentStatus(studentId: string, status: string): Promise<void> {
    await this.updateDocument('students', studentId, { status });
  }

  // ==================== ADMINS ====================

  async getAdmins(): Promise<any[]> {
    const colRef = collection(this.db, 'admins');
    const snapshot = await getDocs(colRef);
    return snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
  }

  async addAdmin(data: { email: string; name: string; role: string }): Promise<string> {
    const colRef = collection(this.db, 'admins');
    const docRef = await addDoc(colRef, {
      ...data,
      active: true,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });
    return docRef.id;
  }

  async updateAdmin(adminId: string, data: DocumentData): Promise<void> {
    const docRef = doc(this.db, 'admins', adminId);
    await updateDoc(docRef, { ...data, updatedAt: serverTimestamp() });
  }

  async deleteAdmin(adminId: string): Promise<void> {
    const docRef = doc(this.db, 'admins', adminId);
    await deleteDoc(docRef);
  }

  async isAdmin(email: string): Promise<boolean> {
    const colRef = collection(this.db, 'admins');
    const q = query(colRef, where('email', '==', email), where('active', '==', true));
    const snapshot = await getDocs(q);
    return !snapshot.empty;
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
    const docRef = doc(this.db, this.schoolPath(), 'config', 'menu');
    await setDoc(docRef, { ...data, updatedAt: serverTimestamp() }, { merge: true });
  }

  // ==================== INSTRUMENTS & COURSE TYPES ====================

  async getInstruments(): Promise<any[]> {
    const items = await this.getCollection('instruments');
    return items.filter(i => i.active).sort((a, b) => (a.order || 0) - (b.order || 0));
  }

  async getCourseTypes(): Promise<any[]> {
    const items = await this.getCollection('courseTypes');
    return items.filter(i => i.active).sort((a, b) => (a.order || 0) - (b.order || 0));
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
    const colRef = collection(this.db, this.schoolPath(), 'conversations');
    const q = query(colRef, orderBy('lastMessageAt', 'desc'));
    const snapshot = await getDocs(q);
    return snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
  }

  async getConversationMessages(phoneNumber: string, limitCount = 100): Promise<any[]> {
    const cleanPhone = phoneNumber.replace(/\D/g, '');
    const colRef = collection(this.db, this.schoolPath(), 'conversations', cleanPhone, 'messages');
    const q = query(colRef, orderBy('timestamp', 'asc'));
    const snapshot = await getDocs(q);
    return snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
  }

  onConversationMessages(phoneNumber: string, callback: (msgs: any[]) => void): Unsubscribe {
    const cleanPhone = phoneNumber.replace(/\D/g, '');
    const colRef = collection(this.db, this.schoolPath(), 'conversations', cleanPhone, 'messages');
    const q = query(colRef, orderBy('timestamp', 'asc'));
    return onSnapshot(q, (snapshot) => {
      const msgs = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
      callback(msgs);
    });
  }

  onConversationsChange(callback: (convs: any[]) => void): Unsubscribe {
    const colRef = collection(this.db, this.schoolPath(), 'conversations');
    const q = query(colRef, orderBy('lastMessageAt', 'desc'));
    return onSnapshot(q, (snapshot) => {
      const convs = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
      callback(convs);
    });
  }

  async markConversationRead(phoneNumber: string): Promise<void> {
    const cleanPhone = phoneNumber.replace(/\D/g, '');
    const docRef = doc(this.db, this.schoolPath(), 'conversations', cleanPhone);
    await updateDoc(docRef, { unreadCount: 0 });
  }

  // ==================== SCHOOL CONFIG (personal WhatsApp) ====================

  async getSchoolConfig(): Promise<any | null> {
    return this.getDocument('config', 'general');
  }

  async saveSchoolConfig(data: DocumentData): Promise<void> {
    const docRef = doc(this.db, this.schoolPath(), 'config', 'general');
    await setDoc(docRef, { ...data, updatedAt: serverTimestamp() }, { merge: true });
  }
}
