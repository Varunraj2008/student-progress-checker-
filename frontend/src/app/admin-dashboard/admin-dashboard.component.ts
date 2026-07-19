import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { AuthService } from '../services/auth.service';
import { ProgressService } from '../services/progress.service';

@Component({
  selector: 'app-admin-dashboard', standalone: true, imports: [CommonModule, FormsModule],
  templateUrl: './admin-dashboard.component.html', styleUrl: './admin-dashboard.component.css'
})
export class AdminDashboardComponent implements OnInit {
  auth = inject(AuthService); progress = inject(ProgressService); router = inject(Router);
  stats: Record<string, number> = {}; students: any[] = []; filtered: any[] = [];
  search = ''; range: 'today'|'week'|'month' = 'today'; sortDir: 'asc'|'desc' = 'desc';
  todayFilter: 'all'|'completed'|'pending' = 'all';
  loading = true; error = '';
  async ngOnInit() {
    try {
      const [stats, list] = await Promise.all([this.progress.adminStats(), this.progress.studentAnalytics()]);
      this.stats = stats || {}; this.students = list; this.apply();
    } catch (e: any) { this.error = e.message || 'Failed to load'; }
    finally { this.loading = false; }
  }
  pct(s: any) { return this.range === 'week' ? Number(s.week_progress)||0 : this.range === 'month' ? Number(s.month_progress)||0 : Number(s.today_progress)||0; }
  setTodayFilter(f: 'all'|'completed'|'pending') { this.todayFilter = f; this.apply(); }
  apply() {
    const q = this.search.trim().toLowerCase();
    let rows = this.students.filter(s => !q || (s.student_name||'').toLowerCase().includes(q) || (s.register_number||'').toLowerCase().includes(q));
    if (this.todayFilter === 'completed') rows = rows.filter(s => s.submitted_today);
    if (this.todayFilter === 'pending') rows = rows.filter(s => !s.submitted_today);
    rows = [...rows].sort((a,b) => this.sortDir === 'asc' ? this.pct(a)-this.pct(b) : this.pct(b)-this.pct(a));
    this.filtered = rows;
  }
  open(s: any) { this.router.navigate(['/admin/student', s.student_id]); }
  async logout() { await this.auth.signOut(); this.router.navigate(['/login']); }
}
