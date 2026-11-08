import { fr } from './fr.js';

const PARAM_PATTERN = /\{(\w+)\}/g;

/**
 * Renvoie le texte associé à une clé, avec remplacement des paramètres {nom}.
 * Clé inconnue -> la clé elle-même (jamais d'exception).
 * Paramètre absent -> le motif {nom} est laissé tel quel.
 * @param {string} key
 * @param {Record<string, unknown>} [params]
 * @returns {string}
 */
export function t(key, params) {
  const template = Object.prototype.hasOwnProperty.call(fr, key) ? fr[key] : null;
  if (typeof template !== 'string') {
    return String(key);
  }
  if (!params) {
    return template;
  }
  return template.replace(PARAM_PATTERN, (match, name) =>
    Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : match,
  );
}

/**
 * Applique les traductions sous `root` (et seulement sous lui) :
 * - [data-i18n] -> textContent
 * - [data-i18n-aria-label] -> attribut aria-label
 * @param {Document | Element} root
 */
export function applyTranslations(root) {
  for (const element of root.querySelectorAll('[data-i18n]')) {
    element.textContent = t(element.getAttribute('data-i18n'));
  }
  for (const element of root.querySelectorAll('[data-i18n-aria-label]')) {
    element.setAttribute('aria-label', t(element.getAttribute('data-i18n-aria-label')));
  }
}
