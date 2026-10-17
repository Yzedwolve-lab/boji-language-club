-- Apply only to a new, independent Supabase project after review. No legacy PTE data.
begin;
create extension if not exists pgcrypto;

create table public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  payload jsonb not null,
  time_zone text not null default 'Australia/Brisbane',
  total_xp integer not null default 0 check (total_xp >= 0),
  completed_days integer not null default 0 check (completed_days >= 0),
  deleting boolean not null default false,
  created_at timestamptz not null default now()
);
create table public.consent_records (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references public.profiles on delete cascade,
  purpose text not null, accepted boolean not null, policy_version text not null, created_at timestamptz not null default now()
);
create table public.exam_records (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references public.profiles on delete cascade,
  scale text not null, score numeric, comparable_total integer check (comparable_total between 0 and 120),
  exam_date date, self_reported boolean not null default true check(self_reported), created_at timestamptz not null default now(),
  check ((scale='ielts' and score is not null and score between 0 and 9 and mod(score*2,1)=0)
    or (scale='pte_academic' and score is not null and score between 10 and 90 and mod(score,1)=0)
    or (scale='toefl_legacy_total' and score is not null and score between 0 and 120 and mod(score,1)=0)
    or (scale='toefl_2026_band' and score is not null and score between 1 and 6 and mod(score*2,1)=0)
    or (scale in ('cet4','cet6','none') and score is null)),
  check(comparable_total is null or scale='toefl_2026_band'),
  check(scale<>'toefl_2026_band' or exam_date is null or exam_date>='2026-01-21')
);
create table public.goals (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references public.profiles on delete cascade,
  goal text not null check (goal in ('user','member','shareholder','alan')), created_at timestamptz not null default now()
);
create table public.forecast_baselines (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references public.profiles on delete cascade,
  status text not null check(status in ('calibrating','estimated','unavailable')), unaccelerated_remaining_days integer check (unaccelerated_remaining_days > 0),
  evidence_ids uuid[] not null default '{}', forecast jsonb not null, created_at timestamptz not null default now(), unique(id,user_id)
);
create table public.plan_versions (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references public.profiles on delete cascade,
  baseline_id uuid, version integer not null check(version > 0), compression_ratio numeric not null default 0 check(compression_ratio between 0 and 0.4),
  total_minutes integer not null check(total_minutes in (30,60,120,240)), plan jsonb not null,
  created_at timestamptz not null default now(), unique(user_id,version), foreign key (baseline_id,user_id) references public.forecast_baselines(id,user_id)
);
create table public.activity_periods (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references public.profiles on delete cascade,
  club_date date not null, day_index integer not null check(day_index>0), time_zone text not null,
  status text not null default 'active' check(status in ('active','reviewing','ready_to_claim','claimed','archived_unclaimed','carried_for_system_review')),
  starts_at timestamptz not null, ends_at timestamptz not null, review_until timestamptz,
  claimed_at timestamptz, claim_club_date date, created_at timestamptz not null default now(),
  unique(user_id,club_date), unique(id,user_id)
);
create table public.lesson_templates (
  id text primary key, kind text not null check(kind in ('vocabulary','listening','reading','writing','speaking')),
  public_payload jsonb not null, provenance jsonb not null
);
create table public.template_private_keys (template_id text primary key references public.lesson_templates on delete cascade, private_payload jsonb not null);
create table public.daily_lessons (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references public.profiles on delete cascade,
  period_id uuid not null, template_id text not null references public.lesson_templates,
  kind text not null check(kind in ('vocabulary','listening','reading','writing','speaking')), public_payload jsonb not null,
  version text not null default 'original-v1', rubric_version text not null default 'teaching-v1',
  answers_revealed boolean not null default false,
  created_at timestamptz not null default now(), unique(period_id,kind), unique(id,user_id),
  foreign key(period_id,user_id) references public.activity_periods(id,user_id) on delete cascade
);
create table public.lesson_private_keys (
  lesson_id uuid primary key references public.daily_lessons on delete cascade, private_payload jsonb not null
);
create table public.task_attempts (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references public.profiles on delete cascade,
  period_id uuid not null, lesson_id uuid, kind text not null check(kind in ('fitness','vocabulary','listening','reading','writing','speaking')),
  original_input jsonb not null, input_hash text not null, request_key uuid not null,
  independent boolean not null, created_at timestamptz not null default now(),
  unique(user_id,request_key), unique(id,user_id),
  foreign key(period_id,user_id) references public.activity_periods(id,user_id) on delete cascade,
  foreign key(lesson_id,user_id) references public.daily_lessons(id,user_id) on delete cascade
);
create table public.evaluations (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references public.profiles on delete cascade,
  version bigint generated always as identity unique,
  attempt_id uuid not null, status text not null check(status in ('pending_review','needs_revision','passed','completed_alternative','system_error')),
  practice_score numeric check(practice_score between 0 and 100), pronunciation numeric check(pronunciation between 0 and 5), fluency numeric check(fluency between 0 and 5),
  evidence_mode text not null check(evidence_mode in ('objective','text','verified_audio','alternative','record_review','unavailable')),
  feedback jsonb not null default '{}', rubric_version text not null, provider_id text, prompt_version text,
  created_at timestamptz not null default now(), unique(id,user_id),
  foreign key(attempt_id,user_id) references public.task_attempts(id,user_id) on delete cascade,
  check(evidence_mode='verified_audio' or (pronunciation is null and fluency is null)),
  check(status not in ('passed','completed_alternative') or practice_score is not null)
);
create table public.meal_logs (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references public.profiles on delete cascade,
  period_id uuid not null, raw_text text not null check(length(raw_text) between 1 and 10000),
  coverage text not null check(coverage in ('partial','complete','exercise_only')), created_at timestamptz not null default now(), unique(id,user_id),
  foreign key(period_id,user_id) references public.activity_periods(id,user_id) on delete cascade
);
create table public.food_items (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references public.profiles on delete cascade,
  meal_log_id uuid not null, normalized_name text not null, amount numeric, unit text, cooked_or_raw text,
  source_id text, source_version text, assumptions jsonb not null default '[]', estimated_range jsonb, confidence text,
  foreign key(meal_log_id,user_id) references public.meal_logs(id,user_id) on delete cascade
);
create table public.exercise_logs (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references public.profiles on delete cascade,
  period_id uuid not null, raw_text text not null, minutes numeric check(minutes between 0 and 1440),
  gross_kcal numeric, net_kcal numeric, met_source text, created_at timestamptz not null default now(),
  foreign key(period_id,user_id) references public.activity_periods(id,user_id) on delete cascade
);
create table public.review_items (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references public.profiles on delete cascade,
  lemma text not null, target_meaning text not null, source_sentence text not null, source_ref text not null,
  status text not null default 'assigned' check(status in ('assigned','studied','retrieved','mastered')),
  studied_at timestamptz, due_at timestamptz, interval_days integer not null default 1, unique(user_id,lemma,target_meaning)
);
create table public.recordings (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references public.profiles on delete cascade,
  object_path text not null unique, content_type text not null, bytes integer check(bytes between 1 and 10485760),
  status text not null default 'pending_validation' check(status in ('pending_validation','verified','rejected')),
  duration_seconds numeric check(duration_seconds between 0 and 180), created_at timestamptz not null default now(),
  expires_at timestamptz not null default(now()+interval '30 days')
);
create table public.checkins (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references public.profiles on delete cascade,
  activity_period_id uuid not null, xp integer not null check(xp between 0 and 100),
  snapshot jsonb not null, created_at timestamptz not null default now(),
  unique(user_id,activity_period_id), unique(id,user_id),
  foreign key(activity_period_id,user_id) references public.activity_periods(id,user_id) on delete cascade
);
create table public.xp_ledger (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references public.profiles on delete cascade,
  source_id uuid not null, amount integer not null check(amount between 0 and 100), rule_version text not null,
  created_at timestamptz not null default now(), unique(user_id,source_id),
  foreign key(source_id,user_id) references public.checkins(id,user_id) on delete cascade
);
create table public.ai_jobs (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references public.profiles on delete cascade,
  attempt_id uuid not null, state text not null default 'pending' check(state in ('pending','running','completed','system_error','cancelled')),
  provider_id text not null, input_hash text not null, error_code text,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique(attempt_id), foreign key(attempt_id,user_id) references public.task_attempts(id,user_id) on delete cascade
);
create table public.usage_ledger (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references public.profiles on delete cascade,
  job_id uuid not null unique references public.ai_jobs on delete cascade,
  reserved_units integer not null check(reserved_units>0), state text not null default 'reserved' check(state in ('reserved','spent','released')),
  created_at timestamptz not null default now()
);
create table public.budget_config (id boolean primary key default true check(id), daily_global_units integer not null default 0 check(daily_global_units>=0), daily_user_units integer not null default 0 check(daily_user_units>=0));
insert into public.budget_config(id) values(true);
create table public.request_windows (user_id uuid not null references public.profiles on delete cascade, window_start timestamptz not null, count integer not null, primary key(user_id,window_start));

