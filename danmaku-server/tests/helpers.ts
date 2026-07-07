// 集成测试辅助：起临时端口服务器 + 真实 ws 客户端（带消息队列）
import { WebSocket } from 'ws';
import { DanmakuServer, DanmakuServerOptions } from '../src/server';

/**
 * 启动一个测试服务器：port 0 由内核分配临时端口（避免 CI 端口冲突），
 * 客户端 IP 从 x-test-ip 请求头读取——生产按 remoteAddress 分配 userId，
 * 测试里所有连接都来自 127.0.0.1，必须经此注入缝模拟多 IP 多用户。
 */
export async function startServer(options: DanmakuServerOptions = {}): Promise<DanmakuServer> {
  const server = new DanmakuServer({
    port: 0,
    httpPort: 0,
    resolveClientIp: (req) => String(req.headers['x-test-ip'] ?? '127.0.0.1'),
    dbPath: ':memory:', // 默认不落盘；持久化测试显式传临时文件路径
    ...options,
  });
  await server.ready();
  return server;
}

export interface TestClient {
  ws: WebSocket;
  send(msg: unknown): void;
  /** 取下一条匹配类型的消息（不传 type 则任意类型）；超时报错并附上已收到的消息类型 */
  next(type?: string | string[], timeoutMs?: number): Promise<any>;
  /** 断言从调用时刻起 ms 内不会收到指定类型的消息（不传 type 则任意新消息都算违例）；此前队列里的旧消息不算 */
  expectSilence(type?: string, ms?: number): Promise<void>;
  /** 清空已收到但未消费的消息队列（join 会残留 user-list 广播，断言后续广播前先清） */
  clear(): void;
  close(): void;
}

interface Waiter {
  types: string[] | null;
  resolve: (msg: any) => void;
  timer: NodeJS.Timeout;
}

/** 连接测试服务器并等待 open；testIp 经 x-test-ip 头传给 resolveClientIp 注入缝 */
export function connect(port: number, opts: { testIp?: string } = {}): Promise<TestClient> {
  const ws = new WebSocket(`ws://127.0.0.1:${port}`, {
    headers: opts.testIp ? { 'x-test-ip': opts.testIp } : {},
  });

  const queue: any[] = [];
  const waiters: Waiter[] = [];

  ws.on('message', (data) => {
    const msg = JSON.parse(data.toString());
    const idx = waiters.findIndex((w) => !w.types || w.types.includes(msg.type));
    if (idx >= 0) {
      const [w] = waiters.splice(idx, 1);
      clearTimeout(w.timer);
      w.resolve(msg);
    } else {
      queue.push(msg);
    }
  });

  const client: TestClient = {
    ws,
    send: (msg) => ws.send(JSON.stringify(msg)),
    next: (type, timeoutMs = 3000) => {
      const types = type === undefined ? null : Array.isArray(type) ? type : [type];
      const qIdx = queue.findIndex((m) => !types || types.includes(m.type));
      if (qIdx >= 0) return Promise.resolve(queue.splice(qIdx, 1)[0]);
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          const i = waiters.indexOf(waiter);
          if (i >= 0) waiters.splice(i, 1);
          reject(new Error(
            `等待消息超时: ${types?.join('/') ?? '任意'}（队列中已有: ${queue.map((m) => m.type).join(', ') || '无'}）`
          ));
        }, timeoutMs);
        const waiter: Waiter = { types, resolve: (m) => { clearTimeout(timer); resolve(m); }, timer };
        waiters.push(waiter);
      });
    },
    expectSilence: (type, ms = 200) => {
      const seenBefore = new Set(queue); // 只检查调用之后新到的消息
      return new Promise<void>((resolve, reject) => {
        setTimeout(() => {
          const hit = queue.find((m) => !seenBefore.has(m) && (!type || m.type === type));
          if (hit) {
            reject(new Error(`预期静默却收到消息: ${JSON.stringify(hit)}`));
          } else {
            resolve();
          }
        }, ms);
      });
    },
    clear: () => {
      queue.length = 0;
    },
    close: () => ws.close(),
  };

  return new Promise((resolve, reject) => {
    ws.once('open', () => resolve(client));
    ws.once('error', reject);
  });
}

/** 发送 join 并返回 joinSuccess / joinError 之一 */
export async function join(
  client: TestClient,
  roomId: string,
  payload: { userId?: string; username?: string; password?: string; isCreate?: boolean } = {}
): Promise<any> {
  client.send({
    type: 'join',
    payload: {
      roomId,
      userId: payload.userId ?? '',
      username: payload.username ?? 'tester',
      ...(payload.password !== undefined ? { password: payload.password } : {}),
      ...(payload.isCreate !== undefined ? { isCreate: payload.isCreate } : {}),
    },
  });
  return client.next(['joinSuccess', 'joinError']);
}

/** 读取 /stats 管理接口 */
export async function fetchStats(httpPort: number): Promise<any> {
  const res = await fetch(`http://127.0.0.1:${httpPort}/stats`);
  return res.json();
}

/** 轮询等待条件成立（如 leave 在服务器端生效），替代裸 sleep */
export async function waitUntil(
  cond: () => boolean | Promise<boolean>,
  timeoutMs = 3000,
  intervalMs = 20
): Promise<void> {
  const start = Date.now();
  while (!(await cond())) {
    if (Date.now() - start > timeoutMs) throw new Error('waitUntil 等待条件超时');
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}
