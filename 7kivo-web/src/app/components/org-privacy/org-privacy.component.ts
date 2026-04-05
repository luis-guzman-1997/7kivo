import { Component, OnInit } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { FirebaseService } from '../../services/firebase.service';
import { marked } from 'marked';

marked.use({
  breaks: true,
  gfm: true
});

@Component({
  selector: 'app-org-privacy',
  templateUrl: './org-privacy.component.html',
  styleUrls: ['./org-privacy.component.css']
})
export class OrgPrivacyComponent implements OnInit {
  loading = true;
  orgName = '';
  orgLogo = '';
  policyHtml: SafeHtml = '';
  notFound = false;
  readonly currentYear = new Date().getFullYear();

  constructor(
    private route: ActivatedRoute,
    private firebaseService: FirebaseService,
    private sanitizer: DomSanitizer
  ) {}

  async ngOnInit(): Promise<void> {
    const orgId = this.route.snapshot.paramMap.get('orgId') || '';
    try {
      const info = await this.firebaseService.getPublicOrgInfo(orgId);
      if (info?.privacyPolicy) {
        this.orgName = info.orgName || orgId;
        this.orgLogo = info.orgLogo || '';
        let html: string;
        try {
          html = await marked.parse(info.privacyPolicy) as string;
        } catch {
          html = `<pre style="white-space:pre-wrap">${info.privacyPolicy}</pre>`;
        }
        this.policyHtml = this.sanitizer.bypassSecurityTrustHtml(html);
      } else {
        this.notFound = true;
      }
    } catch (err) {
      console.error('Error loading privacy policy:', err);
      this.notFound = true;
    }
    this.loading = false;
  }
}
