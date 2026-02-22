import { Injectable } from '@angular/core';
import {
  getAuth, Auth, signInWithEmailAndPassword, signOut,
  onAuthStateChanged, User, createUserWithEmailAndPassword
} from 'firebase/auth';
import { FirebaseService } from './firebase.service';
import { BehaviorSubject, Observable } from 'rxjs';

export const ROLE_PERMISSIONS: Record<string, string[]> = {
  owner: ['dashboard', 'contacts', 'chat', 'inbox', 'collections', 'flows', 'bot_config', 'users', 'settings'],
  admin: ['dashboard', 'contacts', 'chat', 'inbox', 'collections', 'flows', 'bot_config', 'users', 'settings'],
  editor: ['dashboard', 'contacts', 'chat', 'inbox', 'collections'],
  viewer: ['dashboard', 'contacts', 'inbox', 'chat']
};

@Injectable({ providedIn: 'root' })
export class AuthService {
  private auth: Auth;
  private currentUserSubject = new BehaviorSubject<User | null>(null);
  private isAdminSubject = new BehaviorSubject<boolean>(false);
  private loadingSubject = new BehaviorSubject<boolean>(true);
  private orgNameSubject = new BehaviorSubject<string>('');
  private orgLogoSubject = new BehaviorSubject<string>('');
  private botApiUrlSubject = new BehaviorSubject<string>('');
  private userRoleSubject = new BehaviorSubject<string>('');

  currentUser$: Observable<User | null> = this.currentUserSubject.asObservable();
  isAdmin$: Observable<boolean> = this.isAdminSubject.asObservable();
  loading$: Observable<boolean> = this.loadingSubject.asObservable();
  orgName$: Observable<string> = this.orgNameSubject.asObservable();
  orgLogo$: Observable<string> = this.orgLogoSubject.asObservable();
  botApiUrl$: Observable<string> = this.botApiUrlSubject.asObservable();
  userRole$: Observable<string> = this.userRoleSubject.asObservable();

  constructor(private firebaseService: FirebaseService) {
    this.auth = getAuth(this.firebaseService.getFirestore().app);
    onAuthStateChanged(this.auth, async (user) => {
      this.currentUserSubject.next(user);
      if (user) {
        await this.resolveUserOrg(user);
      } else {
        this.isAdminSubject.next(false);
        this.orgNameSubject.next('');
        this.orgLogoSubject.next('');
      }
      this.loadingSubject.next(false);
    });
  }

  private async resolveUserOrg(user: User): Promise<void> {
    try {
      const userData = await this.firebaseService.getUserOrg(user.uid);
      if (userData?.organizationId) {
        this.firebaseService.setOrgId(userData.organizationId);
        this.userRoleSubject.next(userData.role || 'viewer');

        const orgConfig = await this.firebaseService.getOrgConfig();
        this.orgNameSubject.next(orgConfig?.orgName || orgConfig?.schoolName || userData.organizationId);
        this.orgLogoSubject.next(orgConfig?.orgLogo || '');
        this.botApiUrlSubject.next(orgConfig?.botApiUrl || '');
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
    const role = this.userRoleSubject.value || 'viewer';
    const perms = ROLE_PERMISSIONS[role] || ROLE_PERMISSIONS['viewer'];
    return perms.includes(section);
  }

  get isOwnerOrAdmin(): boolean {
    const role = this.userRoleSubject.value;
    return role === 'owner' || role === 'admin';
  }
}
