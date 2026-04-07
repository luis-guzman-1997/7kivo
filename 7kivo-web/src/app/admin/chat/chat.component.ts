import { Component, OnInit, OnDestroy, ViewChild, ElementRef, ChangeDetectorRef } from '@angular/core';
import { Router, ActivatedRoute } from '@angular/router';
import { FirebaseService } from '../../services/firebase.service';
import { AuthService } from '../../services/auth.service';
import { environment } from '../../../environments/environment';
import { Unsubscribe } from 'firebase/firestore';

interface Conversation {
  id: string;
  phoneNumber: string;
  contactName?: string;
  lastMessageAt?: any;
  lastUserMessageMs?: number;
  unreadCount?: number;
  mode?: 'bot' | 'admin';
  modeAdminName?: string;
  session?: any;
}

interface ChatMessage {
  id: string;
  from: 'user' | 'bot' | 'admin';
  text: string;
  type?: string;
  imageUrl?: string;
  audioUrl?: string;
  duration?: number;
  locationData?: { text: string; lat: number; lng: number; name?: string; address?: string };
  timestamp?: any;
  createdMs?: number;
  adminName?: string;
  adminEmail?: string;
}

@Component({
  selector: 'app-chat',
  templateUrl: './chat.component.html',
  styleUrls: ['./chat.component.css']
})
export class ChatComponent implements OnInit, OnDestroy {
  @ViewChild('messagesContainer') messagesContainer!: ElementRef;
  @ViewChild('imageInput') imageInput!: ElementRef;
  @ViewChild('audioPreviewEl') audioPreviewEl!: ElementRef;

  conversations: Conversation[] = [];
  filteredConversations: Conversation[] = [];
  selectedConversation: Conversation | null = null;
  messages: ChatMessage[] = [];
  newMessage = '';
  searchTerm = '';
  loading = true;
  sending = false;
  togglingMode = false;
  error = '';
  personalWhatsApp = '';
  botApiUrl = '';
  showSettings = false;
  settingsPhone = '';
  chatLiveAllowed = true;
  sendingImage = false;

  // ── Audio recording ──
  deliveryAudioEnabled = false;
  deliveryAudioMaxSeconds = 30;
  isRecording = false;
  recordingSeconds = 0;
  sendingAudio = false;
  audioBlob: Blob | null = null;
  audioPreviewUrl: string | null = null;
  private mediaRecorder: MediaRecorder | null = null;
  private audioChunks: BlobPart[] = [];
  private recordingTimer: any = null;
  private recordingStartMs = 0;
  audioDurationSeconds = 0;

  // ── Audio player custom ──
  audioPlayers: Map<string, { el: HTMLAudioElement; playing: boolean; current: number; duration: number }> = new Map();

  // ── Notification sound ──
  private lastMsgCount = -1;

  // ── Delivery mode ──
  isDeliveryMode = false;
  deliveryPhone: string | null = null;
  deliverySubmissionId: string | null = null;
  deliveryCollection: string | null = null;
  deliveryUserName = '';
  deliveryCode = '';
  deliveryTakenAt: number | null = null;
  resolvingCase = false;
  cancellingCase = false;
  resendingCode = false;
  showResendCodeModal = false;
  showCancelModal = false;
  cancelReason = '';
  showResolveModal = false;
  resolveConfirmCode = '';
  resolveCodeError = '';
  deliverySubmission: any = null;
  showDeliveryDetail = false;

  // ── Promo order mode ──
  promoOrderId: string | null = null;
  promoOrderData: any = null;

  private convsUnsub: Unsubscribe | null = null;
  private msgsUnsub: Unsubscribe | null = null;
  private windowTimer: any = null;
  private locationInterval: any = null;
  private locationWatchId: number | null = null;
  private currentLat: number | null = null;
  private currentLng: number | null = null;

  get orgId(): string { return this.firebaseService.getOrgId(); }

  constructor(
    private firebaseService: FirebaseService,
    public authService: AuthService,
    private router: Router,
    private route: ActivatedRoute,
    private cdr: ChangeDetectorRef
  ) {}

  goBackToAdmin(): void {
    this.router.navigate(['/admin']);
  }

  goBack(): void {
    if (this.isDeliveryMode) {
      this.router.navigate(['/admin/bandeja']);
    } else {
      this.selectedConversation = null;
    }
  }

