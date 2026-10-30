// 저장소: 학생 지원 정보·입력 단계를 저장 (GIEC 상담 봇과 같은 방식, 키 앞에 jobbot: 이 붙어 섞이지 않음)
//
// Vercel은 요청이 끝나면 메모리가 사라지기 때문에, 외부 저장소가 필요합니다.
// Vercel 에서 연결한 저장소를 자동으로 찾아서 씁니다:
//   1) Redis (Redis Cloud)  → REDIS_URL
//   2) Upstash for Redis    → UPSTASH_REDIS_REST_URL / KV_REST_API_URL
// 아무것도 없으면(내 컴퓨터 테스트) 메모리에 저장합니다.

const PREFIX = "jobbot:";

// ── Redis Cloud (REDIS_URL) ──
function redisBackend(url) {
  let clientPromise = null;
  const client = () =>
    (clientPromise ??= (async () => {
      const { createClient } = await import("redis");
      const c = createClient({ url });
      c.on("error", (err) => console.error("Redis 오류:", err.message));
      await c.connect();
      return c;
    })().catch((err) => {
      clientPromise = null; // 실패하면 다음 요청 때 다시 시도
      throw err;
    }));

  return {
    get: async (k) => (await client()).get(k),
    set: async (k, v, ttl) => (await client()).set(k, v, ttl ? { EX: ttl } : undefined),
    del: async (k) => (await client()).del(k),
    setNX: async (k, v, ttl) => (await (await client()).set(k, v, { NX: true, EX: ttl })) === "OK",
    mget: async (ks) => (ks.length ? (await client()).mGet(ks) : []),
    sadd: async (k, m) => (await client()).sAdd(k, m),
    srem: async (k, m) => (await client()).sRem(k, m),
    smembers: async (k) => (await client()).sMembers(k),
    rpush: async (k, v, ttl) => {
      const c = await client();
      await c.rPush(k, v);
      if (ttl) await c.expire(k, ttl);
    },
    lrange: async (k) => (await client()).lRange(k, 0, -1),
    incr: async (k, ttl) => {
      const c = await client();
      const n = await c.incr(k);
      if (ttl && n === 1) await c.expire(k, ttl);
      return n;
    },
  };
}

// ── Upstash (REST 방식) ──
function upstashBackend(url, token) {
  const call = async (command) => {
    const res = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify(command),
    });
    if (!res.ok) throw new Error(`Upstash 오류 ${res.status}: ${await res.text()}`);
    return (await res.json()).result;
  };
  return {
    get: (k) => call(["GET", k]),
    set: (k, v, ttl) => call(ttl ? ["SET", k, v, "EX", String(ttl)] : ["SET", k, v]),
    del: (k) => call(["DEL", k]),
    setNX: async (k, v, ttl) => (await call(["SET", k, v, "NX", "EX", String(ttl)])) === "OK",
    mget: async (ks) => (ks.length ? call(["MGET", ...ks]) : []),
    sadd: (k, m) => call(["SADD", k, m]),
    srem: (k, m) => call(["SREM", k, m]),
    smembers: (k) => call(["SMEMBERS", k]),
    rpush: async (k, v, ttl) => {
      await call(["RPUSH", k, v]);
      if (ttl) await call(["EXPIRE", k, String(ttl)]);
    },
    lrange: (k) => call(["LRANGE", k, "0", "-1"]),
    incr: async (k, ttl) => {
      const n = await call(["INCR", k]);
      if (ttl && n === 1) await call(["EXPIRE", k, String(ttl)]);
      return n;
    },
  };
}

// ── 메모리 (내 컴퓨터 테스트용) ──
function memoryBackend() {
  const map = new Map();
  const alive = (k) => {
    const e = map.get(k);
    if (e && e.exp && e.exp < Date.now()) map.delete(k);
    return map.get(k);
  };
  return {
    get: async (k) => alive(k)?.v ?? null,
    set: async (k, v, ttl) => void map.set(k, { v, exp: ttl ? Date.now() + ttl * 1000 : 0 }),
    del: async (k) => void map.delete(k),
    setNX: async (k, v, ttl) => {
      if (alive(k)) return false;
      map.set(k, { v, exp: Date.now() + ttl * 1000 });
      return true;
    },
    mget: async (ks) => ks.map((k) => alive(k)?.v ?? null),
    sadd: async (k, m) => {
      const e = alive(k) ?? { v: new Set(), exp: 0 };
      e.v.add(String(m));
      map.set(k, e);
    },
    srem: async (k, m) => void alive(k)?.v.delete(String(m)),
    smembers: async (k) => [...(alive(k)?.v ?? [])],
    rpush: async (k, v) => {
      const e = alive(k) ?? { v: [], exp: 0 };
      e.v.push(v);
      map.set(k, e);
    },
    lrange: async (k) => [...(alive(k)?.v ?? [])],
    incr: async (k, ttl) => {
      const e = alive(k) ?? { v: "0", exp: ttl ? Date.now() + ttl * 1000 : 0 };
      e.v = String(Number(e.v) + 1);
      map.set(k, e);
      return Number(e.v);
    },
  };
}

let backend = null;
function getBackend() {
  if (backend) return backend;
  if (process.env.REDIS_URL) return (backend = redisBackend(process.env.REDIS_URL));
  const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
  if (url && token) return (backend = upstashBackend(url, token));
  if (process.env.VERCEL) {
    console.error("⚠️ 저장소(Redis)가 연결되지 않았습니다. Vercel → Storage 에서 연결 후 Redeploy 하세요.");
  }
  return (backend = memoryBackend());
}

// 값은 자동으로 JSON 변환
export const kv = {
  get: async (key) => {
    const v = await getBackend().get(PREFIX + key);
    return v == null ? undefined : JSON.parse(v);
  },
  set: (key, value, ttlSec) => getBackend().set(PREFIX + key, JSON.stringify(value), ttlSec),
  del: (key) => getBackend().del(PREFIX + key),
  // 키가 없을 때만 저장 (동시에 두 번 실행되는 것 방지용). 성공하면 true
  setNX: (key, value, ttlSec) => getBackend().setNX(PREFIX + key, JSON.stringify(value), ttlSec),
  // 여러 개 한 번에 읽기
  mget: async (keys) => {
    const out = [];
    for (let i = 0; i < keys.length; i += 100) {
      const vs = await getBackend().mget(keys.slice(i, i + 100).map((k) => PREFIX + k));
      out.push(...vs.map((v) => (v == null ? undefined : JSON.parse(v))));
    }
    return out;
  },
  // 숫자 1 올리기 (미니앱 방문 수 등)
  incr: (key, ttlSec) => getBackend().incr(PREFIX + key, ttlSec),
  // 집합 (학생 id 목록 등)
  sadd: (key, member) => getBackend().sadd(PREFIX + key, String(member)),
  srem: (key, member) => getBackend().srem(PREFIX + key, String(member)),
  smembers: (key) => getBackend().smembers(PREFIX + key),
  // 목록 (하루치 기록 등)
  rpush: (key, value, ttlSec) => getBackend().rpush(PREFIX + key, JSON.stringify(value), ttlSec),
  lrange: async (key) => (await getBackend().lrange(PREFIX + key)).map((v) => JSON.parse(v)),
};
