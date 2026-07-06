import { IncomingMessage, ServerResponse } from 'http';
import * as fs from 'fs';
import * as path from 'path';

/**
 * 客户端自动更新资产的静态文件服务（GET/HEAD /updates/<file>）
 *
 * 目录内容由 CI 发版时 rsync 推送（latest.yml / latest-mac.yml / 安装包 / blockmap），
 * electron-updater 的 generic provider 以 http://<host>:<port+1>/updates 为 feed URL，
 * yml 里的文件字段是相对文件名，会相对本路由解析。
 *
 * 设计约束：
 * - 大文件（exe/dmg 近百 MB）必须流式传输，禁止 readFile 进内存
 * - 差量更新需要单段 Range（客户端配 useMultipleRangeRequest: false，只发单段）；
 *   多段/畸形 Range 直接忽略回 200 全量——electron-updater 差量失败会自动回退全量下载
 * - latest*.yml 必须 no-cache（发新版后客户端立刻看到）；其余文件名含版本号，天然不可变
 */

// 更新资产目录，与 deploy.sh / ecosystem.config.js 的约定保持一致
const UPDATES_DIR = process.env.UPDATES_DIR || '/opt/danmaku-server/updates';

// 文件名白名单：字母数字开头，仅允许字母/数字/._-，天然拒绝路径分隔符、隐藏文件与空名
const SAFE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

// 单段 Range 解析结果：null = 无有效 Range（回 200 全量），'unsatisfiable' = 416
type RangeResult = { start: number; end: number } | null | 'unsatisfiable';

function parseSingleRange(header: string | undefined, size: number): RangeResult {
  if (!header) return null;
  // 只接受单段 bytes=start-end / start- / -N；含逗号（多段）或畸形一律不匹配 → 全量
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!m) return null;
  const [, startStr, endStr] = m;
  if (startStr === '' && endStr === '') return null;
  if (startStr === '') {
    // 后缀形态 bytes=-N：最后 N 字节
    const n = parseInt(endStr, 10);
    if (n === 0 || size === 0) return 'unsatisfiable';
    return { start: Math.max(0, size - n), end: size - 1 };
  }
  const start = parseInt(startStr, 10);
  if (start >= size) return 'unsatisfiable';
  const end = endStr === '' ? size - 1 : Math.min(parseInt(endStr, 10), size - 1);
  if (end < start) return null;
  return { start, end };
}

function notFound(res: ServerResponse) {
  res.writeHead(404);
  res.end('Not Found');
}

/** 判断请求是否归本路由处理（pathname 已剥离 query） */
export function isUpdatesRequest(pathname: string): boolean {
  return pathname.startsWith('/updates/');
}

/** 自包含处理请求：任何异常路径都会结束响应，调用方无需善后 */
export async function serveUpdateFile(
  req: IncomingMessage,
  res: ServerResponse,
  pathname: string
): Promise<void> {
  try {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      notFound(res);
      return;
    }

    // 路径穿越防护双保险：白名单校验文件名 + resolve 后确认仍在目录内。
    // 任何不过都回 404（不回 400，不给探测者反馈）
    let name: string;
    try {
      name = decodeURIComponent(pathname.slice('/updates/'.length));
    } catch {
      notFound(res);
      return;
    }
    if (!SAFE_NAME.test(name)) {
      notFound(res);
      return;
    }
    const baseDir = path.resolve(UPDATES_DIR);
    const filePath = path.resolve(baseDir, name);
    if (!filePath.startsWith(baseDir + path.sep)) {
      notFound(res);
      return;
    }

    let stat: fs.Stats;
    try {
      stat = await fs.promises.stat(filePath);
    } catch {
      notFound(res);
      return;
    }
    if (!stat.isFile()) {
      notFound(res);
      return;
    }

    const size = stat.size;
    const isYml = name.endsWith('.yml');
    const headers: Record<string, string> = {
      'Accept-Ranges': 'bytes',
      'Last-Modified': stat.mtime.toUTCString(),
      'Content-Type': isYml ? 'text/yaml; charset=utf-8' : 'application/octet-stream',
      'Cache-Control': isYml ? 'no-cache' : 'public, max-age=31536000, immutable',
    };

    const range = parseSingleRange(req.headers.range, size);
    if (range === 'unsatisfiable') {
      res.writeHead(416, { ...headers, 'Content-Range': `bytes */${size}` });
      res.end();
      return;
    }

    let status = 200;
    let start = 0;
    let end = size - 1;
    if (range) {
      status = 206;
      start = range.start;
      end = range.end;
      headers['Content-Range'] = `bytes ${start}-${end}/${size}`;
    }
    headers['Content-Length'] = String(end - start + 1);

    // HEAD 或空文件：只回头，不开流（size 为 0 时 end=-1，createReadStream 会抛参数错）
    if (req.method === 'HEAD' || size === 0) {
      res.writeHead(status, headers);
      res.end();
      return;
    }

    res.writeHead(status, headers);
    const stream = fs.createReadStream(filePath, { start, end });
    stream.on('error', (err) => {
      console.error(`[Updates] 读取文件失败 ${name}:`, err.message);
      res.destroy();
    });
    // 客户端中断下载时及时关流，防文件句柄泄漏
    res.on('close', () => stream.destroy());
    stream.pipe(res);
  } catch (err) {
    console.error('[Updates] 处理请求异常:', err);
    if (!res.headersSent) {
      notFound(res);
    } else {
      res.destroy();
    }
  }
}
