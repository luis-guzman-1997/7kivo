import { Injectable } from '@angular/core';
import {
  getAuth, Auth, signInWithEmailAndPassword, signOut,
  onAuthStateChanged, User, createUserWithEmailAndPassword
} from 'firebase/auth';
import { FirebaseService } from './firebase.service';
import { BehaviorSubject, Observable } from 'rxjs';

const SUPER_ADMIN_EMAILS = ['admin@7kivo.com'];

export const PLAN_LIMITS: Record<string, { flows: number; collections: number; admins: number; chatLive: boolean; appointments: boolean }> = {
  'Starter':    { flows: 1,  collections: 1,  admins: 1,   chatLive: false, appointments: false },
  'Business':   { flows: 3,  collections: 3,  admins: 3,   chatLive: true,  appointments: true },
  'Premium':    { flows: 5,  collections: 10, admins: 5,   chatLive: true,  appointments: true },
  'Enterprise': { flows: 20, collections: 999, admins: 999, chatLive: true,  appointments: true }
};

export const ROLE_PERMISSIONS: Record<string, string[]> = {
  owner:  ['dashboard', 'contacts', 'chat', 'inbox', 'collections', 'flows', 'bot_config', 'users', 'settings'],
  admin:  ['dashboard', 'contacts', 'chat', 'inbox', 'collections', 'flows', 'bot_config', 'users'],
  editor: ['dashboard', 'contacts', 'chat', 'inbox', 'collections'],
  viewer: ['dashboard', 'inbox', 'chat']
};

@Injectable({ providedIn: 'root' })
export class AuthService {
  private auth: Auth;
  private currentUserSubject = new BehaviorSubject<User | null>(null);
  private isAdminSubject = new BehaviorSubject<boolean>(false);
  private isSuperAdminSubject = new BehaviorSubject<boolean>(false);
  private loadingSubject = new BehaviorSubject<boolean>(true);
  private orgNameSubject = new BehaviorSubject<string>('');
  private orgLogoSubject = new BehaviorSubject<string>('');
  private botApiUrlSubject = new BehaviorSubject<string>('');
  private userRoleSubject = new BehaviorSubject<string>('');
  private orgPlanSubject = new BehaviorSubject<string>('');
  private customLimitsSubject = new BehaviorSubject<any>(null);
  private botEnabledSubject = new BehaviorSubject<boolean>(true);
  private setupCompleteSubject = new BehaviorSubject<boolean>(true);
  private botPausedSubject = new BehaviorSubject<boolean>(false);
  private botBlockedSubject = new BehaviorSubject<boolean>(false);
  private botPausedReasonSubject = new BehaviorSubject<string | null>(null);

  currentUser$: Observable<User | null> = this.currentUserSubject.asObservable();
  isAdmin$: Observable<boolean> = this.isAdminSubject.asObservable();
  isSuperAdmin$: Observable<boolean> = this.isSuperAdminSubject.asObservable();
  loading$: Observable<boolean> = this.loadingSubject.asObservable();
  orgName$: Observable<string> = this.orgNameSubject.asObservable();
  orgLogo$: Observable<string> = this.orgLogoSubject.asObservable();
  botApiUrl$: Observable<string> = this.botApiUrlSubject.asObservable();
  userRole$: Observable<string> = this.userRoleSubject.asObservable();
  botEnabled$: Observable<boolean> = this.botEnabledSubject.asObservable();
  botPaused$: Observable<boolean> = this.botPausedSubject.asObservable();
  botBlocked$: Observable<boolean> = this.botBlockedSubject.asObservable();

  constructor(private firebaseService: FirebaseService) {
    this.auth = getAuth(this.firebaseService.getFirestore().app);
    onAuthStateChanged(this.auth, async (user) => {
      this.currentUserSubject.next(user);
      if (user) {
        if (SUPER_ADMIN_EMAILS.includes(user.email || '')) {
          this.isSuperAdminSubject.next(true);
          this.isAdminSubject.next(true);
          this.userRoleSubject.next('superadmin');
        } else {
          this.isSuperAdminSubject.next(false);
          await this.resolveUserOrg(user);
        }
      } else {
        this.isAdminSubject.next(false);
        this.isSuperAdminSubject.next(false);
        this.orgNameSubject.next('');
        this.orgLogoSubject.next('');
        this.userRoleSubject.next('');
      }
      this.loadingSubject.next(false);
    });
  }

  async refreshUserOrg(): Promise<void> {
    const user = this.currentUserSubject.value;
    if (user) await this.resolveUserOrg(user);
  }

