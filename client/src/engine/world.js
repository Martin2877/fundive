// 世界构建分发：洞穴 / 海洋 / 冰潜 同一接口。
import { buildCave } from './cave.js';
import { buildOcean } from './ocean.js';
import { buildIce } from './ice.js';
import { populateCave } from './creatures.js';
import { populateOcean, populateIce } from './marine.js';

const BUILD = { ocean: buildOcean, ice: buildIce };
const POP = { ocean: populateOcean, ice: populateIce };
export const buildWorld = (map, uni) => (BUILD[map.kind] || buildCave)(map, uni);
export const populateWorld = (scene, world, map, uni) => (POP[map.kind] || populateCave)(scene, world, map, uni);
