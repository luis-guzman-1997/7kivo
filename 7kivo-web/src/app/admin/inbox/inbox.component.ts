import { Component, OnInit, OnDestroy } from '@angular/core';
import { Router } from '@angular/router';
import { FirebaseService } from '../../services/firebase.service';
import { AuthService } from '../../services/auth.service';
import { PushNotificationService } from '../../services/push-notification.service';

interface FlowTab {
  flowId: string;
  flowName: string;
  collection: string;
  type: string;
  submissions: any[];
  filteredSubmissions: any[];
  loading: boolean;
  unreadCount: number;
  isAppointment: boolean;
}

interface CalendarDay {
  date: Date;
  label: string;
  dayNum: number;
  isToday: boolean;
  isPast: boolean;
  isCurrentMonth: boolean;
  appointments: any[];
}

@Component({
  selector: 'app-inbox',
  templateUrl: './inbox.component.html',
  styleUrls: ['./inbox.component.css']
})
export class InboxComponent implements OnInit, OnDestroy {
  tabs: FlowTab[] = [];
  activeTabIndex = 0;
  loading = true;
  searchTerm = '';
  statusFilter = 'all';

  selectedItem: any = null;
  selectedTab: FlowTab | null = null;

  collectionDefsMap: Record<string, any> = {};

  showReschedule = false;
  rescheduleDate = '';
  rescheduleTime = '';
  rescheduleSaving = false;

