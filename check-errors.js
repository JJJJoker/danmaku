// 检查connectionStore是否有运行时错误
const fs = require('fs');
const path = require('path');

console.log('=== 检查客户端代码 ===\n');

// 1. 检查文件是否存在
const storePath = path.join(__dirname, 'src', 'renderer', 'stores', 'connectionStore.ts');
if (fs.existsSync(storePath)) {
  console.log('✓ connectionStore.ts 存在');
  
  const content = fs.readFileSync(storePath, 'utf-8');
  
  // 2. 检查是否有明显的语法问题
  if (content.includes('ServerConnection')) {
    console.log('✓ 包含 ServerConnection 引用');
  } else {
    console.log('✗ 未找到 ServerConnection 引用');
  }
  
  if (content.includes('_setupServerCallbacks')) {
    console.log('✓ 包含 _setupServerCallbacks 方法');
  } else {
    console.log('✗ 未找到 _setupServerCallbacks 方法');
  }
  
  if (content.includes('connectionMode')) {
    console.log('✓ 包含 connectionMode 配置');
  } else {
    console.log('✗ 未找到 connectionMode 配置');
  }
  
  // 3. 检查导入语句
  if (content.includes("import { peerService, ServerConnection")) {
    console.log('✓ 正确导入 ServerConnection');
  } else {
    console.log('✗ ServerConnection 导入可能有问题');
  }
  
} else {
  console.log('✗ connectionStore.ts 不存在');
}

console.log('\n=== 检查 peerService ===\n');

const peerServicePath = path.join(__dirname, 'src', 'renderer', 'services', 'peerService.ts');
if (fs.existsSync(peerServicePath)) {
  console.log('✓ peerService.ts 存在');
  
  const content = fs.readFileSync(peerServicePath, 'utf-8');
  
  if (content.includes('class ServerConnection')) {
    console.log('✓ ServerConnection 类已定义');
    
    // 检查SERVER_URL
    const urlMatch = content.match(/SERVER_URL\s*=\s*['"]([^'"]+)['"]/);
    if (urlMatch) {
      console.log(`✓ SERVER_URL: ${urlMatch[1]}`);
    } else {
      console.log('✗ 未找到 SERVER_URL');
    }
  } else {
    console.log('✗ ServerConnection 类未定义');
  }
} else {
  console.log('✗ peerService.ts 不存在');
}

console.log('\n=== 检查完成 ===');
