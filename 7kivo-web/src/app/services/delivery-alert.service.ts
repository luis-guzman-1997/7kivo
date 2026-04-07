import { Injectable } from '@angular/core';
import { BehaviorSubject, Subject } from 'rxjs';

@Injectable({ providedIn: 'root' })
export class DeliveryAlertService {
  // State (written by inbox, read by admin-layout)
  readonly locationGranted$ = new BehaviorSubject<boolean>(false);
  readonly locationDenied$  = new BehaviorSubject<boolean>(false);
  readonly locationError$   = new BehaviorSubject<string>('');
  readonly pushPermission$  = new BehaviorSubject<NotificationPermission>('default');
  readonly pushInstructions$ = new BehaviorSubject<string>('');
  readonly showPushInstructions$ = new BehaviorSubject<boolean>(false);

  // Actions — admin-layout emits, inbox responds
  readonly requestLocation$ = new Subject<void>();
  readonly requestPush$     = new Subject<void>();

  get hasAlerts(): boolean {
    return this.locationDenied$.value ||
           !!this.locationError$.value ||
           (!this.locationGranted$.value && !this.locationDenied$.value) ||
           (this.pushPermission$.value !== 'granted');
  }

  get alertCount(): number {
    let n = 0;
    if (!this.locationGranted$.value) n++;
    if (this.pushPermission$.value !== 'granted') n++;
    return n;
  }
}
