import { Component, OnInit } from '@angular/core';
import { FirebaseService } from '../../services/firebase.service';
import { AuthService } from '../../services/auth.service';

interface FlowStep {
  id: string;
  type: string;
  prompt: string;
  fieldKey: string;
  fieldLabel: string;
  required: boolean;
  optional?: boolean;
  allowedTypes?: string;
  exitMessage?: string;
  validation: { minLength?: number; maxLength?: number; min?: number; max?: number };
  errorMessage: string;
  optionsSource: string;
  optionsTitleField: string;
  optionsDescField: string;
  customOptions: { label: string; value: string; description?: string; duration?: number; exitMessage?: string }[];
  buttonText: string;
  sourceCollection: string;
  displayField: string;
  detailFields: string[];
  timeFieldKey: string;
  lookupCollection?: string;
  authField?: string;
  resultTemplate?: string;
  notFoundMessage?: string;
  maxRetries?: number;
  lookupField?: string;
  foundTemplate?: string;
  source?: 'web' | 'bot' | 'order';
  orderField?: string;
  allowWebConfirm?: boolean;
  // UI-only fields (stripped before saving to Firebase)
  _originalFieldKey?: string;
  _fieldKeyChanged?: boolean;
}

interface Flow {
  id?: string;
  name: string;
  description: string;
  menuLabel: string;
  menuDescription: string;
  type: string;
  active: boolean;
  order: number;
  steps: FlowStep[];
  completionMessage: string;
  saveToCollection: string;
  notifyAdmin: boolean;
  notifyDelivery: boolean;
  // Horario de atención del flujo
  scheduleEnabled?: boolean;
  scheduleSlots?: { days: number[]; start: string; end: string }[]; // franjas por días
  scheduleOffMessage?: string;
  // Legacy (compatibilidad con docs anteriores)
  scheduleStart?: string;
  scheduleEnd?: string;
  scheduleDays?: number[];
  // Aviso si no es atendido
  unattendedEnabled?: boolean;
  unattendedTimeoutHours?: number;
  unattendedMessage?: string;
  cancelHint?: string;
  cancelHintImage?: string;
  catalogCollection?: string;
  webStoreEnabled?: boolean;
  storeImage?: string;
  storeColor?: string;
  // Restricción por número (modo prueba)
  testPhones?: string[]; // vacío = todos; con números = solo esos
}

interface TourStep { selector: string; title: string; body: string; position: 'below' | 'above' | 'center'; }

@Component({
  selector: 'app-flow-builder',
  templateUrl: './flow-builder.component.html',
  styleUrls: ['./flow-builder.component.css']
})
export class FlowBuilderComponent implements OnInit {
  flows: Flow[] = [];
  loading = true;
  saving = false;
  notice = '';
  error = '';

  // Edit state
  editMode = false;
  currentFlow: Flow = this.emptyFlow();
  expandedStepIndex: number | null = null;
  expandedStepAdvanced: Set<number> = new Set();
  cancelHintImageFile: File | null = null;
  cancelHintImagePreview = '';

  readonly ORDER_FIELDS = [
    { key: 'orderCode',  label: 'Código de pedido' },
    { key: 'orderItems', label: 'Resumen de ítems' },
    { key: 'orderTotal', label: 'Total del pedido' },
    { key: 'orderDate',  label: 'Fecha del pedido' },
  ];

  // List view tabs
  activeTab: 'menu' | 'flows' = 'menu';
  flowStatusFilter: 'all' | 'active' | 'inactive' = 'all';

  // Drag-and-drop state
  draggedStepIndex: number | null = null;
  dragOverIndex: number | null = null;

  // Menu config
  menuConfig: any = { greeting: '', menuButtonText: 'Ver opciones', fallbackMessage: '', items: [] };
  collectionDefs: any[] = [];
  collectionPreviewCache: Record<string, any[]> = {};

  stepTypes = [
    { value: 'text_input',       label: 'Texto',          icon: 'fa-keyboard',       desc: 'El usuario escribe texto libremente' },
    { value: 'number_input',     label: 'Número',         icon: 'fa-hashtag',        desc: 'El usuario escribe un número' },
    { value: 'select_buttons',   label: 'Botones',        icon: 'fa-hand-pointer',   desc: 'Hasta 3 botones de respuesta rápida' },
    { value: 'select_list',      label: 'Lista',          icon: 'fa-list',           desc: 'Lista desplegable de opciones' },
    { value: 'select_services',  label: 'Lista de Servicios', icon: 'fa-briefcase-medical', desc: 'Muestra los servicios de tu negocio con título, subtítulo y duración' },
    { value: 'browse_collection',label: 'Catálogo',       icon: 'fa-th-large',       desc: 'El usuario navega un catálogo' },
    { value: 'appointment_slot', label: 'Cita',           icon: 'fa-calendar-check', desc: 'El usuario elige fecha y hora disponible' },
    { value: 'message',          label: 'Mensaje',        icon: 'fa-comment',        desc: 'El bot envía un mensaje sin esperar respuesta' },
    { value: 'image_input',      label: 'Imagen',         icon: 'fa-image',          desc: 'El usuario envía una foto o documento' },
    { value: 'location_input',   label: 'Dirección',      icon: 'fa-map-marker-alt', desc: 'El usuario comparte su ubicación de WhatsApp o escribe la dirección' },
    { value: 'auth_lookup',      label: 'Autenticación',  icon: 'fa-id-card',        desc: 'El usuario escribe un código único y el bot responde con sus datos' },
    { value: 'phone_lookup',     label: 'Consulta por teléfono', icon: 'fa-phone-square', desc: 'Verifica si el número de WhatsApp está en tu base de datos y muestra información personalizada' }
  ];

  planLimit = 999;
  scheduleWarning = false;
  scheduleServices: { name: string; title?: string; duration: number; capacity?: number }[] = [];

  // Template modal state
  showTemplateModal = false;
  pendingTemplateFlow: any = null;
  templateTitle = '';
  creatingTemplate = false;

  // Delete flow modal state
  deleteFlowTarget: Flow | null = null;
  deletingFlow = false;

  // Copy flow modal state
  copyFlowSource: Flow | null = null;
  copyFlowName = '';
  copyFlowLabel = '';
  copyFlowDesc = '';
  copyFlowCollectionMode: 'existing' | 'new' = 'existing';
  copyFlowCollection = '';
  copyFlowNewCollection = '';
  copyingFlow = false;

  // Tour state
  tourActive = false;
  tourStep = 0;
  tourTooltipTop = 0;
  tourTooltipLeft = 0;
  tourContext: 'list' | 'edit' = 'list';

  get activeTourSteps(): TourStep[] {
    return this.tourContext === 'edit' ? this.editTourSteps : this.listTourSteps;
  }

  listTourSteps: TourStep[] = [
    { selector: '.bot-menu-panel',          position: 'below', title: 'Menú de tu bot',    body: 'Aquí configuras qué opciones ve el usuario cuando te escribe. Puedes tener hasta 7 opciones y reordenarlas.' },
    { selector: '.bmp-settings',            position: 'below', title: 'Ajustes del bot',   body: 'Personaliza el mensaje de bienvenida, el texto del botón y la respuesta cuando el bot no entienda al usuario.' },
    { selector: '.bmp-items',               position: 'below', title: 'Opciones del menú', body: 'Cada opción puede ser una acción predefinida (horarios, ubicación), un flujo personalizado, o un mensaje directo.' },
    { selector: '.btn-add-item',            position: 'above', title: 'Agregar opciones',  body: 'Con este botón agregas opciones al menú. Usa las plantillas para crear flujos completos en segundos.' },
    { selector: '.flow-grid, .empty-state', position: 'above', title: 'Tus flujos',        body: 'Cada flujo es una conversación guiada. El bot lleva al usuario paso a paso recopilando la información que necesitas.' },
  ];

