-- SAFE MIGRATION: Uses IF NOT EXISTS to skip already-created objects

-- 1. PROFILES TABLE (may already exist from fallback)
create table if not exists public.profiles (
  email text primary key,
  auth_id uuid unique,
  name text not null,
  register_number text unique,
  password text,
  role text not null check (role in ('student', 'admin')) default 'student',
  wants_admin_access boolean not null default false,
  created_at timestamptz default timezone('UTC', now())
);

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'profiles' AND indexname = 'profiles_email_lower_idx'
  ) THEN
    CREATE UNIQUE INDEX profiles_email_lower_idx ON public.profiles (lower(email));
  END IF;
END $$;

-- RLS for profiles
alter table public.profiles enable row level security;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Admins can read all profiles' AND tablename = 'profiles') THEN
    create policy "Admins can read all profiles" on public.profiles
      for select using (
        (select role from public.profiles where auth_id = auth.uid()) = 'admin'
      );
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Users can read own profile' AND tablename = 'profiles') THEN
    create policy "Users can read own profile" on public.profiles
      for select using (auth.uid() = auth_id);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Users can update own profile (except role)' AND tablename = 'profiles') THEN
    create policy "Users can update own profile (except role)" on public.profiles
      for update using (auth.uid() = auth_id)
      with check (
        auth.uid() = auth_id 
        and role = (select role from public.profiles where auth_id = auth.uid())
      );
  END IF;
END $$;

-- Function to handle new user signup
create or replace function public.handle_new_user() 
returns trigger as $$
begin
  update public.profiles
  set auth_id = new.id,
      name = coalesce(new.raw_user_meta_data->>'name', coalesce(new.raw_user_meta_data->>'full_name', name)),
      register_number = coalesce(new.raw_user_meta_data->>'register_number', register_number),
      role = coalesce(role, coalesce(new.raw_user_meta_data->>'role', 'student'))
  where lower(email) = lower(new.email);

  if found then
    return new;
  end if;

  insert into public.profiles (email, auth_id, name, register_number, role)
  values (
    lower(new.email),
    new.id,
    coalesce(new.raw_user_meta_data->>'name', coalesce(new.raw_user_meta_data->>'full_name', 'Student')),
    new.raw_user_meta_data->>'register_number',
    coalesce(new.raw_user_meta_data->>'role', 'student')
  );
  return new;
end;
$$ language plpgsql security definer;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();


-- 2. DAILY PROGRESS TABLE
create table if not exists public.daily_progress (
  id uuid primary key default gen_random_uuid(),
  student_id uuid references public.profiles(auth_id) on delete cascade not null,
  date date not null,
  breakfast_completed boolean default false,
  breakfast_proof_path text,
  lunch_completed boolean default false,
  lunch_proof_path text,
  dinner_completed boolean default false,
  dinner_proof_path text,
  distance_km numeric default 0 check (distance_km >= 0),
  walking_proof_path text,
  sleep_hours numeric default 0 check (sleep_hours >= 0 and sleep_hours <= 24),
  sleep_proof_path text,
  admin_status text not null check (admin_status in ('pending', 'approved', 'rejected')) default 'pending',
  created_at timestamptz default timezone('UTC', now()),
  updated_at timestamptz default timezone('UTC', now()),
  unique(student_id, date)
);

-- Auto-update updated_at
create or replace function public.handle_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

DROP TRIGGER IF EXISTS on_progress_updated ON public.daily_progress;
create trigger on_progress_updated
  before update on public.daily_progress
  for each row execute procedure public.handle_updated_at();

-- RLS for daily_progress
alter table public.daily_progress enable row level security;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Admins can read all progress' AND tablename = 'daily_progress') THEN
    create policy "Admins can read all progress" on public.daily_progress
      for select using ((select role from public.profiles where auth_id = auth.uid()) = 'admin');
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Admins can update admin_status' AND tablename = 'daily_progress') THEN
    create policy "Admins can update admin_status" on public.daily_progress
      for update using ((select role from public.profiles where auth_id = auth.uid()) = 'admin');
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Students can read own progress' AND tablename = 'daily_progress') THEN
    create policy "Students can read own progress" on public.daily_progress
      for select using (auth.uid() = student_id);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Students can insert own progress' AND tablename = 'daily_progress') THEN
    create policy "Students can insert own progress" on public.daily_progress
      for insert with check (auth.uid() = student_id);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Students can update own progress' AND tablename = 'daily_progress') THEN
    create policy "Students can update own progress" on public.daily_progress
      for update using (auth.uid() = student_id)
      with check (
        auth.uid() = student_id 
        and admin_status = (select admin_status from public.daily_progress where id = daily_progress.id)
      );
  END IF;
