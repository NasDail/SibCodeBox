class Rect {
  constructor(x, y, w, h) {
    this.x = x;
    this.y = y;
    this.w = w;
    this.h = h;
  }
}

function CreateRect(x, y, w, h) {
  return new Rect(x, y, w, h);
}

function CheckCollisionPointPoint(x1, x2, y1, y2) {
  return x1 == x2 && y1 == y2;
}

function CheckCollisionPointRect(px, py, rec) {
  return (
    px >= rec.x && px <= rec.x + rec.width && py >= rec.y && py <= rec.y + rec.height
  );
}

function GetCollisionRect(rec1, rec2) {
  let rec = new Rect(0, 0, 0, 0);

  let r1x2 = rec1.x + rec1.w;
  let r1y2 = rec1.y + rec1.h;
  let r2x2 = rec2.x + rec2.w;
  let r2y2 = rec2.y + rec2.h;

  let xmin = rec1.x > rec2.x ? rec1.x : rec2.x;
  let xmax = r1x2 < r2x2 ? r1x2 : r2x2;

  if (xmax > xmin) {
    let ymin = rec1.y > rec2.y ? rec1.y : rec2.y;
    let ymax = r1y2 < r2y2 ? r1y2 : r2y2;

    if (ymax > ymin) {
      rec.x = xmin;
      rec.y = ymin;
      rec.w = xmax - xmin;
      rec.h = ymax - ymin;
    }
  }

  return rec;
}

class Sprite {
  constructor(imagePath) {
    this.image = loadImage(imagePath);
    this.box = CreateRect(0, 0, 0, 0);
  }

  UpdateImage() {
    this.image.resize(this.box.w, this.box.h);
  }

  Resize(newW, newH) {
    this.box.w = newW;
    this.box.h = newH;

    this.UpdateImage();
  }
}
