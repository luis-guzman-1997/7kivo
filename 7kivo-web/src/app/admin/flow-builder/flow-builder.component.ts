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
  validation: { minLength?: number; maxLength?: number; min?: number; max?: number };
  errorMessage: string;
  optionsSource: string;
  optionsTitleField: string;
  optionsDescField: string;
  customOptions: { label: string; value: string; description?: string; duration?: number }[];
  buttonText: string;
  sourceCollection: string;
  displayField: string;
  detailFields: string[];
  timeFieldKey: string;
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
}

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

  // Menu config
  menuConfig: any = { greeting: '', menuButtonText: 'Ver opciones', fallbackMessage: '', items: [] };
  showMenuConfig = false;
  collectionDefs: any[] = [];
  collectionPreviewCache: Record<string, any[]> = {};

  stepTypes = [
    { value: 'text_input',       label: 'Texto',    icon: 'fa-keyboard',       desc: 'El usuario escribe texto libremente' },
    { value: 'number_input',     label: 'Número',   icon: 'fa-hashtag',        desc: 'El usuario escribe un número' },
    { value: 'select_buttons',   label: 'Botones',  icon: 'fa-hand-pointer',   desc: 'Hasta 3 botones de respuesta rápida' },
    { value: 'select_list',      label: 'Lista',    icon: 'fa-list',           desc: 'Lista desplegable de opciones' },
    { value: 'browse_collection',label: 'Catálogo', icon: 'fa-th-large',       desc: 'El usuario navega un catálogo' },
    { value: 'appointment_slot', label: 'Cita',     icon: 'fa-calendar-check', desc: 'El usuario elige fecha y hora disponible' },
    { value: 'message',          label: 'Mensaje',  icon: 'fa-comment',        desc: 'El bot envía un mensaje sin esperar respuesta' }
  ];

  planLimit = 999;
  scheduleWarning = false;

  // Template modal state
  showTemplateModal = false;
  pendingTemplateFlow: any = null;
  templateTitle = '';
  creatingTemplate = false;

  // Delete flow modal state
  deleteFlowTarget: Flow | null = null;
  deletingFlow = false;

  templateFlows = [
    { icon: 'fa-calendar-check',      label: 'Agendar Cita',     description: 'Reserva de citas con disponibilidad en tiempo real', requiresPlan: 'appointments', key: 'appointments' },
    { icon: 'fa-clipboard-list',      label: 'Registro',          description: 'Formulario de inscripción o registro de datos',       requiresPlan: null, key: 'registration' },
    { icon: 'fa-question-circle',     label: 'Consulta',          description: 'Formulario de preguntas y consultas al equipo',       requiresPlan: null, key: 'consultation' },
    { icon: 'fa-file-invoice-dollar', label: 'Cotización',        description: 'Solicitud de presupuesto o precio estimado',          requiresPlan: null, key: 'quote' },
    { icon: 'fa-headset',             label: 'Soporte / Reclamo', description: 'Atención a problemas, quejas y sugerencias',          requiresPlan: null, key: 'support' },
    { icon: 'fa-star',                label: 'Encuesta',          description: 'Encuesta de satisfacción post-servicio',              requiresPlan: null, key: 'feedback' },
    { icon: 'fa-hourglass-half',      label: 'Lista de Espera',   description: 'Registro para lista de espera o turno',              requiresPlan: null, key: 'waitlist' }
  ];

  constructor(private firebaseService: FirebaseService, public authService: AuthService) {
    this.planLimit = this.authService.getPlanLimits().flows;
  }

  get canCreateFlow(): boolean {
    return this.flows.length < this.planLimit;
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
    if (!hasApptFlow) { this.scheduleWarning = false; return; }
    try {
      const schedule = await this.firebaseService.getInfo('schedule');
      const hasActiveDays = schedule?.days?.some((d: any) => d.active && d.shifts?.length > 0);
      this.scheduleWarning = !hasActiveDays;
    } catch {
      this.scheduleWarning = true;
    }
  }

  emptyFlow(): Flow {
    return {
      name: '', description: '', menuLabel: '', menuDescription: '',
      type: 'registration', active: true, order: this.flows?.length || 0,
      steps: [], completionMessage: '', saveToCollection: '', notifyAdmin: false
    };
  }

  emptyStep(): FlowStep {
    return {
      id: 'step_' + Date.now(),
      type: 'text_input', prompt: '', fieldKey: '', fieldLabel: '',
      required: true, validation: {}, errorMessage: '',
      optionsSource: 'custom', optionsTitleField: '', optionsDescField: '',
      customOptions: [], buttonText: 'Ver opciones',
      sourceCollection: '', displayField: '', detailFields: [],
      timeFieldKey: ''
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
  }

  openEditFlow(flow: Flow): void {
    this.currentFlow = JSON.parse(JSON.stringify(flow));
    if (!this.currentFlow.steps) this.currentFlow.steps = [];
    this.currentFlow.steps.forEach(s => {
      if (!s.validation) s.validation = {};
      if (!s.customOptions) s.customOptions = [];
      if (!s.detailFields) s.detailFields = [];
      if (!s.sourceCollection) s.sourceCollection = '';
      if (!s.displayField) s.displayField = '';
      if (!s.optionsTitleField) s.optionsTitleField = '';
      if (!s.optionsDescField) s.optionsDescField = '';
      if (!s.timeFieldKey) s.timeFieldKey = '';
    });
    this.editMode = true;
    this.expandedStepIndex = null;
  }

  cancelEdit(): void {
    this.editMode = false;
    this.expandedStepIndex = null;
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
      const data: any = { ...this.currentFlow };
      delete data.id;

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

  // ==================== STEP MANAGEMENT ====================

  addStep(): void {
    this.currentFlow.steps.push(this.emptyStep());
    this.expandedStepIndex = this.currentFlow.steps.length - 1;
  }

  removeStep(index: number): void {
    this.currentFlow.steps.splice(index, 1);
    this.expandedStepIndex = null;
  }

  moveStepUp(index: number): void {
    if (index <= 0) return;
    const steps = this.currentFlow.steps;
    [steps[index - 1], steps[index]] = [steps[index], steps[index - 1]];
    this.expandedStepIndex = index - 1;
  }

  moveStepDown(index: number): void {
    if (index >= this.currentFlow.steps.length - 1) return;
    const steps = this.currentFlow.steps;
    [steps[index], steps[index + 1]] = [steps[index + 1], steps[index]];
    this.expandedStepIndex = index + 1;
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
  }

  getAvailableFields(): string[] {
    return this.currentFlow.steps
      .filter(s => s.fieldKey && s.type !== 'message')
      .map(s => `{${s.fieldKey}}`);
  }

  // ==================== MENU CONFIG ====================

  toggleMenuConfig(): void {
    this.showMenuConfig = !this.showMenuConfig;
  }

  showAddMenuPanel = false;

  menuTemplates = [
    { icon: 'fa-clock', label: 'Horarios', description: 'Días y horarios de atención', type: 'builtin', action: 'schedule', requiresPlan: null },
    { icon: 'fa-map-marker-alt', label: 'Ubicación', description: 'Cómo encontrarnos', type: 'builtin', action: 'contact', requiresPlan: null },
    { icon: 'fa-info-circle', label: 'Sobre Nosotros', description: 'Información general', type: 'builtin', action: 'general', requiresPlan: null },
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
        ]
      };

      const completionMap: Record<string, string> = {
        appointments: `✅ *CITA AGENDADA*\n\nNombre: {nombre}\nFecha: {fecha}\nHora: {hora}\n\n¡Te esperamos! Si necesitas cancelar, escríbenos.`,
        registration:  `✅ *REGISTRO COMPLETADO*\n\nNombre: {nombre}\n\n¡Gracias! Nos pondremos en contacto pronto.`,
        consultation:  `✅ *CONSULTA RECIBIDA*\n\nNombre: {nombre}\n\nNos pondremos en contacto pronto para responderte.`,
        quote:         `✅ *SOLICITUD DE COTIZACIÓN RECIBIDA*\n\nNombre: {nombre}\nDescripción: {descripcion}\n\nEnviaremos tu cotización a la brevedad.`,
        support:       `✅ *CASO REGISTRADO*\n\nNombre: {nombre} | Tipo: {tipo}\n\nNuestro equipo revisará tu caso y te contactará pronto.`,
        feedback:      `🙏 *¡GRACIAS POR TU OPINIÓN!*\n\nCalificación: {calificacion}\n\nTu retroalimentación nos ayuda a mejorar.`,
        waitlist:      `✅ *¡ANOTADO EN LISTA DE ESPERA!*\n\nNombre: {nombre}\nInterés: {interes}\n\nTe avisaremos cuando haya disponibilidad.`
      };

      const menuDescMap: Record<string, string> = {
        appointments: 'Elige fecha y hora disponible',
        registration:  'Completa tu registro',
        consultation:  'Envíanos tu consulta',
        quote:         'Solicita un precio estimado',
        support:       'Reporta un problema o sugerencia',
        feedback:      'Dinos cómo lo estamos haciendo',
        waitlist:      'Reserva tu lugar en la lista'
      };

      const flowData: any = {
        name: title,
        description: `Flujo: ${title}`,
        menuLabel,
        menuDescription: menuDescMap[tfl.key] || 'Completa el formulario',
        type: tfl.key === 'appointments' ? 'appointment' : 'registration',
        active: true,
        order: this.flows.length + 1,
        saveToCollection: slug,
        notifyAdmin: true,
        completionMessage: completionMap[tfl.key] || completionMap['registration'],
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
      await this.loadData();
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
}
