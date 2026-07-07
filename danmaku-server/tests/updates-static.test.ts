// updates 静态分发集成测试：经真实 HTTP 端口请求，UPDATES_DIR 指向临时 fixture 目录
// （updates-static.ts 的目录是调用时求值，import 后设置 env 即生效）
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { DanmakuServer } from '../src/server';
import { startServer } from './helpers';

let server: DanmakuServer;
let base: string;
let fixtureDir: string;

const YML_CONTENT = 'version: 1.5.1\nfiles:\n  - url: app-setup-1.5.1.exe\n';
const EXE_CONTENT = Buffer.from('0123456789abcdef'); // 16 字节，方便断言 Range 切片

beforeAll(async () => {
  fixtureDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'danmaku-updates-'));
  await fs.promises.writeFile(path.join(fixtureDir, 'latest.yml'), YML_CONTENT);
  await fs.promises.writeFile(path.join(fixtureDir, 'app-setup-1.5.1.exe'), EXE_CONTENT);
  await fs.promises.writeFile(path.join(fixtureDir, 'empty.bin'), '');
  process.env.UPDATES_DIR = fixtureDir;

  server = await startServer();
  base = `http://127.0.0.1:${server.getHttpPort()}`;
});

afterAll(async () => {
  delete process.env.UPDATES_DIR;
  await server.close();
  await fs.promises.rm(fixtureDir, { recursive: true, force: true });
});

describe('updates 静态分发', () => {
  it('GET yml 文件返回 200 全量，Content-Type 为 yaml 且 no-cache', async () => {
    const res = await fetch(`${base}/updates/latest.yml`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('text/yaml; charset=utf-8');
    expect(res.headers.get('cache-control')).toBe('no-cache');
    expect(await res.text()).toBe(YML_CONTENT);
  });

  it('GET 安装包返回 200，octet-stream 且长缓存 immutable', async () => {
    const res = await fetch(`${base}/updates/app-setup-1.5.1.exe`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/octet-stream');
    expect(res.headers.get('cache-control')).toContain('immutable');
    expect(res.headers.get('accept-ranges')).toBe('bytes');
    expect(Buffer.from(await res.arrayBuffer())).toEqual(EXE_CONTENT);
  });

  it('单段 Range 返回 206 与正确的 Content-Range 切片', async () => {
    const res = await fetch(`${base}/updates/app-setup-1.5.1.exe`, {
      headers: { Range: 'bytes=4-7' },
    });
    expect(res.status).toBe(206);
    expect(res.headers.get('content-range')).toBe('bytes 4-7/16');
    expect(res.headers.get('content-length')).toBe('4');
    expect(await res.text()).toBe('4567');
  });

  it('后缀 Range bytes=-N 返回最后 N 字节', async () => {
    const res = await fetch(`${base}/updates/app-setup-1.5.1.exe`, {
      headers: { Range: 'bytes=-4' },
    });
    expect(res.status).toBe(206);
    expect(res.headers.get('content-range')).toBe('bytes 12-15/16');
    expect(await res.text()).toBe('cdef');
  });

  it('起点越界返回 416 并附 Content-Range bytes */size', async () => {
    const res = await fetch(`${base}/updates/app-setup-1.5.1.exe`, {
      headers: { Range: 'bytes=999-' },
    });
    expect(res.status).toBe(416);
    expect(res.headers.get('content-range')).toBe('bytes */16');
  });

  it('多段与畸形 Range 回退 200 全量（electron-updater 差量失败自动回退全量）', async () => {
    for (const range of ['bytes=0-1,4-5', 'bytes=abc', 'chunks=0-1']) {
      const res = await fetch(`${base}/updates/app-setup-1.5.1.exe`, {
        headers: { Range: range },
      });
      expect(res.status, `Range: ${range}`).toBe(200);
      expect((await res.arrayBuffer()).byteLength).toBe(16);
    }
  });

  it('路径穿越与非法文件名一律 404', async () => {
    // %2e%2e%2f = "../"，编码绕过 URL 归一化后由白名单拦截
    for (const p of [
      '/updates/%2e%2e%2fpackage.json',
      '/updates/.hidden',
      '/updates/no-such-file.exe',
      '/updates/',
    ]) {
      const res = await fetch(`${base}${p}`);
      expect(res.status, p).toBe(404);
    }
  });

  it('HEAD 只回响应头不回响应体', async () => {
    const res = await fetch(`${base}/updates/app-setup-1.5.1.exe`, { method: 'HEAD' });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-length')).toBe('16');
    expect((await res.arrayBuffer()).byteLength).toBe(0);
  });

  it('非 GET/HEAD 方法返回 404', async () => {
    const res = await fetch(`${base}/updates/latest.yml`, { method: 'POST' });
    expect(res.status).toBe(404);
  });

  it('空文件返回 200 且 Content-Length 为 0（不开流）', async () => {
    const res = await fetch(`${base}/updates/empty.bin`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-length')).toBe('0');
    expect((await res.arrayBuffer()).byteLength).toBe(0);
  });
});
