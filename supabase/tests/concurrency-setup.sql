\set ON_ERROR_STOP on
begin;
-- A collision fails rather than removing any existing account.
insert into auth.users(id,email) values('f2000000-0000-4000-8000-000000000001','boji-concurrency-fixture@example.invalid');
insert into public.profiles(user_id,payload) values('f2000000-0000-4000-8000-000000000001','{}');
insert into public.activity_periods(id,user_id,club_date,day_index,time_zone,starts_at,ends_at)
values('f2000000-0000-4000-8000-000000000002','f2000000-0000-4000-8000-000000000001',public.club_date('Australia/Brisbane'),1,'Australia/Brisbane',now()-interval '1 hour',now()+interval '1 hour');
insert into public.task_attempts(user_id,period_id,kind,original_input,input_hash,request_key,independent)
select 'f2000000-0000-4000-8000-000000000001','f2000000-0000-4000-8000-000000000002',kind,'{"answer":"fixture"}','fixture',gen_random_uuid(),true from unnest(array['fitness','vocabulary','listening','reading','writing','speaking']) kind;
insert into public.evaluations(user_id,attempt_id,status,practice_score,evidence_mode,rubric_version)
select user_id,id,'passed',100,'objective','concurrency-test-only' from public.task_attempts where user_id='f2000000-0000-4000-8000-000000000001';
commit;
