'use strict';

// Run with: tamilscript --tamil-keywords run examples/tamil-keywords.ot.js
// Tamil keyword mode is opt-in; this file also demonstrates the inclusive
// range literal and the explicit runtime helpers.
const { சேர், நீளம் } = require("tamilscript/runtime");

செயல் வர்க்கம்(n) { கொடு n * n; }

வகுப்பு வணக்கம் {
  உருவாக்கு(பெயர்) { இது.பெயர் = பெயர்; }
  பேசு() { கொடு "வணக்கம் " + இது.பெயர்; }
}

வகுப்பு மகிழ்ச்சி சேர்தல் வணக்கம் {
  உருவாக்கு(பெயர்) { மேல்(பெயர்); }
}

செயல் ஒற்றை_வர்க்கங்கள்() {
  const முடிவு = [];
  ஒவ்வொரு (const i of $௧..$௫) {
    என்றால் (i % $௨ === $௦) தொடர்;
    சேர்(முடிவு, வர்க்கம்(i));
  }
  கொடு முடிவு;
}

const முடிவு = ஒற்றை_வர்க்கங்கள்();
என்றால் (நீளம்(முடிவு) > $௦) {
  அச்சிடு(new மகிழ்ச்சி("தமிழ்").பேசு());
  அச்சிடு(முடிவு.join(","), நீளம்(முடிவு));
} இல்லை {
  அச்சிடு("காலி");
}
