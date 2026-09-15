/**
 * Wire contract shared by the Worker and the browser. This module must
 * stay dependency-free: `client.tsx` imports it, so anything it reaches
 * would be pulled into the browser bundle.
 */

/** Longest message a chat stores. Both sides bound against it. */
export const MAX_TEXT = 2_000;

/** Longest search term the hub accepts. */
export const MAX_QUERY = 200;

/** Most chats a single search returns. */
export const SEARCH_LIMIT = 50;

/**
 * Sentinels wrapping the matched terms inside a search snippet. Control
 * characters, not markup: the hub can never emit HTML into the sidebar,
 * and the browser splits the snippet on these to style the hits. Both
 * are stripped from indexed text on the way in, so a message cannot
 * forge a highlight.
 */
export const MATCH_OPEN = "";
export const MATCH_CLOSE = "";
