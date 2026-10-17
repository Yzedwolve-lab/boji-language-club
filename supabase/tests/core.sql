-- Requires migrated, dedicated LOCAL Supabase database; run via run-local-tests.ps1.
-- All sequential test fixtures roll back.
\set ON_ERROR_STOP on
begin;
create function pg_temp.assert_true(condition boolean, message text) returns void language plpgsql as $$ begin if condition is distinct from true then raise exception 'ASSERTION FAILED: %',message; end if; end $$;
insert into auth.users(id,email) values
 ('f1000000-0000-4000-8000-000000000001','boji-test-a@example.invalid'),
 ('f1000000-0000-4000-8000-000000000002','boji-test-b@example.invalid');
insert into public.profiles(user_id,payload) values
 ('f1000000-0000-4000-8000-000000000001','{}'),
 ('f1000000-0000-4000-8000-000000000002','{}');
select pg_temp.assert_true(public.club_date('Australia/Brisbane','2026-10-14 16:59:00Z')='2026-10-14','02:59 remains previous club date');
select pg_temp.assert_true(public.club_date('Australia/Brisbane','2026-10-14 17:00:00Z')='2026-10-15','03:00 starts next club date');
select pg_temp.assert_true(public.club_date('Australia/Sydney','2026-10-03 15:59:00Z')='2026-10-03','DST spring before boundary');
select pg_temp.assert_true(public.club_date('Australia/Sydney','2026-10-03 16:00:00Z')='2026-10-04','DST spring after boundary');

set local role authenticated;
select set_config('request.jwt.claims','{"sub":"f1000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
select pg_temp.assert_true((select count(*) from public.profiles)=1,'RLS exposes only the caller profile');
select pg_temp.assert_true((select count(*) from public.profiles where user_id='f1000000-0000-4000-8000-000000000002')=0,'A cannot read B');
do $$ begin
  begin update public.profiles set total_xp=999999; raise exception 'client XP write unexpectedly allowed'; exception when insufficient_privilege then null; end;
  begin perform * from public.lesson_private_keys; raise exception 'answer key read unexpectedly allowed'; exception when insufficient_privilege then null; end;
  begin perform public.initialize_profile('f1000000-0000-4000-8000-000000000002','{}'); raise exception 'privileged onboarding RPC unexpectedly callable'; exception when insufficient_privilege then null; end;
end $$;
select public.current_activity();
select pg_temp.assert_true((select count(*) from public.activity_periods)=1,'one current period');
do $$ declare pid uuid; begin
  select id into pid from public.activity_periods limit 1;
  begin perform public.claim_activity(pid); raise exception 'empty period unexpectedly claimable'; exception when raise_exception then if sqlerrm<>'not_ready' then raise; end if; end;
end $$;
reset role;

-- Immutable original submissions and evidence; all six tasks are explicit server fixtures.
insert into public.task_attempts(user_id,period_id,kind,original_input,input_hash,request_key,independent)
select p.user_id,p.id,k.kind,'{"answer":"fixture"}','fixture',gen_random_uuid(),true
from public.activity_periods p cross join unnest(array['fitness','vocabulary','listening','reading','writing','speaking']) k(kind)
where p.user_id='f1000000-0000-4000-8000-000000000001';
insert into public.evaluations(user_id,attempt_id,status,practice_score,evidence_mode,rubric_version)
select user_id,id,'passed',100,case when kind='fitness' then 'record_review' when kind='speaking' then 'verified_audio' else 'objective' end,'test-fixture-v1' from public.task_attempts where user_id='f1000000-0000-4000-8000-000000000001';
do $$ begin
 begin update public.task_attempts set original_input='{}' where user_id='f1000000-0000-4000-8000-000000000001'; raise exception 'mutation allowed'; exception when raise_exception then if sqlerrm<>'immutable_record' then raise; end if; end;
end $$;
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"f1000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
select public.claim_activity((select id from public.activity_periods limit 1));
select public.claim_activity((select id from public.activity_periods limit 1));
select pg_temp.assert_true((select count(*) from public.checkins)=1,'retries have one checkin');
select pg_temp.assert_true((select count(*) from public.xp_ledger)=1,'retries have one ledger source');
select pg_temp.assert_true((select total_xp from public.profiles)=100,'retry never doubles XP');
select pg_temp.assert_true((select completed_days from public.profiles)=1,'retry never doubles completed days');
select pg_temp.assert_true((public.current_activity()->>'day_index')::integer=1,'claim does not immediately open next Day');
reset role;

-- Erasure race guard rejects late insert after deleting flag is set.
update public.profiles set deleting=true where user_id='f1000000-0000-4000-8000-000000000001';
do $$ begin
 begin insert into public.goals(user_id,goal) values('f1000000-0000-4000-8000-000000000001','alan'); raise exception 'late insert allowed'; exception when raise_exception then if sqlerrm<>'account_deleting' then raise; end if; end;
end $$;
rollback;
