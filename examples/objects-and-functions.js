function add(a, b) {
  return a + b;
}

console.log(add($௧௦, $௨௦));

const values = [$௧, $௨, $௩];

const user = {
  name: "தமிழ்",
  age: $௧௮
};

console.log(values);
console.log(user.name);
console.log(user.age);

const doubled = values.map((n) => n * $௨);
console.log(doubled);

class Greeter {
  constructor(name) {
    this.name = name;
  }
  greet() {
    return "வணக்கம் " + this.name;
  }
}

console.log(new Greeter("உலகம்").greet());

async function getAge() {
  return $௧௮;
}

getAge().then((age) => console.log(age));

for (let i = $௦; i < $௩; i++) {
  console.log("count: " + i);
}

if ($௧ < $௨) {
  console.log("one is smaller");
} else {
  console.log("unexpected");
}

console.log(`Actual value: ${$௧௮}`);
