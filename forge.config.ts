import type { ForgeConfig } from '@electron-forge/shared-types';
import { VitePlugin } from '@electron-forge/plugin-vite';

const config: ForgeConfig = {
  packagerConfig: {
    asar: true,
    name: '云弹一下',
    executableName: 'yundan',
    icon: './assets/icon',
    extraResource: ['./assets'],
    electronVersion: require('./package.json').devDependencies.electron.replace('^', ''),
    quiet: false, // 显示详细日志
    download: {
      mirrorOptions: {
        mirror: 'https://npmmirror.com/mirrors/electron/',
        platform: 'win32',
        arch: 'x64'
      },
      cache: './electron-cache' // 使用本地缓存
    }
  },
  rebuildConfig: {},
  makers: [
    {
      name: '@electron-forge/maker-zip',
      platforms: ['win32', 'darwin'],
    },
    {
      name: '@electron-forge/maker-squirrel',
      platforms: ['win32'],
      enabled: false, // 暂时禁用以排查网络问题
      config: {
        name: 'DanmakuHelper',
        setupExe: 'DanmakuHelper-Setup.exe',
      },
    },
    {
      name: '@electron-forge/maker-dmg',
      platforms: ['darwin'],
      enabled: process.platform === 'darwin',
      config: {},
    },
  ],
  plugins: [
    new VitePlugin({
      build: [
        { entry: 'src/main/main.ts', config: 'vite.main.config.ts', target: 'main' },
        { entry: 'src/main/preload.ts', config: 'vite.preload.config.ts', target: 'preload' },
      ],
      renderer: [
        { name: 'main_window', config: 'vite.renderer.config.ts' },
      ],
    }),
  ],
};

export default config;
