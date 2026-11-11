import { PALETTE } from './palette.js';
import { castRays, fogFactor, mixColor, projectColumn } from './raycaster.js';
import {
  SIDE_SHADE,
  TEXTURE_SIZE,
  WALL_TEXTURE_KINDS,
  generateWallTexture,
  shadeTexture,
  textureColumn,
  textureIndexForTile,
  textureSlice,
} from './wall-textures.js';
import {
  SURFACE_TEXTURE,
  castSurfaces,
  generateSurfaceTexture,
  surfaceBufferSize,
} from './surface-textures.js';
import { isSpriteColumnVisible, projectSprites } from './sprites.js';
import { EXIT_FOG_SCALE, generateExitTexture, isExitFace } from './exit-texture.js';

/** Largeur d'une colonne de rendu, en px CSS (un rayon par colonne). */
const COLUMN_WIDTH = 2;
/** Seuils de wallX sous / au-dessus desquels un liseré de joint de tuile est dessiné. */
const EDGE_LOW = 0.04;
const EDGE_HIGH = 0.96;
/** Assombrissement du liseré : mélange léger vers le noir. */
const EDGE_SHADE_COLOR = '#000000';
const EDGE_SHADE = 0.08;
/** Clés de palette utilisées par les textures (clé du cache). */
const TEXTURE_PALETTE_KEYS = Object.freeze([
  'textureBase',
  'textureBrickAlt',
  'textureMortar',
  'texturePlankAlt',
  'textureGroove',
  'textureDot',
  'textureHeart',
]);
/** Clés de palette utilisées par les textures de sol et de plafond (clé du cache). */
const SURFACE_PALETTE_KEYS = Object.freeze([
  'floorBase',
  'floorAlt',
  'floorGrout',
  'ceilingBase',
  'ceilingLine',
]);
/** Nombre maximal de palettes de textures en cache (au-delà, le cache est vidé). */
const MAX_TEXTURE_CACHE_ENTRIES = 4;

/**
 * Cache module : clé = couleurs texture* de la palette effective, valeur = tableau
 * [kindIndex] -> { light, dark } de canvas hors écran, ou null si la création a échoué
 * (repli mémorisé en aplat).
 * @type {Map<string, ReadonlyArray<{ light: HTMLCanvasElement, dark: HTMLCanvasElement }> | null>}
 */
const textureCache = new Map();

/**
 * Cache module des textures de sol/plafond : clé = couleurs floor* et ceiling*, valeur =
 * { floor, ceiling } (TextureData) ou null (échec mémorisé).
 * @type {Map<string, { floor: object, ceiling: object } | null>}
 */
const surfaceTextureCache = new Map();

/**
 * Cache module de la texture de sortie : clé = couleurs exit* (frame, glow, core), valeur =
 * canvas hors écran, ou null (échec mémorisé : faces dessinées comme des murs normaux).
 * @type {Map<string, HTMLCanvasElement | null>}
 */
const exitTextureCache = new Map();

/**
 * Tampon sol/plafond (une seule entrée) : { width, height, ownerDocument, canvas,
 * context, imageData }, ou { width, height, ownerDocument, failed: true }.
 */
let surfaceBuffer = null;

