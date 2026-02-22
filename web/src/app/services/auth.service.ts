import { Injectable } from '@angular/core';
import {
  getAuth, Auth, signInWithEmailAndPassword, signOut,
  onAuthStateChanged, User, createUserWithEmailAndPassword
} from 'firebase/auth';
import { FirebaseService } from './firebase.service';
import { BehaviorSubject, Observable } from 'rxjs';

@Injectable({ providedIn: 'root' })
export class AuthService {
  private auth: Auth;
  private currentUserSubject = new BehaviorSubject<User | null>(null);
  private isAdminSubject = new BehaviorSubject<boolean>(false);
  private loadingSubject = new BehaviorSubject<boolean>(true);
  private orgNameSubject = new BehaviorSubject<string>('');
  private botApiUrlSubject = new BehaviorSubject<string>('');

  currentUser$: Observable<User | null> = this.currentUserSubject.asObservable();
  isAdmin$: Observable<boolean> = this.isAdminSubject.asObservable();
  loading$: Observable<boolean> = this.loadingSubject.asObservable();
  orgName$: Observable<string> = this.orgNameSubject.asObservable();
  botApiUrl$: Observable<string> = this.botApiUrlSubject.asObservable();

  constructor(private firebaseService: FirebaseService) {
    this.auth = getAuth(this.firebaseService.getFirestore().app);
    onAuthStateChanged(this.auth, async (user) => {
      this.currentUserSubject.next(user);
      if (user) {
        await this.resolveUserOrg(user);
      } else {
        this.isAdminSubject.next(false);
        this.orgNameSubject.next('');
      }
      this.loadingSubject.next(false);
    });
  }

  private async resolveUserOrg(user: User): Promise<void> {
    try {
      const userData = await this.firebaseService.getUserOrg(user.uid);
      if (userData?.organizationId) {
        this.firebaseService.setOrgId(userData.organizationId);

        const orgConfig = await this.firebaseService.getOrgConfig();
        this.orgNameSubject.next(orgConfig?.orgName || orgConfig?.schoolName || userData.organizationId);
        this.botApiUrlSubject.next(orgConfig?.botApiUrl || '');
        this.isAdminSubject.next(true);
      } else {
        this.isAdminSubject.next(false);
      }
    } catch (err) {
      console.error('Error resolving user org:', err);
      this.isAdminSubject.next(false);
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

  get botApiUrl(): string {
    return this.botApiUrlSubject.value;
  }
}
