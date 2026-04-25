import { Component, OnInit } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { FirebaseService } from '../services/firebase.service';

interface CartItem { product: any; qty: number; }

@Component({
  selector: 'app-catalog',
  templateUrl: './catalog.component.html',
  styleUrls: ['./catalog.component.css']
})
export class CatalogComponent implements OnInit {
  loading = true;
  orgId = '';
  flowId = '';
  orgName = '';
  orgLogo = '';
  waPhone = '';
  botApiUrl = '';

  flow: any = null;
  products: any[] = [];
  webSteps: any[] = [];
  categories: string[] = [];

  cart: CartItem[] = [];
  checkoutMode = false;
  webFormData: Record<string, any> = {};

  submitting = false;
  orderCode = '';
  waLink = '';
  error = '';

  constructor(
    private route: ActivatedRoute,
    private http: HttpClient,
    private firebaseService: FirebaseService
  ) {}

  async ngOnInit(): Promise<void> {
    this.orgId  = this.route.snapshot.paramMap.get('orgId')  || '';
    this.flowId = this.route.snapshot.paramMap.get('flowId') || '';
    try {
      const publicInfo = await this.firebaseService.getPublicOrgInfo(this.orgId);
      this.orgName   = publicInfo?.orgName  || '';
      this.orgLogo   = publicInfo?.orgLogo  || '';
      this.botApiUrl = publicInfo?.botApiUrl || '';

      if (!this.botApiUrl) {
        this.error = 'Catálogo no disponible en este momento.';
        return;
      }

      const data: any = await this.http
        .get(`${this.botApiUrl}/api/${this.orgId}/catalog/${this.flowId}`)
        .toPromise();

      if (!data?.ok) { this.error = 'Catálogo no encontrado.'; return; }

      this.flow     = data.flow;
      this.products = data.products || [];
      this.webSteps = data.webSteps || [];
      this.waPhone  = data.waPhone  || '';

      const cats = [...new Set<string>(this.products.map((p: any) => p.categoria || 'General'))];
      this.categories = cats;
    } catch {
      this.error = 'Error al cargar el catálogo.';
    } finally {
      this.loading = false;
    }
  }

  getByCategory(cat: string): any[] {
    return this.products.filter(p => (p.categoria || 'General') === cat);
  }

  getQty(id: string): number {
    return this.cart.find(c => c.product.id === id)?.qty || 0;
  }

  addItem(product: any): void {
    const item = this.cart.find(c => c.product.id === product.id);
    item ? item.qty++ : this.cart.push({ product, qty: 1 });
  }

  removeItem(product: any): void {
    const idx = this.cart.findIndex(c => c.product.id === product.id);
    if (idx === -1) return;
    this.cart[idx].qty > 1 ? this.cart[idx].qty-- : this.cart.splice(idx, 1);
  }

  get cartTotal(): number {
    return this.cart.reduce((s, c) => s + c.product.precio * c.qty, 0);
  }

  get cartCount(): number {
    return this.cart.reduce((s, c) => s + c.qty, 0);
  }

  startCheckout(): void {
    this.webFormData  = {};
    this.checkoutMode = true;
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  backToCart(): void {
    this.checkoutMode = false;
  }

  async submitOrder(): Promise<void> {
    for (const step of this.webSteps) {
      if (step.required && !this.webFormData[step.fieldKey]) {
        this.error = `"${step.fieldLabel || step.prompt}" es obligatorio.`;
        setTimeout(() => this.error = '', 3000);
        return;
      }
    }
    this.submitting = true;
    try {
      const now     = new Date();
      const dateStr = now.toISOString().slice(0, 10).replace(/-/g, '');
      const rand    = Math.random().toString(36).slice(2, 6).toUpperCase();
      const code    = `PED-${dateStr}-${rand}`;

      const itemsText = this.cart.map(c => `${c.qty}x ${c.product.nombre}`).join(', ');
      const total     = this.cartTotal;
      const totalText = `$${total.toFixed(2)}`;
      const items     = this.cart.map(c => ({
        productId: c.product.id, name: c.product.nombre,
        price: c.product.precio, qty: c.qty,
      }));

      await this.http.post(`${this.botApiUrl}/api/${this.orgId}/orders`, {
        code, items, itemsText, total, totalText,
        flowId: this.flowId,
        webData: this.webFormData,
        orderDate: now.toLocaleDateString('es', { day: '2-digit', month: '2-digit', year: 'numeric' }),
      }).toPromise();

      this.orderCode = code;
      const msg = encodeURIComponent(`Mi pedido: ${code}`);
      this.waLink = this.waPhone
        ? `https://wa.me/${this.waPhone}?text=${msg}`
        : `https://wa.me/?text=${msg}`;

    } catch {
      this.error = 'Error al enviar el pedido. Intenta nuevamente.';
      setTimeout(() => this.error = '', 4000);
    } finally {
      this.submitting = false;
    }
  }
}
