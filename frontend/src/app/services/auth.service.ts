import { Injectable, signal } from '@angular/core';
import { SupabaseService } from './supabase.service';
import { Router } from '@angular/router';

@Injectable({ providedIn: 'root' })
export class AuthService {
  public currentUser = signal<any>(null);
  public currentRole = signal<string | null>(null);
  public loading = signal<boolean>(true);
  public readonly loginPortalKey = 'wellness-login-portal';
  private readonly localSessionKey = 'wellness-local-session';

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

  private getLoginPortal(): 'student' | 'admin' | null {
    const portal = sessionStorage.getItem(this.loginPortalKey);
    return portal === 'student' || portal === 'admin' ? portal : null;
  }

  private clearLoginPortal() {
    sessionStorage.removeItem(this.loginPortalKey);
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
          const portal = this.getLoginPortal();
          if (portal) {
            this.clearLoginPortal();
            if (portal === 'admin' && this.currentRole() === 'admin') {
              this.router.navigate(['/admin']);
            } else if (portal === 'student' && this.currentRole() === 'student') {
              this.router.navigate(['/student']);
            } else {
              await this.signOut();
              this.router.navigate([portal === 'admin' ? '/admin-login' : '/login']);
            }
          } else {
            const role = this.currentRole(), url = this.router.url;
            if (url === '/' || url === '/login' || url === '/admin-login') {
              if (role === 'admin' && url !== '/login') this.router.navigate(['/admin']);
              else if (role === 'student' && url !== '/admin-login') this.router.navigate(['/student']);
            }
          }
          this.loading.set(false);
        } else this.loading.set(false);
      } else if (event === 'SIGNED_OUT') {
        this.clearLocalSession(); this.loading.set(false);
      }
    });

    this.loading.set(false);
  }
  async loadProfile(user: any) {
    const { data, error } = await this.supabase.supabase.from('profiles').select('*').eq('id', user.id).maybeSingle();
    if (error) throw error;
    if (data) {
      this.currentUser.set(data);
      this.currentRole.set(data.role);
      return;
    }
    const profilePayload = {
      id: user.id,
      email: user.email,
      name: user.user_metadata?.full_name || user.user_metadata?.name || user.email,
      role: 'student'
    };
    const { data: newProfile, error: insertError } = await this.supabase.supabase.from('profiles').upsert(profilePayload, { onConflict: 'id' }).select().maybeSingle();
    if (insertError) {
      this.currentUser.set({ id: user.id, email: user.email, name: user.email, role: 'student' });
      this.currentRole.set('student');
      return;
    }
    this.currentUser.set(newProfile || { ...profilePayload });
    this.currentRole.set(newProfile?.role || 'student');
  }

  async signInWithEmailPassword(email: string, password: string) {
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
