\set ON_ERROR_STOP on
begin;
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"f2000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
select public.claim_activity('f2000000-0000-4000-8000-000000000002');
commit;
