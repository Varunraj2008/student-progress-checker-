import { Injectable, signal } from '@angular/core';
import { SupabaseService } from './supabase.service';
import { Router } from '@angular/router';

@Injectable({ providedIn: 'root' })
export class AuthService {
  public currentUser = signal<any>(null);
  public currentRole = signal<string | null>(null);
  public loading = signal<boolean>(true);
  private readonly localSessionKey = 'wellness-local-session';
  private readonly localAdminEmail = 'honestmanikandan2025@gmail.com';
  private readonly localAdminPassword = '123456';

  constructor(private supabase: SupabaseService, private router: Router) { this.initializeAuth(); }

  private persistLocalSession(user: any, role: string) {
    const payload = { user, role };
    localStorage.setItem(this.localSessionKey, JSON.stringify(payload));
    this.currentUser.set(user);
    this.currentRole.set(role);
  }

  private clearLocalSession() {
    localStorage.removeItem(this.localSessionKey);
    this.currentUser.set(null);
    this.currentRole.set(null);
  }

  async initializeAuth() {
    const saved = localStorage.getItem(this.localSessionKey);
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        this.currentUser.set(parsed.user);
        this.currentRole.set(parsed.role);
      } catch {
        this.clearLocalSession();
      }
    }

    this.supabase.supabase.auth.onAuthStateChange(async (event, session) => {
      if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED' || event === 'INITIAL_SESSION') {
        if (session) {
          await this.loadProfile(session.user);
          this.loading.set(false);
          const role = this.currentRole(), url = this.router.url;
          if (url === '/' || url === '/login' || url === '/admin-login') {
            if (role === 'admin' && url !== '/login') this.router.navigate(['/admin']);
            else if (role === 'student' && url !== '/admin-login') this.router.navigate(['/student']);
          }
        } else this.loading.set(false);
      } else if (event === 'SIGNED_OUT') {
        this.clearLocalSession(); this.loading.set(false);
      }
    });

    this.loading.set(false);
  }
  async loadProfile(user: any) {
    const { data, error } = await this.supabase.supabase.from('profiles').select('*').eq('id', user.id).single();
    if (error) {
      const { data: newProfile, error: insertError } = await this.supabase.supabase.from('profiles').upsert({
        id: user.id, email: user.email, name: user.user_metadata?.full_name || user.user_metadata?.name || user.email, role: 'student'
      }, { onConflict: 'id' }).select().single();
      if (insertError) {
        this.currentUser.set({ id: user.id, email: user.email, name: user.email, role: 'student' });
        this.currentRole.set('student'); return;
      }
      this.currentUser.set(newProfile); this.currentRole.set(newProfile?.role || 'student'); return;
    }
    this.currentUser.set(data); this.currentRole.set(data.role);
  }

  async signInWithEmailPassword(email: string, password: string) {
    if (email === this.localAdminEmail && password === this.localAdminPassword) {
      const user = { id: 'local-admin', email, name: 'Honest Manikandan', role: 'admin' };
      this.persistLocalSession(user, 'admin');
      return { user };
    }
    const { data, error } = await this.supabase.supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
    if (data.user) {
      await this.loadProfile(data.user);
      this.persistLocalSession(this.currentUser(), this.currentRole() || 'student');
    }
    return data;
  }

  async signOut() {
    this.clearLocalSession();
    await this.supabase.supabase.auth.signOut();
  }
}
