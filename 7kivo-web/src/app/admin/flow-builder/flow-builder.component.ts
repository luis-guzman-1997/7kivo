import { Component, OnInit } from '@angular/core';
import { FirebaseService } from '../../services/firebase.service';

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
    { value: 'text_input', label: 'Texto libre', icon: 'fa-keyboard', desc: 'El usuario escribe texto' },
    { value: 'number_input', label: 'Número', icon: 'fa-hashtag', desc: 'El usuario escribe un número' },
    { value: 'select_list', label: 'Lista de opciones', icon: 'fa-list', desc: 'Menú desplegable con opciones' },
    { value: 'select_buttons', label: 'Botones (máx 3)', icon: 'fa-hand-pointer', desc: 'Botones interactivos' },
    { value: 'browse_collection', label: 'Explorar colección', icon: 'fa-database', desc: 'Navegar y ver detalles de items' },
    { value: 'appointment_slot', label: 'Selección de cita', icon: 'fa-calendar-check', desc: 'El usuario elige día y hora disponible' },
    { value: 'message', label: 'Mensaje automático', icon: 'fa-comment', desc: 'Envía un mensaje sin esperar respuesta' }
  ];

  constructor(private firebaseService: FirebaseService) {}

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

  async deleteFlow(flow: Flow): Promise<void> {
    if (!confirm(`¿Eliminar el flujo "${flow.name}"?`)) return;
    this.saving = true;
    try {
      await this.firebaseService.deleteFlow(flow.id!);
      this.notice = `Flujo "${flow.name}" eliminado`;
      await this.loadData();
      setTimeout(() => this.notice = '', 3000);
    } catch (err) {
      this.error = 'Error al eliminar flujo';
      setTimeout(() => this.error = '', 3000);
    } finally {
      this.saving = false;
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

  getAvailableFields(): string[] {
    return this.currentFlow.steps
      .filter(s => s.fieldKey && s.type !== 'message')
      .map(s => `{${s.fieldKey}}`);
  }

  // ==================== MENU CONFIG ====================

  toggleMenuConfig(): void {
    this.showMenuConfig = !this.showMenuConfig;
  }

  addMenuItem(): void {
    this.menuConfig.items.push({
      id: 'item_' + Date.now(),
      type: 'builtin',
      action: 'programs',
      label: '',
      description: '',
      order: this.menuConfig.items.length + 1,
      active: true
    });
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
      item.action = 'programs';
      item.flowId = null;
    } else {
      item.action = null;
      item.flowId = this.flows.length > 0 ? this.flows[0].id : '';
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
