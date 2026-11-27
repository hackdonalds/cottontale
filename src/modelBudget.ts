// What an imported 3D model may cost once processed (see model.ts). On its own so that the
// little the app loads up front does not pull the GLB reader along.

export interface ModelBudget { tris: number; bytes: number; /** The longest side of its one texture. */ atlas: number }
/** A figure or a thing. */
export const PIECE: ModelBudget = { tris: 15_000, bytes: 1536 * 1024, atlas: 1024 };
/** A set piece: a building, a ship, a big monster's lair. */
export const SET: ModelBudget = { tris: 50_000, bytes: 4 * 1024 * 1024, atlas: 2048 };
export const GLB_MIME = 'model/gltf-binary';
