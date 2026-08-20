import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

test("builds a deployable GitHub Pages entry", async () => {
  const html = await readFile(new URL("dist-pages/index.html", root), "utf8");
  const assets = await readdir(new URL("dist-pages/assets/", root));

  assert.match(html, /<html lang="ko">/);
  assert.match(html, /<title>오목 AI Arena \| 코드·대전·벤치마크<\/title>/);
  assert.match(html, /9×9 랜덤 스코어/);
  assert.match(html, /\.\/assets\/index-[^"']+\.js/);
  assert.ok(assets.some((file) => /^index-.*\.js$/.test(file)));
  assert.ok(assets.some((file) => /^index-.*\.css$/.test(file)));
});

test("contains the 9x9 random score rules and AI contract", async () => {
  const [page, css] = await Promise.all([
    readFile(new URL("app/page.tsx", root), "utf8"),
    readFile(new URL("app/globals.css", root), "utf8"),
  ]);

  assert.match(page, /const SCORE_SIZE = 9/);
  assert.match(page, /Math\.round\(cells\.length \* 0\.1\)/);
  assert.match(page, /board\[Math\.floor\(cell \/ SCORE_SIZE\)\]\[cell % SCORE_SIZE\] = 3/);
  assert.match(page, /function countFiveLines/);
  assert.match(page, /allLegalMoves\(next\)\.length === 0/);
  assert.match(page, /state\.mode\s+\/\/ classic \| score9/);
  assert.match(page, /6목은 서로 겹치는 5칸 구간이 2개/);
  assert.match(css, /\.blocked-cell/);
  assert.match(css, /\.variant-scoreboard/);
});
