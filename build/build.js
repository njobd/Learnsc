// build/build.js
const esbuild = require('esbuild');
const path = require('path');

(async () => {
  try {
    await esbuild.build({
      entryPoints: [path.join(__dirname, '..', 'src', 'bootstrap.js')],
      bundle: true,
      minify: true,
      outfile: path.join(__dirname, '..', 'dist', 'bootstrap.js'),
      platform: 'browser',
      define: {
        'process.env.SUPABASE_URL': JSON.stringify(process.env.SUPABASE_URL || ''),
        'process.env.SUPABASE_ANON_KEY': JSON.stringify(process.env.SUPABASE_ANON_KEY || '')
      }
    });
    console.log('✅ Built dist/bootstrap.js');
  } catch (err) {
    console.error('❌ Build failed:', err);
    process.exit(1);
  }
})();
