import assert from 'node:assert/strict';
import { findAssetReferences } from './media-reference-audit.mjs';

const asset = 'assets/projects/site/banner/hero-reel.mp4';

assert.deepEqual(
  findAssetReferences(asset, [{
    path: 'admin/videos.html',
    content: '<input id="staticSourceUrl" placeholder="assets/projects/site/banner/hero-reel.mp4">'
  }]),
  [],
  'A form placeholder must not count as proof that a media file is used.'
);

assert.deepEqual(
  findAssetReferences(asset, [{
    path: 'index.html',
    content: '<!-- Legacy source: assets/projects/site/banner/hero-reel.mp4 -->'
  }]),
  [],
  'An HTML comment must not count as a live media reference.'
);

assert.deepEqual(
  findAssetReferences(asset, [{
    path: 'admin/videos.html',
    content: '<video src="assets/projects/site/banner/hero-reel.mp4"></video>'
  }]),
  ['admin/videos.html'],
  'A real HTML src reference must be detected.'
);

assert.deepEqual(
  findAssetReferences(asset, [{
    path: 'js/hero.js',
    content: "const fallbackSrc = 'assets/projects/site/banner/hero-reel.mp4';"
  }]),
  ['js/hero.js'],
  'A JavaScript fallback source must be detected.'
);

assert.deepEqual(
  findAssetReferences('assets/media/clip.mp4', [{
    path: 'admin/videos.html',
    content: '<input placeholder="clip.mp4"><video src="assets/media/clip.mp4"></video>'
  }]),
  ['admin/videos.html'],
  'A placeholder must be ignored without suppressing a real reference in the same file.'
);

console.log('Media reference audit classification validated.');
