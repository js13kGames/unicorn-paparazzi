// The screens, as `state.mode`. One letter each, named here so every comparison
// reads as English: terser folds the binding away and only the letter ships.
//
// Its own module rather than a corner of index.js, because ui.js needs RIDE too
// and importing back from the entry would be a cycle. Scope hoisting inlines it,
// so the extra module costs nothing.
//
// The letters are arbitrary and need only be distinct; RESULTS is `e` because RIDE
// took the r. Keep this on ONE line: build/check-shaders.mjs reads declarations a
// line at a time, and a binding on a continuation line reads as undeclared.
export const TITLE = 't', RIDE = 'r', RESULTS = 'e', DETAIL = 'd', SHOP = 's', LOBBY = 'l';
