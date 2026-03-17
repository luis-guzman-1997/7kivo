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

  // ── Delivery mode ──
  isDeliveryMode = false;
  deliveryPhone: string | null = null;
  deliverySubmissionId: string | null = null;
  deliveryCollection: string | null = null;
  deliveryUserName = '';
  deliveryCode = '';
  resolvingCase = false;
  cancellingCase = false;

  private convsUnsub: Unsubscribe | null = null;
  private msgsUnsub: Unsubscribe | null = null;
  private windowTimer: any = null;

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
        if (!this.deliveryCode && this.deliverySubmissionId && this.deliveryCollection) {
          const sub = await this.firebaseService.getDocument(this.deliveryCollection, this.deliverySubmissionId);
          this.deliveryCode = sub?.deliveryCode || sub?.assignedTo?.deliveryCode || '';
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
        } else {
          this.router.navigate(['/admin/bandeja']);
          return;
        }
      }
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
  }

  async loadConfig(): Promise<void> {
    try {
      const config = await this.firebaseService.getOrgConfig();
      this.personalWhatsApp = config?.personalWhatsApp || '';
      this.settingsPhone = this.personalWhatsApp;
      this.botApiUrl = config?.botApiUrl || this.authService.botApiUrl || (environment as any).defaultBotApiUrl || '';
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
    this.msgsUnsub = this.firebaseService.onConversationMessages(
      listenPhone,
      (msgs) => {
        if (this.selectedConversation?.phoneNumber !== listenPhone) return;
        this.messages = msgs;
        setTimeout(() => this.scrollToBottom(), 100);
      }
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
      this.error = 'La ventana de 24h expiró. Use WhatsApp personal.';
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

  async cancelDeliveryCase(): Promise<void> {
    if (!this.selectedConversation || this.cancellingCase) return;
    if (!confirm('¿Cancelar este pedido? Se notificará al cliente y quedará disponible para otro delivery.')) return;

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
        body: JSON.stringify({ phone: this.selectedConversation.phoneNumber, clientName, cancelCount })
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
          await this.firebaseService.updateDocument(this.deliveryCollection, this.deliverySubmissionId, {
            status: 'pending',
            cancelCount,
            assignedTo: null
          });
        }
      }

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

  async resolveDeliveryCase(): Promise<void> {
    if (!this.selectedConversation || this.resolvingCase) return;
    if (!confirm('¿Marcar este pedido como completado? Se notificará al cliente.')) return;

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

      this.router.navigate(['/admin/bandeja']);
    } catch (err) {
      this.error = 'No se pudo conectar con el bot.';
    } finally {
      this.resolvingCase = false;
    }
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
