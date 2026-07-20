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

  private setLoginError(message: string) {
    sessionStorage.setItem('wellness-login-error', message);
  }

  getLoginError(): string | null {
    const error = sessionStorage.getItem('wellness-login-error');
    if (error) sessionStorage.removeItem('wellness-login-error');
    return error;
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
              this.setLoginError('Invalid credentials for this portal.');
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

  async loadProfile(user: any) {
    const email = (user.email || '').trim().toLowerCase();
    const { data: authProfile, error: authError } = await this.supabase.supabase.from('profiles').select('*').eq('auth_id', user.id).maybeSingle();
    if (authError) throw authError;
    if (authProfile) {
      const profile = { ...authProfile, id: authProfile.auth_id };
      this.currentUser.set(profile);
      this.currentRole.set(authProfile.role);
      return;
    }

    const { data: emailProfile, error: emailError } = await this.supabase.supabase.from('profiles').select('*').ilike('email', email).maybeSingle();
    if (emailError) throw emailError;
    if (emailProfile) {
      const { data: updated, error: updateError } = await this.supabase.supabase.from('profiles')
        .update({ auth_id: user.id })
        .ilike('email', email)
        .select()
        .maybeSingle();
      if (updateError) throw updateError;
      const profile = { ...(updated || emailProfile), id: user.id, auth_id: user.id };
      this.currentUser.set(profile);
      this.currentRole.set(profile.role);
      return;
    }

    const role = this.resolveRoleFromUser(user);
    const profilePayload = {
      auth_id: user.id,
      email,
      name: user.user_metadata?.full_name || user.user_metadata?.name || email,
      role
    };
    const { data: newProfile, error: insertError } = await this.supabase.supabase.from('profiles').insert(profilePayload).select().maybeSingle();
    if (insertError) {
      this.currentUser.set({ auth_id: user.id, email, name: email, role, id: user.id });
      this.currentRole.set(role);
      return;
    }
    this.currentUser.set({ ...(newProfile || profilePayload), id: newProfile?.auth_id || user.id, auth_id: newProfile?.auth_id || user.id });
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
      const userWithId = { ...profile, id: profile.auth_id };
      this.currentUser.set(userWithId);
      this.currentRole.set(profile.role);
      this.persistLocalSession(userWithId, profile.role);
      return { user: userWithId } as any;
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