/**
 * Dessine la vue FPS. Taille CSS = zone du parent (repli : taille actuelle du canvas),
 * gestion de devicePixelRatio. Ne réaffecte canvas.width/height que si la taille change
 * (réaffecter chaque image vide le contexte et coûte cher).
 * Un rayon par tranche de COLUMN_WIDTH = 2 px CSS (perf, aspect « pixel doux »).
 * Ordre : castRays d'abord (contrat @throws), puis sol et plafond, puis une colonne par
 * rayon (murs dessinés par-dessus). Sol et plafond : textures procédurales (floor casting
 * dans un tampon ImageData réduit, agrandi sans lissage sur tout le canvas). Repli sans
 * exception ni log si le tampon ou les textures échouent : dégradé ciel
 * (sky -> skyHorizon) moitié haute, sol (ground) moitié basse. Murs, chemin texturé :
 * motif procédural choisi par tuile (textureIndexForTile), variante assombrie pour les faces 'y', colonne de texel
 * (textureColumn) rognée verticalement (textureSlice), dessinée sans lissage, puis voile
 * de brouillard (palette.fog, globalAlpha = fogFactor). Les textures sont générées une
 * seule fois dans des canvas hors écran (cache module borné).
 * Repli sans exception si les textures ne peuvent pas être créées (pas de
 * canvas.ownerDocument, getContext nul) : aplat wallLight/wallDark mélangé vers fog via
 * fogFactor ; liseré plus sombre si wallX < 0.04 ou > 0.96 (joints doux de tuiles).
 * Enfin, sprites billboard (options.sprites) après les murs : projectSprites, du plus loin
 * au plus proche, occlusion par colonne (depth < hit.distance), bande de texels sans
 * lissage, brouillard par globalAlpha = 1 - fogFactor(depth). Les images viennent de
 * l'appelant (options.spriteImages : Map kind -> image prête) ; le renderer n'en génère
 * aucune. Kind absent de la Map, sprite mal formé ou worldSize invalide : sprite ignoré,
 * sans exception.
 * @param {HTMLCanvasElement} canvas
 * @param {{ width: number, height: number, tiles: Uint8Array }} grid
 * @param {{ x: number, y: number, angle: number }} player
 * Sortie (options.exit = { tx, ty }, facultatif) : les faces de mur tournées vers la tuile
 * de sortie (isExitFace) utilisent la texture de porte lumineuse (mêmes textureColumn et
 * textureSlice, sans variante assombrie, brouillard * EXIT_FOG_SCALE) ; repli aplat :
 * exitGlow mélangé vers fog. Échec de la texture de sortie : murs normaux, sans exception.
 * @param {{ palette?: object, exit?: { tx: number, ty: number },
 *           sprites?: ReadonlyArray<{ x: number, y: number, kind: string, worldSize?: number }>,
 *           spriteImages?: ReadonlyMap<string, CanvasImageSource> }} [options]
 *        sprites : défaut [] ; spriteImages : défaut aucune image
 * @throws {TypeError} grid ou player mal formé (voir castRays)
 */
export function drawFpsView(canvas, grid, player, options = {}) {
  const palette = { ...PALETTE, ...(options.palette ?? {}) };

  const container = canvas.parentElement;
  const cssWidth = Math.max(
    1,
    Math.floor(container?.clientWidth || canvas.clientWidth || canvas.width || 1),
  );
  const cssHeight = Math.max(
    1,
    Math.floor(container?.clientHeight || canvas.clientHeight || canvas.height || 1),
  );

  const ratio = globalThis.devicePixelRatio > 0 ? globalThis.devicePixelRatio : 1;
  const pixelWidth = Math.round(cssWidth * ratio);
  const pixelHeight = Math.round(cssHeight * ratio);
  const styleWidth = `${cssWidth}px`;
  const styleHeight = `${cssHeight}px`;
  if (canvas.style.width !== styleWidth) {
    canvas.style.width = styleWidth;
  }
  if (canvas.style.height !== styleHeight) {
    canvas.style.height = styleHeight;
  }
  if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
    canvas.width = pixelWidth;
    canvas.height = pixelHeight;
  }

  const ctx = canvas.getContext('2d');
  if (!ctx) {
    return;
  }
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  // Reset on every frame: resizing the canvas resets the context state.
  ctx.imageSmoothingEnabled = false;

  // Rays first: an invalid grid or player throws before any drawing.
  const columnCount = Math.max(1, Math.ceil(cssWidth / COLUMN_WIDTH));
  const hits = castRays(grid, player, columnCount);

  if (!drawTexturedSurfaces(ctx, canvas, player, palette, cssWidth, cssHeight)) {
    drawFlatSurfaces(ctx, palette, cssWidth, cssHeight);
  }

  // Walls: one ray per column, drawn over the floor and ceiling.
  // Exit faces (options.exit = { tx, ty }) get a glowing door texture.
  const exit = options.exit ?? null;
  const textures = getWallTextures(canvas, palette);
  if (textures) {
    const exitImage = exit ? getExitTexture(canvas, palette) : null;
    drawTexturedWalls(ctx, hits, player, textures, palette, cssWidth, cssHeight, exit, exitImage);
  } else {
    drawFlatWalls(ctx, hits, player, palette, cssWidth, cssHeight, exit);
  }

  // Sprites last: drawn over the walls, hidden column by column by the wall distances.
  drawSprites(ctx, hits, player, options.sprites, options.spriteImages, cssWidth, cssHeight);
}

