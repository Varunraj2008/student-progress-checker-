import { Injectable, inject } from '@angular/core';
import { SupabaseService } from './supabase.service';

@Injectable({ providedIn: 'root' })
export class ProgressService {
  private sb = inject(SupabaseService).supabase;
  readonly maxProofSizeBytes = 25 * 1024 * 1024;
  readonly allowedVideoTypes = ['video/mp4', 'video/webm', 'video/quicktime', 'video/x-msvideo', 'video/ogg'];
  readonly allowedImageTypes = ['image/jpeg', 'image/png', 'image/jpg', 'image/webp', 'image/gif'];
  todayLocal() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  }
  calcLocal(row: any, sleepTarget = 7) {
    let s = 0;
    if (row.breakfast_completed) s += 20;
    if (row.lunch_completed) s += 20;
    if (row.dinner_completed) s += 20;
    if (Number(row.distance_km) >= 5) s += 20;
    if (Number(row.sleep_hours) >= sleepTarget) s += 20;
    return s;
  }
  status(pct: number) {
    if (pct >= 90) return 'Excellent';
    if (pct >= 75) return 'Good';
    if (pct >= 50) return 'Needs Improvement';
    return 'Poor';
  }
  async sleepTarget() { return 7; }
  async getToday(studentId: string) {
    const { data, error } = await this.sb.from('daily_progress').select('*').eq('student_id', studentId).eq('date', this.todayLocal()).maybeSingle();
    if (error) throw error; return data;
  }
  async getHistory(studentId: string, days = 30) {
    const from = new Date(); from.setDate(from.getDate() - (days - 1));
    const { data, error } = await this.sb.from('daily_progress').select('*').eq('student_id', studentId).gte('date', from.toISOString().slice(0,10)).order('date', { ascending: false });
    if (error) throw error; return data || [];
  }
  async saveProgress(payload: Record<string, unknown>) {
    const sid = payload['student_id'] as string, date = payload['date'] as string;
    const { data: existing } = await this.sb.from('daily_progress').select('id').eq('student_id', sid).eq('date', date).maybeSingle();
    if (existing?.id) {
      const { admin_status, ...rest } = payload as any;
      const { error } = await this.sb.from('daily_progress').update(rest).eq('id', existing.id);
      if (error) throw error;
    } else {
      const { error } = await this.sb.from('daily_progress').insert({ ...payload, admin_status: 'pending' });
      if (error) throw error;
    }
  }
  getProofAccept(type: string) {
    return ['breakfast', 'lunch', 'dinner'].includes(type) ? 'video/*' : 'image/*';
  }
  validateProofFile(file: File, type: string) {
    const isMeal = ['breakfast', 'lunch', 'dinner'].includes(type);
    const allowedTypes = isMeal ? this.allowedVideoTypes : this.allowedImageTypes;
    const ext = (file.name.split('.').pop() || '').toLowerCase();
    const allowedExtensions = isMeal ? ['mp4', 'webm', 'mov', 'm4v', 'avi', 'mkv', 'ogg', 'ogv'] : ['jpg', 'jpeg', 'png', 'webp', 'gif'];
    const mimeOk = allowedTypes.includes((file.type || '').toLowerCase()) || allowedExtensions.includes(ext);
    if (!mimeOk) return `${isMeal ? 'Meal' : 'Proof'} must be ${isMeal ? 'a video' : 'an image'} file.`;
    if (file.size > this.maxProofSizeBytes) return `${isMeal ? 'Meal' : 'Proof'} must be 25MB or smaller.`;
    return null;
  }
  isVideoPath(path: string | null) {
    if (!path) return false;
    const ext = (path.split('.').pop() || '').toLowerCase();
    return ['mp4', 'webm', 'mov', 'm4v', 'avi', 'mkv', 'ogg', 'ogv'].includes(ext);
  }
  isImagePath(path: string | null) {
    if (!path) return false;
    const ext = (path.split('.').pop() || '').toLowerCase();
    return ['jpg', 'jpeg', 'png', 'webp', 'gif'].includes(ext);
  }
  async uploadProof(file: File, userId: string, dateStr: string, type: string) {
    const validationError = this.validateProofFile(file, type);
    if (validationError) throw new Error(validationError);
    const path = `${userId}/${dateStr}/${type}.${file.name.split('.').pop()}`;
    const { data, error } = await this.sb.storage.from('proofs').upload(path, file, { upsert: true });
    if (error) throw error; return data.path;
  }
  async signedUrl(path: string) {
    const { data, error } = await this.sb.storage.from('proofs').createSignedUrl(path, 3600);
    if (error) throw error; return data.signedUrl;
  }
  async adminStats() {
    const today = this.todayLocal(), sleep = 7;
    const [{ data: students }, { data: todayRows }] = await Promise.all([
      this.sb.from('profiles').select('auth_id').eq('role', 'student'),
      this.sb.from('daily_progress').select('*').eq('date', today)
    ]);
    const total = students?.length || 0, submitted = todayRows?.length || 0;
    const allGoals = (todayRows || []).filter(r => this.calcLocal(r, sleep) === 100).length;
    return {
      total_students: total,
      submitted_today: submitted,
      not_submitted_today: Math.max(total - submitted, 0),
      all_goals_today: allGoals,
      incomplete_goals_today: Math.max(total - submitted, 0)
    };
  }

  async studentAnalytics() {
    const sleep = 7, today = this.todayLocal();
    const weekFrom = new Date(); weekFrom.setDate(weekFrom.getDate() - 6);
    const monthFrom = new Date(); monthFrom.setDate(monthFrom.getDate() - 29);
    const w0 = weekFrom.toISOString().slice(0,10), m0 = monthFrom.toISOString().slice(0,10);
    const [{ data: students, error: e1 }, { data: rows, error: e2 }] = await Promise.all([
      this.sb.from('profiles').select('auth_id,name,register_number,email').eq('role', 'student'),
      this.sb.from('daily_progress').select('*').gte('date', m0)
    ]);
    if (e1) throw e1; if (e2) throw e2;
    const avg = (arr: any[]) => arr.length ? arr.reduce((a, r) => a + this.calcLocal(r, sleep), 0) / arr.length : 0;
    const rate = (arr: any[], pred: (r: any) => boolean) => arr.length ? (arr.filter(pred).length / arr.length) * 100 : 0;
    return (students || []).map(p => {
      const mine = (rows || []).filter(r => r.student_id === p.auth_id);
      const todayRow = mine.find(r => r.date === today);
      const week = mine.filter(r => r.date >= w0), month = mine;
      return {
        student_id: p.auth_id, student_name: p.name, register_number: p.register_number, email: p.email,
        submitted_today: !!todayRow,
        today_progress: todayRow ? this.calcLocal(todayRow, sleep) : 0, week_progress: avg(week), month_progress: avg(month),
        meal_completion_rate: rate(month, r => r.breakfast_completed && r.lunch_completed && r.dinner_completed),
        distance_target_rate: rate(month, r => Number(r.distance_km) >= 5),
        sleep_target_rate: rate(month, r => Number(r.sleep_hours) >= sleep),
        submission_consistency: (month.length / 30) * 100
      };
    });
  }

  async studentDetail(studentId: string) {
    const sleep = 7, today = this.todayLocal();
    const monthFrom = new Date(); monthFrom.setDate(monthFrom.getDate() - 29);
    const m0 = monthFrom.toISOString().slice(0,10);
    const [{ data: student }, { data: rows, error }] = await Promise.all([
      this.sb.from('profiles').select('auth_id,name,register_number,email').eq('auth_id', studentId).single(),
      this.sb.from('daily_progress').select('*').eq('student_id', studentId).gte('date', m0).order('date', { ascending: false })
    ]);
    if (error) throw error;
    const p = student as any;
    const mine = (rows || []) as any[];
    const todayRow = mine.find(r => r.date === today);
    const weekFrom = new Date(); weekFrom.setDate(weekFrom.getDate() - 6);
    const w0 = weekFrom.toISOString().slice(0,10);
    const week = mine.filter(r => r.date >= w0), month = mine;
    const avg = (arr: any[]) => arr.length ? arr.reduce((a, r) => a + this.calcLocal(r, sleep), 0) / arr.length : 0;
    const rate = (arr: any[], pred: (r: any) => boolean) => arr.length ? (arr.filter(pred).length / arr.length) * 100 : 0;
    const analytics = {
      student_id: p.auth_id, student_name: p.name, register_number: p.register_number, email: p.email,
      submitted_today: !!todayRow,
      today_progress: todayRow ? this.calcLocal(todayRow, sleep) : 0, week_progress: avg(week), month_progress: avg(month),
      meal_completion_rate: rate(month, r => r.breakfast_completed && r.lunch_completed && r.dinner_completed),
      distance_target_rate: rate(month, r => Number(r.distance_km) >= 5),
      sleep_target_rate: rate(month, r => Number(r.sleep_hours) >= sleep),
      submission_consistency: (month.length / 30) * 100
    };
    const days = mine.map(r => ({ ...r, pct: this.calcLocal(r, sleep) }));
    return { analytics, days };
  }

  async setAdminStatus(progressId: string, status: 'approved'|'rejected') {
    const { error } = await this.sb.from('daily_progress').update({ admin_status: status }).eq('id', progressId);
    if (error) throw error;
  }
}