  private async resolveUserOrg(user: User): Promise<void> {
    try {
      const userData = await this.firebaseService.getUserOrg(user.uid);
      if (userData?.organizationId) {
        this.firebaseService.setOrgId(userData.organizationId);
        this.userRoleSubject.next(userData.role || 'viewer');

        const [orgConfig, orgDoc] = await Promise.all([
          this.firebaseService.getOrgConfig(),
          this.firebaseService.getOrganization(userData.organizationId)
        ]);
        this.orgNameSubject.next(orgConfig?.orgName || orgConfig?.schoolName || userData.organizationId);
        this.orgLogoSubject.next(orgConfig?.orgLogo || '');
        this.botApiUrlSubject.next(orgConfig?.botApiUrl || '');
        this.orgPlanSubject.next(orgDoc?.plan || '');
        this.customLimitsSubject.next(orgDoc?.customLimits || null);
        this.botEnabledSubject.next(orgDoc?.botEnabled !== false);
        this.setupCompleteSubject.next(orgDoc?.setupComplete !== false);
        this.botPausedSubject.next(orgDoc?.botPaused === true);
        this.botBlockedSubject.next(orgDoc?.botBlocked === true);
        this.botPausedReasonSubject.next(orgDoc?.botPausedReason || null);
        this.isAdminSubject.next(true);
      } else {
        this.isAdminSubject.next(false);
        this.userRoleSubject.next('');
      }
    } catch (err) {
      console.error('Error resolving user org:', err);
      this.isAdminSubject.next(false);
      this.userRoleSubject.next('');
    }
  }

  async login(email: string, password: string): Promise<void> {
    await signInWithEmailAndPassword(this.auth, email, password);
  }

  async logout(): Promise<void> {
    this.isSuperAdminSubject.next(false);
    this.orgLogoSubject.next('');
    this.botPausedSubject.next(false);
    this.botBlockedSubject.next(false);
    this.botPausedReasonSubject.next(null);
    await signOut(this.auth);
  }

  async createUser(email: string, password: string): Promise<User> {
    const credential = await createUserWithEmailAndPassword(this.auth, email, password);
    return credential.user;
  }

  getAuth(): Auth {
    return this.auth;
  }

  get currentUser(): User | null {
    return this.currentUserSubject.value;
  }

  get isAuthenticated(): boolean {
    return !!this.currentUserSubject.value;
  }

  get isSuperAdmin(): boolean {
    return this.isSuperAdminSubject.value;
  }

  get orgName(): string {
    return this.orgNameSubject.value;
  }

  get orgLogo(): string {
    return this.orgLogoSubject.value;
  }

  updateOrgLogo(logo: string): void {
    this.orgLogoSubject.next(logo);
  }

  get botApiUrl(): string {
    return this.botApiUrlSubject.value;
  }

  get userRole(): string {
    return this.userRoleSubject.value;
  }

  hasPermission(section: string): boolean {
    if (this.isSuperAdminSubject.value) return true;
    const role = this.userRoleSubject.value || 'viewer';
    const perms = ROLE_PERMISSIONS[role] || ROLE_PERMISSIONS['viewer'];
    return perms.includes(section);
  }

  get isOwnerOrAdmin(): boolean {
    const role = this.userRoleSubject.value;
    return role === 'owner' || role === 'admin' || role === 'superadmin';
  }

  get botEnabled(): boolean {
    return this.botEnabledSubject.value;
  }

  get botPaused(): boolean {
    return this.botPausedSubject.value;
  }

  get botBlocked(): boolean {
    return this.botBlockedSubject.value;
  }

  get botPausedReason(): string | null {
    return this.botPausedReasonSubject.value;
  }

  updateBotPaused(paused: boolean, reason: string | null = null): void {
    this.botPausedSubject.next(paused);
    this.botPausedReasonSubject.next(reason);
  }

  get orgPlan(): string {
    return this.orgPlanSubject.value;
  }

  get setupComplete(): boolean {
    return this.setupCompleteSubject.value;
  }

  markSetupComplete(): void {
    this.setupCompleteSubject.next(true);
  }

  getPlanLimits(): { flows: number; collections: number; admins: number; chatLive: boolean; appointments: boolean } {
    const custom = this.customLimitsSubject.value;
    if (custom && (custom.flows || custom.collections || custom.admins)) {
      return {
        flows: custom.flows ?? 1,
        collections: custom.collections ?? 1,
        admins: custom.admins ?? 1,
        chatLive: custom.chatLive !== false,
        appointments: custom.appointments !== false
      };
    }
    const plan = this.orgPlanSubject.value;
    return PLAN_LIMITS[plan] || PLAN_LIMITS['Starter'];
  }

  // ── Superadmin org-context preview ──

  async setOrgContextForSuperAdmin(orgId: string): Promise<void> {
    if (!this.isSuperAdminSubject.value) return;
    this.firebaseService.setOrgId(orgId);
    try {
      const [orgConfig, orgDoc] = await Promise.all([
        this.firebaseService.getOrgConfig(),
        this.firebaseService.getOrganization(orgId)
      ]);
      this.orgNameSubject.next(orgConfig?.orgName || orgConfig?.schoolName || orgId);
      this.orgLogoSubject.next(orgConfig?.orgLogo || '');
      this.botApiUrlSubject.next(orgConfig?.botApiUrl || '');
      this.orgPlanSubject.next(orgDoc?.plan || '');
      this.customLimitsSubject.next(orgDoc?.customLimits || null);
      this.botEnabledSubject.next(orgDoc?.botEnabled !== false);
      this.botPausedSubject.next(orgDoc?.botPaused === true);
      this.botBlockedSubject.next(orgDoc?.botBlocked === true);
      this.botPausedReasonSubject.next(orgDoc?.botPausedReason || null);
    } catch (err) {
      console.error('Error setting SA org context:', err);
    }
  }

  clearOrgContext(): void {
    this.firebaseService.setOrgId('');
    this.orgNameSubject.next('');
    this.orgLogoSubject.next('');
    this.botApiUrlSubject.next('');
  }
}
