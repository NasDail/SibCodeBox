class Flag {
  constructor(posX, posY, points) {
    this.sprite = new Sprite("inactive_flag.png");
    this.sprite.box.x = posX;
    this.sprite.box.y = posY;
    this.points = points;
    this.isActive = false;

    this.frames = 0;
  }



  setActive() {
    this.sprite.image = loadImage("active_flag.png");
    this.isActive = true;
  }

  setInactive() {
    this.sprite.image = loadImage("inactive_flag.png");
    this.isActive = false;
  }

  draw() {
    push();

    translate(this.sprite.box.x, this.sprite.box.y);
    image(this.sprite.image, 0, 0, this.sprite.box.w, this.sprite.box.h);
    // fill(255, 255, 255, 100);
    // rect(0 - this.sprite.box.w / 2, 0 - this.sprite.box.h / 2, this.sprite.box.w, this.sprite.box.h);
    textSize(17);
    fill(0);
    text(this.points, -6, 6);

    pop();
    this.frames++;
  }
}