  viewMode: 'list' | 'calendar' = 'list';
  calendarDays: CalendarDay[] = [];
  calendarMonth: Date = new Date();
  selectedCalendarDay: CalendarDay | null = null;
  weekDays = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];

  private refreshTimer: any = null;

  // ── Promo Orders (delivery orgs) ──
  promoOrders: any[] = [];
  promoOrdersLoaded = false;
  takingPromoOrderId: string | null = null;
  promoOrderError = '';
  private unsubPromoOrders: (() => void) | null = null;

  get pendingPromoOrders(): any[] { return this.promoOrders.filter(o => o.status === 'pending'); }
  get activePromoOrders(): any[] { return this.promoOrders.filter(o => o.status === 'pending' || o.status === 'taken'); }
  get cancelledPromoOrders(): any[] {
    return this.promoOrders.filter(o => o.status === 'cancelled' &&
      (!this.isDelivery || o.assignedTo?.uid === this.currentUserId));
  }

  get isDeliveryOrg(): boolean { return this.authService.orgIndustry === 'delivery'; }

  // ── Delivery state ──
  currentUserId = '';
  currentUserName = '';
  currentUserEmail = '';
  currentUserWaPhone = '';
  takingCaseId: string | null = null;
  takeError = '';

  // ── Location tracking ──
  locationGranted = false;
  locationDenied = false;   // solo true si el permiso fue explícitamente rechazado
  locationError = '';       // mensaje descriptivo del error
  private watchId: number | null = null;
  private locationInterval: any = null;
  private currentLat: number | null = null;
  private currentLng: number | null = null;

  // ── Push notifications ──
  pushPermission: NotificationPermission = 'default';
  showPushInstructions = false;

  get pushEnabled(): boolean { return this.pushPermission === 'granted'; }
  get pushDenied(): boolean  { return this.pushPermission === 'denied'; }

  get pushInstructionsText(): string {
    const ua = navigator.userAgent.toLowerCase();
    if (ua.includes('android') && ua.includes('chrome')) {
      return 'En Chrome Android: toca los 3 puntos (⋮) → Configuración → Configuración del sitio → Notificaciones → busca esta página y actívala.';
    }
    if (ua.includes('iphone') || ua.includes('ipad')) {
      return 'En iOS Safari: ve a Ajustes del iPhone → Safari → Notificaciones → activa los permisos para esta página.';
    }
    if (ua.includes('firefox')) {
      return 'En Firefox: haz clic en el candado (🔒) de la barra de direcciones → Permisos → Recibir notificaciones → Permitir.';
    }
    return 'Haz clic en el candado (🔒) o el ícono de información en la barra de direcciones → Permisos del sitio → Notificaciones → Permitir.';
  }

  get isDelivery(): boolean {
    return this.authService.userRole === 'delivery';
  }

  get hasActiveDeliveryCase(): boolean {
    const hasFlowCase = this.tabs.some(t => this.deliveryMyCases(t).length > 0);
    const hasPromoCase = this.promoOrders.some(o => o.status === 'taken' && o.assignedTo?.uid === this.currentUserId);
    return hasFlowCase || hasPromoCase;
  }

  constructor(
    private firebaseService: FirebaseService,
    public authService: AuthService,
    private router: Router,
    public pushService: PushNotificationService
  ) {}

  async ngOnInit(): Promise<void> {
    await this.loadCurrentUserInfo();
    await this.loadFlows();
    const interval = this.isDelivery ? 20000 : 300000;
    this.refreshTimer = setInterval(() => this.silentRefresh(), interval);
    if (this.isDelivery && this.currentUserId) {
      this.checkPushStatus();
      this.startLocationTracking();
    }
    if (this.isDeliveryOrg) {
      this.unsubPromoOrders = this.firebaseService.watchPromoOrders((orders) => {
        this.promoOrders = orders;
        this.promoOrdersLoaded = true;
      });
    }
  }

  ngOnDestroy(): void {
    if (this.refreshTimer) clearInterval(this.refreshTimer);
    if (this.locationInterval) clearInterval(this.locationInterval);
    if (this.watchId !== null) navigator.geolocation.clearWatch(this.watchId);
    if (this.isDelivery && this.currentUserId) {
      this.firebaseService.clearDeliveryLocation(this.currentUserId);
    }
    if (this.unsubPromoOrders) this.unsubPromoOrders();
  }

  startLocationTracking(): void {
    if (!navigator.geolocation) {
      this.locationDenied = true;
      this.locationError = 'Tu navegador no soporta geolocalización.';
      return;
    }
    this.locationError = '';
    this.locationDenied = false;

    const onSuccess = (pos: GeolocationPosition) => {
      this.locationGranted = true;
      this.locationError = '';
      this.currentLat = pos.coords.latitude;
      this.currentLng = pos.coords.longitude;
      this.pushLocationToFirebase();
      if (this.watchId !== null) navigator.geolocation.clearWatch(this.watchId);
      this.watchId = navigator.geolocation.watchPosition(
        (p) => { this.currentLat = p.coords.latitude; this.currentLng = p.coords.longitude; },
        () => {},
        { enableHighAccuracy: true, maximumAge: 0, timeout: 15000 }
      );
      if (!this.locationInterval) {
        this.locationInterval = setInterval(() => this.pushLocationToFirebase(), 15000);
      }
    };

    const onError = (err: GeolocationPositionError) => {
      if (err.code === 1) {
        // PERMISSION_DENIED — el usuario rechazó en el navegador
        this.locationDenied = true;
        this.locationError = 'Permiso denegado en el navegador.';
      } else {
        // POSITION_UNAVAILABLE (2) o TIMEOUT (3) — reintenta sin alta precisión
        this.locationError = 'No se pudo obtener la ubicación. Reintentando...';
        navigator.geolocation.getCurrentPosition(
          onSuccess,
          () => {
            this.locationError = 'No se pudo obtener tu ubicación. Verifica que el GPS esté activo y toca "Reintentar".';
          },
          { enableHighAccuracy: false, timeout: 20000, maximumAge: 60000 }
        );
      }
    };

    // Primer intento con alta precisión y timeout generoso para GPS frío
    navigator.geolocation.getCurrentPosition(onSuccess, onError,
      { enableHighAccuracy: true, timeout: 25000, maximumAge: 0 }
    );
  }

  private async pushLocationToFirebase(): Promise<void> {
    if (!this.currentUserId || this.currentLat === null || this.currentLng === null) return;
    let activeCaseId: string | null = null;
    let activeCollection: string | null = null;
    let activePhone: string | null = null;
    const status: 'available' | 'active' = this.hasActiveDeliveryCase ? 'active' : 'available';
    if (status === 'active') {
      for (const t of this.tabs) {
        const c = this.deliveryMyCases(t)[0];
        if (c) { activeCaseId = c.id; activeCollection = t.collection; activePhone = c.phoneNumber || null; break; }
      }
    }
    try {
      await this.firebaseService.updateDeliveryLocation(this.currentUserId, {
        userId: this.currentUserId,
        userName: this.currentUserName || this.currentUserEmail,
        lat: this.currentLat,
        lng: this.currentLng,
        status,
        activeCaseId,
        activeCollection,
        activePhone
      });
    } catch { /* silent */ }
  }

  private async silentRefresh(): Promise<void> {
    if (this.takingCaseId) return;
    const prevCount = this.isDelivery ? this.deliveryTotalAvailable : 0;
    await Promise.all(this.tabs.map(tab => this.loadTabSubmissions(tab)));
    if (this.isDelivery && this.deliveryTotalAvailable > prevCount) {
      this.playNotificationSound();
    }
  }

  checkPushStatus(): void {
    if (!this.pushService.isSupported) return;
    this.pushPermission = (Notification.permission as NotificationPermission);
    if (this.pushPermission === 'granted') {
      this.pushService.subscribe(this.currentUserId);
    }
  }

  async enablePushNotifications(): Promise<void> {
    const result = await Notification.requestPermission();
    this.pushPermission = result;
    if (result === 'granted') {
      await this.pushService.subscribe(this.currentUserId);
    } else {
      this.showPushInstructions = true;
    }
  }

  private playNotificationSound(): void {
    try {
      const ctx = new AudioContext();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.type = 'sine';
      osc.frequency.value = 880;
      gain.gain.setValueAtTime(0.3, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.5);
      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + 0.5);
    } catch { /* silent if browser blocks audio */ }
  }

  async loadCurrentUserInfo(): Promise<void> {
    const uid = this.authService.currentUser?.uid;
    if (!uid) return;
    this.currentUserId = uid;
    this.currentUserEmail = this.authService.currentUser?.email || '';
    try {
      const userData = await this.firebaseService.getUserOrg(uid);
      this.currentUserName = userData?.name || this.currentUserEmail;
      this.currentUserWaPhone = userData?.whatsappPhone || '';
    } catch { /* silent */ }
  }

  async loadFlows(): Promise<void> {
    this.loading = true;
    try {
      const [flows, colDefs] = await Promise.all([
        this.firebaseService.getFlows(),
        this.firebaseService.getCollectionDefs()
      ]);

      this.collectionDefsMap = {};
      colDefs.forEach((c: any) => { this.collectionDefsMap[c.slug] = c; });

      const inboxFlows = flows.filter((f: any) => {
        const base = f.saveToCollection && f.saveToCollection !== 'applicants' && f.saveToCollection !== 'contacts';
        if (this.isDelivery) return base && f.notifyDelivery === true;
        return base;
      });

      this.tabs = inboxFlows.map((f: any) => ({
        flowId: f.id,
        flowName: f.name,
        collection: f.saveToCollection,
        type: f.type,
        submissions: [],
        filteredSubmissions: [],
        loading: true,
        unreadCount: 0,
        isAppointment: f.type === 'appointment' ||
          (f.steps && f.steps.some((s: any) => s.type === 'appointment_slot'))
      }));

      await Promise.all(this.tabs.map(tab => this.loadTabSubmissions(tab)));
    } catch (err) {
      console.error('Error loading flows:', err);
    } finally {
      this.loading = false;
    }
  }

  async loadTabSubmissions(tab: FlowTab): Promise<void> {
    tab.loading = true;
    try {
      const items = await this.firebaseService.getFlowSubmissions(tab.collection);
      tab.submissions = items;
      tab.unreadCount = items.filter(i => i.status === 'pending').length;
      this.applyFilters(tab);
    } catch (err) {
      console.error(`Error loading ${tab.collection}:`, err);
      tab.submissions = [];
      tab.filteredSubmissions = [];
    } finally {
      tab.loading = false;
    }
  }

  get activeTab(): FlowTab | null {
    return this.tabs[this.activeTabIndex] || null;
  }

  get totalUnread(): number {
    return this.tabs.reduce((sum, t) => sum + t.unreadCount, 0);
  }

  switchTab(index: number): void {
    this.activeTabIndex = index;
    this.searchTerm = '';
    this.statusFilter = 'all';
    this.selectedCalendarDay = null;
    if (this.activeTab) {
      this.viewMode = this.activeTab.isAppointment ? 'calendar' : 'list';
      this.applyFilters(this.activeTab);
      if (this.activeTab.isAppointment) {
        this.buildCalendar();
      }
    }
  }

  applyFilters(tab?: FlowTab): void {
    const t = tab || this.activeTab;
    if (!t) return;

    let filtered = [...t.submissions];

    if (this.statusFilter !== 'all') {
      filtered = filtered.filter(s => s.status === this.statusFilter);
    }

    if (this.searchTerm.trim()) {
      const term = this.searchTerm.toLowerCase();
      filtered = filtered.filter(s => {
        return Object.values(s).some(val =>
          typeof val === 'string' && val.toLowerCase().includes(term)
        );
      });
    }

    t.filteredSubmissions = filtered;
  }

  async markAsRead(item: any, tab: FlowTab): Promise<void> {
    if (item.status === 'pending') {
      try {
        await this.firebaseService.updateDocument(tab.collection, item.id, { status: 'read' });
        item.status = 'read';
        tab.unreadCount = tab.submissions.filter(i => i.status === 'pending').length;
      } catch (err) {
        console.error('Error updating status:', err);
      }
    }
  }

  async markAsResolved(item: any, tab: FlowTab): Promise<void> {
    try {
      const uid = this.authService.currentUser?.uid || '';
      const email = this.authService.currentUser?.email || '';
      const name = this.currentUserName || email;
      await this.firebaseService.updateDocument(tab.collection, item.id, {
        status: 'resolved',
        resolvedBy: { uid, name, email }
      });
      item.status = 'resolved';
      item.resolvedBy = { uid, name, email };
      tab.unreadCount = tab.submissions.filter(i => i.status === 'pending').length;
      this.applyFilters(tab);
    } catch (err) {
      console.error('Error updating status:', err);
    }
  }

  openDetail(item: any, tab: FlowTab): void {
    this.selectedItem = item;
    this.selectedTab = tab;
    this.markAsRead(item, tab);
  }

  closeDetail(): void {
    this.selectedItem = null;
    this.selectedTab = null;
    this.showReschedule = false;
  }

  openReschedule(): void {
    if (!this.selectedItem) return;
    this.rescheduleDate = this.selectedItem._apptFecha || '';
    this.rescheduleTime = this.selectedItem._apptHora || this.selectedItem.hora || '';
    this.showReschedule = true;
  }

  cancelReschedule(): void {
    this.showReschedule = false;
  }

  async confirmReschedule(): Promise<void> {
    if (!this.selectedItem || !this.selectedTab || !this.rescheduleDate || !this.rescheduleTime) return;
    this.rescheduleSaving = true;
    try {
      const dateObj = new Date(this.rescheduleDate + 'T00:00:00');
      const dayNames = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
      const monthNames = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
      const label = `${dayNames[dateObj.getDay()]} ${dateObj.getDate()} ${monthNames[dateObj.getMonth()]}`;

      const updates: any = {
        _apptFecha: this.rescheduleDate,
        _apptHora: this.rescheduleTime,
        fecha: label,
        hora: this.rescheduleTime,
        status: 'pending'
      };

      await this.firebaseService.updateDocument(this.selectedTab.collection, this.selectedItem.id, updates);

      const tab = this.selectedTab;
      this.closeDetail();
      this.viewMode = 'calendar';
      await this.loadTabSubmissions(tab);
      this.buildCalendar();
    } catch (err) {
      console.error('Error rescheduling:', err);
    } finally {
      this.rescheduleSaving = false;
    }
  }

  getPersonName(item: any): string {
    return item.fullName || item.name || item.nombre || 'Sin nombre';
  }

  getItemFields(item: any, tab?: FlowTab | null): { label: string; value: string }[] {
    const fields: { label: string; value: string }[] = [];
    const skip = ['id', 'status', 'createdAt', 'updatedAt', 'organizationId', 'schoolId',
                   'flowId', 'flowName', 'phoneNumber', 'confirmed', 'assignedTo', 'resolvedBy',
                   'deliveryCode', 'cancelCount', 'assignedAt'];

    const collection = tab?.collection || this.selectedTab?.collection || '';
    const colDef = this.collectionDefsMap[collection];

    for (const [key, val] of Object.entries(item)) {
      if (skip.includes(key) || val === null || val === undefined || val === '') continue;
      if (typeof val === 'object') continue;
      if (key.startsWith('_')) continue;
      if (key.endsWith('Id')) continue;
      fields.push({ label: this.fieldLabel(key, colDef), value: String(val) });
    }
    return fields;
  }

  fieldLabel(key: string, colDef?: any): string {
    if (colDef && colDef.fields) {
      const field = colDef.fields.find((f: any) => f.key === key);
      if (field && field.label) return field.label;
    }

    const labels: Record<string, string> = {
      fullName: 'Nombre Completo', name: 'Nombre', nombre: 'Nombre',
      age: 'Edad', edad: 'Edad', courseType: 'Tipo de Curso',
      curso: 'Curso', instrument: 'Instrumento', instrumento: 'Instrumento',
      motivo: 'Motivo', fecha: 'Fecha', hora: 'Hora',
      comment: 'Comentario', email: 'Email', message: 'Mensaje',
      question: 'Pregunta', subject: 'Asunto', direccion: 'Dirección',
      telefono: 'Teléfono', descripcion: 'Descripción'
    };
    return labels[key] || key.replace(/([A-Z])/g, ' $1').replace(/^./, s => s.toUpperCase());
  }

  getWhatsAppLink(phone: string): string {
    const cleaned = phone?.replace(/[^0-9]/g, '') || '';
    return `https://wa.me/${cleaned}`;
  }

  getWhatsAppMessageLink(phone: string, name: string): string {
    const cleaned = phone?.replace(/[^0-9]/g, '') || '';
    const msg = encodeURIComponent(`Hola ${name}, respecto a tu consulta. `);
    return `https://wa.me/${cleaned}?text=${msg}`;
  }

  formatDate(timestamp: any): string {
    if (!timestamp?.seconds) return 'N/A';
    return new Date(timestamp.seconds * 1000).toLocaleDateString('es-SV', {
      day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit'
    });
  }

  getStatusLabel(status: string): string {
    const labels: Record<string, string> = {
      pending: 'Nuevo', read: 'Leído', resolved: 'Resuelto'
    };
    return labels[status] || status;
  }

  getTabIcon(type: string): string {
    const icons: Record<string, string> = {
      inquiry: 'fa-comments', feedback: 'fa-star', registration: 'fa-user-plus',
      custom: 'fa-cogs', appointment: 'fa-calendar-check'
    };
    return icons[type] || 'fa-inbox';
  }

  // ==================== Calendar ====================

  get calendarMonthLabel(): string {
    return this.calendarMonth.toLocaleDateString('es-SV', { month: 'long', year: 'numeric' });
  }

  toggleView(mode: 'list' | 'calendar'): void {
    this.viewMode = mode;
    this.selectedCalendarDay = null;
    if (mode === 'calendar') this.buildCalendar();
  }

  prevMonth(): void {
    const d = new Date(this.calendarMonth);
    d.setMonth(d.getMonth() - 1);
    this.calendarMonth = d;
    this.selectedCalendarDay = null;
    this.buildCalendar(false);
  }

  nextMonth(): void {
    const d = new Date(this.calendarMonth);
    d.setMonth(d.getMonth() + 1);
    this.calendarMonth = d;
    this.selectedCalendarDay = null;
    this.buildCalendar(false);
  }

  goToday(): void {
    this.calendarMonth = new Date();
    this.selectedCalendarDay = null;
    this.buildCalendar(true);
  }

  buildCalendar(autoSelect = true): void {
    const tab = this.activeTab;
    if (!tab) return;

    const year = this.calendarMonth.getFullYear();
    const month = this.calendarMonth.getMonth();
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);

    const startOffset = firstDay.getDay();
    const startDate = new Date(firstDay);
    startDate.setDate(startDate.getDate() - startOffset);

    const endOffset = 6 - lastDay.getDay();
    const endDate = new Date(lastDay);
    endDate.setDate(endDate.getDate() + endOffset);

    const apptMap = this.buildAppointmentMap(tab.submissions);

    const days: CalendarDay[] = [];
    const cursor = new Date(startDate);
    while (cursor <= endDate) {
      const dateKey = this.dateKey(cursor);
      const d = new Date(cursor);
      d.setHours(0, 0, 0, 0);
      days.push({
        date: new Date(cursor),
        label: dateKey,
        dayNum: cursor.getDate(),
        isToday: d.getTime() === today.getTime(),
        isPast: d < today,
        isCurrentMonth: cursor.getMonth() === month,
        appointments: apptMap[dateKey] || []
      });
      cursor.setDate(cursor.getDate() + 1);
    }
    this.calendarDays = days;

    if (autoSelect && !this.selectedCalendarDay) {
      const todayKey = this.dateKey(new Date());
      const nextDay = days.find(d => d.label >= todayKey && d.appointments.length > 0);
      if (nextDay) this.selectedCalendarDay = nextDay;
    }
  }

  private buildAppointmentMap(items: any[]): Record<string, any[]> {
    const map: Record<string, any[]> = {};
    for (const item of items) {
      const dateStr = item._apptFecha || item._apptfecha || item.date || item.fecha || '';
      if (!dateStr) continue;
      const key = this.normalizeDateKey(dateStr);
      if (!key) continue;
      if (!map[key]) map[key] = [];
      map[key].push(item);
    }
    for (const key of Object.keys(map)) {
      map[key].sort((a: any, b: any) => {
        const ha = a._apptHora || a.hora || a.time || '00:00';
        const hb = b._apptHora || b.hora || b.time || '00:00';
        return ha.localeCompare(hb);
      });
    }
    return map;
  }

  private normalizeDateKey(dateStr: string): string {
    if (/^\d{4}-\d{2}-\d{2}/.test(dateStr)) {
      return dateStr.substring(0, 10);
    }
    const parts = dateStr.match(/(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/);
    if (parts) {
      return `${parts[3]}-${parts[2].padStart(2, '0')}-${parts[1].padStart(2, '0')}`;
    }
    const d = new Date(dateStr);
    if (!isNaN(d.getTime())) return this.dateKey(d);
    return '';
  }

  private dateKey(d: Date): string {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  selectCalendarDay(day: CalendarDay): void {
    this.selectedCalendarDay = this.selectedCalendarDay?.label === day.label ? null : day;
  }

  getAppointmentTime(item: any): string {
    return item._apptHora || item.hora || item.time || '';
  }

  getAppointmentDuration(item: any): string {
    const dur = item._apptDuration;
    if (!dur) return '';
    return `${dur} min`;
  }

  getDayAppointmentCount(day: CalendarDay): number {
    return day.appointments.length;
  }

  getItemDateKey(item: any): string {
    const raw = item._apptFecha || item._apptfecha || item.date || item.fecha || '';
    return this.normalizeDateKey(raw);
  }

  // ==================== Delivery ====================

  deliveryAvailableCases(tab: FlowTab): any[] {
    return tab.submissions.filter(s =>
      !s.assignedTo && s.status !== 'resolved'
    );
  }

  deliveryMyCases(tab: FlowTab): any[] {
    return tab.submissions.filter(s =>
      s.assignedTo?.uid === this.currentUserId && s.status !== 'resolved'
    );
  }

  deliveryMyHistory(tab: FlowTab): any[] {
    return tab.submissions.filter(s =>
      s.assignedTo?.uid === this.currentUserId && s.status === 'resolved'
    );
  }

  get deliveryTotalAvailable(): number {
    return this.tabs.reduce((sum, t) => sum + this.deliveryAvailableCases(t).length, 0);
  }

  private generateDeliveryCode(): string {
    return String(Math.floor(10000 + Math.random() * 90000));
  }

  getDeliveryWhatsAppMessageLink(phone: string, clientName: string, deliveryCode?: string): string {
    const cleaned = phone?.replace(/[^0-9]/g, '') || '';
    let msg: string;
    if (deliveryCode) {
      msg = `Hola${clientName ? ' ' + clientName : ''}! 😊\n\nSoy *${this.currentUserName || 'tu Delivery'}* y he tomado tu solicitud.\n\nMi clave es *${deliveryCode}*\n\nVoy a coordinar tu solicitud. 🚗`;
    } else {
      msg = `Hola${clientName ? ' ' + clientName : ''}! 😊\n\nSoy *${this.currentUserName || 'tu Delivery'}* y he tomado tu solicitud.\n\nVoy a coordinar tu solicitud. 🚗`;
    }
    return `https://wa.me/${cleaned}?text=${encodeURIComponent(msg)}`;
  }

  async takeCase(item: any, tab: FlowTab): Promise<void> {
    if (this.takingCaseId) return;

    // Requiere ubicación activa
    if (!this.locationGranted) {
      this.takeError = 'Debes activar tu ubicación para tomar pedidos.';
      setTimeout(() => this.takeError = '', 5000);
      return;
    }

    // No se permite tomar si ya tiene un caso activo en cualquier tab
    const hasActive = this.tabs.some(t => this.deliveryMyCases(t).length > 0);
    if (hasActive) {
      this.takeError = 'Ya tienes un caso activo. Resuélvelo antes de tomar otro.';
      setTimeout(() => this.takeError = '', 4000);
      return;
    }

    this.takingCaseId = item.id;
    this.takeError = '';

    const deliveryCode = this.generateDeliveryCode();

    try {
      const agent = {
        uid: this.currentUserId,
        name: this.currentUserName,
        email: this.currentUserEmail,
        whatsappPhone: this.currentUserWaPhone,
        deliveryCode
      };

      const result = await this.firebaseService.assignSubmission(tab.collection, item.id, agent);

      if (!result.ok) {
        this.takeError = `Este caso ya fue tomado por ${result.takenBy || 'otro Delivery'}.`;
        setTimeout(() => this.takeError = '', 4000);
        await this.loadTabSubmissions(tab);
        return;
      }

      // Enviar mensaje WA al cliente via bot
      const botApiUrl = this.authService.botApiUrl;
      const orgId = this.firebaseService.getOrgId();
      if (botApiUrl && item.phoneNumber) {
        try {
          await fetch(`${botApiUrl}/api/${orgId}/take-delivery-case`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              phone: item.phoneNumber,
              clientName: this.getPersonName(item),
              deliveryCode,
              deliveryName: this.currentUserName || '',
              deliveryWaPhone: this.currentUserWaPhone || ''
            })
          });
        } catch { /* silent — no bloquea el flujo */ }
      }

      await this.loadTabSubmissions(tab);

      // Actualizar estado de ubicación a 'active'
      this.pushLocationToFirebase();

      // Navegar al chat con este cliente
      if (item.phoneNumber) {
        this.router.navigate(['/admin/chat'], {
          queryParams: {
            phone: item.phoneNumber,
            submissionId: item.id,
            collection: tab.collection,
            deliveryCode,
            takenAt: Date.now()
          }
        });
      }
    } catch (err) {
      this.takeError = 'Error al tomar el caso. Intenta de nuevo.';
      setTimeout(() => this.takeError = '', 4000);
    } finally {
      this.takingCaseId = null;
    }
  }

  async takePromoOrder(order: any): Promise<void> {
    if (this.takingPromoOrderId) return;
    if (this.isDelivery && this.hasActiveDeliveryCase) {
      this.promoOrderError = 'Resuelve tu caso activo antes de tomar otro pedido.';
      setTimeout(() => this.promoOrderError = '', 5000);
      return;
    }
    if (this.isDelivery && !this.locationGranted) {
      this.promoOrderError = 'Debes activar tu ubicación para tomar pedidos.';
      setTimeout(() => this.promoOrderError = '', 5000);
      return;
    }
    this.takingPromoOrderId = order.id;
    this.promoOrderError = '';
    const deliveryCode = this.generateDeliveryCode();
    try {
      const agent = {
        uid: this.currentUserId,
        name: this.currentUserName || this.currentUserEmail,
        email: this.currentUserEmail,
        deliveryCode
      };
      const result = await this.firebaseService.takePromoOrder(order.id, agent);
      if (!result.ok) {
        this.promoOrderError = `Este pedido ya fue tomado por ${result.takenBy || 'otro Delivery'}.`;
        setTimeout(() => this.promoOrderError = '', 4000);
        return;
      }

      // Enviar mensaje WA al cliente con código delivery (igual que flujos normales)
      const botApiUrl = this.authService.botApiUrl;
      const orgId = this.firebaseService.getOrgId();
      if (botApiUrl && order.phone) {
        fetch(`${botApiUrl}/api/${orgId}/take-delivery-case`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            phone: order.phone,
            clientName: '',
            deliveryCode,
            deliveryName: this.currentUserName || '',
            deliveryWaPhone: this.currentUserWaPhone || ''
          })
        }).catch(() => {});
      }

      this.pushLocationToFirebase();
      this.router.navigate(['/admin/chat'], {
        queryParams: { phone: order.phone, promoOrderId: order.id, deliveryCode, takenAt: Date.now() }
      });
    } catch {
      this.promoOrderError = 'Error al tomar el pedido.';
      setTimeout(() => this.promoOrderError = '', 4000);
    } finally {
      this.takingPromoOrderId = null;
    }
  }

  async resolvePromoOrder(order: any, event: Event): Promise<void> {
    event.stopPropagation();
    try {
      await this.firebaseService.resolvePromoOrder(order.id);
    } catch { /* silent */ }
  }

  async cancelPromoOrder(order: any, event: Event): Promise<void> {
    event.stopPropagation();
    try {
      await this.firebaseService.cancelPromoOrder(order.id);
    } catch { /* silent */ }
  }

  openPromoChat(order: any): void {
    const takenAt = order.takenAt?.seconds
      ? order.takenAt.seconds * 1000
      : (order.takenAt?.toMillis?.() || Date.now());
    this.router.navigate(['/admin/chat'], {
      queryParams: { phone: order.phone, promoOrderId: order.id, takenAt }
    });
  }

  promoWaLink(phone: string): string {
    return 'https://wa.me/' + (phone || '').replace(/[^0-9]/g, '');
  }

  promoTimeAgo(order: any): string {
    const seconds = order.createdAt?.seconds;
    if (!seconds) return '';
    const diff = Math.floor((Date.now() / 1000) - seconds);
    if (diff < 60) return 'Hace un momento';
    if (diff < 3600) return `Hace ${Math.floor(diff / 60)} min`;
    return `Hace ${Math.floor(diff / 3600)} h`;
  }

  goToChat(item: any, tab: FlowTab): void {
    const code = item.deliveryCode || item.assignedTo?.deliveryCode;
    const takenAt = item.assignedAt?.seconds
      ? item.assignedAt.seconds * 1000
      : item.assignedAt?.toMillis?.() || null;
    this.router.navigate(['/admin/chat'], {
      queryParams: {
        phone: item.phoneNumber,
        submissionId: item.id,
        collection: tab.collection,
        ...(code ? { deliveryCode: code } : {}),
        ...(takenAt ? { takenAt } : {})
      }
    });
  }
}
