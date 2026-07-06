#!/usr/bin/env node
/**
 * 版本号统一管理脚本
 *
 * 发版时版本号出现在 4 处，必须保持一致（CI 的 release.yml 会用 --check 强制校验）：
 *   1. package.json          version 字段（release.yml 以它为发版依据）
 *   2. package-lock.json     根 version + packages[""].version
 *   3. README.md             「版本与下载」区块的当前版本行
 *   4. ControlPanel.tsx      「说明」Tab 的静态更新日志（需要人工填写内容）
 *
 * 用法：
 *   node scripts/bump-version.js <x.y.z | patch | minor | major>   # 升版本，四处同步更新
 *   node scripts/bump-version.js --check                           # 一致性校验（CI / 提交前）
 *
 * bump 后更新日志里会插入带 "TODO: 填写" 占位的新条目，填完真实内容后 --check 才会通过。
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const PKG_PATH = path.join(ROOT, 'package.json');
const LOCK_PATH = path.join(ROOT, 'package-lock.json');
const README_PATH = path.join(ROOT, 'README.md');
const PANEL_PATH = path.join(ROOT, 'src', 'renderer', 'components', 'ControlPanel.tsx');

const README_VERSION_RE = /(- 当前版本：\*\*v)(\d+\.\d+\.\d+)(\*\*)/;
const CHANGELOG_ANCHOR = '<h4>📋 更新日志</h4>';
const TODO_MARK = 'TODO: 填写';

function fail(msg) {
  console.error(`❌ ${msg}`);
  process.exit(1);
}

function parseVersion(v) {
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(v);
  if (!m) return null;
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

function compareVersion(a, b) {
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return a[i] - b[i];
  }
  return 0;
}

function readJson(p) {
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function writeJson(p, obj) {
  fs.writeFileSync(p, JSON.stringify(obj, null, 2) + '\n');
}

// ========== --check：一致性校验 ==========
function check() {
  const problems = [];
  const pkg = readJson(PKG_PATH);
  const version = pkg.version;

  if (!parseVersion(version)) {
    fail(`package.json 的 version "${version}" 不是合法的 x.y.z 格式`);
  }

  const lock = readJson(LOCK_PATH);
  if (lock.version !== version) {
    problems.push(`package-lock.json 根 version 是 "${lock.version}"，与 package.json 的 "${version}" 不一致（运行 npm install 或本脚本 bump 修正）`);
  }
  if (lock.packages && lock.packages[''] && lock.packages[''].version !== version) {
    problems.push(`package-lock.json 的 packages[""].version 是 "${lock.packages[''].version}"，与 "${version}" 不一致`);
  }

  const readme = fs.readFileSync(README_PATH, 'utf8');
  const readmeMatch = README_VERSION_RE.exec(readme);
  if (!readmeMatch) {
    problems.push('README.md 找不到「- 当前版本：**vX.Y.Z**」行（版本与下载区块被改动了？）');
  } else if (readmeMatch[2] !== version) {
    problems.push(`README.md 当前版本是 v${readmeMatch[2]}，与 package.json 的 v${version} 不一致`);
  }

  const panel = fs.readFileSync(PANEL_PATH, 'utf8');
  if (!panel.includes(`cp-changelog-version">v${version}<`)) {
    problems.push(`ControlPanel.tsx 更新日志缺少 v${version} 条目（「说明」Tab 用户可见，发版必须补）`);
  }
  if (panel.includes(TODO_MARK)) {
    problems.push(`ControlPanel.tsx 更新日志还有 "${TODO_MARK}" 占位，请填写真实更新内容`);
  }

  if (problems.length) {
    for (const p of problems) console.error(`❌ ${p}`);
    process.exit(1);
  }
  console.log(`✅ 版本一致性校验通过：v${version}（package.json / package-lock.json / README.md / 更新日志）`);
}

// ========== bump：四处同步升版本 ==========
function bump(arg) {
  const pkg = readJson(PKG_PATH);
  const cur = parseVersion(pkg.version);
  if (!cur) fail(`package.json 的 version "${pkg.version}" 不是合法的 x.y.z 格式`);

  let next;
  if (arg === 'patch') next = [cur[0], cur[1], cur[2] + 1];
  else if (arg === 'minor') next = [cur[0], cur[1] + 1, 0];
  else if (arg === 'major') next = [cur[0] + 1, 0, 0];
  else {
    next = parseVersion(arg);
    if (!next) fail(`参数 "${arg}" 既不是 patch/minor/major，也不是合法的 x.y.z 版本号`);
    if (compareVersion(next, cur) <= 0) {
      fail(`新版本 ${arg} 必须大于当前版本 ${pkg.version}`);
    }
  }
  const newVersion = next.join('.');

  // 1. package.json
  pkg.version = newVersion;
  writeJson(PKG_PATH, pkg);

  // 2. package-lock.json（根 version + packages[""].version）
  const lock = readJson(LOCK_PATH);
  lock.version = newVersion;
  if (lock.packages && lock.packages['']) lock.packages[''].version = newVersion;
  writeJson(LOCK_PATH, lock);

  // 3. README.md 当前版本行
  const readme = fs.readFileSync(README_PATH, 'utf8');
  if (!README_VERSION_RE.test(readme)) {
    fail('README.md 找不到「- 当前版本：**vX.Y.Z**」行，无法更新');
  }
  fs.writeFileSync(README_PATH, readme.replace(README_VERSION_RE, `$1${newVersion}$3`));

  // 4. ControlPanel.tsx 更新日志：插入带 TODO 占位的新条目（已存在则跳过）
  let panel = fs.readFileSync(PANEL_PATH, 'utf8');
  if (panel.includes(`cp-changelog-version">v${newVersion}<`)) {
    console.log(`ℹ️ 更新日志已有 v${newVersion} 条目，跳过插入`);
  } else {
    const anchorIdx = panel.indexOf(CHANGELOG_ANCHOR);
    if (anchorIdx < 0) fail(`ControlPanel.tsx 找不到更新日志锚点 ${CHANGELOG_ANCHOR}`);
    const entryIdx = panel.indexOf('<div className="cp-changelog-entry">', anchorIdx);
    if (entryIdx < 0) fail('ControlPanel.tsx 更新日志锚点后找不到现有条目，无法确定插入位置');
    // 取现有首条的缩进，保证插入后格式一致
    const lineStart = panel.lastIndexOf('\n', entryIdx) + 1;
    const indent = panel.slice(lineStart, entryIdx);
    const template =
      `${indent}<div className="cp-changelog-entry">\n` +
      `${indent}  <span className="cp-changelog-version">v${newVersion}</span>\n` +
      `${indent}  <p><strong>✨ 新功能</strong></p>\n` +
      `${indent}  <ul>\n` +
      `${indent}    <li>${TODO_MARK}本版本更新内容</li>\n` +
      `${indent}  </ul>\n` +
      `${indent}</div>\n\n`;
    panel = panel.slice(0, lineStart) + template + panel.slice(lineStart);
    fs.writeFileSync(PANEL_PATH, panel);
  }

  console.log(`✅ 版本已从 v${cur.join('.')} 升到 v${newVersion}，已同步 package.json / package-lock.json / README.md / 更新日志`);
  console.log('');
  console.log('接下来：');
  console.log(`  1. 编辑 src/renderer/components/ControlPanel.tsx，把更新日志里的 "${TODO_MARK}" 占位替换成真实内容`);
  console.log('  2. node scripts/bump-version.js --check 确认一致性');
  console.log('  3. npm run build:vite 验证构建，提交并合入 main 即自动发版');
}

// ========== 入口 ==========
const arg = process.argv[2];
if (!arg || arg === '-h' || arg === '--help') {
  console.log('用法：node scripts/bump-version.js <x.y.z | patch | minor | major>  或  --check');
  process.exit(arg ? 0 : 1);
}
if (arg === '--check') check();
else bump(arg);
