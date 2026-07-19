import { Component, OnInit, inject } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { CommonModule } from '@angular/common';
import { AuthService } from '../services/auth.service';
import { ProgressService } from '../services/progress.service';
import { SupabaseService } from '../services/supabase.service';

@Component({
  selector: 'app-student-dashboard', standalone: true,
  imports: [ReactiveFormsModule, CommonModule],
  templateUrl: './student-dashboard.component.html', styleUrls: ['./student-dashboard.component.css']
})
export class StudentDashboardComponent implements OnInit {
  auth = inject(AuthService); progress = inject(ProgressService); fb = inject(FormBuilder);
  router = inject(Router); supabase = inject(SupabaseService);
  tab: 'checkin'|'history' = 'checkin';
  form = this.fb.group({ breakfast:[false], lunch:[false], dinner:[false], distance:[0,[Validators.required,Validators.min(0)]], sleep:[0,[Validators.required,Validators.min(0),Validators.max(24)]] });
  proofs: Record<string, File|null> = { breakfast:null, lunch:null, dinner:null, walking:null, sleep:null };
  existing: Record<string, string|null> = {}; history: any[] = []; sleepTarget = 7;
  submitting = false; loading = true; success = ''; error = '';
  get todayPct() { const t = this.history.find(h => h.date === this.progress.todayLocal()); return t ? t.pct : 0; }
  get todayStatus() { return this.progress.status(this.todayPct); }
  async ngOnInit() {
    const uid = this.auth.currentUser()?.id; if (!uid) return;
    const today = await this.progress.getToday(uid).catch(() => null);
    if (today) {
      this.form.patchValue({ breakfast: today.breakfast_completed, lunch: today.lunch_completed, dinner: today.dinner_completed, distance: Number(today.distance_km)||0, sleep: Number(today.sleep_hours)||0 });
      this.existing = { breakfast: today.breakfast_proof_path, lunch: today.lunch_proof_path, dinner: today.dinner_proof_path, walking: today.walking_proof_path, sleep: today.sleep_proof_path };
    }
    await this.loadHistory(); this.loading = false;
  }
  async loadHistory() {
    const uid = this.auth.currentUser()?.id; if (!uid) return;
    this.history = (await this.progress.getHistory(uid)).map(r => ({ ...r, pct: this.progress.calcLocal(r, this.sleepTarget), statusLabel: this.progress.status(this.progress.calcLocal(r, this.sleepTarget)) }));
  }
  onFile(e: Event, key: string) { this.proofs[key] = (e.target as HTMLInputElement).files?.[0] || null; }
  validateProofs(): string|null {
    const v = this.form.value;
    if (v.breakfast && !this.proofs['breakfast'] && !this.existing['breakfast']) return 'Breakfast proof required';
    if (v.lunch && !this.proofs['lunch'] && !this.existing['lunch']) return 'Lunch proof required';
    if (v.dinner && !this.proofs['dinner'] && !this.existing['dinner']) return 'Dinner proof required';
    if ((v.distance??0)>0 && !this.proofs['walking'] && !this.existing['walking']) return 'Walking proof required';
    if ((v.sleep??0)>0 && !this.proofs['sleep'] && !this.existing['sleep']) return 'Sleep proof required';
    return null;
  }
  async submit() {
    this.error=''; this.success='';
    if (this.form.invalid) { this.error='Fix form errors'; return; }
    const proofErr = this.validateProofs(); if (proofErr) { this.error=proofErr; return; }
    const uid = this.auth.currentUser()?.id; if (!uid) return;
    this.submitting = true; const date = this.progress.todayLocal(); const v = this.form.value;
    try {
      const up = async (key: string, needed: boolean) => needed && this.proofs[key] ? await this.progress.uploadProof(this.proofs[key]!, uid, date, key) : this.existing[key] ?? null;
      const payload = {
        student_id: uid, date,
        breakfast_completed: !!v.breakfast, breakfast_proof_path: await up('breakfast', !!v.breakfast),
        lunch_completed: !!v.lunch, lunch_proof_path: await up('lunch', !!v.lunch),
        dinner_completed: !!v.dinner, dinner_proof_path: await up('dinner', !!v.dinner),
        distance_km: Number(v.distance)||0, walking_proof_path: await up('walking', (v.distance??0)>0),
        sleep_hours: Number(v.sleep)||0, sleep_proof_path: await up('sleep', (v.sleep??0)>0),
      };
      await this.progress.saveProgress(payload);
      this.existing = { breakfast: payload.breakfast_proof_path, lunch: payload.lunch_proof_path, dinner: payload.dinner_proof_path, walking: payload.walking_proof_path, sleep: payload.sleep_proof_path };
      this.success = 'Progress saved'; await this.loadHistory(); this.tab = 'history';
    } catch (e: any) { this.error = e.message || 'Submit failed'; }
    finally { this.submitting = false; }
  }
  async logout() { await this.auth.signOut(); this.router.navigate(['/login']); }

  adminRequested = false;
  async requestAdmin() {
    const uid = this.auth.currentUser()?.id;
    if (!uid) return;
    const { error } = await this.supabase.supabase.from('profiles').update({ wants_admin_access: true }).eq('id', uid);
    if (error) { this.error = error.message; return; }
    this.adminRequested = true;
    this.success = 'Admin access requested. Staff must approve in SQL / dashboard.';
  }
}