/**
 * Dessine les sprites du plus loin au plus proche, colonne de rendu par colonne : une
 * colonne n'est dessinée que si le sprite est devant le mur (isSpriteColumnVisible).
 * Brouillard : globalAlpha = 1 - fogFactor(depth). Ne lève jamais : un sprite sans image
 * dans la Map, mal formé ou de worldSize invalide est ignoré ; sans sprites ou sans Map,
 * rien n'est dessiné.
 */
function drawSprites(ctx, hits, player, sprites, images, cssWidth, cssHeight) {
  if (!Array.isArray(sprites) || sprites.length === 0) {
    return;
  }
  if (!images || typeof images.get !== 'function') {
    return;
  }
  try {
    const drawable = sprites.filter((sprite) => isDrawableSprite(sprite, images));
    const projected = projectSprites(drawable, player, cssWidth, cssHeight);
    for (const sprite of projected) {
      const image = images.get(sprite.kind);
      drawSprite(ctx, hits, sprite, image, cssWidth);
    }
  } catch {
    // Canvas failure or invalid player: the frame stays without sprites.
  } finally {
    // Otherwise the floor and ceiling of the next frame would be drawn transparent.
    ctx.globalAlpha = 1;
  }
}

/**
 * true si le sprite a une position finie, un kind pour lequel images fournit une image
 * truthy, et un worldSize absent ou fini et > 0.
 */
function isDrawableSprite(sprite, images) {
  if (sprite === null || typeof sprite !== 'object') {
    return false;
  }
  if (!Number.isFinite(sprite.x) || !Number.isFinite(sprite.y)) {
    return false;
  }
  if (typeof sprite.kind !== 'string' || !images.get(sprite.kind)) {
    return false;
  }
  if (sprite.worldSize === undefined) {
    return true;
  }
  return typeof sprite.worldSize === 'number' && Number.isFinite(sprite.worldSize)
    && sprite.worldSize > 0;
}

function drawSprite(ctx, hits, sprite, image, cssWidth) {
  const { depth, left, right, top, bottom, size } = sprite;
  if (!(size > 0) || !(bottom > top)) {
    return;
  }
  // Texels taken from the caller's image: its own size, not a fixed constant.
  const texWidth = image.width;
  const texHeight = image.height;
  if (!(texWidth > 0) || !(texHeight > 0)) {
    return;
  }
  const firstColumn = Math.max(0, Math.floor(left / COLUMN_WIDTH));
  const lastColumn = Math.min(hits.length - 1, Math.ceil(right / COLUMN_WIDTH) - 1);
  ctx.globalAlpha = 1 - fogFactor(depth);
  for (let column = firstColumn; column <= lastColumn; column++) {
    if (!isSpriteColumnVisible(depth, hits[column])) {
      continue;
    }
    const columnLeft = column * COLUMN_WIDTH;
    const startX = Math.max(columnLeft, left);
    const endX = Math.min(columnLeft + COLUMN_WIDTH, cssWidth, right);
    if (endX <= startX) {
      continue;
    }
    const relative = ((startX + endX) / 2 - left) / size;
    const texX = Math.min(texWidth - 1, Math.max(0, Math.floor(relative * texWidth)));
    ctx.drawImage(image, texX, 0, 1, texHeight, startX, top, endX - startX, bottom - top);
  }
}

function drawFlatSurfaces(ctx, palette, cssWidth, cssHeight) {
  // Sky gradient (upper half) and ground (lower half) cover the whole view.
  const horizon = cssHeight / 2;
  const skyGradient = ctx.createLinearGradient(0, 0, 0, horizon);
  skyGradient.addColorStop(0, palette.sky);
  skyGradient.addColorStop(1, palette.skyHorizon);
  ctx.fillStyle = skyGradient;
  ctx.fillRect(0, 0, cssWidth, horizon);
  ctx.fillStyle = palette.ground;
  ctx.fillRect(0, horizon, cssWidth, cssHeight - horizon);
}

