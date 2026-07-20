import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { AuthService } from '../services/auth.service';
import { ProgressService } from '../services/progress.service';

@Component({
  selector: 'app-admin-student', standalone: true, imports: [CommonModule, FormsModule, RouterLink],
  templateUrl: './admin-student.component.html', styleUrl: './admin-student.component.css'
})
export class AdminStudentComponent implements OnInit {
  route = inject(ActivatedRoute); router = inject(Router); auth = inject(AuthService); progress = inject(ProgressService);
  id = ''; analytics: any = null; days: any[] = []; range: 'today'|'week'|'month'|'all' = 'all';
  selected: any = null; sleepTarget = 7; loading = true; error = ''; updating = false; showReviewed = false;
  proofUrls: Record<string, string|null> = { breakfast:null, lunch:null, dinner:null, walking:null, sleep:null };
  get availableDays() {
    return this.showReviewed ? this.days : this.days.filter(d => d.admin_status === 'pending');
  }
  async ngOnInit() {
    this.id = this.route.snapshot.paramMap.get('id') || '';
    try {
      const { analytics, days } = await this.progress.studentDetail(this.id);
      this.analytics = analytics;
      this.days = days || [];
      this.selected = this.availableDays[0] || this.days[0] || null;
      await this.loadProofPreviews();
    } catch (e: any) { this.error = e.message; }
    finally { this.loading = false; }
  }
  get overall() {
    if (!this.analytics) return 0;
    if (this.range === 'today') return Number(this.analytics.today_progress)||0;
    if (this.range === 'week') return Number(this.analytics.week_progress)||0;
    if (this.range === 'month') return Number(this.analytics.month_progress)||0;
    return this.days.length ? this.days.reduce((a, d) => a + d.pct, 0) / this.days.length : 0;
  }
  get chartDays() {
    const source = this.showReviewed ? this.days : this.availableDays;
    if (this.range === 'all') return [...source].reverse();
    const today = this.progress.todayLocal();
    if (this.range === 'today') return source.filter(d => d.date === today).reverse();
    const from = new Date();
    from.setDate(from.getDate() - (this.range === 'week' ? 6 : 29));
    const fromStr = from.toISOString().slice(0, 10);
    return source.filter(d => d.date >= fromStr).reverse();
  }
  async onSelectionChange() { await this.loadProofPreviews(); }
  async loadProofPreviews() {
    if (!this.selected) return;
    for (const key of ['breakfast', 'lunch', 'dinner', 'walking', 'sleep'] as const) {
      const path = this.selected?.[`${key}_proof_path`] || null;
      if (!path) { this.proofUrls[key] = null; continue; }
      try { this.proofUrls[key] = await this.progress.signedUrl(path); } catch { this.proofUrls[key] = null; }
    }
  }
  isVideoProof(path: string | null) { return this.progress.isVideoPath(path); }
  isImageProof(path: string | null) { return this.progress.isImagePath(path); }
  async viewProof(path: string|null) {
    if (!path) return;
    try { window.open(await this.progress.signedUrl(path), '_blank'); } catch (e: any) { this.error = e.message; }
  }
  async setStatus(status: 'approved'|'rejected') {
    if (!this.selected || this.selected.admin_status === 'approved') return;
    this.updating = true;
    try {
      await this.progress.setAdminStatus(this.selected.id, status);
      this.selected.admin_status = status;
      const i = this.days.findIndex(d => d.id === this.selected.id); if (i >= 0) this.days[i].admin_status = status;
    } catch (e: any) { this.error = e.message; }
    finally { this.updating = false; }
  }
  async logout() { await this.auth.signOut(); this.router.navigate(['/login']); }
}
