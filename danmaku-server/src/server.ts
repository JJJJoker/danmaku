// 生产入口（PM2 ecosystem 与 npm start 都指向 dist/server.js）：import 即无条件启动。
// 真实实现在 app.ts，测试只 import app.ts——本文件绝不能被测试或其他模块 import。
//
// 为什么没有 require.main / 环境变量守卫：PM2 不同版本、cluster/fork 不同模式下
// require.main 的指向与 pm_id 等环境注入行为不一致（2026-07-07 部署事故：守卫在服务器的
// PM2 下不触发，进程 online 但服务静默不启动、无端口监听）。入口与实现分文件后无需任何探测。
import { DanmakuServer } from './app';

new DanmakuServer();
