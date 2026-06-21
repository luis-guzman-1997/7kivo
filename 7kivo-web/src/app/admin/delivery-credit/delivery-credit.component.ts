import { Component, OnDestroy, OnInit } from '@angular/core';
import { FirebaseService } from '../../services/firebase.service';
import { AuthService } from '../../services/auth.service';

@Component({
  selector: 'app-delivery-credit',
  templateUrl: './delivery-credit.component.html',
  styleUrls: ['./delivery-credit.component.css']
})
export class DeliveryCreditComponent implements OnInit, OnDestroy {
  balance: number | null = null;
  refunds: any[] = [];
  movements: any[] = [];
  loading = true;

  private unsubWallet: (() => void) | null = null;
  private unsubRefunds: (() => void) | null = null;
  private unsubMovements: (() => void) | null = null;

  constructor(private firebaseService: FirebaseService, private authService: AuthService) {}

  ngOnInit(): void {
    const uid = this.authService.currentUser?.uid;
    if (!uid) { this.loading = false; return; }
    this.unsubWallet = this.firebaseService.watchDeliveryWallet(uid, bal => { this.balance = bal; this.loading = false; });
    this.unsubRefunds = this.firebaseService.watchMyRefunds(uid, list => this.refunds = list);
    this.unsubMovements = this.firebaseService.watchMyCreditMovements(uid, list => this.movements = list);
  }

  ngOnDestroy(): void {
    if (this.unsubWallet) this.unsubWallet();
    if (this.unsubRefunds) this.unsubRefunds();
    if (this.unsubMovements) this.unsubMovements();
  }

  get isLow(): boolean {
    return this.balance !== null && this.balance <= 0;
  }

  refundStatusLabel(s: string): string {
    return ({ pending: 'Pendiente', approved: 'Aprobado', rejected: 'Rechazado' } as Record<string, string>)[s] || s;
  }

  movementLabel(t: any): string {
    const map: Record<string, string> = {
      debit: 'Comisión por pedido',
      recharge: t.source === 'paid' ? 'Recarga (pagada)' : 'Recarga (cortesía)',
      refund: 'Reembolso',
      adjustment: 'Ajuste'
    };
    return map[t.type] || t.type;
  }

  movementIcon(type: string): string {
    const map: Record<string, string> = {
      debit: 'fa-arrow-down', recharge: 'fa-arrow-up', refund: 'fa-rotate-left', adjustment: 'fa-sliders-h'
    };
    return map[type] || 'fa-circle';
  }

  // Monto con signo para mostrar (débito resta; recarga/reembolso suman; ajuste ya viene con signo)
  movementSigned(t: any): number {
    const amt = t.amount || 0;
    if (t.type === 'debit') return -Math.abs(amt);
    if (t.type === 'adjustment') return amt;
    return Math.abs(amt);
  }

  formatDate(ts: any): string {
    if (!ts?.seconds) return '';
    return new Date(ts.seconds * 1000).toLocaleString('es', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
  }
}
