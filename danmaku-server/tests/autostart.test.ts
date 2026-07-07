// 入口自启动判定（shouldAutoStart）单元测试。
// 复现 2026-07-07 部署事故：PM2（cluster/fork 模式都一样）的入口是它的 ProcessContainer
// 包装器，require.main 永远不是 server 模块——旧守卫只查 require.main，导致 PM2 下
// 服务静默不启动：进程 online 但无端口监听，部署自检 /stats 连接被拒。
import { describe, it, expect } from 'vitest';
import { shouldAutoStart } from '../src/server';

// shouldAutoStart 对 NodeModule 只做恒等比较，用带 id 的对象假装即可
const fakeModule = (id: string) => ({ id } as unknown as NodeModule);

describe('shouldAutoStart 入口判定', () => {
  const serverModule = fakeModule('dist/server.js');

  it('node 直跑：require.main 即本模块 → 启动', () => {
    expect(shouldAutoStart(serverModule, serverModule, {})).toBe(true);
  });

  it('被测试/其他模块 import 且无 PM2 环境 → 不启动（防抢占真实端口）', () => {
    expect(shouldAutoStart(fakeModule('vitest-entry'), serverModule, {})).toBe(false);
  });

  it('require.main 为 undefined 且无 PM2 环境 → 不启动', () => {
    expect(shouldAutoStart(undefined, serverModule, {})).toBe(false);
  });

  it('PM2 托管（事故复现）：require.main 是 ProcessContainer 包装器，凭 pm_id 识别 → 启动', () => {
    const pm2Wrapper = fakeModule('/usr/lib/node_modules/pm2/lib/ProcessContainer.js');
    expect(shouldAutoStart(pm2Wrapper, serverModule, { pm_id: '0' })).toBe(true);
  });

  it('pm_id 存在即算 PM2 环境（空字符串也算，只看变量是否注入）', () => {
    expect(shouldAutoStart(undefined, serverModule, { pm_id: '' })).toBe(true);
  });
});
