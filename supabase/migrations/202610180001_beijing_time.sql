-- New accounts use Beijing time; this product no longer offers a timezone setting.
-- Preserve existing profiles and all period/claim/ledger timestamps. Changing a
-- deployed account's historical zone requires a separate, reviewed transition.
alter table public.profiles alter column time_zone set default 'Asia/Shanghai';

create or replace function public.normalize_new_profile_time_zone()
returns trigger language plpgsql set search_path='' as $$ begin
  new.time_zone := 'Asia/Shanghai';
  new.payload := jsonb_set(new.payload, '{timeZone}', '"Asia/Shanghai"'::jsonb, true);
  return new;
end $$;

create or replace trigger normalize_new_profile_time_zone
before insert on public.profiles for each row
execute function public.normalize_new_profile_time_zone();

create or replace function public.initialize_profile(p_uid uuid, p_payload jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  result public.profiles;
  normalized_payload jsonb := jsonb_set(p_payload, '{timeZone}', '"Asia/Shanghai"'::jsonb, true);
begin
  insert into public.profiles(user_id,payload,time_zone)
  values(p_uid,normalized_payload,'Asia/Shanghai') on conflict(user_id) do nothing;
  select * into result from public.profiles where user_id=p_uid for update;
  if result.deleting then raise exception 'account_deleting'; end if;
  -- Idempotent onboarding is not profile editing. An existing account retains
  -- its locked historical timezone, even if an old client submits another one.
  if not exists(select 1 from public.goals where user_id=p_uid) then
    insert into public.goals(user_id,goal) values(p_uid,normalized_payload->>'goal');
    insert into public.consent_records(user_id,purpose,accepted,policy_version)
    values(p_uid,'health_recommendations',coalesce((normalized_payload->>'healthConsent')::boolean,false),'privacy-draft-v1');
    insert into public.exam_records(user_id,scale,score,comparable_total,exam_date)
    values(p_uid,normalized_payload->>'examType',(normalized_payload->>'examScore')::numeric,(normalized_payload->>'comparableToeflScore')::integer,nullif(normalized_payload->>'examDate','')::date);
  end if;
  return to_jsonb(result);
end $$;

revoke all on function public.normalize_new_profile_time_zone() from public,anon,authenticated;
revoke all on function public.initialize_profile(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.initialize_profile(uuid,jsonb) to service_role;
