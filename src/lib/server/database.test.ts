import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
import path from "node:path";

// Actual PostgreSQL WASM, one isolated in-memory connection. Supabase Auth/Storage
// gateway behavior and multi-session socket concurrency are NOT covered here.
let db: PGlite;
const A = "a1000000-0000-4000-8000-000000000001";
const B = "a1000000-0000-4000-8000-000000000002";
const PERIOD = "a1000000-0000-4000-8000-000000000003";
const sqlFile = (name: string) =>
  readFile(path.join(process.cwd(), "supabase", name), "utf8");

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    create role anon nologin;
    create role authenticated nologin;
    create role service_role nologin bypassrls;
    create schema auth;
    create schema storage;
    create table auth.users(id uuid primary key, email text);
    create function auth.uid() returns uuid language sql stable as $$
      select (nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid
    $$;
    grant usage on schema auth,public,storage to anon,authenticated,service_role;
    grant execute on function auth.uid() to anon,authenticated,service_role;
    create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
    create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text references storage.buckets,name text);
    alter table storage.objects enable row level security;
    grant select on storage.objects to authenticated;
    create function storage.foldername(name text) returns text[] language sql immutable as $$
      select (string_to_array(name,'/'))[1:array_length(string_to_array(name,'/'),1)-1]
    $$;
  `);
  // PGlite has core gen_random_uuid/sha256 but does not package pgcrypto by
  // default. The migration never calls extension-only functions. This is the
  // only production SQL line removed; all table/RLS/RPC/trigger SQL is applied.
  const migration = await sqlFile("migrations/202610150001_club.sql");
  expect(
    migration.match(/create extension if not exists pgcrypto;/g),
  ).toHaveLength(1);
  await db.exec(
    migration.replace(
      "create extension if not exists pgcrypto;",
      "-- pgcrypto bootstrap omitted in PGlite; core UUID/SHA256 verified below.",
    ),
  );
  await db.exec(await sqlFile("seed.sql"));
}, 30_000);

beforeEach(async () => {
  await db.exec("begin");
});
afterEach(async () => {
  await db.exec("rollback");
});
afterAll(async () => {
  await db?.close();
});

async function user(id = A) {
  await db.query("insert into auth.users(id,email) values($1,$2)", [
    id,
    `${id}@example.invalid`,
  ]);
  await db.query("insert into public.profiles(user_id,payload) values($1,$2)", [
    id,
    { timeBudget: 30 },
  ]);
}
async function authenticated(id = A) {
  await db.exec("set local role authenticated");
  await db.query("select set_config('request.jwt.claims',$1,true)", [
    JSON.stringify({ sub: id, role: "authenticated" }),
  ]);
}
async function denied(query: string, args: unknown[] = [], expected?: string) {
  await db.exec("savepoint denied_operation");
  const result = db.query(query, args);
  if (expected) await expect(result).rejects.toThrow(expected);
  else await expect(result).rejects.toBeDefined();
  await db.exec("rollback to savepoint denied_operation");
}
async function readyPeriod(ends = "future") {
  await user();
  await db.query(
    `insert into public.activity_periods(id,user_id,club_date,day_index,time_zone,starts_at,ends_at)
    values($1,$2,public.club_date('Australia/Brisbane'),1,'Australia/Brisbane',now()-interval '3 hours',now()+$3::interval)`,
    [PERIOD, A, ends === "future" ? "1 hour" : "-1 hour"],
  );
  await db.query(
    `insert into public.task_attempts(user_id,period_id,kind,original_input,input_hash,request_key,independent,created_at)
    select $1,$2,kind,'{"answer":"original fixture"}','fixture',gen_random_uuid(),true,now()-interval '2 hours'
    from unnest(array['fitness','vocabulary','listening','reading','writing','speaking']) kind`,
    [A, PERIOD],
  );
  await db.query(
    `insert into public.evaluations(user_id,attempt_id,status,practice_score,evidence_mode,rubric_version)
    select user_id,id,'passed',100,case when kind='speaking' then 'verified_audio' else 'objective' end,'test-v1'
    from public.task_attempts where user_id=$1`,
    [A],
  );
}

describe("actual in-memory PostgreSQL migration and authorization", () => {
  it("applies the real migration/seed and has core UUID/SHA256", async () => {
    const result = await db.query<{
      lessons: number;
      uuid: string;
      hash: string;
    }>(
      "select (select count(*)::int from lesson_templates) as lessons,gen_random_uuid() as uuid,encode(sha256(convert_to('x','UTF8')),'hex') as hash",
    );
    expect(result.rows[0].lessons).toBe(5);
    expect(result.rows[0].uuid).toMatch(/^[\da-f-]{36}$/);
    expect(result.rows[0].hash).toBe(
      "2d711642b726b04401627ca9fbac32f5c8530fb1903cc4db02258717921a4881",
    );
  });
  it("enforces A/B row isolation and denies browser wallet/key/RPC access", async () => {
    await user(A);
    await user(B);
    await authenticated(A);
    expect((await db.query("select user_id from profiles")).rows).toEqual([
      { user_id: A },
    ]);
    await denied(
      "update profiles set total_xp=999999",
      [],
      "permission denied",
    );
    await denied("select * from lesson_private_keys", [], "permission denied");
    await denied(
      "select * from template_private_keys",
      [],
      "permission denied",
    );
    await denied(
      "select initialize_profile($1,$2)",
      [B, {}],
      "permission denied",
    );
    await denied(
      "select record_attempt($1,$2,null,$3,$4,$5,null)",
      [B, PERIOD, "fitness", {}, crypto.randomUUID()],
      "permission denied",
    );
  });
  it("rejects selected numeric exams with null score and transcript-only speech numbers", async () => {
    await user();
    await denied(
      "insert into exam_records(user_id,scale,score) values($1,'ielts',null)",
      [A],
      "check constraint",
    );
    await db.query(
      `insert into activity_periods(id,user_id,club_date,day_index,time_zone,starts_at,ends_at) values($1,$2,current_date,1,'Australia/Brisbane',now(),now()+interval '1 day')`,
      [PERIOD, A],
    );
    const attempt = await db.query<{ id: string }>(
      `insert into task_attempts(user_id,period_id,kind,original_input,input_hash,request_key,independent) values($1,$2,'speaking','{}','hash',$3,true) returning id`,
      [A, PERIOD, crypto.randomUUID()],
    );
    await denied(
      `insert into evaluations(user_id,attempt_id,status,practice_score,pronunciation,evidence_mode,rubric_version) values($1,$2,'passed',80,4,'text','v1')`,
      [A, attempt.rows[0].id],
      "check constraint",
    );
  });
  it("uses private, verified, unexpired storage metadata for owner-only audio reads", async () => {
    await user(A);
    await user(B);
    await db.query(
      "insert into storage.objects(bucket_id,name) values('club-audio',$1),('club-audio',$2)",
      [`${A}/audio.webm`, `${B}/audio.webm`],
    );
    await db.query(
      "insert into recordings(user_id,object_path,content_type,status,expires_at) values($1,$2,'audio/webm','verified',now()+interval '1 day'),($3,$4,'audio/webm','verified',now()+interval '1 day')",
      [A, `${A}/audio.webm`, B, `${B}/audio.webm`],
    );
    await authenticated(A);
    expect((await db.query("select name from storage.objects")).rows).toEqual([
      { name: `${A}/audio.webm` },
    ]);
    await db.exec("reset role");
    await db.query(
      "update recordings set expires_at=now()-interval '1 second' where user_id=$1",
      [A],
    );
    await authenticated(A);
    expect((await db.query("select name from storage.objects")).rows).toEqual(
      [],
    );
  });
});

describe("actual PostgreSQL settlement and boundary functions", () => {
  it("keeps 02:59/03:00 and Sydney DST boundaries distinct", async () => {
    const result = await db.query<{
      a: string;
      b: string;
      c: string;
      d: string;
    }>(`select
      club_date('Australia/Brisbane','2026-10-14 16:59:00Z')::text a,
      club_date('Australia/Brisbane','2026-10-14 17:00:00Z')::text b,
      club_date('Australia/Sydney','2026-10-03 15:59:00Z')::text c,
      club_date('Australia/Sydney','2026-10-03 16:00:00Z')::text d`);
    expect(result.rows[0]).toEqual({
      a: "2026-10-14",
      b: "2026-10-15",
      c: "2026-10-03",
      d: "2026-10-04",
    });
  });
  it("creates one current period and rejects missing module evidence", async () => {
    await user();
    await authenticated();
    const first = (
      await db.query<{ result: { id: string } }>(
        "select current_activity() result",
      )
    ).rows[0].result;
    const second = (
      await db.query<{ result: { id: string } }>(
        "select current_activity() result",
      )
    ).rows[0].result;
    expect(second.id).toBe(first.id);
    expect((await db.query("select * from daily_lessons")).rows).toHaveLength(
      5,
    );
    await denied("select claim_activity($1)", [first.id], "not_ready");
  });
  it("archives a missed period without advancing Day or inventing XP", async () => {
    await user();
    await authenticated();
    const first = (
      await db.query<{ result: { id: string } }>(
        "select current_activity() result",
      )
    ).rows[0].result;
    await db.exec("reset role");
    await db.query(
      "update activity_periods set club_date=club_date-3,ends_at=now()-interval '2 days',created_at=now()-interval '3 days' where id=$1",
      [first.id],
    );
    await db.query(
      "update daily_lessons set answers_revealed=true where period_id=$1",
      [first.id],
    );
    await authenticated();
    const next = (
      await db.query<{ result: { id: string; day_index: number } }>(
        "select current_activity() result",
      )
    ).rows[0].result;
    expect(next.id).not.toBe(first.id);
    expect(next.day_index).toBe(1);
    expect(
      (
        await db.query<{ status: string }>(
          "select status from activity_periods where id=$1",
          [first.id],
        )
      ).rows[0].status,
    ).toBe("archived_unclaimed");
    expect(
      (
        await db.query<{ total_xp: number; completed_days: number }>(
          "select total_xp,completed_days from profiles",
        )
      ).rows[0],
    ).toEqual({ total_xp: 0, completed_days: 0 });
    expect(
      (await db.query("select * from activity_periods")).rows,
    ).toHaveLength(2);
    expect(
      (
        await db.query<{ answers_revealed: boolean }>(
          "select answers_revealed from daily_lessons where period_id=$1",
          [next.id],
        )
      ).rows.every((row) => row.answers_revealed),
    ).toBe(true);
  });
  it("starts Day 2 only after a claimed period crosses the server boundary", async () => {
    await readyPeriod();
    await authenticated();
    await db.query("select claim_activity($1)", [PERIOD]);
    await db.exec("reset role");
    await db.query(
      "update activity_periods set club_date=club_date-1,claim_club_date=claim_club_date-1,ends_at=now()-interval '1 hour',created_at=now()-interval '1 day' where id=$1",
      [PERIOD],
    );
    await authenticated();
    const next = (
      await db.query<{ result: { id: string; day_index: number } }>(
        "select current_activity() result",
      )
    ).rows[0].result;
    expect(next.id).not.toBe(PERIOD);
    expect(next.day_index).toBe(2);
    expect(
      (await db.query<{ total_xp: number }>("select total_xp from profiles"))
        .rows[0].total_xp,
    ).toBe(100);
  });
  it("records immutable request-idempotent attempts and rejects reusing the key for different input", async () => {
    await user();
    await authenticated();
    const period = (
      await db.query<{ result: { id: string } }>(
        "select current_activity() result",
      )
    ).rows[0].result;
    const lesson = (
      await db.query<{ id: string }>(
        "select id from daily_lessons where kind='vocabulary'",
      )
    ).rows[0].id;
    await db.exec("reset role");
    const key = crypto.randomUUID();
    const args = [
      A,
      period.id,
      lesson,
      "vocabulary",
      { answer: "sustainable" },
      key,
      {
        status: "passed",
        practiceScore: 100,
        evidenceMode: "objective",
        rubricVersion: "v1",
        pronunciation: null,
        fluency: null,
      },
    ];
    const first = (
      await db.query<{ result: { idempotent: boolean } }>(
        "select record_attempt($1,$2,$3,$4,$5,$6,$7) result",
        args,
      )
    ).rows[0].result;
    const again = (
      await db.query<{ result: { idempotent: boolean } }>(
        "select record_attempt($1,$2,$3,$4,$5,$6,$7) result",
        args,
      )
    ).rows[0].result;
    expect(first.idempotent).toBe(false);
    expect(again.idempotent).toBe(true);
    expect((await db.query("select * from task_attempts")).rows).toHaveLength(
      1,
    );
    expect((await db.query("select * from evaluations")).rows).toHaveLength(1);
    await denied(
      "select record_attempt($1,$2,$3,$4,$5,$6,$7)",
      [
        A,
        period.id,
        lesson,
        "vocabulary",
        { answer: "different" },
        key,
        args[6],
      ],
      "request_key_conflict",
    );
  });
  it("settles once, preserves immutable versions and waits before opening next Day", async () => {
    await readyPeriod();
    await denied(
      "update task_attempts set original_input='{}' where user_id=$1",
      [A],
      "immutable_record",
    );
    await denied(
      "update evaluations set practice_score=0 where user_id=$1",
      [A],
      "immutable_record",
    );
    await authenticated();
    const first = (
      await db.query<{
        result: { totalXp: number; completedDays: number; idempotent: boolean };
      }>("select claim_activity($1) result", [PERIOD])
    ).rows[0].result;
    const retry = (
      await db.query<{ result: { totalXp: number; idempotent: boolean } }>(
        "select claim_activity($1) result",
        [PERIOD],
      )
    ).rows[0].result;
    expect(first).toMatchObject({
      totalXp: 100,
      completedDays: 1,
      idempotent: false,
    });
    expect(retry).toMatchObject({ totalXp: 100, idempotent: true });
    expect((await db.query("select * from checkins")).rows).toHaveLength(1);
    expect((await db.query("select * from xp_ledger")).rows).toHaveLength(1);
    expect(
      (
        await db.query<{ result: { id: string; day_index: number } }>(
          "select current_activity() result",
        )
      ).rows[0].result,
    ).toMatchObject({ id: PERIOD, day_index: 1 });
  });
  it("blocks ownership attacks on claim without revealing another period", async () => {
    await readyPeriod();
    await user(B);
    await authenticated(B);
    await denied("select claim_activity($1)", [PERIOD], "not_found");
  });
  it("preserves full-submission late review even if the browser has not refreshed", async () => {
    await readyPeriod("past");
    const attempt = (
      await db.query<{ id: string }>(
        "select id from task_attempts where user_id=$1 and kind='writing'",
        [A],
      )
    ).rows[0].id;
    const job = (
      await db.query<{ id: string }>(
        "insert into ai_jobs(user_id,attempt_id,provider_id,input_hash,state) values($1,$2,'test','fixture','running') returning id",
        [A, attempt],
      )
    ).rows[0].id;
    await db.query("select finish_assessment($1,$2,$3,null)", [
      A,
      job,
      {
        status: "passed",
        practiceScore: 100,
        pronunciation: null,
        fluency: null,
        evidenceMode: "text",
        rubricVersion: "test-v1",
        feedback: {},
      },
    ]);
    const period = (
      await db.query<{ status: string; window_ok: boolean }>(
        "select status,review_until=now()+interval '24 hours' as window_ok from activity_periods where id=$1",
        [PERIOD],
      )
    ).rows[0];
    expect(period).toEqual({
      status: "carried_for_system_review",
      window_ok: true,
    });
    await authenticated();
    expect(
      (
        await db.query<{ result: { id: string } }>(
          "select current_activity() result",
        )
      ).rows[0].result.id,
    ).toBe(PERIOD);
    expect(
      (
        await db.query<{ result: { totalXp: number } }>(
          "select claim_activity($1) result",
          [PERIOD],
        )
      ).rows[0].result.totalXp,
    ).toBe(100);
  });
  it("denies costs by default then reserves configured quota once", async () => {
    await readyPeriod();
    const attempt = (
      await db.query<{ id: string }>(
        "select id from task_attempts where kind='writing'",
        [],
      )
    ).rows[0].id;
    const job = (
      await db.query<{ id: string }>(
        "insert into ai_jobs(user_id,attempt_id,provider_id,input_hash) values($1,$2,'test','fixture') returning id",
        [A, attempt],
      )
    ).rows[0].id;
    await denied("select reserve_usage($1,$2,10)", [A, job], "quota_exceeded");
    await db.exec(
      "update budget_config set daily_global_units=10,daily_user_units=10",
    );
    expect(
      (
        await db.query<{ reserved: boolean }>(
          "select reserve_usage($1,$2,10) reserved",
          [A, job],
        )
      ).rows[0].reserved,
    ).toBe(true);
    expect(
      (
        await db.query<{ reserved: boolean }>(
          "select reserve_usage($1,$2,10) reserved",
          [A, job],
        )
      ).rows[0].reserved,
    ).toBe(false);
    expect((await db.query("select * from usage_ledger")).rows).toHaveLength(1);
  });
  it("stops inserts after deletion starts and cascades primary account records", async () => {
    await readyPeriod();
    await db.query("update profiles set deleting=true where user_id=$1", [A]);
    await denied(
      "insert into goals(user_id,goal) values($1,'alan')",
      [A],
      "account_deleting",
    );
    await db.query("delete from auth.users where id=$1", [A]);
    expect((await db.query("select * from profiles")).rows).toEqual([]);
    expect((await db.query("select * from task_attempts")).rows).toEqual([]);
    expect((await db.query("select * from evaluations")).rows).toEqual([]);
  });
});
