import { Component, OnInit, OnDestroy, AfterViewInit, ViewEncapsulation } from '@angular/core';
import { FirebaseService } from '../../services/firebase.service';
import { AuthService } from '../../services/auth.service';
import * as L from 'leaflet';

@Component({
  selector: 'app-delivery-map',
  templateUrl: './delivery-map.component.html',
  styleUrls: ['./delivery-map.component.css'],
  encapsulation: ViewEncapsulation.None
})
export class DeliveryMapComponent implements OnInit, OnDestroy, AfterViewInit {
  private map!: L.Map;
  private markers = new Map<string, L.Marker>();
  private unsubLocations: (() => void) | null = null;
  private unsubPromoOrders: (() => void) | null = null;
  private boundsSet = false;

  deliveryUsers: any[] = [];
  selectedUser: any = null;
  selectedMessages: any[] = [];
  loadingPreview = false;

  promoOrders: any[] = [];
  cancellingOrderId: string | null = null;

  get activeCount(): number {
    return this.deliveryUsers.filter((u: any) => u.status === 'active').length;
  }

  get selectedOrder(): any | null {
    if (!this.selectedUser) return null;
    return this.promoOrders.find(
      o => o.status === 'taken' && o.assignedTo?.uid === this.selectedUser.userId
    ) || null;
  }

  constructor(
    private firebaseService: FirebaseService,
    public authService: AuthService
  ) {}

  ngOnInit(): void {}

  ngAfterViewInit(): void {
    this.initMap();
    this.unsubLocations = this.firebaseService.watchDeliveryLocations((users) => {
      this.deliveryUsers = users;
      this.updateMarkers(users);
    });
    this.unsubPromoOrders = this.firebaseService.watchPromoOrders((orders) => {
      this.promoOrders = orders;
    });
  }

  ngOnDestroy(): void {
    this.unsubLocations?.();
    this.unsubPromoOrders?.();
    if (this.map) this.map.remove();
  }

  private initMap(): void {
    this.map = L.map('delivery-map-el', { center: [13.7942, -88.8965], zoom: 11 });
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
    }).addTo(this.map);
    setTimeout(() => this.map.invalidateSize(), 200);
  }

  private updateMarkers(users: any[]): void {
    const currentIds = new Set(users.map((u: any) => u.userId));
    this.markers.forEach((m, uid) => {
      if (!currentIds.has(uid)) { m.remove(); this.markers.delete(uid); }
    });

    users.forEach((user: any) => {
      if (!user.lat || !user.lng) return;
      const icon = this.buildIcon(user.status);
      const latlng: L.LatLngTuple = [user.lat, user.lng];
      if (this.markers.has(user.userId)) {
        const m = this.markers.get(user.userId)!;
        m.setLatLng(latlng);
        m.setIcon(icon);
      } else {
        const m = L.marker(latlng, { icon })
          .addTo(this.map)
          .on('click', () => this.selectUser(user));
        this.markers.set(user.userId, m);
      }
    });

    // Ajustar mapa para englobar todos los puntos la primera vez
    if (!this.boundsSet && this.markers.size > 0) {
      const coords = Array.from(this.markers.values()).map(m => m.getLatLng());
      if (coords.length === 1) {
        this.map.setView(coords[0], 14);
      } else {
        this.map.fitBounds(L.latLngBounds(coords), { padding: [40, 40] });
      }
      this.boundsSet = true;
    }
  }

  private buildIcon(status: string): L.DivIcon {
    const active = status === 'active';
    return L.divIcon({
      className: '',
      html: `<div class="dm-pin ${active ? 'dm-pin--active' : 'dm-pin--available'}">
        <i class="fas fa-motorcycle"></i>
        ${active ? '<span class="dm-pin-dot"></span>' : ''}
      </div>`,
      iconSize: [40, 40],
      iconAnchor: [20, 40],
      popupAnchor: [0, -42]
    });
  }

  async selectUser(user: any): Promise<void> {
    this.selectedUser = user;
    this.selectedMessages = [];
    this.map.panTo([user.lat, user.lng]);

    if (user.activePhone) {
      this.loadingPreview = true;
      try {
        const msgs = await this.firebaseService.getConversationMessages(user.activePhone, 100);
        this.selectedMessages = msgs.slice(-12);
      } catch { /* silent */ }
      this.loadingPreview = false;
    }
  }

  selectUserFromList(user: any): void {
    this.selectUser(user);
  }

  closePanel(): void {
    this.selectedUser = null;
    this.selectedMessages = [];
  }

  async cancelOrderFromMap(order: any): Promise<void> {
    if (this.cancellingOrderId) return;
    this.cancellingOrderId = order.id;
    try {
      await this.firebaseService.cancelPromoOrder(order.id, 'Cancelado desde mapa de deliveries');
    } catch { /* silent */ }
    this.cancellingOrderId = null;
  }

  getStatusLabel(status: string): string {
    return status === 'active' ? 'Con pedido activo' : 'Disponible';
  }

  orderTimeAgo(order: any): string {
    const seconds = order.createdAt?.seconds;
    if (!seconds) return '';
    const diff = Math.floor(Date.now() / 1000 - seconds);
    if (diff < 60) return 'hace un momento';
    if (diff < 3600) return `hace ${Math.floor(diff / 60)} min`;
    return `hace ${Math.floor(diff / 3600)}h`;
  }

  msgTime(ts: any): string {
    if (!ts) return '';
    const ms = ts?.toMillis?.() ?? (ts?.seconds ? ts.seconds * 1000 : null) ?? new Date(ts).getTime();
    if (!ms) return '';
    return new Date(ms).toLocaleTimeString('es-SV', { hour: '2-digit', minute: '2-digit' });
  }

  isOutgoing(msg: any): boolean {
    return msg.type === 'outgoing' || msg.direction === 'out' || msg.fromAdmin === true;
  }
}
