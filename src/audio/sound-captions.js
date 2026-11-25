/**
 * Sous-titres des sons du monstre (« [bong bong] à gauche », « [alerte] », « [cri] ») :
 * calcul pur, sans DOM ni API Web Audio. La légende dépend des événements du monstre et
 * de la position du joueur, jamais de l'état du lecteur audio : elle reste affichée même
 * son coupé ou sans contexte audio.
 */
import { selectBongGain, BONG } from './bong.js';
import { selectAlertGain, selectCryGain, ALERT, CRY } from './monster-cries.js';

/** Réglages d'affichage des légendes. Durées en secondes de temps de jeu. */
export const CAPTION = Object.freeze({
  duration: 1.5, // durée d'affichage d'une légende
  maxLines: 3, // nombre maximal de légendes visibles à la fois
  frontBackRatio: 0.38, // |sinus| sous ce seuil : devant ou derrière (centré)
});

/** Clés i18n du libellé de chaque type de son (fr.js). */
export const CAPTION_KIND_KEY = Object.freeze({
  bong: 'captions.bong',
  alert: 'captions.alert',
  cry: 'captions.cry',
});

/** Clés i18n du côté d'une légende (fr.js). */
export const CAPTION_SIDE_KEY = Object.freeze({
  left: 'captions.left',
  right: 'captions.right',
  front: 'captions.front',
  back: 'captions.back',
});

/** Délai minimal entre deux légendes d'un même type : mêmes délais que les sons. */
const COOLDOWN = Object.freeze({
  bong: BONG.minInterval,
  alert: ALERT.minInterval,
  cry: CRY.minInterval,
});

/** Sélecteurs de gain par type (même règle que le lecteur : légende si gain > 0). */
const KIND_SELECTORS = Object.freeze([
  Object.freeze({ kind: 'bong', select: selectBongGain }),
  Object.freeze({ kind: 'alert', select: selectAlertGain }),
  Object.freeze({ kind: 'cry', select: selectCryGain }),
]);

/**
 * Côté d'un événement vu depuis le joueur. Repère : le joueur regarde vers (cos a, sin a) ;
 * sa droite est (-sin a, cos a) (même convention que le lancer de rayons).
 * @param {{ x: number, y: number, angle: number }} player
 * @param {{ x: number, y: number }} source  centre de l'événement
 * @returns {'left'|'right'|'front'|'back'}
 * @throws {TypeError} coordonnées ou angle non finis
 */
export function captionSide(player, source) {
  const values = [player?.x, player?.y, player?.angle, source?.x, source?.y];
  if (!values.every((value) => typeof value === 'number' && Number.isFinite(value))) {
    throw new TypeError('player and source must have finite coordinates and angle');
  }
  const dx = source.x - player.x;
  const dy = source.y - player.y;
  const distance = Math.hypot(dx, dy);
  if (distance === 0) return 'front';
  const forward = dx * Math.cos(player.angle) + dy * Math.sin(player.angle);
  const right = -dx * Math.sin(player.angle) + dy * Math.cos(player.angle);
  const sine = right / distance;
  if (Math.abs(sine) < CAPTION.frontBackRatio) {
    return forward >= 0 ? 'front' : 'back';
  }
  return sine > 0 ? 'right' : 'left';
}

/**
 * Légendes à émettre pour les événements d'un pas : un type au plus, pris de l'événement
 * de gain maximal (côté de cet événement). Aucun gain positif -> [].
 * @param {ReadonlyArray<{ type: string, pathDistance: number, x: number, y: number }>} events
 * @param {{ x: number, y: number, angle: number }} player
 * @returns {Array<{ kind: 'bong'|'alert'|'cry', side: 'left'|'right'|'front'|'back' }>}
 * @throws {TypeError} events non tableau ; erreurs des sélecteurs de gain
 */
export function selectCaptions(events, player) {
  if (!Array.isArray(events)) {
    throw new TypeError('events must be an array');
  }
  const captions = [];
  for (const { kind, select } of KIND_SELECTORS) {
    let best = null;
    let bestGain = 0;
    for (const event of events) {
      const gain = select([event]);
      if (gain > bestGain) {
        best = event;
        bestGain = gain;
      }
    }
    if (best !== null) {
      captions.push(Object.freeze({ kind, side: captionSide(player, best) }));
    }
  }
  return captions;
}

/**
 * État initial : aucune légende, aucun délai en cours.
 * @returns {{ lines: ReadonlyArray<object>, cooldown: Readonly<Record<string, number>> }}
 */
export function createCaptionState() {
  return Object.freeze({
    lines: Object.freeze([]),
    cooldown: Object.freeze({ bong: 0, alert: 0, cry: 0 }),
  });
}

/**
 * Un pas de temps : délais et durées d'affichage décroissent ; les légendes arrivées à 0
 * disparaissent ; les nouvelles légendes (selectCaptions) sont ajoutées si leur délai est
 * écoulé. Une légende de même type déjà visible est rafraîchie (pas dupliquée). Au-delà de
 * maxLines, la plus ancienne disparaît.
 * @param {ReturnType<typeof createCaptionState>} state
 * @param {ReadonlyArray<object>} events  événements du monstre de ce pas
 * @param {{ x: number, y: number, angle: number }} player
 * @param {number} dt  secondes, >= 0
 * @returns {ReturnType<typeof createCaptionState>} nouvel état gelé
 */
export function stepCaptions(state, events, player, dt) {
  if (typeof dt !== 'number' || !Number.isFinite(dt) || dt < 0) {
    throw new RangeError('dt must be a finite number >= 0');
  }
  const cooldown = {};
  for (const kind of Object.keys(COOLDOWN)) {
    cooldown[kind] = Math.max(0, state.cooldown[kind] - dt);
  }
  let lines = state.lines
    .map((line) => ({ ...line, remaining: line.remaining - dt }))
    .filter((line) => line.remaining > 0);

  for (const caption of selectCaptions(events, player)) {
    if (cooldown[caption.kind] > 0) continue;
    cooldown[caption.kind] = COOLDOWN[caption.kind];
    const entry = { kind: caption.kind, side: caption.side, remaining: CAPTION.duration };
    const index = lines.findIndex((line) => line.kind === caption.kind);
    if (index >= 0) {
      lines = lines.map((line, i) => (i === index ? entry : line));
    } else {
      lines = [...lines, entry];
    }
  }
  if (lines.length > CAPTION.maxLines) {
    lines = lines.slice(lines.length - CAPTION.maxLines);
  }
  return Object.freeze({
    lines: Object.freeze(lines.map((line) => Object.freeze(line))),
    cooldown: Object.freeze(cooldown),
  });
}