  editTourSteps: TourStep[] = [
    {
      selector: '#fe-steps-block',
      position: 'below',
      title: 'Conversación paso a paso',
      body: 'Cada paso es un mensaje del bot que espera la respuesta del usuario. El flujo avanza automáticamente de paso en paso hasta completar la conversación y guardar los datos.'
    },
    {
      selector: '',
      position: 'center',
      title: 'Texto  ·  Número',
      body: '✏️ Texto — el usuario escribe libremente.\nEj: "¿Cuál es tu nombre?" → el usuario responde "María López"\n\n🔢 Número — solo acepta dígitos.\nEj: "¿Cuántas personas asistirán?" → el usuario responde "3"'
    },
    {
      selector: '',
      position: 'center',
      title: 'Botones  ·  Lista',
      body: '🔘 Botones — hasta 3 opciones de respuesta rápida.\nEj: "¿Cómo prefieres que te contactemos?"\n→  [WhatsApp]  [Llamada]  [Email]\n\n📋 Lista — opciones en menú desplegable (sin límite).\nEj: elegir un servicio cuando hay más de 3 opciones.'
    },
    {
      selector: '',
      position: 'center',
      title: 'Cita  ·  Catálogo',
      body: '📅 Cita — muestra fechas y horas disponibles según tus horarios. Evita dobles reservas automáticamente.\nEj: "¿Qué día te queda mejor?"\n→  Lun 10 · Mar 11 · Mié 12…  |  09:00 · 09:30 · 10:00…\n\n🗂️ Catálogo — el usuario navega y elige un ítem de una base de datos (productos, servicios, etc.).'
    },
    {
      selector: '',
      position: 'center',
      title: 'Mensaje  ·  Imagen',
      body: '💬 Mensaje — el bot envía información sin esperar respuesta.\nEj: "Tu número de caso es #1042. Un agente te contactará."\n\n📷 Imagen — el usuario envía una foto o documento.\nEj: "¿Tienes exámenes previos? Envíalos aquí."\n→ el usuario adjunta una foto o PDF.'
    },
    {
      selector: '#fe-completion-block',
      position: 'above',
      title: 'Mensaje de confirmación',
      body: 'Se envía al usuario cuando termina todos los pasos. Usa variables para personalizarlo con sus propios datos.\nEj: "✅ ¡Listo, {nombre}! Tu cita es el {fecha} a las {hora}."'
    }
  ];

  templateFlows = [
    { icon: 'fa-calendar-check',      label: 'Agendar Cita',     description: 'Reserva de citas con disponibilidad en tiempo real', requiresPlan: 'appointments', key: 'appointments',        category: 'citas' },
    { icon: 'fa-clipboard-list',      label: 'Registro',          description: 'Formulario de inscripción o registro de datos',       requiresPlan: null,           key: 'registration',        category: 'registros' },
    { icon: 'fa-question-circle',     label: 'Consulta',          description: 'Formulario de preguntas y consultas al equipo',       requiresPlan: null,           key: 'consultation',        category: 'consultas' },
    { icon: 'fa-file-invoice-dollar', label: 'Cotización',        description: 'Solicitud de presupuesto o precio estimado',          requiresPlan: null,           key: 'quote',               category: 'consultas' },
    { icon: 'fa-headset',             label: 'Soporte / Reclamo', description: 'Atención a problemas, quejas y sugerencias',          requiresPlan: null,           key: 'support',             category: 'soporte' },
    { icon: 'fa-star',                label: 'Encuesta',          description: 'Encuesta de satisfacción post-servicio',              requiresPlan: null,           key: 'feedback',            category: 'soporte' },
    { icon: 'fa-hourglass-half',      label: 'Lista de Espera',   description: 'Registro para lista de espera o turno',              requiresPlan: null,           key: 'waitlist',            category: 'registros' },
    { icon: 'fa-ambulance',           label: 'Urgencias',         description: 'Mensaje rápido con info de urgencias/emergencias',    requiresPlan: null,           key: 'urgency',             category: 'soporte' },
    { icon: 'fa-user-md',             label: 'Cita Médica',       description: 'Cita + opción de subir imágenes médicas',            requiresPlan: 'appointments', key: 'medical_appointment', category: 'citas' },
    { icon: 'fa-school',              label: 'Pre-matrícula',     description: 'Registro de pre-inscripción escolar',                 requiresPlan: null,           key: 'school_enrollment',   category: 'registros' },
    { icon: 'fa-box',                 label: 'Solicitud Envío',   description: 'Solicitud de envío/paquete con foto',                 requiresPlan: null,           key: 'shipping_request',    category: 'consultas' },
    { icon: 'fa-credit-card',         label: 'Consulta de Pago',  description: 'El usuario consulta su estado de cuenta con su código', requiresPlan: null,          key: 'payment_lookup',      category: 'consultas' }
  ];

  constructor(private firebaseService: FirebaseService, public authService: AuthService) {
    this.planLimit = this.authService.getPlanLimits().flows;
  }

  get canCreateFlow(): boolean {
    return this.flows.length < this.planLimit;
  }

  get filteredFlows(): Flow[] {
    if (this.flowStatusFilter === 'active') return this.flows.filter(f => f.active);
    if (this.flowStatusFilter === 'inactive') return this.flows.filter(f => !f.active);
    return this.flows;
  }

  get activeFlowsCount(): number { return this.flows.filter(f => f.active).length; }
  get inactiveFlowsCount(): number { return this.flows.filter(f => !f.active).length; }

  get isOwner(): boolean {
    return this.authService.userRole === 'owner' || this.authService.isSuperAdmin;
  }

  get hasInactiveMenuItems(): boolean {
    return this.menuConfig.items.some((i: any) => i.active === false);
  }

  get canAddMenuItem(): boolean {
    return this.menuConfig.items.length < 7;
  }

  async ngOnInit(): Promise<void> {
    await this.loadData();
  }

  async loadData(): Promise<void> {
    this.loading = true;
    try {
      const [flows, menuConfig, colDefs] = await Promise.all([
        this.firebaseService.getFlows(),
        this.firebaseService.getMenuConfig(),
        this.firebaseService.getCollectionDefs()
      ]);
      this.flows = flows;
      this.collectionDefs = colDefs;
      if (menuConfig) {
        this.menuConfig = {
          greeting: menuConfig.greeting || '',
          menuButtonText: menuConfig.menuButtonText || 'Ver opciones',
          fallbackMessage: menuConfig.fallbackMessage || '',
          items: menuConfig.items || []
        };
      }
      await this.preloadCollectionPreviews();
      await this.checkScheduleForAppointments();
    } catch (err) {
      console.error('Error loading flows:', err);
      this.error = 'Error al cargar flujos';
      setTimeout(() => this.error = '', 3000);
    } finally {
      this.loading = false;
    }
  }

  private async preloadCollectionPreviews(): Promise<void> {
    const previews = await Promise.all(
      this.collectionDefs.map(async (col) => {
        try {
          const items = await this.firebaseService.getCollectionData(col.slug);
          return {
            slug: col.slug,
            items: items.slice(0, 10).map((item: any) => ({ id: item.id, ...item }))
          };
        } catch {
          return { slug: col.slug, items: [] };
        }
      })
    );
    this.collectionPreviewCache = {};
    previews.forEach(p => this.collectionPreviewCache[p.slug] = p.items);
  }

  private async checkScheduleForAppointments(): Promise<void> {
    const hasApptFlow = this.flows.some((f: any) =>
      f.type === 'appointment' || f.steps?.some((s: any) => s.type === 'appointment_slot')
    );
    try {
      const schedule = await this.firebaseService.getInfo('schedule');
      const hasActiveDays = schedule?.days?.some((d: any) => d.active && d.shifts?.length > 0);
      this.scheduleWarning = hasApptFlow && !hasActiveDays;
      this.scheduleServices = (schedule?.services || []).filter((s: any) => s.name || s.title);
    } catch {
      this.scheduleWarning = hasApptFlow;
    }
  }