  async ngOnInit(): Promise<void> {
    this.chatLiveAllowed = this.authService.getPlanLimits().chatLive;
    await this.loadConfig();

    // Delivery: solo puede ver su caso activo
    if (this.authService.userRole === 'delivery') {
      const params = this.route.snapshot.queryParams;
      const phone = params['phone'];
      // Cargar nombre del delivery para guardarlo al resolver
      const uid = this.authService.currentUser?.uid;
      if (uid) {
        const userData = await this.firebaseService.getUserOrg(uid);
        this.deliveryUserName = userData?.name || this.authService.currentUser?.email || '';
      }

      if (phone) {
        // Viene desde la bandeja con caso específico
        this.isDeliveryMode = true;
        this.deliveryPhone = phone;
        this.deliverySubmissionId = params['submissionId'] || null;
        this.deliveryCollection = params['collection'] || null;
        this.deliveryCode = params['deliveryCode'] || '';
        this.deliveryTakenAt = params['takenAt'] ? +params['takenAt'] : null;
        // ── Promo order ──
        this.promoOrderId = params['promoOrderId'] || null;
        if (this.promoOrderId) {
          try {
            this.promoOrderData = await this.firebaseService.getPromoOrder(this.promoOrderId);
          } catch { /* silent */ }
        }
        if (this.deliverySubmissionId && this.deliveryCollection) {
          const sub = await this.firebaseService.getDocument(this.deliveryCollection, this.deliverySubmissionId);
          this.deliverySubmission = sub || null;
          if (!this.deliveryCode) {
            this.deliveryCode = sub?.deliveryCode || sub?.assignedTo?.deliveryCode || '';
          }
          // Siempre preferir assignedAt del servidor (mismo reloj que los timestamps de mensajes)
          // para evitar desfase entre el reloj del cliente (Date.now()) y el servidor de Firestore
          if (sub?.assignedAt) {
            const assignedMs = sub.assignedAt?.toMillis?.()
              ?? (sub.assignedAt?.seconds ? sub.assignedAt.seconds * 1000 : null);
            if (assignedMs) this.deliveryTakenAt = assignedMs;
          }
        }
      } else {
        // Entró directo al chat — buscar su caso activo
        const activeCase = await this.findMyActiveDeliveryCase();
        if (activeCase) {
          this.isDeliveryMode = true;
          this.deliveryPhone = activeCase.phone;
          this.deliverySubmissionId = activeCase.submissionId;
          this.deliveryCollection = activeCase.collection;
          this.deliveryCode = activeCase.deliveryCode || '';
          try {
            const sub = await this.firebaseService.getDocument(activeCase.collection, activeCase.submissionId);
            this.deliverySubmission = sub;
            if (sub?.assignedAt) {
              this.deliveryTakenAt = sub.assignedAt?.toMillis?.()
                ?? (sub.assignedAt?.seconds ? sub.assignedAt.seconds * 1000 : null);
            }
          } catch { /* silent */ }
        } else {
          this.router.navigate(['/admin/bandeja']);
          return;
        }
      }
    }

    if (this.isDeliveryMode) {
      this.startLocationTracking();
    }

    this.convsUnsub = this.firebaseService.onConversationsChange((convs) => {
      this.conversations = convs;
      this.applyFilter();
      this.loading = false;

      // Auto-seleccionar conversación para delivery
      if (this.isDeliveryMode && this.deliveryPhone && !this.selectedConversation) {
        const conv = convs.find(c => c.phoneNumber === this.deliveryPhone || c.id === this.deliveryPhone);
        if (conv) this.selectConversation(conv);
      }

      if (this.selectedConversation) {
        const updated = convs.find(c => c.id === this.selectedConversation!.id);
        if (updated) {
          this.selectedConversation = updated;
        }
      }
    });
  }

  ngOnDestroy(): void {
    if (this.convsUnsub) this.convsUnsub();
    if (this.msgsUnsub) this.msgsUnsub();
    if (this.windowTimer) clearInterval(this.windowTimer);
    if (this.locationInterval) clearInterval(this.locationInterval);
    if (this.locationWatchId !== null) navigator.geolocation.clearWatch(this.locationWatchId);
    this.stopRecordingCleanup();
  }

