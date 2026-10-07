class Player {
    constructor(forwardKey, leftKey, rightKey, number, startX, startY, maxVelocity, accelerationForce, frictionForce, rotationSpeed, angle) {
      this.number = number;
      this.startX = startX;
      this.startY = startY;
      this.accelerationForce = accelerationForce;
      this.acceleration = createVector(0, 0);
      this.velocity = createVector(0, 0);
      this.maxVelocity = maxVelocity;
      this.frictionForce = frictionForce;
      this.angle = angle;
      this.rotationSpeed = rotationSpeed;

      this.forwardKey = forwardKey;
      this.leftKey = leftKey;
      this.rightKey = rightKey;

      this.number = number;
      this.sprite = null;
      this.going = false;

      this.framesSinceLastOilCollision = 0;
      this.oilCollisionDelayFrames = 60;
      this.oilCollisionFrames = 30;

      this.framesSinceLastFlagCollision = 0;
      this.flagCollisionDelayFrames = 60;
      this.flagCollisionFrames = 30;

      this.collidingOil = false;
      this.collidingFlag = false;

      if (number == 1) {
          this.sprite = new Sprite("blue_car.png");
      }
      else {
          this.sprite = new Sprite("red_car.png");
      }
      this.sprite.box.x = startX;
      this.sprite.box.y = startY;
    }

    update() {
      this.applyInput();
      this.applyPhysics();
    }  

    draw() {
      push();

      translate(this.sprite.box.x, this.sprite.box.y);
      angleMode(DEGREES);
      rotate(this.angle);
      image(this.sprite.image, 0, 0, this.sprite.box.w, this.sprite.box.h);
      
      pop();
    }

    applyInput() {
      if (this.framesSinceLastFlagCollision < this.flagCollisionFrames) {
        this.velocity.set(0, 0);
      }
      if (this.framesSinceLastOilCollision >= this.oilCollisionFrames && this.framesSinceLastFlagCollision >= this.flagCollisionFrames) {
        this.acceleration.set(0, 0);
        if (keyIsDown(this.forwardKey)) {
          this.going = true;
          let force = p5.Vector.fromAngle(radians(this.angle));
          force.mult(this.accelerationForce);
          this.acceleration.add(force);
        } else {
          this.going = false;
        }
        
        if (keyIsDown(this.leftKey) && !this.collidingOil) {
          this.angle -= this.rotationSpeed;
        }

        if (keyIsDown(this.rightKey) && !this.collidingOil) {
          this.angle += this.rotationSpeed;
        }
      }

      this.handleOilCollision();
      this.handleFlagCollision();
    }

    handleOilCollision() {
      if (this.collidingOil && this.framesSinceLastOilCollision >= this.oilCollisionDelayFrames) {
        this.angle += random(-45, 45);
        this.framesSinceLastOilCollision = 0;
      } else {
        this.framesSinceLastOilCollision++;
      }
    }

    handleFlagCollision() {
      if (this.collidingFlag && this.framesSinceLastFlagCollision >= this.flagCollisionDelayFrames) {
        this.acceleration.set(0, 0);
        this.framesSinceLastFlagCollision = 0;
        print("flag!");
      } else {
        this.framesSinceLastFlagCollision++;
      }
    }

    applyPhysics() {
      if (this.velocity.mag() > 0.1) {
        let speed = this.velocity.mag();
        let newDirection = p5.Vector.fromAngle(radians(this.angle));
        newDirection.mult(speed);
        this.velocity.lerp(newDirection, 0.3);
      }
      
      this.velocity.add(this.acceleration);
      this.velocity.limit(this.maxVelocity);
      this.velocity.mult(this.frictionForce);
      
      this.sprite.box.x += this.velocity.x;
      this.sprite.box.y += this.velocity.y;

      // проверяем, вышла ли машинка за границы экрана
      if (this.sprite.box.x < -10 || this.sprite.box.x > width + 10 || this.sprite.box.y < -10 || this.sprite.box.y > height + 10) {
        this.sprite.box.x = this.startX;
        this.sprite.box.y = this.startY;
        this.velocity.set(0, 0);
      }
    }
}