create index on public.activity_periods(user_id,created_at desc);
create index on public.task_attempts(period_id,kind,created_at);
create index on public.evaluations(attempt_id,version desc);
create index on public.ai_jobs(user_id,state);
create index on public.usage_ledger(created_at,user_id);
create index on public.recordings(user_id,expires_at);

-- Serialize every server insert with account erasure as well. This prevents a
-- request authorized just before deletion from recreating data afterwards.
create function public.guard_user_insert() returns trigger language plpgsql security definer set search_path='' as $$ begin
 perform 1 from public.profiles where user_id=new.user_id and not deleting for update;
 if not found then raise exception 'account_deleting'; end if;
 return new;
end $$;
do $$ declare t text; begin
 foreach t in array array['consent_records','exam_records','goals','forecast_baselines','plan_versions','activity_periods','daily_lessons','task_attempts','evaluations','meal_logs','food_items','exercise_logs','review_items','recordings','checkins','xp_ledger','ai_jobs','usage_ledger','request_windows'] loop
   execute format('create trigger guard_user_insert before insert on public.%I for each row execute function public.guard_user_insert()',t);
 end loop;
end $$;

-- No browser DML for XP, evaluations, answers or private user data. Writes go through
-- narrowly granted RPCs / the authenticated server. Default Supabase grants are revoked.
do $$ declare t text; begin
  foreach t in array array['profiles','consent_records','exam_records','goals','forecast_baselines','plan_versions','activity_periods','daily_lessons','task_attempts','evaluations','meal_logs','food_items','exercise_logs','review_items','recordings','checkins','xp_ledger','ai_jobs','usage_ledger','request_windows'] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('revoke all on public.%I from anon, authenticated',t);
    execute format('grant select on public.%I to authenticated',t);
    execute format('grant all on public.%I to service_role',t);
    execute format('create policy owner_read on public.%I for select to authenticated using ((select auth.uid())=user_id)',t);
  end loop;
  foreach t in array array['lesson_templates','template_private_keys','lesson_private_keys','budget_config'] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('revoke all on public.%I from anon, authenticated',t);
    execute format('grant all on public.%I to service_role',t);
  end loop;