  private startLocationTracking(): void {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        this.currentLat = pos.coords.latitude;
        this.currentLng = pos.coords.longitude;
        this.pushLocationToFirebase();
        this.locationWatchId = navigator.geolocation.watchPosition(
          (p) => { this.currentLat = p.coords.latitude; this.currentLng = p.coords.longitude; },
          () => {},
          { enableHighAccuracy: true, maximumAge: 0, timeout: 15000 }
        );
        if (!this.locationInterval) {
          this.locationInterval = setInterval(() => this.pushLocationToFirebase(), 15000);
        }
      },
      () => {},
      { enableHighAccuracy: true, maximumAge: 0, timeout: 10000 }
    );
  }

  private pushLocationToFirebase(): void {
    const uid = this.authService.currentUser?.uid;
    if (!uid || this.currentLat === null || this.currentLng === null) return;
    const name = this.deliveryUserName || this.authService.currentUser?.email || '';
    this.firebaseService.updateDeliveryLocation(uid, {
      userId: uid,
      userName: name,
      lat: this.currentLat,
      lng: this.currentLng,
      status: 'active',
      activeCaseId: this.deliverySubmissionId ?? this.promoOrderId,
      activeCollection: this.deliveryCollection,
      activePhone: this.deliveryPhone
    }).catch(() => {});
  }

  async loadConfig(): Promise<void> {
    try {
      const config = await this.firebaseService.getOrgConfig();
      this.personalWhatsApp = config?.personalWhatsApp || '';
      this.settingsPhone = this.personalWhatsApp;
      this.botApiUrl = config?.botApiUrl || this.authService.botApiUrl || (environment as any).defaultBotApiUrl || '';
      this.deliveryAudioEnabled = config?.deliveryAudioEnabled === true;
      this.deliveryAudioMaxSeconds = config?.deliveryAudioMaxSeconds || 30;
    } catch (err) {
      console.error('Error loading config:', err);
    }
  }

  applyFilter(): void {
    const term = this.searchTerm.toLowerCase().trim();
    if (!term) {
      this.filteredConversations = [...this.conversations];
    } else {
      this.filteredConversations = this.conversations.filter(c =>
        (c.contactName || '').toLowerCase().includes(term) ||
        (c.phoneNumber || '').includes(term)
      );
    }
  }

  selectConversation(conv: Conversation): void {
    this.selectedConversation = conv;
    this.messages = [];
    this.error = '';

    if (this.msgsUnsub) this.msgsUnsub();
    if (this.windowTimer) clearInterval(this.windowTimer);

    const listenPhone = conv.phoneNumber;
    // En modo delivery, filtrar por createdMs directo en Firestore para evitar el límite
    // de 100 mensajes históricos y asegurar que los mensajes nuevos siempre se capturen
    const sinceMs = (this.isDeliveryMode && this.deliveryTakenAt)
      ? this.deliveryTakenAt - 1000
      : undefined;
    this.lastMsgCount = -1;
    this.msgsUnsub = this.firebaseService.onConversationMessages(
      listenPhone,
      (msgs) => {
        if (this.selectedConversation?.phoneNumber !== listenPhone) return;
        const prev = this.lastMsgCount;
        const hasNew = prev >= 0 && msgs.length > prev;
        const lastIsUser = msgs.length > 0 && msgs[msgs.length - 1].from === 'user';
        if (hasNew && lastIsUser) this.playNotificationSound();
        this.lastMsgCount = msgs.length;
        this.messages = msgs;
        setTimeout(() => this.scrollToBottom(), 100);
      },
      sinceMs
    );

    this.firebaseService.markConversationRead(conv.phoneNumber).catch(() => {});

    this.windowTimer = setInterval(() => {}, 30000);
  }

  get currentMode(): string {
    return this.selectedConversation?.mode || 'bot';
  }

  get isAdminMode(): boolean {
    return this.currentMode === 'admin';
  }

  get isBotMode(): boolean {
    return this.currentMode === 'bot';
  }

  get sessionStep(): string {
    return this.selectedConversation?.session?.step || '';
  }

  get isInFlow(): boolean {
    const step = this.sessionStep;
    return step.startsWith('flow_');
  }

  get isWithin24h(): boolean {
    if (!this.selectedConversation?.lastUserMessageMs) return false;
    return (Date.now() - this.selectedConversation.lastUserMessageMs) < 24 * 60 * 60 * 1000;
  }

  get windowTimeLeft(): string {
    if (!this.selectedConversation?.lastUserMessageMs) return '';
    const expiresAt = this.selectedConversation.lastUserMessageMs + 24 * 60 * 60 * 1000;
    const remaining = expiresAt - Date.now();
    if (remaining <= 0) return 'Expirada';
    const hours = Math.floor(remaining / 3600000);
    const minutes = Math.floor((remaining % 3600000) / 60000);
    return `${hours}h ${minutes}m`;
  }

  async takeControl(): Promise<void> {
    if (!this.selectedConversation || this.togglingMode) return;
    this.togglingMode = true;
    this.error = '';
    try {
      const user = this.authService.currentUser;
      const response = await fetch(`${this.botApiUrl}/api/${this.orgId}/take-control`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          phone: this.selectedConversation.phoneNumber,
          adminEmail: user?.email || '',
          adminName: user?.displayName || user?.email || 'Admin'
        })
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        this.error = data.error || `Error del servidor (${response.status}). Reinicie el bot.`;
      }
    } catch (err) {
      this.error = 'No se pudo conectar con el bot. Verifique que esté activo y reiniciado.';
    } finally {
      this.togglingMode = false;
    }
  }

  async releaseToBot(): Promise<void> {
    if (!this.selectedConversation || this.togglingMode) return;
    this.togglingMode = true;
    this.error = '';
    try {
      const response = await fetch(`${this.botApiUrl}/api/${this.orgId}/release-to-bot`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          phone: this.selectedConversation.phoneNumber
        })
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        this.error = data.error || `Error del servidor (${response.status}).`;
      }
    } catch (err) {
      this.error = 'No se pudo conectar con el bot.';
    } finally {
      this.togglingMode = false;
    }
  }

  async sendMessage(): Promise<void> {
    if (!this.newMessage.trim() || !this.selectedConversation || this.sending) return;
    if (!this.isWithin24h) {
      this.error = 'La ventana de 24h expiró. El cliente debe escribir primero para reactivar el chat.';
      return;
    }

    this.sending = true;
    this.error = '';
    const text = this.newMessage.trim();
    this.newMessage = '';

    try {
      const user = this.authService.currentUser;
      const response = await fetch(`${this.botApiUrl}/api/${this.orgId}/send-message`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          phone: this.selectedConversation.phoneNumber,
          message: text,
          adminEmail: user?.email || '',
          adminName: user?.displayName || user?.email || 'Admin'
        })
      });

      const data = await response.json().catch(() => ({ ok: false, error: `Error HTTP ${response.status}` }));
      if (!data.ok) {
        if (data.error === '24h_window_expired') {
          this.error = 'La ventana de 24h expiró. Use WhatsApp personal para contactar.';
        } else {
          this.error = data.error || 'Error al enviar mensaje. Reinicie el bot.';
        }
        this.newMessage = text;
      }
    } catch (err: any) {
      this.error = 'No se pudo conectar con el bot. Verifique que esté activo y reiniciado.';
      this.newMessage = text;
    } finally {
      this.sending = false;
    }
  }

  openImage(url: string): void {
    window.open(url, '_blank');
  }

  async clearMessages(): Promise<void> {
    if (!this.selectedConversation) return;
    if (!confirm('¿Limpiar todos los mensajes de esta conversación? Esta acción no se puede deshacer.')) return;
    try {
      await this.firebaseService.clearConversationMessages(this.selectedConversation.phoneNumber);
      this.messages = [];
    } catch (err) {
      this.error = 'No se pudo limpiar la conversación.';
    }
  }

  async deleteConversation(conv: Conversation, event: Event): Promise<void> {
    event.stopPropagation();
    const name = conv.contactName || this.formatPhone(conv.phoneNumber);
    if (!confirm(`¿Eliminar la conversación con ${name}? Se borrarán todos los mensajes permanentemente.`)) return;
    try {
      await this.firebaseService.deleteConversation(conv.phoneNumber);
      if (this.selectedConversation?.id === conv.id) {
        this.selectedConversation = null;
        this.messages = [];
        if (this.msgsUnsub) { this.msgsUnsub(); this.msgsUnsub = null; }
      }
    } catch (err) {
      this.error = 'No se pudo eliminar la conversación.';
    }
  }

  triggerImageUpload(): void {
    this.imageInput?.nativeElement?.click();
  }

  async onImageSelected(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file || !this.selectedConversation) return;

    if (!file.type.startsWith('image/')) {
      this.error = 'Solo se permiten imágenes.';
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      this.error = 'La imagen no debe superar 5 MB.';
      return;
    }

    this.sendingImage = true;
    this.error = '';

    try {
      const path = `chat-images/${this.selectedConversation.phoneNumber}/${Date.now()}_${file.name}`;
      const imageUrl = await this.firebaseService.uploadFile(file, path);

      const user = this.authService.currentUser;
      const response = await fetch(`${this.botApiUrl}/api/${this.orgId}/send-image`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          phone: this.selectedConversation.phoneNumber,
          imageUrl,
          caption: '',
          adminEmail: user?.email || '',
          adminName: user?.displayName || user?.email || 'Admin'
        })
      });

      const data = await response.json().catch(() => ({ ok: false, error: `Error HTTP ${response.status}` }));
      if (!data.ok) {
        if (data.error === '24h_window_expired') {
          this.error = 'La ventana de 24h expiró. Use WhatsApp personal.';
        } else {
          this.error = data.error || 'Error al enviar imagen.';
        }
      }
    } catch (err: any) {
      this.error = 'No se pudo enviar la imagen.';
    } finally {
      this.sendingImage = false;
      if (this.imageInput) this.imageInput.nativeElement.value = '';
      this.cdr.detectChanges();
    }
  }

  async startRecording(): Promise<void> {
    if (this.isRecording || !navigator.mediaDevices) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      this.audioChunks = [];
      this.mediaRecorder = new MediaRecorder(stream);
      this.mediaRecorder.ondataavailable = (e) => { if (e.data.size > 0) this.audioChunks.push(e.data); };
      this.mediaRecorder.onstop = () => {
        this.audioBlob = new Blob(this.audioChunks, { type: 'audio/webm' });
        if (this.audioPreviewUrl) URL.revokeObjectURL(this.audioPreviewUrl);
        this.audioPreviewUrl = URL.createObjectURL(this.audioBlob);
        stream.getTracks().forEach(t => t.stop());
        this.cdr.detectChanges();
      };
      this.mediaRecorder.start(100); // timeslice 100ms → proper timestamps in webm
      this.isRecording = true;
      this.recordingSeconds = 0;
      this.recordingStartMs = Date.now();
      this.recordingTimer = setInterval(() => {
        this.recordingSeconds++;
        this.cdr.detectChanges();
        if (this.recordingSeconds >= this.deliveryAudioMaxSeconds) {
          this.stopRecording();
        }
      }, 1000);
    } catch {
      this.error = 'No se pudo acceder al micrófono. Verifique los permisos.';
    }
  }

  stopRecording(): void {
    if (this.recordingTimer) { clearInterval(this.recordingTimer); this.recordingTimer = null; }
    if (this.recordingStartMs > 0) {
      this.audioDurationSeconds = (Date.now() - this.recordingStartMs) / 1000;
      this.recordingStartMs = 0;
    }
    if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
      this.mediaRecorder.stop();
    }
    this.isRecording = false;
  }

  cancelAudio(): void {
    this.stopRecordingCleanup();
    this.audioBlob = null;
    if (this.audioPreviewUrl) { URL.revokeObjectURL(this.audioPreviewUrl); this.audioPreviewUrl = null; }
  }

  private stopRecordingCleanup(): void {
    if (this.recordingTimer) { clearInterval(this.recordingTimer); this.recordingTimer = null; }
    if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
      this.mediaRecorder.stop();
    }
    this.isRecording = false;
  }

  async sendAudio(): Promise<void> {
    if (!this.audioBlob || !this.selectedConversation || this.sendingAudio) return;
    if (!this.isWithin24h) {
      this.error = 'La ventana de 24h expiró.';
      return;
    }

    this.sendingAudio = true;
    this.error = '';
    this.cdr.detectChanges();
    setTimeout(() => this.scrollToBottom(), 50);

    try {
      const phone = this.selectedConversation.phoneNumber;
      const path = `chat-audios/${phone}/${Date.now()}.webm`;
      const audioUrl = await this.firebaseService.uploadBlob(this.audioBlob!, path, 'audio/webm');

      const user = this.authService.currentUser;
      const response = await fetch(`${this.botApiUrl}/api/${this.orgId}/send-audio`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          phone,
          audioUrl,
          duration: this.audioDurationSeconds || this.recordingSeconds,
          adminEmail: user?.email || '',
          adminName: user?.displayName || user?.email || 'Admin'
        })
      });

      const data = await response.json().catch(() => ({ ok: false, error: `Error HTTP ${response.status}` }));
      if (!data.ok) {
        this.error = data.error === '24h_window_expired'
          ? 'La ventana de 24h expiró.'
          : data.error || 'Error al enviar audio.';
      } else {
        this.cancelAudio();
      }
    } catch {
      this.error = 'No se pudo enviar el audio.';
    } finally {
      this.sendingAudio = false;
      this.cdr.detectChanges();
    }
  }

  formatRecordingTime(seconds: number): string {
    const m = Math.floor(seconds / 60).toString().padStart(2, '0');
    const s = (seconds % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
  }

  getWhatsAppLink(phone: string): string {
    if (this.isDeliveryMode && this.deliveryCode && phone) {
      const clientName = this.selectedConversation ? this.getContactDisplayName(this.selectedConversation) : '';
      const msg = `Hola${clientName ? ' ' + clientName : ''}! 😊\n\nSoy *${this.deliveryUserName || 'tu Delivery'}* y he tomado tu solicitud.\n\nMi clave es *${this.deliveryCode}*\n\nVoy a coordinar tu solicitud. 🚗`;
      return `https://wa.me/${(phone || '').replace(/\D/g, '')}?text=${encodeURIComponent(msg)}`;
    }
    const wpPhone = this.personalWhatsApp || phone;
    return `https://wa.me/${wpPhone}`;
  }

  getContactDisplayName(conv: Conversation): string {
    return conv.contactName || this.formatPhone(conv.phoneNumber);
  }

  formatPhone(phone: string): string {
    if (!phone) return '';
    if (phone.length > 10) {
      return `+${phone.substring(0, phone.length - 10)} ${phone.substring(phone.length - 10)}`;
    }
    return phone;
  }

  formatTimestamp(ts: any): string {
    if (!ts) return '';
    let date: Date;
    if (ts.seconds) {
      date = new Date(ts.seconds * 1000);
    } else if (ts.toDate) {
      date = ts.toDate();
    } else {
      date = new Date(ts);
    }
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    if (diff < 60000) return 'Ahora';
    if (diff < 3600000) return `${Math.floor(diff / 60000)}m`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}h`;
    return date.toLocaleDateString('es', { day: '2-digit', month: 'short' });
  }

  formatMessageTime(ts: any): string {
    if (!ts) return '';
    let date: Date;
    if (ts.seconds) {
      date = new Date(ts.seconds * 1000);
    } else if (ts.toDate) {
      date = ts.toDate();
    } else {
      date = new Date(ts);
    }
    return date.toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' });
  }

  getTotalUnread(): number {
    return this.conversations.reduce((sum, c) => sum + (c.unreadCount || 0), 0);
  }

  getAdminModeCount(): number {
    return this.conversations.filter(c => c.mode === 'admin').length;
  }

  async saveSettings(): Promise<void> {
    try {
      await this.firebaseService.saveOrgConfig({ personalWhatsApp: this.settingsPhone });
      this.personalWhatsApp = this.settingsPhone;
      this.showSettings = false;
    } catch (err) {
      console.error('Error saving config:', err);
    }
  }

  onKeyPress(event: KeyboardEvent): void {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      this.sendMessage();
    }
  }

  openCancelModal(): void {
    this.cancelReason = '';
    this.showCancelModal = true;
  }

  closeCancelModal(): void {
    this.showCancelModal = false;
    this.cancelReason = '';
  }

  async confirmCancelDeliveryCase(): Promise<void> {
    this.closeCancelModal();
    await this.cancelDeliveryCase();
  }

  async cancelDeliveryCase(): Promise<void> {
    if (!this.selectedConversation || this.cancellingCase) return;

    // Promo order cancel
    if (this.promoOrderId) {
      this.cancellingCase = true;
      this.error = '';
      try {
        if (this.botApiUrl && this.selectedConversation) {
          await fetch(`${this.botApiUrl}/api/${this.orgId}/cancel-delivery-case`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              phone: this.selectedConversation.phoneNumber,
              clientName: '',
              cancelCount: 1,
              cancelReason: this.cancelReason.trim(),
              isPromoOrder: true
            })
          }).catch(() => {});
        }
        const pos = await this.getCurrentPositionOrNull();
        await this.firebaseService.cancelPromoOrder(this.promoOrderId, this.cancelReason.trim());
        await this.saveDeliveryHistory(pos, 'cancelled', this.cancelReason.trim());
        this.router.navigate(['/admin/bandeja']);
      } catch {
        this.error = 'No se pudo cancelar el pedido.';
      } finally {
        this.cancellingCase = false;
      }
      return;
    }

    this.cancellingCase = true;
    this.error = '';
    try {
      // Leer submission para obtener cancelCount actual
      let cancelCount = 0;
      if (this.deliverySubmissionId && this.deliveryCollection) {
        const submission = await this.firebaseService.getDocument(this.deliveryCollection, this.deliverySubmissionId);
        cancelCount = (submission?.cancelCount || 0) + 1;
      }

      const clientName = this.selectedConversation.contactName || '';
      const response = await fetch(`${this.botApiUrl}/api/${this.orgId}/cancel-delivery-case`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          phone: this.selectedConversation.phoneNumber,
          clientName,
          cancelCount,
          cancelReason: this.cancelReason.trim()
        })
      });

      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        this.error = data.error || 'Error al cancelar el caso';
        return;
      }

      if (this.deliverySubmissionId && this.deliveryCollection) {
        const user = this.authService.currentUser;
        if (cancelCount >= 3) {
          // Cerrar definitivamente
          await this.firebaseService.updateDocument(this.deliveryCollection, this.deliverySubmissionId, {
            status: 'resolved',
            cancelCount,
            assignedTo: null,
            resolvedBy: { uid: 'system', name: 'Sin disponibilidad', email: '' }
          });
        } else {
          // Devolver a disponibles
          const submission = await this.firebaseService.getDocument(this.deliveryCollection, this.deliverySubmissionId);
          await this.firebaseService.updateDocument(this.deliveryCollection, this.deliverySubmissionId, {
            status: 'pending',
            cancelCount,
            assignedTo: null
          });
          // Notificar a todos los deliveries que hay un caso disponible
          fetch(`${this.botApiUrl}/api/${this.orgId}/notify-deliveries`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              flowName: submission?.flowName || '',
              clientName: this.selectedConversation?.contactName || ''
            })
          }).catch(() => {});
        }
      }

      const pos = await this.getCurrentPositionOrNull();
      await this.saveDeliveryHistory(pos, 'cancelled', this.cancelReason.trim());
      this.router.navigate(['/admin/bandeja']);
    } catch (err) {
      this.error = 'No se pudo conectar con el bot.';
    } finally {
      this.cancellingCase = false;
    }
  }

  private async findMyActiveDeliveryCase(): Promise<{ phone: string; submissionId: string; collection: string; deliveryCode?: string } | null> {
    try {
      const uid = this.authService.currentUser?.uid;
      if (!uid) return null;
      const flows = await this.firebaseService.getFlows();
      const inboxFlows = flows.filter((f: any) =>
        f.saveToCollection && f.saveToCollection !== 'applicants' && f.saveToCollection !== 'contacts'
      );
      for (const flow of inboxFlows) {
        const items = await this.firebaseService.getFlowSubmissions(flow.saveToCollection);
        const active = items.find((i: any) => i.assignedTo?.uid === uid && i.status !== 'resolved' && i.phoneNumber);
        if (active) {
          return {
            phone: active.phoneNumber,
            submissionId: active.id,
            collection: flow.saveToCollection,
            deliveryCode: active.deliveryCode || active.assignedTo?.deliveryCode
          };
        }
      }
    } catch { /* silent */ }
    return null;
  }

  openResolveModal(): void {
    this.resolveConfirmCode = '';
    this.resolveCodeError = '';
    this.showResolveModal = true;
  }

  closeResolveModal(): void {
    this.showResolveModal = false;
    this.resolveConfirmCode = '';
    this.resolveCodeError = '';
  }

  async confirmResolveDeliveryCase(): Promise<void> {
    if (this.resolveConfirmCode.trim() !== this.deliveryCode.trim()) {
      this.resolveCodeError = 'Código incorrecto. Pide al cliente su código de confirmación.';
      return;
    }
    this.closeResolveModal();
    await this.resolveDeliveryCase();
  }

  async resendDeliveryCode(): Promise<void> {
    if (!this.selectedConversation || this.resendingCode || !this.deliveryCode) return;
    this.showResendCodeModal = false;
    this.resendingCode = true;
    const msg = `🔑 Tu código de confirmación es: *${this.deliveryCode}*\n\nCuando el Delivery llegue, dile este código para confirmar la entrega. ✅`;
    try {
      await fetch(`${this.botApiUrl}/api/${this.orgId}/send-message`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          phone: this.selectedConversation.phoneNumber,
          message: msg,
          adminName: this.deliveryUserName || 'Delivery',
          adminEmail: this.authService.currentUser?.email || ''
        })
      });
    } catch { /* silent */ }
    this.resendingCode = false;
  }

  private getCurrentPositionOrNull(): Promise<{ lat: number; lng: number } | null> {
    return new Promise(resolve => {
      if (!navigator.geolocation) { resolve(null); return; }
      navigator.geolocation.getCurrentPosition(
        p => resolve({ lat: p.coords.latitude, lng: p.coords.longitude }),
        () => resolve(null),
        { enableHighAccuracy: true, timeout: 6000, maximumAge: 30000 }
      );
    });
  }

  private async saveDeliveryHistory(
    endPos: { lat: number; lng: number } | null,
    status: 'completed' | 'cancelled',
    cancelReason?: string
  ): Promise<void> {
    const user = this.authService.currentUser;
    const startLat = this.promoOrderData?.startLat ?? this.deliverySubmission?.startLat ?? null;
    const startLng = this.promoOrderData?.startLng ?? this.deliverySubmission?.startLng ?? null;
    try {
      await this.firebaseService.addDeliveryHistory({
        status,
        startLat: startLat ?? null,
        startLng: startLng ?? null,
        endLat: endPos?.lat ?? null,
        endLng: endPos?.lng ?? null,
        deliveryAgent: {
          uid: user?.uid || '',
          name: this.deliveryUserName || user?.email || '',
          email: user?.email || ''
        },
        clientPhone: this.selectedConversation?.phoneNumber || '',
        clientName: this.selectedConversation?.contactName || '',
        type: this.promoOrderId ? 'promo' : 'submission',
        promoOrderId: this.promoOrderId || undefined,
        campaignId: this.promoOrderData?.campaignId || undefined,
        campaignName: this.promoOrderData?.campaignName || undefined,
        imageUrl: this.promoOrderData?.imageUrl || undefined,
        promoMessage: this.promoOrderData?.promoMessage || undefined,
        submissionId: this.deliverySubmissionId || undefined,
        collection: this.deliveryCollection || undefined,
        cancelReason: cancelReason || undefined,
        takenAt: this.deliveryTakenAt || undefined
      });
    } catch { /* silent — historial no debe bloquear el flujo */ }
  }

  async resolveDeliveryCase(): Promise<void> {
    if (!this.selectedConversation || this.resolvingCase) return;

    // Promo order resolve — notificar al cliente igual que flujo normal
    if (this.promoOrderId) {
      this.resolvingCase = true;
      this.error = '';
      try {
        if (this.botApiUrl && this.selectedConversation) {
          await fetch(`${this.botApiUrl}/api/${this.orgId}/resolve-delivery-case`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ phone: this.selectedConversation.phoneNumber, clientName: '' })
          }).catch(() => {});
        }
        const pos = await this.getCurrentPositionOrNull();
        await this.firebaseService.resolvePromoOrder(this.promoOrderId);
        await this.saveDeliveryHistory(pos, 'completed');
        this.router.navigate(['/admin/bandeja']);
      } catch {
        this.error = 'No se pudo resolver el pedido.';
      } finally {
        this.resolvingCase = false;
      }
      return;
    }

    this.resolvingCase = true;
    this.error = '';
    try {
      const clientName = this.selectedConversation.contactName || '';
      const response = await fetch(`${this.botApiUrl}/api/${this.orgId}/resolve-delivery-case`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: this.selectedConversation.phoneNumber, clientName })
      });

      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        this.error = data.error || 'Error al resolver el caso';
        return;
      }

      const pos = await this.getCurrentPositionOrNull();

      if (this.deliverySubmissionId && this.deliveryCollection) {
        const user = this.authService.currentUser;
        await this.firebaseService.updateDocument(
          this.deliveryCollection,
          this.deliverySubmissionId,
          {
            status: 'resolved',
            resolvedBy: {
              uid: user?.uid || '',
              name: this.deliveryUserName || user?.email || '',
              email: user?.email || ''
            }
          }
        );
      }

      await this.saveDeliveryHistory(pos, 'completed');
      this.router.navigate(['/admin/bandeja']);
    } catch (err) {
      this.error = 'No se pudo conectar con el bot.';
    } finally {
      this.resolvingCase = false;
    }
  }

  getDeliverySubmissionFields(): { label: string; value: string }[] {
    if (!this.deliverySubmission) return [];
    const skip = ['id', 'status', 'createdAt', 'updatedAt', 'organizationId', 'schoolId',
                   'flowId', 'flowName', 'phoneNumber', 'confirmed', 'assignedTo', 'resolvedBy',
                   'deliveryCode', 'cancelCount', 'assignedAt'];
    const labels: Record<string, string> = {
      fullName: 'Nombre', name: 'Nombre', nombre: 'Nombre',
      direccion: 'Dirección', address: 'Dirección',
      productos: 'Productos', items: 'Ítems', detalle: 'Detalle',
      descripcion: 'Descripción', comment: 'Comentario', motivo: 'Motivo',
      fecha: 'Fecha', hora: 'Hora', telefono: 'Teléfono',
    };
    const fields: { label: string; value: string }[] = [];
    for (const [key, val] of Object.entries(this.deliverySubmission)) {
      if (skip.includes(key) || val === null || val === undefined || val === '') continue;
      if (typeof val === 'object') continue;
      if (key.startsWith('_')) continue;
      if (key.endsWith('Id')) continue;
      const label = labels[key] || key.replace(/([A-Z])/g, ' $1').replace(/^./, s => s.toUpperCase());
      fields.push({ label, value: String(val) });
    }
    return fields;
  }

  // ── Notification sound ──
  private playNotificationSound(): void {
    try {
      const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.type = 'sine';
      osc.frequency.setValueAtTime(880, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(440, ctx.currentTime + 0.15);
      gain.gain.setValueAtTime(0.3, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.3);
      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + 0.3);
      osc.onended = () => ctx.close();
    } catch (e) {}
  }

  // ── Custom audio player methods ──
  getPlayer(msgId: string, audioUrl: string) {
    if (!this.audioPlayers.has(msgId)) {
      const el = new Audio(audioUrl);
      const state = { el, playing: false, current: 0, duration: 0 };
      el.addEventListener('loadedmetadata', () => { state.duration = el.duration || 0; this.cdr.detectChanges(); });
      el.addEventListener('timeupdate', () => { state.current = el.currentTime; this.cdr.detectChanges(); });
      el.addEventListener('ended', () => { state.playing = false; state.current = 0; el.currentTime = 0; this.cdr.detectChanges(); });
      this.audioPlayers.set(msgId, state);
    }
    return this.audioPlayers.get(msgId)!;
  }

  toggleAudio(msgId: string, audioUrl: string) {
    const state = this.getPlayer(msgId, audioUrl);
    // Pause any other playing audio
    this.audioPlayers.forEach((s, id) => { if (id !== msgId && s.playing) { s.el.pause(); s.playing = false; } });
    if (state.playing) {
      state.el.pause();
      state.playing = false;
    } else {
      state.el.play().catch(() => {});
      state.playing = true;
    }
  }

  formatAudioTime(seconds: number): string {
    if (!seconds || isNaN(seconds)) return '0:00';
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
  }

  private scrollToBottom(): void {
    try {
      if (this.messagesContainer) {
        this.messagesContainer.nativeElement.scrollTop =
          this.messagesContainer.nativeElement.scrollHeight;
      }
    } catch (e) {}
  }
}
