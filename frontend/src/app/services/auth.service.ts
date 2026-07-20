import { Injectable, signal } from '@angular/core';
import { SupabaseService } from './supabase.service';
import { Router } from '@angular/router';
import { environment } from '../../environments/environment';

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
            const role = this.currentRole();
            const url = this.router.url;
            if (role === 'admin' && url !== '/admin') {
              this.router.navigate(['/admin']);
            } else if (role === 'student' && url !== '/student') {
              this.router.navigate(['/student']);
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
  private resolveRoleFromUser(user: any): 'admin' | 'student' {
    const email = user.email?.toLowerCase?.();
    const hasAdminEmail = email && Array.isArray(environment.adminEmails)
      ? environment.adminEmails.map((e: string) => e.toLowerCase()).includes(email)
      : false;

    const metadataRole = user.user_metadata?.role || user.raw_user_meta_data?.role;
    if (metadataRole === 'admin' || hasAdminEmail) {
      return 'admin';
    }
    return 'student';
  }

  private async syncProfileByEmail(user: any) {
    const email = (user.email || '').trim().toLowerCase();
    if (!email) return null;

    const { data: emailProfile, error: emailError } = await this.supabase.supabase.from('profiles').select('*').ilike('email', email).maybeSingle();
    if (emailError) throw emailError;
    if (!emailProfile) return null;

    const profilePayload = {
      id: user.id,
      email: emailProfile.email,
      name: user.user_metadata?.full_name || user.user_metadata?.name || emailProfile.email,
      role: emailProfile.role,
      password: emailProfile.password
    };

    const { data: syncedProfile, error: syncError } = await this.supabase.supabase.from('profiles')
      .upsert(profilePayload, { onConflict: 'email' }).select().maybeSingle();
    if (syncError) {
      return emailProfile;
    }
    return syncedProfile || emailProfile;
  }

  async loadProfile(user: any) {
    const { data, error } = await this.supabase.supabase.from('profiles').select('*').eq('id', user.id).maybeSingle();
    if (error) throw error;
    if (data) {
      this.currentUser.set(data);
      this.currentRole.set(data.role);
      return;
    }

    const emailProfile = await this.syncProfileByEmail(user);
    if (emailProfile) {
      this.currentUser.set({ ...emailProfile, id: user.id });
      this.currentRole.set(emailProfile.role);
      return;
    }

    const role = this.resolveRoleFromUser(user);
    const profilePayload = {
      id: user.id,
      email: user.email,
      name: user.user_metadata?.full_name || user.user_metadata?.name || user.email,
      role
    };
    const { data: newProfile, error: insertError } = await this.supabase.supabase.from('profiles').upsert(profilePayload, { onConflict: 'id' }).select().maybeSingle();
    if (insertError) {
      this.currentUser.set({ id: user.id, email: user.email, name: user.email, role });
      this.currentRole.set(role);
      return;
    }
    this.currentUser.set(newProfile || { ...profilePayload });
    this.currentRole.set(newProfile?.role || role);
  }

  async signInWithEmailPassword(email: string, password: string) {
    const trimmedEmail = email.trim().toLowerCase();
    const { data, error } = await this.supabase.supabase.auth.signInWithPassword({ email: trimmedEmail, password });
    if (error || !data.user) {
      const { data: profile, error: profileError } = await this.supabase.supabase.from('profiles')
        .select('*').ilike('email', trimmedEmail).eq('password', password).maybeSingle();
      if (profileError) throw profileError;
      if (!profile) throw error || new Error('Invalid credentials');
      this.currentUser.set(profile);
      this.currentRole.set(profile.role);
      this.persistLocalSession(profile, profile.role);
      return { user: profile } as any;
    }
    await this.loadProfile(data.user);
    this.persistLocalSession(this.currentUser(), this.currentRole() || 'student');
    return data;
  }

  async signOut() {
    this.clearLocalSession();
    await this.supabase.supabase.auth.signOut();
  }
}
