import GameObject from './gameobject.js';

const PI_ON_180 = Math.PI / 180;

const THRUST_SPEED = 1800;
const ROTATION_SPEED = 200;
const GRAVITY_STRENGTH = 800;
const SPACE = -20000;

export default class Ship extends GameObject {
  constructor(x, y, rotation, image, game) {
    super(x, y, rotation, image);
    this.gravity = true;
    this.game = game;
  }

  thrust(deltaTime) {
    this.velocity.x += Math.cos(this.rotation * PI_ON_180) * THRUST_SPEED * deltaTime;
    this.velocity.y += Math.sin(this.rotation * PI_ON_180) * THRUST_SPEED * deltaTime * (this.game.input.thrustAmplification || 1);
  }

  rotate(deltaTime) {
    this.velocity.rotation += ROTATION_SPEED * deltaTime * (this.game.input.rotationAmplification || 1);
  }

  updateControl(deltaTime) {
    // if we are in control of the ship
    if (this.game.objective.controlShip === this) {
      // if the W key or the up arrow key or the space bar is pressed
      if (this.game.input.KeyW || this.game.input.ArrowUp || this.game.input.Space) {
        this.thrust(deltaTime);
      }
      // if the A key or the left arrow key is pressed (keyboard only)
      if (this.game.input.KeyA || this.game.input.ArrowLeft) {
        this.rotate(-deltaTime);
      }
      // if the D key or the right arrow key is pressed (keyboard only)
      if (this.game.input.KeyD || this.game.input.ArrowRight) {
        this.rotate(deltaTime);
      }
      // Joystick: slowly turn toward joystick angle (heavy/inertial) and thrust in that direction
      if (this.game.input.joystickAngle !== null && this.game.input.joystickAngle !== undefined) {
        const target = this.game.input.joystickAngle;
        let diff = ((target - this.rotation + 540) % 360) - 180;
        // Lerp velocity.rotation toward a capped target speed
        const JOYSTICK_MAX_ROT_SPEED = 150; // deg/s maximum
        const JOYSTICK_ROT_INERTIA = 12;   // lower = more inertia
        const targetRotVel = Math.sign(diff) * Math.min(Math.abs(diff), JOYSTICK_MAX_ROT_SPEED);
        this.velocity.rotation += (targetRotVel - this.velocity.rotation) * JOYSTICK_ROT_INERTIA * deltaTime;
        // Thrust in facing direction, scaled by angular alignment with joystick:
        // thrust only fires when within 20° of joystick direction
        if (Math.abs(diff) <= 20) {
          this.velocity.x += Math.cos(this.rotation * PI_ON_180) * THRUST_SPEED * deltaTime;
          this.velocity.y += Math.sin(this.rotation * PI_ON_180) * THRUST_SPEED * deltaTime;
        }
      } else if (!this.game.input.KeyA && !this.game.input.ArrowLeft && !this.game.input.KeyD && !this.game.input.ArrowRight) {
        this.velocity.rotation = 0;
      }
      // if the Escape key is pressed
      if (this.game.input.Escape) {
        // force the player to release Escape to prevent self destruct on hold
        this.game.input.Escape = false;
        this.game.explosion(this.x, this.y, 50, 500);
        this.removeEventListener('update');
        this.game.scene.remove(this);
        setTimeout(() => this.game.onCrash(this), 0);
      }
      // if the ship hits the ground
      if (this.y > this.game.groundLevel + 50) {
        this.game.explosion(this.x, this.y, 50, 500);
        this.removeEventListener('update');
        this.game.scene.remove(this);
        setTimeout(() => this.game.onCrash(this), 0);
      }
      // if the R key is pressed
      if (this.game.input.KeyR) {
        // force player to release R to prevent self destruct on hold
        this.game.input.KeyR = false;
        this.game.reset();
      }
    }
  }

  update(deltaTime) {
    this.dispatchEvent('update', deltaTime);
    this.x += this.velocity.x * deltaTime;
    this.y += this.velocity.y * deltaTime;
    this.rotation += this.velocity.rotation * deltaTime;
    this.rotation %= 360;
    while (this.rotation < 0) {
      this.rotation += 360;
    }
    while (this.rotation > 360) {
      this.rotation -= 360;
    }
    this.velocity.x -= this.velocity.x * 0.99 * deltaTime;
    this.velocity.y -= this.velocity.y * 0.99 * deltaTime;
    if (this.gravity) {
      this.velocity.y += (GRAVITY_STRENGTH
        * Math.abs((Math.max(this.y, SPACE) - SPACE) / Math.abs(SPACE)))
        * deltaTime;
    }
    this.velocity.rotation -= this.velocity.rotation * 0.9 * deltaTime;
  }

  land(deltaTime) {
    this.velocity.x = this.velocity.y = this.velocity.rotation = 0;
    // rotate towards 270 (upright)
    this.rotation += (270 - this.rotation) * deltaTime;
    // move towards x = 0
    this.x += -this.x * deltaTime;
  }

  landBottom(deltaTime) {
    this.land(deltaTime);
    // move towards original booster resting position (bottom half of full stack)
    this.y += (100 - this.y) * deltaTime;
  }

  landTop(deltaTime) {
    this.land(deltaTime);
    // move towards original Starship resting position (top half of full stack)
    this.y += (-131 - this.y) * deltaTime;
    this.gravity = false;
    // when Starship is back in place on top of the booster, trigger win
    if (Math.abs(this.x) < 1 && Math.abs(-131 - this.y) < 1 && Math.abs(270 - this.rotation) < 1) {
      this.x = 0;
      this.y = -131;
      this.rotation = 270;
      this.removeEventListener('update');
      this.game.won = true;
    }
  }
}