end $$;

create function public.prevent_immutable_update() returns trigger language plpgsql as $$ begin raise exception 'immutable_record'; end $$;
do $$ declare t text; begin
 foreach t in array array['task_attempts','evaluations','checkins','xp_ledger','consent_records','exam_records','goals','forecast_baselines','plan_versions'] loop
   execute format('create trigger immutable_update before update on public.%I for each row execute function public.prevent_immutable_update()',t);
 end loop;
end $$;
-- Deletion remains possible for authenticated account erasure, never client DML.

create function public.club_date(p_zone text, p_now timestamptz default now()) returns date language sql stable set search_path='' as $$
  select ((p_now at time zone p_zone)-interval '3 hours')::date
$$;

create function public.initialize_profile(p_uid uuid, p_payload jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare result public.profiles; zone text:=p_payload->>'timeZone'; begin
 if not exists(select 1 from pg_timezone_names where name=zone) then raise exception 'invalid_timezone'; end if;
 insert into public.profiles(user_id,payload,time_zone) values(p_uid,p_payload,zone) on conflict(user_id) do nothing;
 select * into result from public.profiles where user_id=p_uid for update;
 if result.deleting then raise exception 'account_deleting'; end if;
  if result.time_zone<>zone then raise exception 'timezone_locked'; end if;
 -- Onboarding is idempotent. Profile editing is deliberately a separate future endpoint.
 if not exists(select 1 from public.goals where user_id=p_uid) then
   insert into public.goals(user_id,goal) values(p_uid,p_payload->>'goal');
   insert into public.consent_records(user_id,purpose,accepted,policy_version) values(p_uid,'health_recommendations',coalesce((p_payload->>'healthConsent')::boolean,false),'privacy-draft-v1');
   insert into public.exam_records(user_id,scale,score,comparable_total,exam_date) values(p_uid,p_payload->>'examType',(p_payload->>'examScore')::numeric,(p_payload->>'comparableToeflScore')::integer,nullif(p_payload->>'examDate','')::date);
 end if;
 return to_jsonb(result);
end $$;

create function public.current_activity() returns jsonb language plpgsql security definer set search_path='' as $$
declare uid uuid:=auth.uid(); profile public.profiles; period public.activity_periods; today date; template record; lesson uuid; begin
 if uid is null then raise exception 'not_found'; end if;
 select * into profile from public.profiles where user_id=uid for update;
 if not found then raise exception 'missing_profile'; end if;
 if profile.deleting then raise exception 'account_deleting'; end if;
 today:=public.club_date(profile.time_zone);
 select * into period from public.activity_periods where user_id=uid order by created_at desc limit 1 for update;
 if found then
   if period.club_date=today or (period.status='claimed' and period.claim_club_date>=today) then return to_jsonb(period); end if;
   if period.status='carried_for_system_review' and (period.review_until is null or period.review_until>=now()) then return to_jsonb(period); end if;
   -- Only genuinely submitted, server-timestamped work receives system-delay carry.
   if period.status not in ('claimed','archived_unclaimed') and
      (select count(distinct kind) from public.task_attempts where period_id=period.id and created_at<period.ends_at)=6 and
      exists(select 1 from public.ai_jobs j join public.task_attempts a on a.id=j.attempt_id where a.period_id=period.id and j.state in ('pending','running','system_error')) then
     update public.activity_periods set status='carried_for_system_review' where id=period.id returning * into period;
     return to_jsonb(period);
   end if;
   if period.status<>'claimed' then update public.activity_periods set status='archived_unclaimed' where id=period.id; end if;
 end if;
 insert into public.activity_periods(user_id,club_date,day_index,time_zone,starts_at,ends_at)
 values(uid,today,profile.completed_days+1,profile.time_zone,(today+time '03:00') at time zone profile.time_zone,((today+1)+time '03:00') at time zone profile.time_zone)
 returning * into period;
 for template in select * from public.lesson_templates loop
   insert into public.daily_lessons(user_id,period_id,template_id,kind,public_payload,answers_revealed)
   values(uid,period.id,template.id,template.kind,template.public_payload,
     exists(select 1 from public.daily_lessons prior where prior.user_id=uid and prior.template_id=template.id and prior.answers_revealed)) returning id into lesson;
   insert into public.lesson_private_keys(lesson_id,private_payload) select lesson,private_payload from public.template_private_keys where template_id=template.id;
 end loop;
 return to_jsonb(period);
end $$;

create function public.claim_activity(p_period_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare uid uuid:=auth.uid(); profile public.profiles; period public.activity_periods; old_claim public.checkins;
 fitness numeric; language numeric; n integer; minimum numeric; award integer; claim public.checkins; evidence jsonb; begin
 if uid is null then raise exception 'not_found'; end if;
 select * into profile from public.profiles where user_id=uid for update;
 if not found then raise exception 'missing_profile'; end if;
 if profile.deleting then raise exception 'account_deleting'; end if;
 select * into period from public.activity_periods where id=p_period_id and user_id=uid for update;
 if not found then raise exception 'not_found'; end if;
 select * into old_claim from public.checkins where activity_period_id=period.id and user_id=uid;
 if found then return jsonb_build_object('checkin',to_jsonb(old_claim),'totalXp',profile.total_xp,'completedDays',profile.completed_days,'idempotent',true); end if;
 if period.status in ('claimed','archived_unclaimed') or (now()>=period.ends_at and (period.status<>'carried_for_system_review' or period.review_until is null or now()>period.review_until)) then raise exception 'period_closed'; end if;
 -- Freeze the latest immutable evaluation of each attempt, then retain the best
 -- passed attempt for each component. A retry cannot erase another component.
 with latest as (
   select distinct on (e.attempt_id) e.*,a.kind from public.evaluations e join public.task_attempts a on a.id=e.attempt_id
   where a.period_id=period.id and e.user_id=uid order by e.attempt_id,e.version desc
 ), best as (
   select distinct on (kind) * from latest where status in ('passed','completed_alternative') order by kind,practice_score desc,created_at desc
 ) select max(practice_score) filter(where kind='fitness'),avg(practice_score) filter(where kind<>'fitness'),count(*) filter(where kind<>'fitness'),min(practice_score) filter(where kind<>'fitness'),jsonb_agg(jsonb_build_object('evaluationId',id,'attemptId',attempt_id,'kind',kind,'practiceScore',practice_score,'evidenceMode',evidence_mode))
 into fitness,language,n,minimum,evidence from best;
 if fitness is null or n<>5 or minimum<60 or language<70 then raise exception 'not_ready'; end if;
 award:=least(100,round(40*fitness/100)+round(50*language/100)+10);
 insert into public.checkins(user_id,activity_period_id,xp,snapshot) values(uid,period.id,award,jsonb_build_object('fitnessQuality',fitness,'languagePracticeScore',language,'evaluations',evidence,'ruleVersion','product-2026-10-15','dayIndex',period.day_index)) returning * into claim;
 insert into public.xp_ledger(user_id,source_id,amount,rule_version) values(uid,claim.id,award,'product-2026-10-15');
 update public.profiles set total_xp=total_xp+award,completed_days=completed_days+1 where user_id=uid returning * into profile;
 update public.activity_periods set status='claimed',claimed_at=now(),claim_club_date=public.club_date(profile.time_zone) where id=period.id;
 return jsonb_build_object('checkin',to_jsonb(claim),'totalXp',profile.total_xp,'completedDays',profile.completed_days,'idempotent',false);
end $$;

create function public.record_attempt(p_uid uuid,p_period uuid,p_lesson uuid,p_kind text,p_input jsonb,p_request uuid,p_evaluation jsonb default null) returns jsonb language plpgsql security definer set search_path='' as $$
declare profile public.profiles; period public.activity_periods; attempt public.task_attempts; lesson public.daily_lessons; hash text; begin
 select * into profile from public.profiles where user_id=p_uid for update;
 if not found then raise exception 'missing_profile'; end if;
 if profile.deleting then raise exception 'account_deleting'; end if;
 select * into period from public.activity_periods where id=p_period and user_id=p_uid for update;
 if not found then raise exception 'not_found'; end if;
 hash:=encode(sha256(convert_to(p_input::text,'UTF8')),'hex');
 select * into attempt from public.task_attempts where user_id=p_uid and request_key=p_request;
 if found then
   if attempt.input_hash<>hash or attempt.period_id<>p_period or attempt.kind<>p_kind then raise exception 'request_key_conflict'; end if;
   return jsonb_build_object('attempt',to_jsonb(attempt),'idempotent',true);
 end if;
 if period.status in ('claimed','archived_unclaimed') or (now()>=period.ends_at and (period.status<>'carried_for_system_review' or period.review_until is null or now()>period.review_until)) then raise exception 'period_closed'; end if;
 if p_kind<>'fitness' then
   select * into lesson from public.daily_lessons where id=p_lesson and user_id=p_uid and period_id=p_period and kind=p_kind;
   if not found then raise exception 'not_found'; end if;
 end if;
 insert into public.task_attempts(user_id,period_id,lesson_id,kind,original_input,input_hash,request_key,independent) values(p_uid,p_period,p_lesson,p_kind,p_input,hash,p_request,not coalesce(lesson.answers_revealed,false)) returning * into attempt;
 if p_evaluation is not null then
   insert into public.evaluations(user_id,attempt_id,status,practice_score,pronunciation,fluency,evidence_mode,feedback,rubric_version,provider_id,prompt_version)
   values(p_uid,attempt.id,p_evaluation->>'status',(p_evaluation->>'practiceScore')::numeric,(p_evaluation->>'pronunciation')::numeric,(p_evaluation->>'fluency')::numeric,p_evaluation->>'evidenceMode',coalesce(p_evaluation->'feedback','{}'),p_evaluation->>'rubricVersion',p_evaluation->>'providerId',p_evaluation->>'promptVersion');
 end if;
 if p_evaluation is null and p_kind in ('writing','speaking') then insert into public.ai_jobs(user_id,attempt_id,provider_id,input_hash) values(p_uid,attempt.id,case when p_kind='writing' then 'openai-writing' else 'audio-unconfigured' end,hash); end if;
 return jsonb_build_object('attempt',to_jsonb(attempt),'idempotent',false);
end $$;

create function public.finish_assessment(p_uid uuid,p_job uuid,p_evaluation jsonb,p_error text default null) returns void language plpgsql security definer set search_path='' as $$
declare job public.ai_jobs; v_period_id uuid; period public.activity_periods; begin
 perform 1 from public.profiles where user_id=p_uid and not deleting for update;
 if not found then raise exception 'account_deleting'; end if;
 select * into job from public.ai_jobs where id=p_job and user_id=p_uid for update;
 if not found or job.state in ('completed','cancelled') then return; end if;
 select a.period_id into v_period_id from public.task_attempts a where a.id=job.attempt_id;
 select * into period from public.activity_periods where id=v_period_id and user_id=p_uid for update;
 if p_error is not null then update public.ai_jobs set state='system_error',error_code=p_error,updated_at=now() where id=job.id; return; end if;
 insert into public.evaluations(user_id,attempt_id,status,practice_score,pronunciation,fluency,evidence_mode,feedback,rubric_version,provider_id,prompt_version)
 values(p_uid,job.attempt_id,p_evaluation->>'status',(p_evaluation->>'practiceScore')::numeric,(p_evaluation->>'pronunciation')::numeric,(p_evaluation->>'fluency')::numeric,p_evaluation->>'evidenceMode',coalesce(p_evaluation->'feedback','{}'),p_evaluation->>'rubricVersion',job.provider_id,'writing-v1');
 update public.ai_jobs set state='completed',error_code=null,updated_at=now() where id=job.id;
 -- Provider completion after cutoff must get the same fair window whether or
 -- not a browser has already called current_activity since the boundary.
 if now()>=period.ends_at and period.status not in ('claimed','archived_unclaimed') and
    (select count(distinct kind) from public.task_attempts where period_id=period.id and created_at<period.ends_at)=6 then
   update public.activity_periods set status='carried_for_system_review' where id=period.id;
 end if;
 if not exists(select 1 from public.ai_jobs j join public.task_attempts a on a.id=j.attempt_id where a.period_id=v_period_id and j.state in ('pending','running','system_error')) then
   update public.activity_periods set review_until=coalesce(review_until,now()+interval '24 hours') where id=v_period_id and status='carried_for_system_review';
 end if;
end $$;

create function public.reserve_usage(p_uid uuid,p_job uuid,p_units integer) returns boolean language plpgsql security definer set search_path='' as $$
declare limits public.budget_config; begin
 perform 1 from public.profiles where user_id=p_uid and not deleting for update;
 if not found then raise exception 'account_deleting'; end if;
 if not exists(select 1 from public.ai_jobs where id=p_job and user_id=p_uid and state in ('pending','system_error')) then return false; end if;
 select * into limits from public.budget_config where id=true for update; -- serialize global budget
 if exists(select 1 from public.usage_ledger where job_id=p_job) then return false; end if;
 if p_units<1 or p_units>limits.daily_user_units or
   (select coalesce(sum(reserved_units),0) from public.usage_ledger where user_id=p_uid and created_at>=date_trunc('day',now() at time zone 'UTC') at time zone 'UTC' and state<>'released')+p_units>limits.daily_user_units or
   (select coalesce(sum(reserved_units),0) from public.usage_ledger where created_at>=date_trunc('day',now() at time zone 'UTC') at time zone 'UTC' and state<>'released')+p_units>limits.daily_global_units then raise exception 'quota_exceeded'; end if;
 insert into public.usage_ledger(user_id,job_id,reserved_units) values(p_uid,p_job,p_units);
 update public.ai_jobs set state='running',updated_at=now() where id=p_job;
 return true;
end $$;

create function public.check_rate_limit() returns void language plpgsql security definer set search_path='' as $$
declare uid uuid:=auth.uid(); bucket timestamptz:=date_trunc('minute',now()); requests integer; begin
 if uid is null then raise exception 'not_found'; end if;
 if not exists(select 1 from public.profiles where user_id=uid) then return; end if;
 insert into public.request_windows(user_id,window_start,count) values(uid,bucket,1) on conflict(user_id,window_start) do update set count=public.request_windows.count+1 returning count into requests;
 if requests>60 then raise exception 'rate_limited'; end if;
end $$;

-- Authenticated users can execute only the three authority-preserving RPCs.
revoke all on function public.current_activity() from public,anon,authenticated;
revoke all on function public.claim_activity(uuid) from public,anon,authenticated;
revoke all on function public.check_rate_limit() from public,anon,authenticated;
grant execute on function public.current_activity(),public.claim_activity(uuid),public.check_rate_limit() to authenticated;
revoke all on function public.initialize_profile(uuid,jsonb),public.record_attempt(uuid,uuid,uuid,text,jsonb,uuid,jsonb),public.finish_assessment(uuid,uuid,jsonb,text),public.reserve_usage(uuid,uuid,integer) from public,anon,authenticated;
grant execute on function public.initialize_profile(uuid,jsonb),public.record_attempt(uuid,uuid,uuid,text,jsonb,uuid,jsonb),public.finish_assessment(uuid,uuid,jsonb,text),public.reserve_usage(uuid,uuid,integer) to service_role;
revoke all on function public.prevent_immutable_update() from public,anon,authenticated;
revoke all on function public.guard_user_insert() from public,anon,authenticated;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('club-audio','club-audio',false,10485760,array['audio/webm','audio/ogg','audio/wav','audio/mpeg']) on conflict(id) do nothing;
-- Server upload validation is required before activation. Browser uploads are denied.
create policy club_audio_owner_read on storage.objects for select to authenticated using(bucket_id='club-audio' and (storage.foldername(name))[1]=(select auth.uid())::text and exists(select 1 from public.recordings r where r.user_id=(select auth.uid()) and r.object_path=name and r.status='verified' and r.expires_at>now()));
commit;
