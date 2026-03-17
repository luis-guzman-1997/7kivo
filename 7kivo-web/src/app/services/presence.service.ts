import { Injectable, OnDestroy } from '@angular/core';
import { FirebaseService } from './firebase.service';
import { AuthService } from './auth.service';

const HEARTBEAT_INTERVAL_MS = 60_000; // cada 60s
const ONLINE_THRESHOLD_MS   = 2 * 60_000; // online si lastSeen < 2 min

@Injectable({ providedIn: 'root' })
export class PresenceService implements OnDestroy {
  private timer: any = null;
  private uid = '';
  private name = '';
  private role = '';

  constructor(
    private firebaseService: FirebaseService,
    private authService: AuthService
  ) {}

  start(): void {
    const user = this.authService.currentUser;
    if (!user) return;
    this.uid  = user.uid;
    this.name = user.displayName || user.email || '';
    this.role = this.authService.userRole;

    this.beat();
    this.timer = setInterval(() => this.beat(), HEARTBEAT_INTERVAL_MS);

    window.addEventListener('beforeunload', this.onUnload);
  }

  stop(): void {
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
    window.removeEventListener('beforeunload', this.onUnload);
    if (this.uid) this.firebaseService.updatePresence(this.uid, { online: false }).catch(() => {});
  }

  ngOnDestroy(): void { this.stop(); }

  private beat(): void {
    if (!this.uid) return;
    this.firebaseService.updatePresence(this.uid, {
      uid: this.uid,
      name: this.name,
      role: this.role,
      online: true,
      lastSeen: new Date()
    }).catch(() => {});
  }

  private onUnload = (): void => {
    // Intento síncrono (no garantizado en todos los browsers, pero ayuda)
    this.firebaseService.updatePresence(this.uid, { online: false }).catch(() => {});
  };

  static isOnline(presence: any): boolean {
    if (!presence?.lastSeen) return false;
    const ms = presence.lastSeen?.toMillis?.() ?? new Date(presence.lastSeen).getTime();
    return Date.now() - ms < ONLINE_THRESHOLD_MS;
  }
}
