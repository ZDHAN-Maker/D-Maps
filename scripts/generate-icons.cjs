const fs = require('fs');
const { chromium } = require('@playwright/test');

const svgIcon = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512" role="img" aria-label="D'Maps">
  <defs>
    <linearGradient id="bgGrad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#4C0519" />
      <stop offset="45%" stop-color="#881337" />
      <stop offset="100%" stop-color="#9F1239" />
    </linearGradient>
    <linearGradient id="foldLeft" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#FDA4AF" />
      <stop offset="100%" stop-color="#FB7185" />
    </linearGradient>
    <linearGradient id="foldCenter" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#F43F5E" />
      <stop offset="100%" stop-color="#E11D48" />
    </linearGradient>
    <linearGradient id="foldRight" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#BE123C" />
      <stop offset="100%" stop-color="#881337" />
    </linearGradient>
    <linearGradient id="pinGrad" x1="0%" y1="0%" x2="0%" y2="100%">
      <stop offset="0%" stop-color="#FFFFFF" />
      <stop offset="100%" stop-color="#FFE4E6" />
    </linearGradient>
    <linearGradient id="pinHighlight" x1="0%" y1="0%" x2="0%" y2="100%">
      <stop offset="0%" stop-color="#FFFFFF" stop-opacity="0.8" />
      <stop offset="100%" stop-color="#FFFFFF" stop-opacity="0" />
    </linearGradient>
    <linearGradient id="routeGrad" x1="0%" y1="100%" x2="100%" y2="0%">
      <stop offset="0%" stop-color="#34D399" />
      <stop offset="50%" stop-color="#10B981" />
      <stop offset="100%" stop-color="#059669" />
    </linearGradient>
    <filter id="cardShadow" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="0" dy="16" stdDeviation="20" flood-color="#2A020D" flood-opacity="0.55" />
    </filter>
    <filter id="pinShadow" x="-30%" y="-20%" width="160%" height="160%">
      <feDropShadow dx="0" dy="12" stdDeviation="14" flood-color="#2A020D" flood-opacity="0.5" />
    </filter>
  </defs>

  <!-- App icon squircle background in luxury Maroon -->
  <rect width="512" height="512" rx="116" fill="url(#bgGrad)" />

  <!-- Subtle contour map grid lines in background -->
  <g opacity="0.15" stroke="#FFFFFF" stroke-width="2" fill="none">
    <ellipse cx="256" cy="256" rx="220" ry="160" />
    <ellipse cx="256" cy="256" rx="170" ry="120" />
    <ellipse cx="256" cy="256" rx="120" ry="80" />
    <path d="M 0 160 Q 256 220 512 160" />
    <path d="M 0 340 Q 256 280 512 340" />
    <path d="M 160 0 Q 220 256 160 512" />
    <path d="M 340 0 Q 280 256 340 512" />
  </g>

  <!-- 3D Folded Map Base with modern shadow -->
  <g filter="url(#cardShadow)">
    <!-- Fold 1 (Left pane) -->
    <path d="M 92 388 L 196 352 L 196 208 L 92 244 Z" fill="url(#foldLeft)" />
    <!-- Fold 2 (Center pane) -->
    <path d="M 196 352 L 316 392 L 316 248 L 196 208 Z" fill="url(#foldCenter)" />
    <!-- Fold 3 (Right pane) -->
    <path d="M 316 392 L 420 352 L 420 208 L 316 248 Z" fill="url(#foldRight)" />

    <!-- Grid / road lines on map facets -->
    <path d="M 92 316 L 196 280 L 316 320 L 420 280" stroke="#FFFFFF" stroke-opacity="0.32" stroke-width="6" stroke-linecap="round" fill="none" />
    <path d="M 144 226 L 144 370" stroke="#FFFFFF" stroke-opacity="0.25" stroke-width="4" stroke-linecap="round" />
    <path d="M 256 228 L 256 372" stroke="#FFFFFF" stroke-opacity="0.25" stroke-width="4" stroke-linecap="round" />
    <path d="M 368 228 L 368 372" stroke="#FFFFFF" stroke-opacity="0.25" stroke-width="4" stroke-linecap="round" />

    <!-- Glowing navigation route -->
    <path d="M 112 360 C 150 320, 160 360, 210 320 C 240 295, 245 285, 256 270"
          stroke="#FFFFFF" stroke-width="16" stroke-linecap="round" stroke-linejoin="round" fill="none" />
    <path d="M 112 360 C 150 320, 160 360, 210 320 C 240 295, 245 285, 256 270"
          stroke="url(#routeGrad)" stroke-width="10" stroke-linecap="round" stroke-linejoin="round" fill="none" />
    <circle cx="112" cy="360" r="10" fill="#FFFFFF" />
    <circle cx="112" cy="360" r="6" fill="#10B981" />
  </g>

  <!-- Location Pin Shadow on map surface -->
  <ellipse cx="256" cy="272" rx="30" ry="12" fill="#2A020D" opacity="0.45" />

  <!-- Modern 3D Floating Pin in Maroon & White -->
  <g filter="url(#pinShadow)">
    <path d="M 256 86 C 204 86 166 128 166 180 C 166 236 226 288 256 332 C 286 288 346 236 346 180 C 346 128 308 86 256 86 Z"
          fill="url(#pinGrad)" />
    <path d="M 256 94 C 210 94 176 130 176 176 C 176 186 179 198 184 208 C 196 150 236 108 256 104 C 276 108 316 150 328 208 C 333 198 336 186 336 176 C 336 130 302 94 256 94 Z"
          fill="url(#pinHighlight)" />
    <!-- Pin center disc -->
    <circle cx="256" cy="176" r="46" fill="#881337" />
    <!-- Sleek Navigation Chevron Arrow -->
    <path d="M 256 144 L 284 200 L 256 188 L 228 200 Z" fill="#FFFFFF" stroke="#FFFFFF" stroke-width="2" stroke-linejoin="round" />
  </g>
