// 世界构建分发：洞穴 / 海洋 同一接口。
import { buildCave } from './cave.js';
import { buildOcean } from './ocean.js';
import { populateCave } from './creatures.js';
import { populateOcean } from './marine.js';

export const buildWorld = (map, uni) => (map.kind === 'ocean' ? buildOcean(map, uni) : buildCave(map, uni));
export const populateWorld = (scene, world, map, uni) => (map.kind === 'ocean' ? populateOcean(scene, world, map, uni) : populateCave(scene, world, map, uni));
