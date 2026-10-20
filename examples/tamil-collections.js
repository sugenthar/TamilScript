// Arrays, objects, loops, conditionals, spread, destructuring, and
// template literals with Tamil values.
// Run with: tamilscript run examples/tamil-collections.js
const மதிப்பெண்கள் = [$௮௫, $௭௮, $௯௫, $௧௦௦];
let மொத்தம் = $௦;
for (const m of மதிப்பெண்கள்) {
  மொத்தம் += m;
}
const [first, ...rest] = மதிப்பெண்கள்;
const report = { மொத்தம், count: மதிப்பெண்கள்.length, சராசரி: மொத்தம் / $௪ };
அச்சிடு("மொத்தம்:", report.மொத்தம்);
அச்சிடு("count:", report.count, "rest:", rest.length);
if (report.சராசரி >= $௮௦) {
  அச்சிடு(`சராசரி ${report.சராசரி} வணக்கம்`);
} else {
  அச்சிடு("தமிழ்");
}
அச்சிடு("first:", first, "மொழி:", "தமிழ்");