  readonly DAYS_OF_WEEK = [
    { label: 'Dom', value: 0 },
    { label: 'Lun', value: 1 },
    { label: 'Mar', value: 2 },
    { label: 'Mié', value: 3 },
    { label: 'Jue', value: 4 },
    { label: 'Vie', value: 5 },
    { label: 'Sáb', value: 6 },
  ];

  emptySlot(): { days: number[]; start: string; end: string } {
    return { days: [], start: '08:00', end: '17:00' };
  }

  ensureSlots(): void {
    if (!this.currentFlow.scheduleSlots || this.currentFlow.scheduleSlots.length === 0) {
      // Migrar del formato legacy si existe
      const legacyDays = this.currentFlow.scheduleDays ?? [1,2,3,4,5];
      const legacyStart = this.currentFlow.scheduleStart ?? '07:00';
      const legacyEnd = this.currentFlow.scheduleEnd ?? '17:00';
      this.currentFlow.scheduleSlots = [{ days: legacyDays, start: legacyStart, end: legacyEnd }];
    }
  }

  addScheduleSlot(): void {
    this.ensureSlots();
    this.currentFlow.scheduleSlots!.push(this.emptySlot());
  }

  removeScheduleSlot(i: number): void {
    this.currentFlow.scheduleSlots!.splice(i, 1);
  }

  toggleSlotDay(slot: { days: number[]; start: string; end: string }, day: number): void {
    const idx = slot.days.indexOf(day);
    if (idx === -1) slot.days.push(day);
    else slot.days.splice(idx, 1);
    slot.days = [...slot.days].sort();
  }

  isSlotDay(slot: { days: number[]; start: string; end: string }, day: number): boolean {
    return slot.days.includes(day);
  }

  newTestPhone = '';

  addTestPhone(): void {
    const phone = this.newTestPhone.replace(/\D/g, '').trim();
    if (!phone) return;
    if (!(this.currentFlow.testPhones ?? []).includes(phone)) {
      this.currentFlow.testPhones = [...(this.currentFlow.testPhones ?? []), phone];
    }
    this.newTestPhone = '';
  }

  removeTestPhone(phone: string): void {
    this.currentFlow.testPhones = (this.currentFlow.testPhones ?? []).filter(p => p !== phone);
  }

  emptyFlow(): Flow {
    return {
      name: '', description: '', menuLabel: '', menuDescription: '',
      type: 'registration', active: true, order: this.flows?.length || 0,
      steps: [], completionMessage: '', saveToCollection: '', notifyAdmin: false, notifyDelivery: false,
      scheduleEnabled: false,
      scheduleSlots: [{ days: [1,2,3,4,5], start: '07:00', end: '17:00' }],
      scheduleOffMessage: '',
      unattendedEnabled: false, unattendedTimeoutHours: 2, unattendedMessage: '',
      cancelHint: 'Puedes escribir *cancelar* o *salir* en cualquier momento para detener el proceso.',
      catalogCollection: '',
      webStoreEnabled: false,
      storeImage: '',
      testPhones: []
    };
  }

  emptyStep(): FlowStep {
    return {
      id: 'step_' + Date.now(),
      type: 'text_input', prompt: '', fieldKey: '', fieldLabel: '',
      required: true, optional: false, allowedTypes: 'image',
      validation: {}, errorMessage: '',
      optionsSource: 'custom', optionsTitleField: '', optionsDescField: '',
      customOptions: [], buttonText: 'Ver opciones',
      sourceCollection: '', displayField: '', detailFields: [],
      timeFieldKey: '',
      lookupCollection: '', authField: '', resultTemplate: '', notFoundMessage: '', maxRetries: 3,
      lookupField: '', foundTemplate: ''
    };
  }

  flowHasAppointmentStep(): boolean {
    return this.currentFlow.steps.some(s => s.type === 'appointment_slot');
  }

  getCollectionFields(slug: string): any[] {
    const col = this.collectionDefs.find(c => c.slug === slug);
    return col?.fields || [];
  }

  getCollectionPreview(slug: string): any[] {
    if (!slug || slug === 'custom') return [];
    return this.collectionPreviewCache[slug] || [];
  }

  getPreviewItemField(item: any, fieldKey: string, fallbackField?: string): string {
    if (fieldKey && item[fieldKey] !== undefined) return String(item[fieldKey]);
    if (fallbackField && item[fallbackField] !== undefined) return String(item[fallbackField]);
    const colDef = this.collectionDefs.find(c => c.slug === item._slug);
    if (colDef?.displayField && item[colDef.displayField]) return String(item[colDef.displayField]);
    return item.name || item.nombre || item.id || '';
  }

  onBrowseCollectionChange(step: FlowStep): void {
    const fields = this.getCollectionFields(step.sourceCollection);
    if (fields.length > 0 && !step.displayField) {
      step.displayField = fields[0].key;
    }
    step.detailFields = fields.map((f: any) => f.key);
  }

  toggleDetailField(step: FlowStep, key: string): void {
    const idx = step.detailFields.indexOf(key);
    if (idx >= 0) {
      step.detailFields.splice(idx, 1);
    } else {
      step.detailFields.push(key);
    }
  }

  // ==================== FLOW LIST ====================

  openNewFlow(): void {
    this.currentFlow = this.emptyFlow();
    this.currentFlow.order = this.flows.length + 1;
    this.editMode = true;
    this.expandedStepIndex = null;
    this.expandedStepAdvanced.clear();
    this.cancelHintImageFile = null;
    this.cancelHintImagePreview = '';
  }

  openEditFlow(flow: Flow): void {
    this.currentFlow = JSON.parse(JSON.stringify(flow));
    if (!this.currentFlow.steps) this.currentFlow.steps = [];
    this.currentFlow.steps.forEach(s => {
      // Store original fieldKey to detect dangerous renames
      if (s.fieldKey) s._originalFieldKey = s.fieldKey;
    });
    this.currentFlow.steps.forEach(s => {
      if (!s.validation) s.validation = {};
      if (!s.customOptions) s.customOptions = [];
      if (!s.detailFields) s.detailFields = [];
      if (!s.sourceCollection) s.sourceCollection = '';
      if (!s.displayField) s.displayField = '';
      if (!s.optionsTitleField) s.optionsTitleField = '';
      if (!s.optionsDescField) s.optionsDescField = '';
      if (!s.timeFieldKey) s.timeFieldKey = '';
      if (s.optional === undefined) s.optional = false;
      if (!s.allowedTypes) s.allowedTypes = 'image';
      if (!s.lookupCollection) s.lookupCollection = '';
      if (!s.authField) s.authField = '';
      if (!s.resultTemplate) s.resultTemplate = '';
      if (!s.notFoundMessage) s.notFoundMessage = '';
      if (s.maxRetries === undefined) s.maxRetries = 3;
      if (!s.lookupField) s.lookupField = '';
      if (!s.foundTemplate) s.foundTemplate = '';
    });
    this.editMode = true;
    this.expandedStepIndex = null;
    this.expandedStepAdvanced.clear();
    this.cancelHintImageFile = null;
    this.cancelHintImagePreview = this.currentFlow.cancelHintImage || '';
  }

  cancelEdit(): void {
    this.editMode = false;
    this.expandedStepIndex = null;
    this.expandedStepAdvanced.clear();
  }

  getCatalogUrl(): string {
    if (!this.currentFlow.id) return '';
    if (!this.currentFlow.webStoreEnabled && !this.currentFlow.catalogCollection) return '';
    const orgId = this.firebaseService.getOrgId();
    return `${window.location.origin}/tienda/${orgId}/${this.currentFlow.id}`;
  }

  async copyCatalogUrl(): Promise<void> {
    const url = this.getCatalogUrl();
    if (!url) return;
    await navigator.clipboard.writeText(url);
    this.notice = 'URL copiada';
    setTimeout(() => this.notice = '', 2000);
  }

  onCancelHintImageSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    if (!input.files || !input.files[0]) return;
    const file = input.files[0];
    if (file.size > 5 * 1024 * 1024) { this.error = 'La imagen no debe superar 5 MB'; setTimeout(() => this.error = '', 3000); return; }
    this.cancelHintImageFile = file;
    const reader = new FileReader();
    reader.onload = (e) => { this.cancelHintImagePreview = e.target!.result as string; };
    reader.readAsDataURL(file);
  }

  clearCancelHintImage(): void {
    this.cancelHintImageFile = null;
    this.cancelHintImagePreview = '';
    this.currentFlow.cancelHintImage = '';
  }

  async saveFlow(): Promise<void> {
    if (!this.currentFlow.name.trim()) {
      this.error = 'El nombre del flujo es requerido';
      setTimeout(() => this.error = '', 3000);
      return;
    }
    if (!this.currentFlow.menuLabel.trim()) {
      this.error = 'La etiqueta del menú es requerida';
      setTimeout(() => this.error = '', 3000);
      return;
    }

    this.saving = true;
    try {
      if (this.cancelHintImageFile) {
        const orgId = this.firebaseService.getOrgId();
        const ext = this.cancelHintImageFile.name.split('.').pop() || 'jpg';
        const path = `organizations/${orgId}/flows/cancel-hint-${Date.now()}.${ext}`;
        this.currentFlow.cancelHintImage = await this.firebaseService.uploadFileByPath(this.cancelHintImageFile, path);
        this.cancelHintImageFile = null;
      }

      const data: any = { ...this.currentFlow };
      delete data.id;
      // Strip UI-only internal fields before saving to Firebase
      if (data.steps) {
        data.steps = data.steps.map((s: any) => {
          const clean = { ...s };
          delete clean._originalFieldKey;
          delete clean._fieldKeyChanged;
          return clean;
        });
      }

      if (this.currentFlow.id) {
        await this.firebaseService.updateFlow(this.currentFlow.id, data);
        this.notice = `Flujo "${data.name}" actualizado`;
      } else {
        await this.firebaseService.addFlow(data);
        this.notice = `Flujo "${data.name}" creado`;
      }

      // Sync flow steps → linked collection fields
      if (data.saveToCollection) {
        await this.firebaseService.syncFlowToCollection(data.saveToCollection, data.steps || []);
      }

      // Sync public store snapshot when web store is enabled
      const savedId = this.currentFlow.id || (await this.firebaseService.getFlows()).find((f: any) => f.name === data.name)?.id;
      if (data.webStoreEnabled && savedId) {
        this.firebaseService.syncPublicStore(savedId).catch(() => {});
      }

      this.editMode = false;
      await this.loadData();
      setTimeout(() => this.notice = '', 3000);
    } catch (err) {
      this.error = 'Error al guardar flujo';
      setTimeout(() => this.error = '', 3000);
    } finally {
      this.saving = false;
    }
  }

  deleteFlow(flow: Flow): void {
    this.deleteFlowTarget = flow;
  }

  cancelDeleteFlow(): void {
    this.deleteFlowTarget = null;
  }

  async confirmDeleteFlow(withCollection: boolean): Promise<void> {
    if (!this.deleteFlowTarget) return;
    const flow = this.deleteFlowTarget;
    this.deletingFlow = true;
    try {
      await this.firebaseService.deleteFlow(flow.id!);
      if (withCollection && flow.saveToCollection) {
        await this.firebaseService.deleteCollectionWithData(flow.saveToCollection);
      }
      // Remove any menu items that reference this flow
      const before = this.menuConfig.items.length;
      this.menuConfig.items = this.menuConfig.items.filter((it: any) => it.flowId !== flow.id);
      if (this.menuConfig.items.length !== before) {
        await this.firebaseService.saveMenuConfig(this.menuConfig);
      }
      this.deleteFlowTarget = null;
      this.notice = `Flujo "${flow.name}" eliminado`;
      await this.loadData();
      setTimeout(() => this.notice = '', 3000);
    } catch (err) {
      this.error = 'Error al eliminar flujo';
      setTimeout(() => this.error = '', 3000);
    } finally {
      this.deletingFlow = false;
    }
  }

  async toggleFlowActive(flow: Flow): Promise<void> {
    try {
      await this.firebaseService.updateFlow(flow.id!, { active: !flow.active });
      flow.active = !flow.active;
      this.notice = `Flujo "${flow.name}" ${flow.active ? 'activado' : 'desactivado'}`;
      setTimeout(() => this.notice = '', 3000);
    } catch (err) {
      this.error = 'Error al actualizar flujo';
      setTimeout(() => this.error = '', 3000);
    }
  }

  // ==================== COPY FLOW ====================

  sanitizeCopySlug(): void {
    this.copyFlowNewCollection = this.copyFlowNewCollection
      .toLowerCase()
      .replace(/[^a-z0-9_]/g, '_');
  }

  openCopyFlow(flow: Flow): void {
    this.copyFlowSource = flow;
    this.copyFlowName = flow.name + ' (copia)';
    this.copyFlowLabel = flow.menuLabel;
    this.copyFlowDesc = flow.menuDescription || '';
    this.copyFlowCollection = flow.saveToCollection || '';
    this.copyFlowNewCollection = '';
    this.copyFlowCollectionMode = flow.saveToCollection ? 'existing' : 'new';
  }

  async confirmCopyFlow(): Promise<void> {
    if (!this.copyFlowSource || !this.copyFlowName.trim() || !this.copyFlowLabel.trim()) return;
    const collection = this.copyFlowCollectionMode === 'new'
      ? this.copyFlowNewCollection.trim()
      : this.copyFlowCollection.trim();
    this.copyingFlow = true;
    try {
      const data: any = {
        ...this.copyFlowSource,
        name: this.copyFlowName.trim(),
        menuLabel: this.copyFlowLabel.trim(),
        menuDescription: this.copyFlowDesc.trim(),
        saveToCollection: collection,
        active: true,
        order: this.flows.length
      };
      delete data.id;
      if (data.steps) {
        data.steps = data.steps.map((s: any) => {
          const c = { ...s };
          delete c._originalFieldKey;
          delete c._fieldKeyChanged;
          return c;
        });
      }
      await this.firebaseService.addFlow(data);
      if (collection) {
        await this.firebaseService.syncFlowToCollection(collection, data.steps || []);
      }
      this.copyFlowSource = null;
      await this.loadData();
      this.notice = `Flujo "${data.name}" creado`;
      setTimeout(() => this.notice = '', 3000);
    } catch (err) {
      this.error = 'Error al copiar flujo';
      setTimeout(() => this.error = '', 3000);
    } finally {
      this.copyingFlow = false;
    }
  }

  // ==================== STEP MANAGEMENT ====================

  addStep(): void {
    this.currentFlow.steps.push(this.emptyStep());
    this.expandedStepIndex = this.currentFlow.steps.length - 1;
  }

  removeStep(index: number): void {
    this.currentFlow.steps.splice(index, 1);
    this.expandedStepIndex = null;
  }

  onStepDragStart(index: number): void {
    this.draggedStepIndex = index;
  }

  onStepDragOver(event: DragEvent, index: number): void {
    event.preventDefault();
    if (this.draggedStepIndex !== null && this.draggedStepIndex !== index) {
      this.dragOverIndex = index;
    }
  }

  onStepDragLeave(): void {
    this.dragOverIndex = null;
  }

  onStepDrop(index: number): void {
    if (this.draggedStepIndex === null || this.draggedStepIndex === index) {
      this.draggedStepIndex = null;
      this.dragOverIndex = null;
      return;
    }
    const steps = this.currentFlow.steps;
    const dragged = steps.splice(this.draggedStepIndex, 1)[0];
    steps.splice(index, 0, dragged);
    // Adjust expanded index
    const from = this.draggedStepIndex;
    const to = index;
    if (this.expandedStepIndex === from) {
      this.expandedStepIndex = to;
    } else if (this.expandedStepIndex !== null) {
      if (from < to && this.expandedStepIndex > from && this.expandedStepIndex <= to) {
        this.expandedStepIndex--;
      } else if (from > to && this.expandedStepIndex >= to && this.expandedStepIndex < from) {
        this.expandedStepIndex++;
      }
    }
    this.draggedStepIndex = null;
    this.dragOverIndex = null;
  }

  onStepDragEnd(): void {
    this.draggedStepIndex = null;
    this.dragOverIndex = null;
  }

  toggleStepExpand(index: number): void {
    this.expandedStepIndex = this.expandedStepIndex === index ? null : index;
  }

  addCustomOption(step: FlowStep): void {
    step.customOptions.push({ label: '', value: '' });
  }

  removeCustomOption(step: FlowStep, index: number): void {
    step.customOptions.splice(index, 1);
  }

  getStepTypeInfo(type: string): any {
    return this.stepTypes.find(t => t.value === type) || this.stepTypes[0];
  }

  fieldKeyFromLabel(label: string): string {
    return label.toLowerCase().trim()
      .replace(/[áàäâ]/g, 'a').replace(/[éèëê]/g, 'e')
      .replace(/[íìïî]/g, 'i').replace(/[óòöô]/g, 'o')
      .replace(/[úùüû]/g, 'u').replace(/ñ/g, 'n')
      .replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '')
      .substring(0, 20);
  }

  onStepLabelChange(step: FlowStep): void {
    const expected = this.fieldKeyFromLabel(step.fieldLabel);
    if (!step.fieldKey || step.fieldKey === this.fieldKeyFromLabel(step.fieldLabel.slice(0, -1)) || step.fieldKey === expected) {
      step.fieldKey = expected;
    }
    // Warn if the key changed from a non-empty original value
    if (step._originalFieldKey) {
      step._fieldKeyChanged = step._originalFieldKey !== step.fieldKey;
    }
  }

  getAvailableFields(): string[] {
    return this.currentFlow.steps
      .filter(s => s.fieldKey && s.type !== 'message')
      .map(s => `{${s.fieldKey}}`);
  }

  // ==================== STEP ADVANCED ====================

  toggleStepAdvanced(i: number): void {
    if (this.expandedStepAdvanced.has(i)) {
      this.expandedStepAdvanced.delete(i);
    } else {
      this.expandedStepAdvanced.add(i);
    }
  }

  getMenuItemIcon(item: any): string {
    if (item.type === 'builtin') {
      const icons: any = {
        schedule: 'fa-clock',
        contact: 'fa-map-marker-alt',
        general: 'fa-info-circle',
        my_appointments: 'fa-calendar-check',
        cancel_appointment: 'fa-calendar-times'
      };
      return icons[item.action] || 'fa-bolt';
    }
    if (item.type === 'flow') return 'fa-project-diagram';
    return 'fa-comment-alt';
  }

  // ==================== MENU CONFIG ====================

  showAddMenuPanel = false;
  templateFilter = '';
  activeCategoryTab = 'all';

  get filteredTemplateFlows(): any[] {
    const q = this.templateFilter.toLowerCase().trim();
    return this.templateFlows.filter(tfl => {
      const matchesCategory = this.activeCategoryTab === 'all' || tfl.category === this.activeCategoryTab;
      const matchesText = !q || tfl.label.toLowerCase().includes(q) || tfl.description.toLowerCase().includes(q);
      return matchesCategory && matchesText;
    });
  }

  menuTemplates = [
    { icon: 'fa-clock',            label: 'Horarios',         description: 'Días y horarios de atención',    type: 'builtin', action: 'schedule',            requiresPlan: null },
    { icon: 'fa-map-marker-alt',   label: 'Ubicación',        description: 'Cómo encontrarnos',              type: 'builtin', action: 'contact',             requiresPlan: null },
    { icon: 'fa-info-circle',      label: 'Sobre Nosotros',   description: 'Información general',            type: 'builtin', action: 'general',             requiresPlan: null },
    { icon: 'fa-calendar-check',   label: 'Ver mis citas',    description: 'El usuario ve sus citas futuras', type: 'builtin', action: 'my_appointments',     requiresPlan: null },
    { icon: 'fa-calendar-times',   label: 'Cancelar mi cita', description: 'El usuario cancela una cita',    type: 'builtin', action: 'cancel_appointment',  requiresPlan: null },
  ];

  isTemplatePlanBlocked(tpl: any): boolean {
    if (!tpl.requiresPlan) return false;
    const limits = this.authService.getPlanLimits();
    return !(limits as any)[tpl.requiresPlan];
  }

  isTemplateAlreadyInMenu(tpl: any): boolean {
    if (tpl.type === 'builtin') {
      return this.menuConfig.items.some((it: any) => it.type === 'builtin' && it.action === tpl.action);
    }
    return this.menuConfig.items.some((it: any) =>
      it.type === 'flow' && it.label === tpl.label
    );
  }

  addMenuFromTemplate(tpl: any): void {
    if (!this.canAddMenuItem) return;
    const item: any = {
      id: 'item_' + Date.now(),
      label: tpl.label,
      description: tpl.description,
      order: this.menuConfig.items.length + 1,
      active: true
    };
    if (tpl.type === 'builtin') {
      item.type = 'builtin';
      item.action = tpl.action;
    } else {
      item.type = 'flow';
      const flow = this.flows.find((f: any) => f.name === tpl.matchFlow);
      item.flowId = flow ? flow.id : (this.flows.length > 0 ? this.flows[0].id : '');
    }
    this.menuConfig.items.push(item);
    this.showAddMenuPanel = false;
    this.templateFilter = '';
    this.activeCategoryTab = 'all';
  }

  addMenuItem(): void {
    if (!this.canAddMenuItem) return;
    this.menuConfig.items.push({
      id: 'item_' + Date.now(),
      type: 'builtin',
      action: 'schedule',
      label: '',
      description: '',
      order: this.menuConfig.items.length + 1,
      active: true
    });
    this.showAddMenuPanel = false;
    this.templateFilter = '';
    this.activeCategoryTab = 'all';
  }

  addMessageMenuItem(): void {
    if (!this.canAddMenuItem) return;
    this.menuConfig.items.push({
      id: 'item_' + Date.now(),
      type: 'message',
      label: '',
      messageContent: '',
      order: this.menuConfig.items.length + 1,
      active: true
    });
    this.showAddMenuPanel = false;
    this.templateFilter = '';
    this.activeCategoryTab = 'all';
  }

  removeMenuItem(index: number): void {
    this.menuConfig.items.splice(index, 1);
  }

  moveMenuItemUp(index: number): void {
    if (index <= 0) return;
    const items = this.menuConfig.items;
    [items[index - 1], items[index]] = [items[index], items[index - 1]];
    items.forEach((item: any, i: number) => item.order = i + 1);
  }

  moveMenuItemDown(index: number): void {
    if (index >= this.menuConfig.items.length - 1) return;
    const items = this.menuConfig.items;
    [items[index], items[index + 1]] = [items[index + 1], items[index]];
    items.forEach((item: any, i: number) => item.order = i + 1);
  }

  onMenuItemTypeChange(item: any): void {
    if (item.type === 'builtin') {
      item.action = 'schedule';
      item.flowId = null;
      item.messageContent = null;
    } else if (item.type === 'flow') {
      item.action = null;
      item.flowId = this.flows.length > 0 ? this.flows[0].id : '';
      item.messageContent = null;
    } else if (item.type === 'message') {
      item.action = null;
      item.flowId = null;
      if (!item.messageContent) item.messageContent = '';
    }
  }

  isTemplateFlowPlanBlocked(tfl: any): boolean {
    if (!tfl.requiresPlan) return false;
    const limits = this.authService.getPlanLimits();
    return !(limits as any)[tfl.requiresPlan];
  }

  isTemplateFlowAlreadyCreated(tfl: any): boolean {
    if (tfl.key === 'appointments') {
      return this.flows.some(f => f.steps?.some((s: any) => s.type === 'appointment_slot'));
    }
    return false;
  }

  openTemplateModal(tfl: any): void {
    this.pendingTemplateFlow = tfl;
    this.templateTitle = tfl.label;
    this.showTemplateModal = true;
  }

  cancelTemplateModal(): void {
    this.showTemplateModal = false;
    this.pendingTemplateFlow = null;
    this.templateTitle = '';
  }

  slugify(text: string): string {
    return text.toLowerCase().trim()
      .replace(/[áàäâ]/g, 'a').replace(/[éèëê]/g, 'e')
      .replace(/[íìïî]/g, 'i').replace(/[óòöô]/g, 'o')
      .replace(/[úùüû]/g, 'u').replace(/ñ/g, 'n')
      .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  }

  async confirmCreateTemplate(): Promise<void> {
    if (!this.templateTitle.trim() || this.creatingTemplate) return;
    const tfl = this.pendingTemplateFlow;
    this.creatingTemplate = true;
    try {
      const title = this.templateTitle.trim();
      const slug = this.slugify(title);
      const menuLabel = title.substring(0, 24);
      const now = Date.now();
      const sb = { required: true, validation: {}, errorMessage: '', optionsSource: 'custom', optionsTitleField: '', optionsDescField: '', customOptions: [], buttonText: 'Ver opciones', sourceCollection: '', displayField: '', detailFields: [], timeFieldKey: '' };

      // ── Base de datos ──
      const colFieldsMap: Record<string, any[]> = {
        appointments: [
          { key: 'nombre', label: 'Nombre', type: 'text', required: true },
          { key: 'fecha', label: 'Fecha', type: 'text', required: false },
          { key: 'hora', label: 'Hora', type: 'text', required: false },
          { key: '_apptService', label: 'Servicio', type: 'text', required: false },
          { key: 'phoneNumber', label: 'WhatsApp', type: 'text', required: false, protected: true }
        ],
        consultation: [
          { key: 'nombre', label: 'Nombre', type: 'text', required: true },
          { key: 'consulta', label: 'Consulta', type: 'text', required: true },
          { key: 'phoneNumber', label: 'WhatsApp', type: 'text', required: false, protected: true }
        ],
        quote: [
          { key: 'nombre', label: 'Nombre', type: 'text', required: true },
          { key: 'descripcion', label: 'Descripción', type: 'text', required: true },
          { key: 'presupuesto', label: 'Presupuesto', type: 'text', required: false },
          { key: 'phoneNumber', label: 'WhatsApp', type: 'text', required: false, protected: true }
        ],
        support: [
          { key: 'nombre', label: 'Nombre', type: 'text', required: true },
          { key: 'tipo', label: 'Tipo', type: 'text', required: true },
          { key: 'descripcion', label: 'Descripción', type: 'text', required: true },
          { key: 'phoneNumber', label: 'WhatsApp', type: 'text', required: false, protected: true }
        ],
        feedback: [
          { key: 'nombre', label: 'Nombre', type: 'text', required: false },
          { key: 'calificacion', label: 'Calificación', type: 'text', required: true },
          { key: 'comentario', label: 'Comentario', type: 'text', required: false },
          { key: 'phoneNumber', label: 'WhatsApp', type: 'text', required: false, protected: true }
        ],
        waitlist: [
          { key: 'nombre', label: 'Nombre', type: 'text', required: true },
          { key: 'interes', label: 'Interés', type: 'text', required: true },
          { key: 'phoneNumber', label: 'WhatsApp', type: 'text', required: false, protected: true }
        ],
        medical_appointment: [
          { key: 'nombre', label: 'Nombre', type: 'text', required: true },
          { key: 'fecha', label: 'Fecha', type: 'text', required: false },
          { key: 'hora', label: 'Hora', type: 'text', required: false },
          { key: '_apptService', label: 'Servicio', type: 'text', required: false },
          { key: 'archivoUrl', label: 'Imagen médica', type: 'text', required: false },
          { key: 'phoneNumber', label: 'WhatsApp', type: 'text', required: false, protected: true }
        ],
        school_enrollment: [
          { key: 'nombreEstudiante', label: 'Nombre estudiante', type: 'text', required: true },
          { key: 'grado', label: 'Grado / Nivel', type: 'text', required: true },
          { key: 'telefonoPadre', label: 'Teléfono padre/madre', type: 'text', required: true },
          { key: 'transporte', label: 'Necesita transporte', type: 'text', required: false },
          { key: 'phoneNumber', label: 'WhatsApp', type: 'text', required: false, protected: true }
        ],
        shipping_request: [
          { key: 'nombre', label: 'Nombre', type: 'text', required: true },
          { key: 'origen', label: 'Dirección origen', type: 'text', required: true },
          { key: 'destino', label: 'Dirección destino', type: 'text', required: true },
          { key: 'fotoUrl', label: 'Foto del paquete', type: 'text', required: false },
          { key: 'phoneNumber', label: 'WhatsApp', type: 'text', required: false, protected: true }
        ],
        payment_lookup: [
          { key: 'codigo_alumno',      label: 'Código de Alumno',      type: 'text',   required: true },
          { key: 'proxima_fecha_pago', label: 'Próxima Fecha de Pago', type: 'date',   required: false },
          { key: 'monto_pagar',        label: 'Monto a Pagar',         type: 'number', required: false },
          { key: 'formas_pago',        label: 'Formas de Pago',        type: 'text',   required: false },
          { key: 'cuotas_pendientes',  label: 'Cuotas Pendientes',     type: 'number', required: false }
        ]
      };
      const colFields = colFieldsMap[tfl.key] || [
        { key: 'nombre', label: 'Nombre', type: 'text', required: true },
        { key: 'correo', label: 'Correo', type: 'text', required: false },
        { key: 'telefono', label: 'Teléfono', type: 'text', required: false },
        { key: 'phoneNumber', label: 'WhatsApp', type: 'text', required: false, protected: true }
      ];
      await this.firebaseService.saveCollectionDef({ name: title, slug, description: `Registros de ${title}`, displayField: 'nombre', fields: colFields });

      // ── Pasos del flujo ──
      const stepsMap: Record<string, any[]> = {
        appointments: [
          { id: `step_${now}`,   ...sb, type: 'text_input',       prompt: '¿Cuál es tu nombre completo?',                                                        fieldKey: 'nombre',      fieldLabel: 'Nombre',      validation: { minLength: 3 }, errorMessage: 'Por favor ingresa un nombre válido.' },
          { id: `step_${now+1}`, ...sb, type: 'appointment_slot', prompt: '¿En qué fecha y hora te gustaría agendar?',                                            fieldKey: 'fecha',       fieldLabel: 'Fecha',       timeFieldKey: 'hora' }
        ],
        registration: [
          { id: `step_${now}`,   ...sb, type: 'text_input', prompt: '¿Cuál es tu nombre completo?',       fieldKey: 'nombre',   fieldLabel: 'Nombre',   validation: { minLength: 3 }, errorMessage: 'Por favor ingresa un nombre válido.' },
          { id: `step_${now+1}`, ...sb, type: 'text_input', prompt: '¿Cuál es tu correo electrónico?',    fieldKey: 'correo',   fieldLabel: 'Correo',   required: false },
          { id: `step_${now+2}`, ...sb, type: 'text_input', prompt: '¿Cuál es tu número de teléfono?',    fieldKey: 'telefono', fieldLabel: 'Teléfono', required: false }
        ],
        consultation: [
          { id: `step_${now}`,   ...sb, type: 'text_input', prompt: '¿Cuál es tu nombre completo?',                                            fieldKey: 'nombre',   fieldLabel: 'Nombre',   validation: { minLength: 3 }, errorMessage: 'Por favor ingresa un nombre válido.' },
          { id: `step_${now+1}`, ...sb, type: 'text_input', prompt: '¿Cuál es tu consulta? Descríbela con el mayor detalle posible.',          fieldKey: 'consulta', fieldLabel: 'Consulta', validation: { minLength: 5 }, errorMessage: 'Por favor describe tu consulta.' }
        ],
        quote: [
          { id: `step_${now}`,   ...sb, type: 'text_input', prompt: '¿Cuál es tu nombre completo?',                                                       fieldKey: 'nombre',      fieldLabel: 'Nombre',       validation: { minLength: 3 }, errorMessage: 'Por favor ingresa un nombre válido.' },
          { id: `step_${now+1}`, ...sb, type: 'text_input', prompt: '¿Qué producto o servicio necesitas cotizar? Descríbelo con detalle.',                 fieldKey: 'descripcion', fieldLabel: 'Descripción',  validation: { minLength: 5 }, errorMessage: 'Por favor describe lo que necesitas.' },
          { id: `step_${now+2}`, ...sb, type: 'text_input', prompt: '¿Tienes algún presupuesto en mente? (Escribe el monto o "No lo sé")',                 fieldKey: 'presupuesto', fieldLabel: 'Presupuesto',  required: false }
        ],
        support: [
          { id: `step_${now}`,   ...sb, type: 'text_input',      prompt: '¿Cuál es tu nombre completo?',                         fieldKey: 'nombre',      fieldLabel: 'Nombre',      validation: { minLength: 3 }, errorMessage: 'Por favor ingresa un nombre válido.' },
          { id: `step_${now+1}`, ...sb, type: 'select_buttons',  prompt: '¿Sobre qué nos contactas?',                           fieldKey: 'tipo',        fieldLabel: 'Tipo',        customOptions: [{ label: 'Reclamo', value: 'Reclamo' }, { label: 'Consulta', value: 'Consulta' }, { label: 'Sugerencia', value: 'Sugerencia' }] },
          { id: `step_${now+2}`, ...sb, type: 'text_input',      prompt: 'Cuéntanos con detalle. ¿Qué sucedió o qué necesitas?', fieldKey: 'descripcion', fieldLabel: 'Descripción', validation: { minLength: 10 }, errorMessage: 'Por favor brinda más detalle.' }
        ],
        feedback: [
          { id: `step_${now}`,   ...sb, type: 'text_input',     prompt: '¿Cuál es tu nombre? (opcional)',                 fieldKey: 'nombre',      fieldLabel: 'Nombre',       required: false },
          { id: `step_${now+1}`, ...sb, type: 'select_buttons', prompt: '¿Cómo calificarías nuestro servicio?',           fieldKey: 'calificacion', fieldLabel: 'Calificación', customOptions: [{ label: '⭐ Regular', value: 'Regular' }, { label: '⭐⭐⭐ Bueno', value: 'Bueno' }, { label: '⭐⭐⭐⭐⭐ Excelente', value: 'Excelente' }] },
          { id: `step_${now+2}`, ...sb, type: 'text_input',     prompt: '¿Deseas dejarnos algún comentario? (opcional)',  fieldKey: 'comentario',  fieldLabel: 'Comentario',   required: false }
        ],
        waitlist: [
          { id: `step_${now}`,   ...sb, type: 'text_input', prompt: '¿Cuál es tu nombre completo?',                                                   fieldKey: 'nombre',  fieldLabel: 'Nombre',   validation: { minLength: 3 }, errorMessage: 'Por favor ingresa un nombre válido.' },
          { id: `step_${now+1}`, ...sb, type: 'text_input', prompt: '¿Para qué servicio o producto deseas reservar tu lugar en la lista de espera?',  fieldKey: 'interes', fieldLabel: 'Interés',  validation: { minLength: 3 }, errorMessage: 'Por favor indica el servicio o producto.' }
        ],
        urgency: [
          { id: `step_${now}`, ...sb, type: 'message', prompt: '🚨 *URGENCIAS / EMERGENCIAS*\n\nSi tienes una emergencia médica llama al 911.\n\nPara contacto directo escríbenos al número de atención de urgencias o visítanos en nuestra sede.', fieldKey: '', fieldLabel: '' }
        ],
        medical_appointment: [
          { id: `step_${now}`,   ...sb, type: 'text_input',       prompt: '¿Cuál es tu nombre completo?',                                               fieldKey: 'nombre',  fieldLabel: 'Nombre',  validation: { minLength: 3 }, errorMessage: 'Por favor ingresa un nombre válido.' },
          { id: `step_${now+1}`, ...sb, type: 'appointment_slot', prompt: '¿En qué fecha y hora deseas tu consulta?',                                   fieldKey: 'fecha',   fieldLabel: 'Fecha',   timeFieldKey: 'hora' },
          { id: `step_${now+2}`, ...sb, type: 'image_input',      prompt: '📎 ¿Tienes exámenes o imágenes médicas previas? Puedes enviarlas aquí.', fieldKey: 'archivoUrl', fieldLabel: 'Imagen médica', required: false, optional: true, allowedTypes: 'any' }
        ],
        school_enrollment: [
          { id: `step_${now}`,   ...sb, type: 'text_input',     prompt: '¿Cuál es el nombre completo del estudiante?',                            fieldKey: 'nombreEstudiante', fieldLabel: 'Nombre estudiante', validation: { minLength: 3 }, errorMessage: 'Por favor ingresa el nombre del estudiante.' },
          { id: `step_${now+1}`, ...sb, type: 'text_input',     prompt: '¿A qué grado o nivel desea ingresar?',                                  fieldKey: 'grado',            fieldLabel: 'Grado / Nivel',     validation: { minLength: 1 }, errorMessage: 'Por favor indica el grado.' },
          { id: `step_${now+2}`, ...sb, type: 'text_input',     prompt: '¿Cuál es el número de teléfono del padre o madre de familia?',           fieldKey: 'telefonoPadre',    fieldLabel: 'Teléfono padre',    validation: { minLength: 8 }, errorMessage: 'Por favor ingresa un teléfono válido.' },
          { id: `step_${now+3}`, ...sb, type: 'select_buttons', prompt: '¿El estudiante necesita servicio de transporte escolar?',               fieldKey: 'transporte',       fieldLabel: 'Necesita transporte', customOptions: [{ label: 'Sí, necesito', value: 'Sí' }, { label: 'No, gracias', value: 'No' }] }
        ],
        shipping_request: [
          { id: `step_${now}`,   ...sb, type: 'text_input',  prompt: '¿Cuál es tu nombre completo?',                                  fieldKey: 'nombre',  fieldLabel: 'Nombre',            validation: { minLength: 3 }, errorMessage: 'Por favor ingresa tu nombre.' },
          { id: `step_${now+1}`, ...sb, type: 'text_input',  prompt: '¿Cuál es la dirección de origen del paquete?',                  fieldKey: 'origen',  fieldLabel: 'Dirección origen',  validation: { minLength: 5 }, errorMessage: 'Por favor ingresa la dirección de origen.' },
          { id: `step_${now+2}`, ...sb, type: 'text_input',  prompt: '¿Cuál es la dirección de destino del paquete?',                 fieldKey: 'destino', fieldLabel: 'Dirección destino', validation: { minLength: 5 }, errorMessage: 'Por favor ingresa la dirección de destino.' },
          { id: `step_${now+3}`, ...sb, type: 'image_input', prompt: '📦 Por favor envía una foto del paquete (opcional).', fieldKey: 'fotoUrl', fieldLabel: 'Foto del paquete', required: false, optional: true, allowedTypes: 'image' }
        ],
        payment_lookup: [
          {
            id: `step_${now}`, ...sb,
            type: 'auth_lookup',
            prompt: 'Por favor escribe tu código de alumno:',
            fieldKey: 'codigo_alumno', fieldLabel: 'Código de Alumno',
            lookupCollection: slug,
            authField: 'codigo_alumno',
            resultTemplate: '📋 *Estado de Cuenta*\n\nCódigo: {codigo_alumno}\n📅 Próxima fecha de pago: {proxima_fecha_pago}\n💰 Monto a pagar: ${monto_pagar}\n💳 Formas de pago: {formas_pago}\n📊 Cuotas pendientes: {cuotas_pendientes}',
            notFoundMessage: 'No encontramos ese código de alumno. Por favor verifica e intenta de nuevo.',
            maxRetries: 3
          }
        ]
      };

      const completionMap: Record<string, string> = {
        appointments:        `✅ *CITA AGENDADA*\n\nNombre: {nombre}\nFecha: {fecha}\nHora: {hora}\n\n¡Te esperamos! Si necesitas cancelar, escríbenos.`,
        registration:        `✅ *REGISTRO COMPLETADO*\n\nNombre: {nombre}\n\n¡Gracias! Nos pondremos en contacto pronto.`,
        consultation:        `✅ *CONSULTA RECIBIDA*\n\nNombre: {nombre}\n\nNos pondremos en contacto pronto para responderte.`,
        quote:               `✅ *SOLICITUD DE COTIZACIÓN RECIBIDA*\n\nNombre: {nombre}\nDescripción: {descripcion}\n\nEnviaremos tu cotización a la brevedad.`,
        support:             `✅ *CASO REGISTRADO*\n\nNombre: {nombre} | Tipo: {tipo}\n\nNuestro equipo revisará tu caso y te contactará pronto.`,
        feedback:            `🙏 *¡GRACIAS POR TU OPINIÓN!*\n\nCalificación: {calificacion}\n\nTu retroalimentación nos ayuda a mejorar.`,
        waitlist:            `✅ *¡ANOTADO EN LISTA DE ESPERA!*\n\nNombre: {nombre}\nInterés: {interes}\n\nTe avisaremos cuando haya disponibilidad.`,
        urgency:             ``,
        medical_appointment: `✅ *CITA MÉDICA CONFIRMADA*\n\nNombre: {nombre}\nFecha: {fecha}\nHora: {hora}\n\n¡Te esperamos! Llega 10 minutos antes de tu cita.`,
        school_enrollment:   `✅ *PRE-MATRÍCULA RECIBIDA*\n\nEstudiante: {nombreEstudiante}\nGrado: {grado}\n\nNuestro equipo de secretaría te contactará para completar el proceso.`,
        shipping_request:    `✅ *SOLICITUD DE ENVÍO RECIBIDA*\n\nNombre: {nombre}\nOrigen: {origen}\nDestino: {destino}\n\nUn agente revisará tu solicitud y te dará el precio pronto.`,
        payment_lookup:      ''
      };

      const menuDescMap: Record<string, string> = {
        appointments:        'Elige fecha y hora disponible',
        registration:        'Completa tu registro',
        consultation:        'Envíanos tu consulta',
        quote:               'Solicita un precio estimado',
        support:             'Reporta un problema o sugerencia',
        feedback:            'Dinos cómo lo estamos haciendo',
        waitlist:            'Reserva tu lugar en la lista',
        urgency:             'Información de urgencias y emergencias',
        medical_appointment: 'Agenda tu consulta médica',
        school_enrollment:   'Inicia tu pre-inscripción escolar',
        shipping_request:    'Solicita un envío o paquetería',
        payment_lookup:      'Consulta tu próxima fecha de pago'
      };

      const saveToCollection = tfl.key === 'payment_lookup' ? '' : slug;
      const flowType = (tfl.key === 'appointments' || tfl.key === 'medical_appointment') ? 'appointment'
                     : tfl.key === 'payment_lookup' ? 'lookup'
                     : 'registration';
      const flowData: any = {
        name: title,
        description: `Flujo: ${title}`,
        menuLabel,
        menuDescription: menuDescMap[tfl.key] || 'Completa el formulario',
        type: flowType,
        active: true,
        order: this.flows.length + 1,
        saveToCollection,
        notifyAdmin: tfl.key !== 'payment_lookup',
        completionMessage: completionMap[tfl.key] ?? completionMap['registration'],
        steps: stepsMap[tfl.key] || stepsMap['registration']
      };
      const newFlowId = await this.firebaseService.addFlow(flowData);

      // Agregar al menú solo si hay espacio
      const addedToMenu = this.canAddMenuItem;
      if (addedToMenu) {
        this.menuConfig.items.push({
          id: 'item_' + Date.now(),
          type: 'flow',
          flowId: newFlowId,
          label: menuLabel,
          description: flowData.menuDescription,
          order: this.menuConfig.items.length + 1,
          active: true
        });
        await this.firebaseService.saveMenuConfig(this.menuConfig);
      }

      this.cancelTemplateModal();
      this.showAddMenuPanel = false;
      this.templateFilter = '';
      this.activeCategoryTab = 'all';
      await this.loadData();
      this.activeTab = 'flows';
      this.notice = addedToMenu
        ? `Flujo "${title}" creado y agregado al menú`
        : `Flujo "${title}" creado (menú lleno — agrégalo desde el menú manualmente)`;
      setTimeout(() => this.notice = '', 5000);
    } catch {
      this.error = 'Error al crear flujo desde plantilla';
      setTimeout(() => this.error = '', 3000);
    } finally {
      this.creatingTemplate = false;
    }
  }

  async saveMenuConfig(): Promise<void> {
    this.saving = true;
    try {
      this.menuConfig.items.forEach((item: any, i: number) => item.order = i + 1);
      await this.firebaseService.saveMenuConfig(this.menuConfig);
      this.notice = 'Menú guardado correctamente';
      setTimeout(() => this.notice = '', 3000);
    } catch (err) {
      this.error = 'Error al guardar menú';
      setTimeout(() => this.error = '', 3000);
    } finally {
      this.saving = false;
    }
  }

  // ==================== TOUR ====================

  startTour(): void { this.tourContext = 'list'; this.tourActive = true; this.tourStep = 0; this.updateTourPosition(); }
  startEditTour(): void { this.tourContext = 'edit'; this.tourActive = true; this.tourStep = 0; this.updateTourPosition(); }
  closeTour(): void { this.tourActive = false; this.clearTourHighlight(); }

  nextTourStep(): void {
    if (this.tourStep < this.activeTourSteps.length - 1) { this.tourStep++; this.updateTourPosition(); }
    else { this.closeTour(); }
  }

  prevTourStep(): void {
    if (this.tourStep > 0) { this.tourStep--; this.updateTourPosition(); }
  }

  private clearTourHighlight(): void {
    document.querySelectorAll('.tour-highlight-el').forEach(el => el.classList.remove('tour-highlight-el'));
  }

  private updateTourPosition(): void {
    const step = this.activeTourSteps[this.tourStep];

    // Center: no target element, center in viewport
    if (step.position === 'center' || !step.selector) {
      this.clearTourHighlight();
      setTimeout(() => {
        const tooltipW = 420, tooltipH = 280;
        this.tourTooltipTop  = Math.max(80,  (window.innerHeight - tooltipH) / 2);
        this.tourTooltipLeft = Math.max(16,  (window.innerWidth  - tooltipW) / 2);
      }, 50);
      return;
    }

    const selectors = step.selector.split(', ');
    let el: Element | null = null;
    for (const sel of selectors) { el = document.querySelector(sel.trim()); if (el) break; }
    this.clearTourHighlight();
    if (!el) return;
    el.classList.add('tour-highlight-el');
    el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    setTimeout(() => {
      const rect = el!.getBoundingClientRect();
      const tooltipW = 340, tooltipH = 200;
      let top = step.position === 'below' ? rect.bottom + 14 : rect.top - tooltipH - 14;
      let left = rect.left + rect.width / 2 - tooltipW / 2;
      top  = Math.max(16, Math.min(top,  window.innerHeight - tooltipH - 16));
      left = Math.max(16, Math.min(left, window.innerWidth  - tooltipW - 16));
      this.tourTooltipTop = top;
      this.tourTooltipLeft = left;
    }, 300);
  }
}
