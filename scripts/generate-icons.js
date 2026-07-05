import sharp from 'sharp';
import pngToIco from 'png-to-ico';
import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ICONS_DIR = path.join(process.cwd(), 'assets');

async function generateIcons() {
  console.log('Starting icon generation...');
  
  // Windows ICO: 多尺寸（16, 32, 48, 256）
  const sizes = [16, 32, 48, 256];
  
  for (const size of sizes) {
    const outputPath = path.join(ICONS_DIR, `icon_${size}.png`);
    await sharp(path.join(ICONS_DIR, 'icon_1024.png'))
      .resize(size, size)
      .toFile(outputPath);
    console.log(`Generated ${outputPath}`);
  }
  
  // 生成 Windows ICO 文件（使用多个尺寸的 PNG）
  const icoOutputPath = path.join(ICONS_DIR, 'icon.ico');
  const icoBuffer = await pngToIco([
    path.join(ICONS_DIR, 'icon_16.png'),
    path.join(ICONS_DIR, 'icon_32.png'),
    path.join(ICONS_DIR, 'icon_48.png'),
    path.join(ICONS_DIR, 'icon_256.png'),
  ]);
  await fs.writeFile(icoOutputPath, icoBuffer);
  console.log(`Generated ${icoOutputPath}`);
  
  // macOS ICNS: electron-builder 支持直接使用 PNG 作为图标
  // 但为了最佳兼容性，建议使用在线工具转换为 ICNS 格式
  console.log(`Note: For best macOS compatibility, convert icon_1024.png to ICNS using:`);
  console.log(`  - Online: https://convertio.co/png-icns/`);
  console.log(`  - Or use Apple's iconutil tool on macOS`);
  
  console.log('\nPNG icons and Windows ICO generated successfully!');
}

generateIcons().catch(console.error);
