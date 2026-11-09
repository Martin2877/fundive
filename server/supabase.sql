-- DeepLog 深蓝手账 · 账号与玩家榜（Supabase SQL）
-- 用法：Supabase 项目 -> SQL Editor -> 整段跑一遍。
-- 设计：免登录，账号与访问者 IP 绑定（PostgREST 的 request.headers 里取
-- x-forwarded-for/cf-connecting-ip）。表开 RLS 且不放任何直读直写策略——
-- 所有读写只走下面三个 SECURITY DEFINER RPC，昵称/分数之外的档案不会泄漏。
-- 注意：XFF 首段可被客户端伪造——休闲游戏够用，要更严请接 Supabase Auth。

create table if not exists public.divers (
  ip         text primary key,
  name       text not null default '潜水员',
  data       jsonb not null default '{}'::jsonb,   -- 图鉴/结局/章节/课程/生涯/回放
  score      int not null default 0,               -- 榜分（fd_score 由 data 算出）
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.divers enable row level security;
revoke select, insert, update, delete on public.divers from anon, authenticated;

-- 访问者 IP：XFF 首段 -> cf-connecting-ip -> x-real-ip
create or replace function public.fd_ip() returns text
language plpgsql stable as $$
declare h jsonb;
begin
  begin
    h := nullif(current_setting('request.headers', true), '')::jsonb;
  exception when others then h := '{}'::jsonb;
  end;
  return coalesce(
    nullif(trim(h->>'cf-connecting-ip'), ''),
    nullif(trim(split_part(coalesce(h->>'x-forwarded-for', ''), ',', 1)), ''),
    nullif(trim(h->>'x-real-ip'), ''),
    'unknown');
end $$;

-- 综合分：潜水×2 + 图鉴种数×10 + 章节×15 + 课程星×3
create or replace function public.fd_score(d jsonb) returns int
language sql immutable as $$
  select
      coalesce((d->'stats'->>'dives')::int, 0) * 2
    + case when jsonb_typeof(d->'codex') = 'object'
        then (select count(*)::int * 10 from jsonb_object_keys(d->'codex')) else 0 end
    + case when jsonb_typeof(d->'chapters') = 'object'
        then (select count(*)::int * 15 from jsonb_object_keys(d->'chapters')) else 0 end
    + coalesce((
        select sum((l->>'stars')::int)::int
        from jsonb_each(case when jsonb_typeof(d->'courses') = 'object' then d->'courses' else '{}'::jsonb end) c,
             jsonb_each(case when jsonb_typeof(c.value) = 'object' then c.value else '{}'::jsonb end) l
      ), 0) * 3
$$;

-- 认领/同步：新建或更新本 IP 的档案。p_name/p_data 传 null = 只读不更新对应字段。
create or replace function public.fd_hello(p_name text default null, p_data jsonb default null)
returns jsonb
security definer set search_path = public
language plpgsql as $$
declare vip text := fd_ip(); r public.divers;
begin
  insert into public.divers (ip, name, data, score)
  values (vip,
          coalesce(nullif(trim(p_name), ''), '潜水员'),
          coalesce(p_data, '{}'::jsonb),
          public.fd_score(coalesce(p_data, '{}'::jsonb)))
  on conflict (ip) do update set
    name = coalesce(nullif(trim(p_name), ''), public.divers.name),
    data = coalesce(p_data, public.divers.data),
    score = public.fd_score(coalesce(p_data, public.divers.data)),
    updated_at = now()
  returning * into r;
  return jsonb_build_object('name', r.name, 'data', r.data, 'score', r.score, 'updated_at', r.updated_at);
end $$;

-- 玩家榜：只回公开字段（昵称 + 汇总数字 + 分数），不回档案本体。
create or replace function public.fd_board(p_limit int default 30)
returns table(name text, score int, dives int, codex int, chapters int, stars int, updated_at timestamptz)
security definer set search_path = public
language plpgsql as $$
begin
  return query
    select d.name, d.score,
      coalesce((d.data->'stats'->>'dives')::int, 0),
      case when jsonb_typeof(d.data->'codex') = 'object'
        then (select count(*)::int from jsonb_object_keys(d.data->'codex')) else 0 end,
      case when jsonb_typeof(d.data->'chapters') = 'object'
        then (select count(*)::int from jsonb_object_keys(d.data->'chapters')) else 0 end,
      coalesce((
        select sum((l->>'stars')::int)::int
        from jsonb_each(case when jsonb_typeof(d.data->'courses') = 'object' then d.data->'courses' else '{}'::jsonb end) c,
             jsonb_each(case when jsonb_typeof(c.value) = 'object' then c.value else '{}'::jsonb end) l
      ), 0),
      d.updated_at
    from public.divers d
    order by d.score desc, d.updated_at asc
    limit least(greatest(p_limit, 1), 100);
end $$;

-- 重置：删本 IP 的档案（客户端同时会清 localStorage）
create or replace function public.fd_reset() returns void
security definer set search_path = public
language plpgsql as $$
begin
  delete from public.divers where ip = fd_ip();
end $$;

grant execute on function public.fd_ip() to anon, authenticated;
grant execute on function public.fd_hello(text, jsonb) to anon, authenticated;
grant execute on function public.fd_board(int) to anon, authenticated;
grant execute on function public.fd_reset() to anon, authenticated;
