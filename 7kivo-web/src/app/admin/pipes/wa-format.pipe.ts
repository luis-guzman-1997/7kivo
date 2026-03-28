import { Pipe, PipeTransform } from '@angular/core';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';

@Pipe({ name: 'waFormat' })
export class WaFormatPipe implements PipeTransform {
  constructor(private sanitizer: DomSanitizer) {}

  transform(value: string | null | undefined): SafeHtml {
    if (!value) return '';

    // 1. Escapar HTML para evitar XSS
    let text = value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');

    // 2. Formato WhatsApp
    text = text
      .replace(/\*(.*?)\*/g, '<strong>$1</strong>')   // *negrita*
      .replace(/_(.*?)_/g, '<em>$1</em>')              // _cursiva_
      .replace(/~(.*?)~/g, '<del>$1</del>')            // ~tachado~
      .replace(/```([\s\S]*?)```/g, '<code>$1</code>') // ```código```
      .replace(/\n/g, '<br>');                         // saltos de línea

    return this.sanitizer.bypassSecurityTrustHtml(text);
  }
}
