import { Injectable } from '@angular/core';
import { SwPush } from '@angular/service-worker';
import { FirebaseService } from './firebase.service';
import { environment } from '../../environments/environment';

@Injectable({ providedIn: 'root' })
export class PushNotificationService {
  constructor(
    private swPush: SwPush,
    private firebaseService: FirebaseService
  ) {}

  get isSupported(): boolean {
    return this.swPush.isEnabled;
  }

  async subscribe(userId: string): Promise<void> {
    if (!this.swPush.isEnabled) return;
    try {
      const sub = await this.swPush.requestSubscription({
        serverPublicKey: environment.vapidPublicKey
      });
      await this.firebaseService.savePushSubscription(userId, sub.toJSON());
    } catch { /* usuario negó o no soportado */ }
  }

  async unsubscribe(userId: string): Promise<void> {
    if (!this.swPush.isEnabled) return;
    try {
      await this.swPush.unsubscribe();
      await this.firebaseService.deletePushSubscription(userId);
    } catch { /* silent */ }
  }
}