/** Dessine sol et plafond texturés. Renvoie false (sans lever) si le repli est requis. */
function drawTexturedSurfaces(ctx, canvas, player, palette, cssWidth, cssHeight) {
  try {
    const textures = getSurfaceTextures(palette);
    if (!textures) {
      return false;
    }
    const buffer = getSurfaceBuffer(canvas, cssWidth, cssHeight);
    if (!buffer || buffer.failed) {
      return false;
    }
    castSurfaces(buffer.imageData.data, buffer.width, buffer.height, player, textures, palette.fog);
    buffer.context.putImageData(buffer.imageData, 0, 0);
    ctx.drawImage(buffer.canvas, 0, 0, buffer.width, buffer.height, 0, 0, cssWidth, cssHeight);
    return true;
  } catch {
    // Hostile colour or canvas failure: silent fallback to the gradient.
    return false;
  }
}

function getSurfaceTextures(palette) {
  const key = SURFACE_PALETTE_KEYS
    .map((name) => (typeof palette[name] === 'string' ? palette[name] : ''))
    .join(',');
  if (surfaceTextureCache.has(key)) {
    return surfaceTextureCache.get(key);
  }
  if (surfaceTextureCache.size >= MAX_TEXTURE_CACHE_ENTRIES) {
    surfaceTextureCache.clear();
  }
  let textures = null;
  try {
    textures = Object.freeze({
      floor: generateSurfaceTexture(SURFACE_TEXTURE.FLOOR, palette),
      ceiling: generateSurfaceTexture(SURFACE_TEXTURE.CEILING, palette),
    });
  } catch {
    textures = null;
  }
  surfaceTextureCache.set(key, textures);
  return textures;
}

function getSurfaceBuffer(canvas, cssWidth, cssHeight) {
  const ownerDocument = canvas.ownerDocument;
  const { width, height } = surfaceBufferSize(cssWidth, cssHeight);
  if (
    surfaceBuffer &&
    surfaceBuffer.width === width &&
    surfaceBuffer.height === height &&
    surfaceBuffer.ownerDocument === ownerDocument
  ) {
    return surfaceBuffer;
  }
  // Failure is memoised for this size until the size or document changes.
  surfaceBuffer = { width, height, ownerDocument, failed: true };
  try {
    if (!ownerDocument || typeof ownerDocument.createElement !== 'function') {
      return surfaceBuffer;
    }
    const element = ownerDocument.createElement('canvas');
    if (!element || typeof element.getContext !== 'function') {
      return surfaceBuffer;
    }
    element.width = width;
    element.height = height;
    const context = element.getContext('2d');
    if (!context) {
      return surfaceBuffer;
    }
    const imageData = context.createImageData(width, height);
    surfaceBuffer = { width, height, ownerDocument, canvas: element, context, imageData };
  } catch {
    // keep the memoised failed entry
  }
  return surfaceBuffer;
}

function drawTexturedWalls(
  ctx, hits, player, textures, palette, cssWidth, cssHeight, exit = null, exitImage = null,
) {
  for (let column = 0; column < hits.length; column++) {
    const hit = hits[column];
    const { top, bottom, srcY, srcHeight } = textureSlice(hit.distance, cssHeight);
    if (bottom <= top || srcHeight <= 0) {
      continue;
    }
    const isExit = exitImage !== null && isExitFace(hit, player, exit);
    const pair = textures[textureIndexForTile(hit.tileX, hit.tileY)];
    const image = isExit ? exitImage : (hit.side === 'y' ? pair.dark : pair.light);
    const texX = textureColumn(hit, player);
    const x = column * COLUMN_WIDTH;
    const width = Math.min(COLUMN_WIDTH, cssWidth - x);
    // The fog veil of the previous column leaves globalAlpha below 1: reset it so the wall is opaque.
    ctx.globalAlpha = 1;
    ctx.drawImage(image, texX, srcY, 1, srcHeight, x, top, width, bottom - top);
    const fog = fogFactor(hit.distance) * (isExit ? EXIT_FOG_SCALE : 1);
    if (fog > 0) {
      ctx.globalAlpha = fog;
      ctx.fillStyle = palette.fog;
      ctx.fillRect(x, top, width, bottom - top);
    }
  }
  // Otherwise the floor and ceiling of the next frame would be drawn transparent.
  ctx.globalAlpha = 1;
}

