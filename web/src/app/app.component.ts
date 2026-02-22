import { Component, OnInit, OnDestroy, AfterViewInit, HostListener } from '@angular/core';
import { Router, NavigationEnd } from '@angular/router';
import { filter } from 'rxjs/operators';

@Component({
  selector: 'app-root',
  templateUrl: './app.component.html',
  styleUrls: ['./app.component.css']
})
export class AppComponent implements OnInit, OnDestroy, AfterViewInit {
  title = '7kivo';
  activeSection: string = 'inicio';
  isAdminRoute = false;
  private scrollTimeout: any;

  constructor(private router: Router) {
    this.router.events.pipe(
      filter(event => event instanceof NavigationEnd)
    ).subscribe((event: any) => {
      this.isAdminRoute = event.url.startsWith('/admin');
    });
  }

  ngOnInit(): void {
    this.updateActiveSection();
  }

  ngOnDestroy(): void {
    if (this.scrollTimeout) {
      clearTimeout(this.scrollTimeout);
    }
  }

  @HostListener('window:scroll')
  onScroll(): void {
    // Debounce para mejorar el rendimiento
    if (this.scrollTimeout) {
      clearTimeout(this.scrollTimeout);
    }
    this.scrollTimeout = setTimeout(() => {
      this.updateActiveSection();
    }, 100);
  }

  ngAfterViewInit(): void {
    // Escuchar scroll en el elemento main también
    const mainElement = document.querySelector('main');
    if (mainElement) {
      mainElement.addEventListener('scroll', () => {
        if (this.scrollTimeout) {
          clearTimeout(this.scrollTimeout);
        }
        this.scrollTimeout = setTimeout(() => {
          this.updateActiveSection();
        }, 100);
      });
    }
  }

  updateActiveSection(): void {
    const sections = ['inicio', 'nosotros', 'servicios', 'contacto'];
    
    // Obtener altura real del navbar
    const navbar = document.querySelector('.navbar');
    const navbarHeight = navbar ? navbar.getBoundingClientRect().height : 76;
    const offset = navbarHeight + 50; // Offset para considerar el navbar y dar margen

    // Obtener posición de scroll
    const mainElement = document.querySelector('main');
    const scrollY = mainElement ? mainElement.scrollTop : window.scrollY;

    // Si estamos en la parte superior, siempre mostrar inicio
    if (scrollY < 200) {
      this.activeSection = 'inicio';
      return;
    }

    let currentSection = 'inicio';
    let minDistance = Infinity;

    // Encontrar la sección más cercana al viewport
    sections.forEach(sectionId => {
      const element = document.getElementById(sectionId);
      if (element) {
        const rect = element.getBoundingClientRect();
        const elementTop = rect.top;
        const elementBottom = rect.bottom;
        
        // Calcular la distancia desde el offset hasta el inicio de la sección
        const distance = Math.abs(elementTop - offset);
        
        // Si la sección está visible en el viewport (con más margen)
        // Una sección está activa si su parte superior está cerca del offset
        if (elementTop <= offset + 150 && elementTop >= offset - 200) {
          if (distance < minDistance) {
            minDistance = distance;
            currentSection = sectionId;
          }
        }
      }
    });

    this.activeSection = currentSection;
  }

  scrollToSection(sectionId: string, event: Event): void {
    event.preventDefault();
    event.stopPropagation();
    
    const element = document.getElementById(sectionId);
    if (element) {
      // Obtener altura real del navbar
      const navbar = document.querySelector('.navbar');
      const navbarHeight = navbar ? navbar.getBoundingClientRect().height : 76;
      const offset = navbarHeight + 30; // Altura del navbar + margen adicional más grande
      
      // Para todas las secciones, buscar el título dentro de la sección
      let targetElement = element;
      const title = element.querySelector('h1, h2, h3');
      if (title) {
        targetElement = title as HTMLElement;
      }
      
      // Obtener el elemento main o window según corresponda
      const mainElement = document.querySelector('main');
      const scrollContainer = mainElement || window;
      
      // Calcular posición
      const elementPosition = targetElement.getBoundingClientRect().top;
      let offsetPosition: number;
      
      if (mainElement) {
        // Si hay un elemento main con scroll
        const mainScrollTop = mainElement.scrollTop;
        offsetPosition = elementPosition + mainScrollTop - offset;
      } else {
        // Scroll en window
        offsetPosition = elementPosition + window.pageYOffset - offset;
      }

      // Actualizar sección activa inmediatamente
      this.activeSection = sectionId;

      // Scroll rápido con animación personalizada
      this.smoothScrollTo(scrollContainer, Math.max(0, offsetPosition), 300);

      // Asegurar que se actualice después del scroll
      setTimeout(() => {
        this.updateActiveSection();
      }, 350);
    } else {
      console.warn(`Elemento con id "${sectionId}" no encontrado`);
    }
  }

  private smoothScrollTo(container: Element | Window, targetPosition: number, duration: number): void {
    const isWindow = container === window;
    const startPosition = isWindow 
      ? window.pageYOffset 
      : (container as Element).scrollTop;
    const distance = targetPosition - startPosition;
    let startTime: number | null = null;

    const easeInOutCubic = (t: number): number => {
      return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
    };

    const animation = (currentTime: number) => {
      if (startTime === null) startTime = currentTime;
      const timeElapsed = currentTime - startTime;
      const progress = Math.min(timeElapsed / duration, 1);
      const ease = easeInOutCubic(progress);

      const currentPosition = startPosition + distance * ease;

      if (isWindow) {
        window.scrollTo(0, currentPosition);
      } else {
        (container as Element).scrollTo(0, currentPosition);
      }

      if (timeElapsed < duration) {
        requestAnimationFrame(animation);
      } else {
        // Asegurar posición final exacta
        if (isWindow) {
          window.scrollTo(0, targetPosition);
        } else {
          (container as Element).scrollTo(0, targetPosition);
        }
      }
    };

    requestAnimationFrame(animation);
  }

  isActive(sectionId: string): boolean {
    return this.activeSection === sectionId;
  }
}

