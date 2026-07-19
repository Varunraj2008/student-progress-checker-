import { Component, OnInit, inject } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { AuthService } from '../services/auth.service';
import { SupabaseService } from '../services/supabase.service';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-admin-login', standalone: true,
  imports: [ReactiveFormsModule, CommonModule, RouterLink],
  templateUrl: './admin-login.component.html', styleUrls: ['../login/login.component.css']
})
export class AdminLoginComponent implements OnInit {
  private fb = inject(FormBuilder); private auth = inject(AuthService);
  private supabase = inject(SupabaseService); private router = inject(Router);
  loginForm = this.fb.group({ email: ['', [Validators.required, Validators.email]], password: ['', [Validators.required, Validators.minLength(6)]] });
  loading = false; errorMessage = '';

  async ngOnInit() {
    // After Google redirect: enforce admin-only
    const { data: { session } } = await this.supabase.supabase.auth.getSession();
    if (session?.user) {
      await this.auth.loadProfile(session.user);
      if (this.auth.currentRole() === 'admin') this.router.navigate(['/admin']);
      else if (sessionStorage.getItem('loginPortal') === 'admin') {
        await this.auth.signOut();
        this.errorMessage = 'Not an admin account. Ask staff to set wants_admin_access / role.';
        sessionStorage.removeItem('loginPortal');
      }
    }
  }

  async signInWithGoogle() {
    try {
      sessionStorage.setItem('loginPortal', 'admin');
      const { error } = await this.supabase.supabase.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo: `${window.location.origin}/admin-login` }
      });
      if (error) throw error;
    } catch (e: any) { this.errorMessage = e.message; }
  }

  async onSubmit() {
    if (this.loginForm.invalid) return;
    this.loading = true; this.errorMessage = '';
    const { email, password } = this.loginForm.value;
    try {
      const { data, error } = await this.supabase.supabase.auth.signInWithPassword({ email: email as string, password: password as string });
      if (error) throw error;
      if (!data.user) return;
      await this.auth.loadProfile(data.user);
      if (this.auth.currentRole() !== 'admin') { await this.auth.signOut(); this.errorMessage = 'Not an admin account.'; return; }
      this.router.navigate(['/admin']);
    } catch (e: any) { this.errorMessage = e.message; }
    finally { this.loading = false; }
  }
}
