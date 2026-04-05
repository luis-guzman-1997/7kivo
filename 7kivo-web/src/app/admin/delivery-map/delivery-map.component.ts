import { Component, OnInit, OnDestroy, AfterViewInit, ViewEncapsulation, HostListener } from '@angular/core';
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
  private historyMarkers: L.Marker[] = [];
  private routeLayer: L.LayerGroup | null = null;
  private unsubLocations: (() => void) | null = null;
  private unsubPromoOrders: (() => void) | null = null;
  private unsubHistory: (() => void) | null = null;
  private boundsSet = false;

  mapView: 'live' | 'history' = 'live';

  // Live
  deliveryUsers: any[] = [];
  selectedUser: any = null;
  selectedMessages: any[] = [];
  loadingPreview = false;
  promoOrders: any[] = [];
  cancellingOrderId: string | null = null;

  // History
  historyRecords: any[] = [];
  selectedRecord: any = null;
  historyLoaded = false;
  fromDate: string = this.todayStr();
  toDate: string = this.todayStr();
  historyFilterCollapsed = false;

  get isMobileView(): boolean {
    return typeof window !== 'undefined' && window.innerWidth <= 768;
  }

  get activeCount(): number {
    return this.deliveryUsers.filter((u: any) => u.status === 'active').length;
  }

  get selectedOrder(): any | null {
    if (!this.selectedUser) return null;
    return this.promoOrders.find(
      o => o.status === 'taken' && o.assignedTo?.uid === this.selectedUser.userId
    ) || null;
  }

  get top5(): { name: string; email: string; completed: number; cancelled: number; total: number }[] {
    const map = new Map<string, { name: string; email: string; completed: number; cancelled: number }>();
    for (const r of this.historyRecords) {
      const uid = r.deliveryAgent?.uid || r.deliveryAgent?.email || 'unknown';
      if (!map.has(uid)) {
        map.set(uid, { name: r.deliveryAgent?.name || '—', email: r.deliveryAgent?.email || '', completed: 0, cancelled: 0 });
      }
      const entry = map.get(uid)!;
      if (r.status === 'cancelled') entry.cancelled++; else entry.completed++;
    }
    return Array.from(map.values())
      .map(e => ({ ...e, total: e.completed + e.cancelled }))
      .sort((a, b) => b.completed - a.completed)
      .slice(0, 5);
  }

  constructor(
    private firebaseService: FirebaseService,
    public authService: AuthService
  ) {}

  ngOnInit(): void {}

  @HostListener('window:resize')
  onWindowResize(): void {
    if (!this.isMobileView && this.historyFilterCollapsed) {
      this.historyFilterCollapsed = false;
    }
    this.refreshMapSize();
  }

  private refreshMapSize(): void {
    if (this.map) {
      setTimeout(() => this.map.invalidateSize(), 200);
    }
  }

  ngAfterViewInit(): void {
    this.initMap();
    this.unsubLocations = this.firebaseService.watchDeliveryLocations((users) => {
      this.deliveryUsers = users;
      if (this.mapView === 'live') this.updateMarkers(users);
    });
    this.unsubPromoOrders = this.firebaseService.watchPromoOrders((orders) => {
      this.promoOrders = orders;
    });
  }

  ngOnDestroy(): void {
    this.unsubLocations?.();
    this.unsubPromoOrders?.();
    this.unsubHistory?.();
    if (this.map) this.map.remove();
  }

  private todayStr(): string {
    return new Date().toISOString().slice(0, 10);
  }

  private dateRangeMs(): { fromMs: number; toMs: number } {
    const from = new Date(this.fromDate + 'T00:00:00');
    const to   = new Date(this.toDate   + 'T23:59:59.999');
    return { fromMs: from.getTime(), toMs: to.getTime() };
  }

  private initMap(): void {
    this.map = L.map('delivery-map-el', { center: [13.7942, -88.8965], zoom: 11 });
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
    }).addTo(this.map);
    setTimeout(() => this.map.invalidateSize(), 200);
  }

  setView(view: 'live' | 'history'): void {
    if (this.mapView === view) return;
    this.mapView = view;
    this.selectedUser = null;
    this.selectedRecord = null;
    this.historyFilterCollapsed = view === 'history' ? this.isMobileView : false;
    this.clearRouteLayer();
    this.refreshMapSize();

    if (view === 'live') {
      this.clearHistoryMarkers();
      this.updateMarkers(this.deliveryUsers);
    } else {
      this.clearLiveMarkers();
      this.subscribeHistory();
    }
  }

  applyDateFilter(): void {
    if (this.unsubHistory) { this.unsubHistory(); this.unsubHistory = null; }
    this.historyRecords = [];
    this.historyLoaded = false;
    this.selectedRecord = null;
    this.clearRouteLayer();
    this.clearHistoryMarkers();
    this.subscribeHistory();
    if (this.isMobileView) {
      this.historyFilterCollapsed = true;
      this.refreshMapSize();
    }
  }

  toggleHistoryFilter(): void {
    this.historyFilterCollapsed = !this.historyFilterCollapsed;
    this.refreshMapSize();
  }

  private subscribeHistory(): void {
    const { fromMs, toMs } = this.dateRangeMs();
    this.unsubHistory = this.firebaseService.watchDeliveryHistory((records) => {
      this.historyRecords = records;
      this.historyLoaded = true;
      if (this.mapView === 'history') this.renderHistoryMarkers();
    }, fromMs, toMs);
  }

  private clearLiveMarkers(): void {
    this.markers.forEach(m => m.remove());
    this.markers.clear();
  }

  private clearHistoryMarkers(): void {
    this.historyMarkers.forEach(m => m.remove());
    this.historyMarkers = [];
  }

  private clearRouteLayer(): void {
    if (this.routeLayer) { this.routeLayer.clearLayers(); this.routeLayer.remove(); this.routeLayer = null; }
  }

  private updateMarkers(users: any[]): void {
    const currentIds = new Set(users.map((u: any) => u.userId));
    this.markers.forEach((m, uid) => {
      if (!currentIds.has(uid)) { m.remove(); this.markers.delete(uid); }
    });

    users.forEach((user: any) => {
      if (!user.lat || !user.lng) return;
      const icon = this.buildIcon(user.status, user.vehicleType);
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

  private renderHistoryMarkers(): void {
    this.clearHistoryMarkers();
    const withCoords = this.historyRecords.filter(r => r.endLat && r.endLng);
    withCoords.forEach(record => {
      const icon = this.buildHistoryIcon(record.status);
      const m = L.marker([record.endLat, record.endLng], { icon })
        .addTo(this.map)
        .on('click', () => this.selectRecordFromList(record));
      this.historyMarkers.push(m);
    });
    if (withCoords.length > 0) {
      const coords = this.historyMarkers.map(m => m.getLatLng());
      if (coords.length === 1) {
        this.map.setView(coords[0], 14);
      } else {
        this.map.fitBounds(L.latLngBounds(coords), { padding: [40, 40] });
      }
    }
  }

  private showRouteForRecord(record: any): void {
    this.clearRouteLayer();
    this.routeLayer = L.layerGroup().addTo(this.map);
    const points: L.LatLng[] = [];

    if (record.startLat && record.startLng) {
      L.marker([record.startLat, record.startLng], { icon: this.buildRoutePointIcon() }).addTo(this.routeLayer);
      points.push(L.latLng(record.startLat, record.startLng));
    }
    if (record.endLat && record.endLng) {
      points.push(L.latLng(record.endLat, record.endLng));
    }

    if (points.length === 2) {
      const color = record.status === 'cancelled' ? '#ef4444' : '#6366f1';
      L.polyline(points, { color, weight: 3, opacity: 0.7, dashArray: '6 4' }).addTo(this.routeLayer);
      this.map.fitBounds(L.latLngBounds(points), { padding: [60, 60] });
    } else if (points.length === 1) {
      this.map.setView(points[0], 15);
    }
  }

  vehicleIcon(vehicleType: string): string {
    const map: Record<string, string> = {
      motorcycle: 'fa-motorcycle',
      bicycle:    'fa-bicycle',
      car:        'fa-car',
      truck:      'fa-truck'
    };
    return map[vehicleType] || 'fa-motorcycle';
  }

  private buildIcon(status: string, vehicleType?: string): L.DivIcon {
    const active = status === 'active';
    const icon = this.vehicleIcon(vehicleType || 'motorcycle');
    return L.divIcon({
      className: '',
      html: `<div class="dm-pin ${active ? 'dm-pin--active' : 'dm-pin--available'}">
        <i class="fas ${icon}"></i>
        ${active ? '<span class="dm-pin-dot"></span>' : ''}
      </div>`,
      iconSize: [40, 40], iconAnchor: [20, 40], popupAnchor: [0, -42]
    });
  }

  private buildHistoryIcon(status: string): L.DivIcon {
    const done = status !== 'cancelled';
    return L.divIcon({
      className: '',
      html: `<div class="dm-pin ${done ? 'dm-pin--done' : 'dm-pin--cancelled'}">
        <i class="fas ${done ? 'fa-check' : 'fa-times'}"></i>
      </div>`,
      iconSize: [36, 36], iconAnchor: [18, 36], popupAnchor: [0, -38]
    });
  }

  private buildRoutePointIcon(): L.DivIcon {
    return L.divIcon({
      className: '',
      html: `<div class="dm-pin dm-pin--start"><i class="fas fa-dot-circle"></i></div>`,
      iconSize: [30, 30], iconAnchor: [15, 30], popupAnchor: [0, -32]
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
    this.refreshMapSize();
  }

  selectUserFromList(user: any): void { this.selectUser(user); }

  selectRecordFromList(record: any): void {
    this.selectedRecord = record;
    this.showRouteForRecord(record);
    this.refreshMapSize();
  }

  closePanel(): void {
    this.selectedUser = null;
    this.selectedRecord = null;
    this.selectedMessages = [];
    this.clearRouteLayer();
    this.refreshMapSize();
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

  recordTimeAgo(record: any): string {
    const ms = record.completedAt?.toMillis?.() ?? (record.completedAt?.seconds ? record.completedAt.seconds * 1000 : null);
    if (!ms) return '';
    const diff = Math.floor((Date.now() - ms) / 1000);
    if (diff < 60) return 'hace un momento';
    if (diff < 3600) return `hace ${Math.floor(diff / 60)} min`;
    if (diff < 86400) return `hace ${Math.floor(diff / 3600)}h`;
    return new Date(ms).toLocaleDateString('es-SV', { day: '2-digit', month: 'short' });
  }

  recordFullDate(record: any): string {
    const ms = record.completedAt?.toMillis?.() ?? (record.completedAt?.seconds ? record.completedAt.seconds * 1000 : null);
    if (!ms) return '';
    return new Date(ms).toLocaleString('es-SV', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
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