END $$;


-- 3. STORAGE SETUP
insert into storage.buckets (id, name, public) 
values ('proofs', 'proofs', false)
on conflict (id) do nothing;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Admins can read all proofs' AND tablename = 'objects') THEN
    create policy "Admins can read all proofs" on storage.objects
      for select using (bucket_id = 'proofs' and (select role from public.profiles where auth_id = auth.uid()) = 'admin');
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Students can access own proofs' AND tablename = 'objects') THEN
    create policy "Students can access own proofs" on storage.objects
      for select using (bucket_id = 'proofs' and auth.uid()::text = (string_to_array(name, '/'))[1]);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Students can upload own proofs' AND tablename = 'objects') THEN
    create policy "Students can upload own proofs" on storage.objects
      for insert with check (bucket_id = 'proofs' and auth.uid()::text = (string_to_array(name, '/'))[1]);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Students can update own proofs' AND tablename = 'objects') THEN
    create policy "Students can update own proofs" on storage.objects
      for update using (bucket_id = 'proofs' and auth.uid()::text = (string_to_array(name, '/'))[1]);
  END IF;
END $$;


-- 4. ANALYTICS
create or replace function public.calculate_daily_progress(progress_row public.daily_progress, sleep_target numeric default 7.0)
returns numeric as $$
declare
  score numeric := 0;
begin
  if progress_row.breakfast_completed then score := score + 20; end if;
  if progress_row.lunch_completed then score := score + 20; end if;
  if progress_row.dinner_completed then score := score + 20; end if;
  if progress_row.distance_km >= 5 then score := score + 20; end if;
  if progress_row.sleep_hours >= sleep_target then score := score + 20; end if;
  return score;
end;
$$ language plpgsql stable;

CREATE OR REPLACE VIEW public.daily_progress_analytics AS
select 
  dp.*,
  p.name as student_name,
  p.register_number,
  public.calculate_daily_progress(dp) as progress_percentage
from public.daily_progress dp
join public.profiles p on dp.student_id = p.auth_id;

CREATE OR REPLACE VIEW public.student_analytics AS
select
  p.auth_id as student_id,
  p.name as student_name,
  p.register_number,
  coalesce((select progress_percentage from public.daily_progress_analytics where student_id = p.auth_id and date = current_date), 0) as today_progress,
  coalesce((select avg(progress_percentage) from public.daily_progress_analytics where student_id = p.auth_id and date >= current_date - interval '7 days'), 0) as week_progress,
  coalesce((select avg(progress_percentage) from public.daily_progress_analytics where student_id = p.auth_id and date >= current_date - interval '30 days'), 0) as month_progress,
  
  coalesce((select count(*) from daily_progress where student_id = p.auth_id and date >= current_date - interval '30 days' and breakfast_completed and lunch_completed and dinner_completed)::numeric / nullif((select count(*) from daily_progress where student_id = p.auth_id and date >= current_date - interval '30 days'), 0) * 100, 0) as meal_completion_rate,
  coalesce((select count(*) from daily_progress where student_id = p.auth_id and date >= current_date - interval '30 days' and distance_km >= 5)::numeric / nullif((select count(*) from daily_progress where student_id = p.auth_id and date >= current_date - interval '30 days'), 0) * 100, 0) as distance_target_rate,
  coalesce((select count(*) from daily_progress where student_id = p.auth_id and date >= current_date - interval '30 days' and sleep_hours >= 7)::numeric / nullif((select count(*) from daily_progress where student_id = p.auth_id and date >= current_date - interval '30 days'), 0) * 100, 0) as sleep_target_rate,
  
  coalesce((select count(*) from daily_progress where student_id = p.auth_id and date >= current_date - interval '30 days')::numeric / 30 * 100, 0) as submission_consistency
from public.profiles p
where p.role = 'student';
