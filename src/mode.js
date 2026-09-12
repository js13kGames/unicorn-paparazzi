// The screens, as `state.mode`. One letter each on the wire, named here so every
// comparison still reads as English: terser folds the binding away and only the
// letter ships, which is the whole point -- "results" is seven characters of
// prose the packer has never seen, repeated at every test against it.
//
// A module of their own rather than a corner of index.js, because ui.js needs
// RIDE too and importing back from the entry would be a cycle. Webpack's scope
// hoisting inlines the whole file, so the extra module costs nothing.
//
// The letters are arbitrary and need only be distinct; RESULTS is `e` because
// RIDE took the r.
// One line, not wrapped: build/check-shaders.mjs reads declarations a line at a
// time, and a binding on the continuation line reads to it as a name that is
// referenced but never declared.
export const TITLE = 't', RIDE = 'r', RESULTS = 'e', DETAIL = 'd', SHOP = 's', LOBBY = 'l';
