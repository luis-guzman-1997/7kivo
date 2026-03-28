import { Component, OnInit } from '@angular/core';
import { FirebaseService } from '../../services/firebase.service';

@Component({
  selector: 'app-sa-plans',
  templateUrl: './sa-plans.component.html',
  styleUrls: ['./sa-plans.component.css']
})
export class SaPlansComponent implements OnInit {
  plans: any[] = [];
  loading = true;
  saving = false;

  sectionTitle = 'Un plan para cada etapa de tu negocio';
  sectionDesc = 'Elige el plan que se adapte a tus necesidades. Actualiza en cualquier momento.';
  savingSection = false;

  showForm = false;
  editingIndex: number | null = null;
  form = this.emptyForm();

  private emptyForm() {
    return { name: '', tagline: '', price: 0, popular: false, ctaText: 'Comenzar', features: '', disabledFeatures: '', active: true };
  }

  constructor(private firebaseService: FirebaseService) {}

  async ngOnInit(): Promise<void> {
    await this.loadPlans();
  }

  async loadPlans(): Promise<void> {
    this.loading = true;
    try {
      const data = await this.firebaseService.getPlatformPlans();
      this.plans = data?.plans || [];
      this.sectionTitle = data?.sectionTitle || this.sectionTitle;
      this.sectionDesc = data?.sectionDesc || this.sectionDesc;
    } catch (err) {
      console.error('Error loading plans:', err);
    } finally {
      this.loading = false;
    }
  }

  async saveSectionTexts(): Promise<void> {
    this.savingSection = true;
    try {
      await this.firebaseService.savePlatformPlansMeta({
        sectionTitle: this.sectionTitle,
        sectionDesc: this.sectionDesc
      });
    } catch (err) {
      console.error('Error saving section texts:', err);
    } finally {
      this.savingSection = false;
    }
  }

  openNewPlan(): void {
    this.editingIndex = null;
    this.form = this.emptyForm();
    this.showForm = true;
  }

  editPlan(index: number): void {
    const plan = this.plans[index];
    this.editingIndex = index;
    this.form = {
      name: plan.name || '',
      tagline: plan.tagline || '',
      price: plan.price || 0,
      popular: plan.popular || false,
      ctaText: plan.ctaText || 'Comenzar',
      features: (plan.features || []).join('\n'),
      disabledFeatures: (plan.disabledFeatures || []).join('\n'),
      active: plan.active !== false
    };
    this.showForm = true;
  }

  closeForm(): void {
    this.showForm = false;
    this.editingIndex = null;
  }

  async savePlan(): Promise<void> {
    if (!this.form.name.trim()) return;
    this.saving = true;
    try {
      const planData = {
        name: this.form.name.trim(),
        tagline: this.form.tagline.trim(),
        price: this.form.price,
        popular: this.form.popular,
        ctaText: this.form.ctaText.trim() || 'Comenzar',
        features: this.form.features.split('\n').map(f => f.trim()).filter(f => f),
        disabledFeatures: this.form.disabledFeatures.split('\n').map(f => f.trim()).filter(f => f),
        active: this.form.active
      };

      const updatedPlans = [...this.plans];
      if (this.editingIndex !== null) {
        updatedPlans[this.editingIndex] = planData;
      } else {
        updatedPlans.push(planData);
      }

      await this.firebaseService.savePlatformPlans(updatedPlans);
      this.plans = updatedPlans;
      this.closeForm();
    } catch (err) {
      console.error('Error saving plan:', err);
    } finally {
      this.saving = false;
    }
  }

  async deletePlan(index: number): Promise<void> {
    if (!confirm(`¿Eliminar el plan "${this.plans[index].name}"?`)) return;
    try {
      const updatedPlans = this.plans.filter((_: any, i: number) => i !== index);
      await this.firebaseService.savePlatformPlans(updatedPlans);
      this.plans = updatedPlans;
    } catch (err) {
      console.error('Error deleting plan:', err);
    }
  }

  async togglePlanActive(index: number): Promise<void> {
    this.plans[index].active = !this.plans[index].active;
    try {
      await this.firebaseService.savePlatformPlans(this.plans);
    } catch (err) {
      console.error('Error toggling plan:', err);
      this.plans[index].active = !this.plans[index].active;
    }
  }
}
