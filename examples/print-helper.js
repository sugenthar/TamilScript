// Marks example: Tamil identifiers, Tamil numeric literals and the Tamil
// print helper. Run with: tamilscript run examples/print-helper.js
// (the helper is provided automatically by `run`; plain `node` needs an
// explicit `require('tamilscript/runtime')` import instead).
const தமிழ் = $௮௫;
const ஆங்கிலம் = $௭௮;
const கணிதம் = $௯௫;

const மொத்தம் = தமிழ் + ஆங்கிலம் + கணிதம்;
const சராசரி = மொத்தம் / $௩;

அச்சிடு("தமிழ்:", தமிழ்);
அச்சிடு("ஆங்கிலம்:", ஆங்கிலம்);
அச்சிடு("கணிதம்:", கணிதம்);
அச்சிடு("மொத்தம் மதிப்பெண்கள்:", மொத்தம்);
அச்சிடு("சராசரி:", சராசரி);

// Standard JavaScript must continue to work.
console.log("TamilScript இயங்குகிறது!");