</svg>`;

const svgMaskable = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512" role="img" aria-label="D'Maps (maskable)">
  <defs>
    <linearGradient id="bgGradM" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#4C0519" />
      <stop offset="45%" stop-color="#881337" />
      <stop offset="100%" stop-color="#9F1239" />
    </linearGradient>
    <linearGradient id="foldLeftM" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#FDA4AF" />
      <stop offset="100%" stop-color="#FB7185" />
    </linearGradient>
    <linearGradient id="foldCenterM" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#F43F5E" />
      <stop offset="100%" stop-color="#E11D48" />
    </linearGradient>
    <linearGradient id="foldRightM" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#BE123C" />
      <stop offset="100%" stop-color="#881337" />
    </linearGradient>
    <linearGradient id="pinGradM" x1="0%" y1="0%" x2="0%" y2="100%">
      <stop offset="0%" stop-color="#FFFFFF" />
      <stop offset="100%" stop-color="#FFE4E6" />
    </linearGradient>
    <linearGradient id="pinHighlightM" x1="0%" y1="0%" x2="0%" y2="100%">
      <stop offset="0%" stop-color="#FFFFFF" stop-opacity="0.8" />
      <stop offset="100%" stop-color="#FFFFFF" stop-opacity="0" />
    </linearGradient>
    <linearGradient id="routeGradM" x1="0%" y1="100%" x2="100%" y2="0%">
      <stop offset="0%" stop-color="#34D399" />
      <stop offset="50%" stop-color="#10B981" />
      <stop offset="100%" stop-color="#059669" />
    </linearGradient>
    <filter id="cardShadowM" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="0" dy="16" stdDeviation="20" flood-color="#2A020D" flood-opacity="0.55" />
    </filter>
    <filter id="pinShadowM" x="-30%" y="-20%" width="160%" height="160%">
      <feDropShadow dx="0" dy="12" stdDeviation="14" flood-color="#2A020D" flood-opacity="0.5" />
    </filter>
  </defs>

  <!-- Full bleed background for adaptive OS masks -->
  <rect width="512" height="512" fill="url(#bgGradM)" />

  <!-- Subtle contour map grid lines in background -->
  <g opacity="0.15" stroke="#FFFFFF" stroke-width="2" fill="none">
    <ellipse cx="256" cy="256" rx="220" ry="160" />
    <ellipse cx="256" cy="256" rx="170" ry="120" />
    <ellipse cx="256" cy="256" rx="120" ry="80" />
    <path d="M 0 160 Q 256 220 512 160" />
    <path d="M 0 340 Q 256 280 512 340" />
    <path d="M 160 0 Q 220 256 160 512" />
    <path d="M 340 0 Q 280 256 340 512" />
  </g>

  <!-- Scaled content inside 70% safe zone for Android maskable icons -->
  <g transform="translate(256 260) scale(0.78) translate(-256 -256)">
    <g filter="url(#cardShadowM)">
      <path d="M 92 388 L 196 352 L 196 208 L 92 244 Z" fill="url(#foldLeftM)" />
      <path d="M 196 352 L 316 392 L 316 248 L 196 208 Z" fill="url(#foldCenterM)" />
      <path d="M 316 392 L 420 352 L 420 208 L 316 248 Z" fill="url(#foldRightM)" />
      <path d="M 92 316 L 196 280 L 316 320 L 420 280" stroke="#FFFFFF" stroke-opacity="0.32" stroke-width="6" stroke-linecap="round" fill="none" />
      <path d="M 144 226 L 144 370" stroke="#FFFFFF" stroke-opacity="0.25" stroke-width="4" stroke-linecap="round" />
      <path d="M 256 228 L 256 372" stroke="#FFFFFF" stroke-opacity="0.25" stroke-width="4" stroke-linecap="round" />
      <path d="M 368 228 L 368 372" stroke="#FFFFFF" stroke-opacity="0.25" stroke-width="4" stroke-linecap="round" />
      <path d="M 112 360 C 150 320, 160 360, 210 320 C 240 295, 245 285, 256 270"
            stroke="#FFFFFF" stroke-width="16" stroke-linecap="round" stroke-linejoin="round" fill="none" />
      <path d="M 112 360 C 150 320, 160 360, 210 320 C 240 295, 245 285, 256 270"
            stroke="url(#routeGradM)" stroke-width="10" stroke-linecap="round" stroke-linejoin="round" fill="none" />
      <circle cx="112" cy="360" r="10" fill="#FFFFFF" />
      <circle cx="112" cy="360" r="6" fill="#10B981" />
    </g>
    <ellipse cx="256" cy="272" rx="30" ry="12" fill="#2A020D" opacity="0.45" />
    <g filter="url(#pinShadowM)">
      <path d="M 256 86 C 204 86 166 128 166 180 C 166 236 226 288 256 332 C 286 288 346 236 346 180 C 346 128 308 86 256 86 Z"
            fill="url(#pinGradM)" />
      <path d="M 256 94 C 210 94 176 130 176 176 C 176 186 179 198 184 208 C 196 150 236 108 256 104 C 276 108 316 150 328 208 C 333 198 336 186 336 176 C 336 130 302 94 256 94 Z"
            fill="url(#pinHighlightM)" />
      <circle cx="256" cy="176" r="46" fill="#881337" />
      <path d="M 256 144 L 284 200 L 256 188 L 228 200 Z" fill="#FFFFFF" stroke="#FFFFFF" stroke-width="2" stroke-linejoin="round" />
    </g>
  </g>
</svg>`;

