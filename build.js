const esbuild = require('esbuild');
const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
const buildChrome = args.includes('--chrome') || (!args.includes('--firefox'));
const buildFirefox = args.includes('--firefox') || (!args.includes('--chrome'));
const watch = args.includes('--watch');

const manifestBase = JSON.parse(
  fs.readFileSync(path.join(__dirname, 'src', 'manifest.base.json'), 'utf8')
);

function generateManifest(target) {
  const manifest = { ...manifestBase };

  if (target === 'chrome') {
    manifest.background = { service_worker: 'background.js' };
  } else {
    manifest.background = { scripts: ['background.js'] };
    manifest.browser_specific_settings = {
      gecko: {
        id: 'vimascii@example.com',
        strict_min_version: '109.0'
      }
    };
  }

  return manifest;
}

async function build(target) {
  const outdir = path.join(__dirname, `dist-${target}`);

  fs.mkdirSync(outdir, { recursive: true });

  const manifest = generateManifest(target);
  fs.writeFileSync(
    path.join(outdir, 'manifest.json'),
    JSON.stringify(manifest, null, 2)
  );

  const buildOptions = {
    bundle: true,
    minify: !watch,
    sourcemap: watch ? 'inline' : false,
    target: ['chrome109', 'firefox109'],
  };

  await esbuild.build({
    ...buildOptions,
    entryPoints: [path.join(__dirname, 'src', 'background', 'background.js')],
    outfile: path.join(outdir, 'background.js'),
    format: 'iife',
  });

  await esbuild.build({
    ...buildOptions,
    entryPoints: [path.join(__dirname, 'src', 'content', 'content.js')],
    outfile: path.join(outdir, 'content.js'),
    format: 'iife',
  });

  // Copy CSS
  fs.copyFileSync(
    path.join(__dirname, 'src', 'content', 'content.css'),
    path.join(outdir, 'content.css')
  );

  // Copy icons
  const iconsDir = path.join(__dirname, 'src', 'icons');
  const outIconsDir = path.join(outdir, 'icons');
  fs.mkdirSync(outIconsDir, { recursive: true });
  if (fs.existsSync(iconsDir)) {
    for (const file of fs.readdirSync(iconsDir)) {
      fs.copyFileSync(path.join(iconsDir, file), path.join(outIconsDir, file));
    }
  }

  console.log(`Built dist-${target}/`);
}

async function main() {
  const targets = [];
  if (buildChrome) targets.push('chrome');
  if (buildFirefox) targets.push('firefox');

  for (const target of targets) {
    await build(target);
  }

  if (watch) {
    console.log('Watching for changes...');
    const srcDir = path.join(__dirname, 'src');
    fs.watch(srcDir, { recursive: true }, async (eventType, filename) => {
      if (!filename) return;
      console.log(`Changed: ${filename}`);
      for (const target of targets) {
        try {
          await build(target);
        } catch (e) {
          console.error(`Build error for ${target}:`, e.message);
        }
      }
    });
  }
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
