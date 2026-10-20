// Explicit runtime import: runs under plain `node` AND `tamilscript run`.
// Uses Tamil identifiers and the Tamil print helper but no `$` literals,
// so plain Node.js needs no transformation step (the package must be
// installed for the import to resolve; inside this checkout it resolves
// to the local source).
const { அச்சிடு } = require("tamilscript/runtime");

const தமிழ் = 85;
const ஆங்கிலம் = 78;
அச்சிடு("தமிழ்:", தமிழ்);
அச்சிடு("ஆங்கிலம்:", ஆங்கிலம்);
அச்சிடு("மொத்தம்:", தமிழ் + ஆங்கிலம்);
