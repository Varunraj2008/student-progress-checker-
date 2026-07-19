import { Component, inject } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { AuthService } from '../services/auth.service';
import { SupabaseService } from '../services/supabase.service';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-login', standalone: true,
  imports: [ReactiveFormsModule, CommonModule, RouterLink],
  templateUrl: './login.component.html', styleUrls: ['./login.component.css']
})
export class LoginComponent {
  private fb = inject(FormBuilder);
  private authService = inject(AuthService);
  private supabase = inject(SupabaseService);
  private router = inject(Router);

  isAdminView = false;

  cards = [
    { title: 'Fuel with meals', body: 'Log breakfast, lunch, and dinner. Each completed meal adds 20% to your daily score.', tag: 'NUTRITION' },
    { title: 'Move 5 km daily', body: 'Walk or jog at least 5 km and upload a fitness-app screenshot as proof.', tag: 'CARDIO' },
    { title: 'Protect your sleep', body: 'Hit your sleep target (7h+) for recovery, focus, and better mood.', tag: 'RECOVERY' },
    { title: 'Stay accountable', body: 'Admins verify proofs so progress stays honest across the campus.', tag: 'TRUST' },
  ];

  stats = [
    { value: '5', label: 'Daily Goals' },
    { value: '20%', label: 'Per Goal' },
    { value: '7h+', label: 'Sleep Target' },
    { value: '5km', label: 'Walk Goal' },
  ];

  loginForm = this.fb.group({
    email: ['', [Validators.required, Validators.email]],
    password: ['', [Validators.required, Validators.minLength(6)]],
  });
  loading = false;
  errorMessage = '';

  async signInWithGoogle() {
    try {
      const { error } = await this.supabase.supabase.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo: `${window.location.origin}/login` }
      });
      if (error) throw error;
    } catch (e: any) { this.errorMessage = e.message; }
  }

  async onSubmit() {
    if (this.loginForm.invalid) return;
    this.loading = true; this.errorMessage = '';
    const { email, password } = this.loginForm.value;
    try {
      const { data, error } = await this.supabase.supabase.auth.signInWithPassword({
        email: email as string, password: password as string
      });
      if (error) throw error;
      if (!data.user) return;
      await this.authService.loadProfile(data.user);
      const role = this.authService.currentRole();
      if (this.isAdminView && role !== 'admin') {
        await this.authService.signOut();
        this.errorMessage = 'Not an admin account.';
        return;
      }
      if (!this.isAdminView && role === 'admin') {
        await this.authService.signOut();
        this.errorMessage = 'Admin accounts must use Admin Login.';
        return;
      }
      this.router.navigate(this.isAdminView ? ['/admin'] : ['/student']);
    } catch (e: any) { this.errorMessage = e.message; }
    finally { this.loading = false; }
  }

  toggleAdminView() { this.isAdminView = !this.isAdminView; this.loginForm.reset(); this.errorMessage = ''; }
}
