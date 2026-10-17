\set ON_ERROR_STOP on
do $$ begin
 if (select count(*) from public.checkins where user_id='f2000000-0000-4000-8000-000000000001')<>1 then raise exception 'duplicate checkins'; end if;
 if (select count(*) from public.xp_ledger where user_id='f2000000-0000-4000-8000-000000000001')<>1 then raise exception 'duplicate ledger'; end if;
 if (select total_xp from public.profiles where user_id='f2000000-0000-4000-8000-000000000001')<>100 then raise exception 'incorrect XP'; end if;
end $$;
