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

  currentUser$: Observable<User | null> = this.currentUserSubject.asObservable();
  isAdmin$: Observable<boolean> = this.isAdminSubject.asObservable();
  loading$: Observable<boolean> = this.loadingSubject.asObservable();

  constructor(private firebaseService: FirebaseService) {
    this.auth = getAuth(this.firebaseService.getFirestore().app);
    onAuthStateChanged(this.auth, async (user) => {
      this.currentUserSubject.next(user);
      if (user?.email) {
        const admin = await this.firebaseService.isAdmin(user.email);
        this.isAdminSubject.next(admin);
      } else {
        this.isAdminSubject.next(false);
      }
      this.loadingSubject.next(false);
    });
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
}