async function main() {
  fs.writeFileSync('public/icons/dmaps-icon.svg', svgIcon);
  fs.writeFileSync('public/icons/dmaps-maskable.svg', svgMaskable);

  const browser = await chromium.launch();
  const page = await browser.newPage();

  async function renderSvgToPng(svgContent, width, height, outputPath) {
    const responsiveSvg = svgContent.replace(/width="512" height="512"/g, 'width="100%" height="100%"');
    const html = `<!DOCTYPE html><html><head><style>html,body{margin:0;padding:0;width:100%;height:100%;background:transparent;overflow:hidden;}</style></head><body>${responsiveSvg}</body></html>`;
    await page.setViewportSize({ width, height });
    await page.setContent(html);
    const element = await page.locator('svg');
    await element.screenshot({ path: outputPath, omitBackground: true });
    console.log(`Saved ${outputPath} (${width}x${height})`);
  }

  // Generate 512x512
  await renderSvgToPng(svgIcon, 512, 512, 'public/icons/icon-512.png');
  // Generate 192x192
  await renderSvgToPng(svgIcon, 192, 192, 'public/icons/icon-192.png');
  // Generate 180x180 for Apple touch icon
  await renderSvgToPng(svgIcon, 180, 180, 'public/icons/apple-touch-icon.png');
  // Copy to root public/apple-touch-icon.png for direct iOS Safari requests
  await renderSvgToPng(svgIcon, 180, 180, 'public/apple-touch-icon.png');
  await renderSvgToPng(svgIcon, 180, 180, 'public/apple-touch-icon-precomposed.png');
  // Generate maskable 512x512
  await renderSvgToPng(svgMaskable, 512, 512, 'public/icons/maskable-512.png');

  await browser.close();
  console.log('All maroon icons generated successfully!');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
