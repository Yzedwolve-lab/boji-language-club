\set ON_ERROR_STOP on
delete from auth.users where id='f2000000-0000-4000-8000-000000000001' and email='boji-concurrency-fixture@example.invalid';