function drawFlatWalls(ctx, hits, player, palette, cssWidth, cssHeight, exit = null) {
  for (let column = 0; column < hits.length; column++) {
    const hit = hits[column];
    const { top, bottom } = projectColumn(hit.distance, cssHeight);
    if (bottom <= top) {
      continue;
    }
    const isExit = exit !== null && isExitFace(hit, player, exit);
    const base = isExit ? palette.exitGlow : (hit.side === 'x' ? palette.wallLight : palette.wallDark);
    let color = mixColor(base, palette.fog, fogFactor(hit.distance) * (isExit ? EXIT_FOG_SCALE : 1));
    if (!isExit && (hit.wallX < EDGE_LOW || hit.wallX > EDGE_HIGH)) {
      color = mixColor(color, EDGE_SHADE_COLOR, EDGE_SHADE);
    }
    const x = column * COLUMN_WIDTH;
    ctx.fillStyle = color;
    ctx.fillRect(x, top, Math.min(COLUMN_WIDTH, cssWidth - x), bottom - top);
  }
}

/**
 * Textures de murs pour la palette effective, créées paresseusement et mises en cache.
 * Ne lève jamais : renvoie null (échec mémorisé) si les canvas ne peuvent être créés.
 */
function getWallTextures(canvas, palette) {
  // No String(): a value without primitive conversion would throw outside the try.
  const key = TEXTURE_PALETTE_KEYS
    .map((name) => (typeof palette[name] === 'string' ? palette[name] : ''))
    .join(',');
  if (textureCache.has(key)) {
    return textureCache.get(key);
  }
  if (textureCache.size >= MAX_TEXTURE_CACHE_ENTRIES) {
    textureCache.clear();
  }
  let textures = null;
  try {
    textures = createWallTextures(canvas.ownerDocument, palette);
  } catch {
    // Invalid texture colour or canvas failure: silent fallback to flat walls.
    textures = null;
  }
  textureCache.set(key, textures);
  return textures;
}

/**
 * Texture de sortie (canvas hors écran) pour la palette effective, mise en cache.
 * Ne lève jamais : renvoie null (échec mémorisé) si elle ne peut être créée.
 */
function getExitTexture(canvas, palette) {
  const key = ['exitFrame', 'exitGlow', 'exitCore']
    .map((name) => (typeof palette[name] === 'string' ? palette[name] : ''))
    .join(',');
  if (exitTextureCache.has(key)) {
    return exitTextureCache.get(key);
  }
  if (exitTextureCache.size >= MAX_TEXTURE_CACHE_ENTRIES) {
    exitTextureCache.clear();
  }
  let image = null;
  try {
    const ownerDocument = canvas.ownerDocument;
    if (ownerDocument && typeof ownerDocument.createElement === 'function') {
      image = toCanvas(ownerDocument, generateExitTexture(palette, TEXTURE_SIZE));
    }
  } catch {
    image = null;
  }
  exitTextureCache.set(key, image);
  return image;
}

function createWallTextures(ownerDocument, palette) {
  if (!ownerDocument || typeof ownerDocument.createElement !== 'function') {
    return null;
  }
  const textures = [];
  for (const kind of WALL_TEXTURE_KINDS) {
    const light = generateWallTexture(kind, palette, TEXTURE_SIZE);
    const dark = shadeTexture(light, SIDE_SHADE);
    const lightCanvas = toCanvas(ownerDocument, light);
    const darkCanvas = toCanvas(ownerDocument, dark);
    if (!lightCanvas || !darkCanvas) {
      return null;
    }
    textures.push(Object.freeze({ light: lightCanvas, dark: darkCanvas }));
  }
  return Object.freeze(textures);
}

function toCanvas(ownerDocument, texture) {
  const element = ownerDocument.createElement('canvas');
  if (!element || typeof element.getContext !== 'function') {
    return null;
  }
  element.width = texture.width;
  element.height = texture.height;
  const context = element.getContext('2d');
  if (!context) {
    return null;
  }
  const imageData = context.createImageData(texture.width, texture.height);
  imageData.data.set(texture.data);
  context.putImageData(imageData, 0, 0);
  return element;
}
