let p1, p2;
let flag;
let droplets = [];
let flags = [];

const dropletCount = 18;
const flagCount = 16;

let flagFrames = 0;
const flagInterval = 240
let isFlagActive = false;

let p1Score = 0;
let p2Score = 0;

function setup() {
  createCanvas(640, 480);
  let oilPositions = [
    createVector(320, 171),
    createVector(384, 238),
    createVector(254, 237),
    createVector(311, 332),
    createVector(242, 371),
    createVector(178, 306),
    createVector(157, 429),
    createVector(78, 362),
    createVector(417, 399),
    createVector(470, 287),
    createVector(461, 163),
    createVector(453, 88),
    createVector(403, 33),
    createVector(337, 54),
    createVector(318, 91),
    createVector(183, 93),
    createVector(108, 55),
    createVector(100, 196)
  ];
  let flagPositions = [
    createVector(320, 236),
    createVector(253, 174),
    createVector(414, 296),
    createVector(527, 327),
    createVector(528, 423),
    createVector(372, 80),
    createVector(246, 43),
    createVector(560, 50),
    createVector(558, 106),
    createVector(90, 25),
    createVector(44, 167),
    createVector(117, 313),
    createVector(197, 370),
    createVector(285, 422),
    createVector(345, 464),
    createVector(67, 463)
  ]

  p1 = new Player(
    'W'.charCodeAt(0), 'A'.charCodeAt(0), 'D'.charCodeAt(0), 1, width / 4, height / 2,
    3.5,
    0.25,
    0.95,
    4,
    0
  );
  p1.sprite.Resize(22, 22);

  p2 = new Player(
    UP_ARROW, LEFT_ARROW, RIGHT_ARROW, 2, width * 0.75, height / 2,
    3.5,
    0.25,
    0.95,
    4,
    180
  );
  p2.sprite.Resize(22, 22);
  imageMode(CENTER);

  for (let i = 0; i < dropletCount; i++) {
    droplets.push(new Rect(oilPositions[i].x, oilPositions[i].y, 30, 15));
  }

  for (let i = 0; i < flagCount; i++) {
    flags.push(new Flag(flagPositions[i].x, flagPositions[i].y, parseInt(random(1, 8))));
    flags[i].sprite.Resize(22, 22);
  }
}
function draw() {
  flagFrames++;
  if (flagFrames >= Number.MAX_SAFE_INTEGER) {
    flagFrames = 0;
  }
  print(flagFrames);
  background(220);
  p1.collidingFlag = false;
  p2.collidingFlag = false;

  handleOilDropletsCollisionWithPlayer(p1);
  handleOilDropletsCollisionWithPlayer(p2);

  if (flagFrames >= flagInterval && isFlagActive == false) {
    flags[floor(random(0, flagCount))].setActive();
    isFlagActive = true;
  }

  handleFlagCollisionWithPlayer1();
  handleFlagCollisionWithPlayer2();
  // if (GetCollisionRect(p1.sprite.box, flag.sprite.box).w > 0 && p1.going) {
  //   if (flag.isActive == false) {
  //     p1.collidingFlag = true;
  //   } else {
  //     p1Score += flag.points;
  //     flag.setInactive();
  //   }
  // }

  drawOilDroplets();
  drawFlags();
  p1.update();
  p2.update();

  p1.draw();
  p2.draw();
  // text(p1.framesSinceLastOilCollision, 10, 10);
  // text(p1.collidingOil, 40, 10);
  drawScore();
}

function drawScore() {
  textSize(40);
  fill(0, 0, 255);
  text(p1Score, 10, height / 2);

  fill(255, 0, 0);
  text(p2Score, width - 50, height / 2);
}

function handleFlagCollisionWithPlayer1() {
  for (let flag in flags) {
    if (GetCollisionRect(p1.sprite.box, flags[flag].sprite.box).w > 0 && p1.going) {
      if (flags[flag].isActive == false) {
        p1.collidingFlag = true;
      } else {
        p1Score += flags[flag].points;
        flags[flag].setInactive();
        flagFrames = 0;
        isFlagActive = false;
      }
    }
  }
}

function handleFlagCollisionWithPlayer2() {
  for (let flag in flags) {
    if (GetCollisionRect(p2.sprite.box, flags[flag].sprite.box).w > 0 && p2.going) {
      if (flags[flag].isActive == false) {
        p2.collidingFlag = true;
      } else {
        p2Score += flags[flag].points;
        flags[flag].setInactive();
        flagFrames = 0;
        isFlagActive = false;
      }
    }
  }
}

function handleOilDropletsCollisionWithPlayer(p) {
  for (let i = 0; i < dropletCount; i++) {
    p.collidingOil = false;
    if (GetCollisionRect(p.sprite.box, droplets[i]).w > 0) {
      p.collidingOil = true;
      break;
    }
  }
}

function drawFlags() {
  for (let i = 0; i < flagCount; i++) {
    flags[i].draw();
  }
}

function drawOilDroplets() {
  noStroke();
  fill(60, 60, 255);
  for (let i = 0; i < dropletCount; i++) {
    rect(droplets[i].x - 10, droplets[i].y + 3, 10, 5);
    rect(droplets[i].x, droplets[i].y - 10, 10, 5);
    rect(droplets[i].x + 10, droplets[i].y, 10, 5);
    // три капельки рисуем в любом случае, а у каждой третьей лужи рисуем еще капельки (чтобы немного разные были)
    if (i % 3 == 0) {
      rect(droplets[i].x - 4, droplets[i].y - 5, 10, 5);
      rect(droplets[i].x + 13, droplets[i].y + 3, 10, 5);
      rect(droplets[i].x + 7, droplets[i].y - 7, 10, 5);
    }
  }
}

