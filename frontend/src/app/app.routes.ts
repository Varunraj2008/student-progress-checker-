import { Routes } from '@angular/router';
import { LoginComponent } from './login/login.component';
import { AdminLoginComponent } from './admin-login/admin-login.component';
import { inject } from '@angular/core';
import { AuthService } from './services/auth.service';
import { Router } from '@angular/router';
import { SupabaseService } from './services/supabase.service';

async function waitForAuth(): Promise<AuthService> {
  const authService = inject(AuthService);
  const supabase = inject(SupabaseService);
  if (!authService.currentRole()) {
    const { data: { session } } = await supabase.supabase.auth.getSession();
    if (session) await authService.loadProfile(session.user);
  }
  return authService;
}
const studentGuard = async () => {
  const router = inject(Router), auth = await waitForAuth();
  return auth.currentRole() === 'student' ? true : router.createUrlTree(['/login']);
};
const adminGuard = async () => {
  const router = inject(Router), auth = await waitForAuth();
  return auth.currentRole() === 'admin' ? true : router.createUrlTree(['/admin-login']);
};
export const routes: Routes = [
  { path: 'login', component: LoginComponent },
  { path: 'admin-login', component: AdminLoginComponent },
  { path: 'student', canActivate: [studentGuard], loadComponent: () => import('./student-dashboard/student-dashboard.component').then(m => m.StudentDashboardComponent) },
  { path: 'admin', canActivate: [adminGuard], loadComponent: () => import('./admin-dashboard/admin-dashboard.component').then(m => m.AdminDashboardComponent) },
  { path: 'admin/student/:id', canActivate: [adminGuard], loadComponent: () => import('./admin-student/admin-student.component').then(m => m.AdminStudentComponent) },
  { path: '', redirectTo: '/login', pathMatch: 'full' },
  { path: '**', redirectTo: '/login' }
];
