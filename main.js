import Scene from './scenes.js';
import GameObject from './gameobject.js';
import Particle from './particle.js';
import Ship from './ship.js';
import { submitScore, getTopScores } from './leaderboard.js';
import { Share } from '@capacitor/share';
import { playSound, setThrust, stopAllSounds, stopAllExcept } from './sounds.js';

// PI_ON_180 is useful for converting degrees to radians,
// which is the form of angle that computers generally use
const PI_ON_180 = Math.PI / 180;
// this is ground level, this is the point where the Starship collides and explodes
const GROUND_LEVEL = 100;

const canvas = document.createElement('canvas');
const ctx = canvas.getContext('2d');
let dpr = window.devicePixelRatio || 1;
let appActive = true;    // false when app is backgrounded
let previousFrame = 0;   // last rAF timestamp

// object to store all input
const Input = {};
function overlayVisible() {
  return document.getElementById('overlay-name').style.display !== 'none'
    || document.getElementById('overlay-scoreboard').style.display !== 'none'
    || document.getElementById('overlay-pause').style.display !== 'none';
}

function vibrate(pattern) {
  if (navigator.vibrate) navigator.vibrate(pattern);
}

// keydown event listener (we only need the code property of the event object)
window.addEventListener('keydown', ({ code }) => {
  if (overlayVisible()) return;
  Input[code] = true;
});
window.addEventListener('keyup', ({ code }) => {
  if (overlayVisible()) return;
  Input[code] = false;
});

function touchMouseReleased() {
  Input.ArrowUp = false;
  Input.MouseDown = false;
  Input.thrustAmplification = null;
  Input.joystickAngle = null;
}

// Define joystick properties
let joystickRadius; // Joystick radius
let joystickCenter = { x: 0, y: 0 }; // Center of the joystick area

function setJoystickPosition() {

   // Set joystick radius based on device type
   if (window.innerWidth < 768) { // Assuming mobile devices have a width less than 768px
    joystickCenter.x = window.innerWidth / 2; // Center horizontally
    joystickCenter.y = window.innerHeight - (window.innerHeight / 4); // Offset from the bottom by 1/4 of the screen height
  } else {
    joystickCenter.x = window.innerWidth * .75; // Center horizontally
    joystickCenter.y = window.innerHeight - (window.innerHeight / 4); // Offset from the bottom by 1/4 of the screen height
  }
}

function setJoystickRadius() {
  // Set joystick radius based on device type
  if (window.innerWidth < 768) { // Assuming mobile devices have a width less than 768px
    joystickRadius = window.innerWidth / 3 * 0.7; // 30% smaller than original
  } else {
    joystickRadius = 50; // Fixed radius for PC
  }
}

function setPosition(e) {
  if (overlayVisible()) return;
  // Don't intercept events on UI buttons/inputs so they can receive clicks
  if (e.target && e.target.closest && e.target.closest('button, input, a, select')) return;
  e.preventDefault();
  
  // Update MouseDown state
  if (e.type === 'touchstart' || e.type === 'mousedown') {
    Input.MouseDown = true; // Set MouseDown to true on touchstart or mousedown
  } else if (e.type === 'touchend' || e.type === 'mouseup') {
    Input.MouseDown = false; // Set MouseDown to false on touchend or mouseup
    Input.ArrowUp = false;
    Input.thrustAmplification = 0;
    Input.joystickAngle = null;
    Input.x = joystickCenter.x;
    Input.y = joystickCenter.y;
  }

  // Update position for touchmove and mousemove only if MouseDown is true
  if (Input.MouseDown && (e.type === 'touchmove' || e.type === 'mousemove')) {
    let clientX, clientY;

    if (e.touches) { // For touch events
      clientX = e.touches[0].clientX;
      clientY = e.touches[0].clientY;
    } else { // For mouse events
      clientX = e.clientX;
      clientY = e.clientY;
    }

    // Calculate the distance from the joystick center
    const dx = clientX - joystickCenter.x;
    const dy = clientY - joystickCenter.y;
    const distance = Math.sqrt(dx * dx + dy * dy);

    // Limit the distance to the joystick radius
    if (distance > joystickRadius) {
      const angle = Math.atan2(dy, dx);
      Input.x = joystickCenter.x + Math.cos(angle) * joystickRadius;
      Input.y = joystickCenter.y + Math.sin(angle) * joystickRadius;
    } else {
      Input.x = clientX;
      Input.y = clientY;
    }

    // Update control inputs based on joystick position
    Input.ArrowUp = Input.y < joystickCenter.y;

    // Calculate the joystick angle for direct rocket pointing
    const jdx = Input.x - joystickCenter.x;
    const jdy = Input.y - joystickCenter.y;
    if (Math.sqrt(jdx * jdx + jdy * jdy) > joystickRadius * 0.1) {
      Input.joystickAngle = Math.atan2(jdy, jdx) * (180 / Math.PI);
    } else {
      Input.joystickAngle = null;
    }

    Input.thrustAmplification = ((window.innerHeight - Input.y) / (window.innerHeight - joystickCenter.y)) * 0.75; // Less sensitive
  }
}

// Function to render the joystick
function renderJoystick() {
  ctx.fillStyle = 'rgba(0, 0, 0, 0.3)'; // Joystick background with reduced opacity
  ctx.beginPath();
  ctx.arc(joystickCenter.x, joystickCenter.y, joystickRadius, 0, Math.PI * 2);
  ctx.fill();

  // Draw the joystick handle
  const handleX = Input.x || joystickCenter.x;
  const handleY = Input.y || joystickCenter.y;
  ctx.fillStyle = 'rgba(255, 255, 255, 0.5)'; // Joystick handle with reduced opacity
  ctx.beginPath();
  ctx.arc(handleX, handleY, joystickRadius / 2, 0, Math.PI * 2);
  ctx.fill();
}

// Add event listeners for mouse and touch events
window.document.addEventListener('mousedown', setPosition);
window.document.addEventListener('mouseup', setPosition);
window.document.addEventListener('touchstart', setPosition);
window.document.addEventListener('touchend', setPosition);
window.document.addEventListener('mousemove', setPosition);
window.document.addEventListener('touchmove', setPosition);

// Ensure the canvas is full screen and set joystick position on load
window.addEventListener('load', () => {
  fillScreen();
  setJoystickRadius(); // Set the joystick radius on load
  setJoystickPosition(); // Set the joystick position on load
});

// Ensure the joystick is positioned correctly on window resize
window.addEventListener('resize', () => {
  fillScreen();
  setJoystickRadius(); // Update the joystick radius on resize
  setJoystickPosition(); // Update the joystick position on resize
});

// Function to fit the canvas to the window
function fillScreen() {
  dpr = window.devicePixelRatio || 1;
  canvas.width = window.innerWidth * dpr;
  canvas.height = window.innerHeight * dpr;
  canvas.style.width = window.innerWidth + 'px';
  canvas.style.height = window.innerHeight + 'px';
}

function img(src) {
  const image = new Image();
  image.src = src;
  return image;
}

// store all the images in one Image object
const Images = {
  ship: img('./StarshipSprites/fullstack.png'),
  shipTop: img('./StarshipSprites/starship.png'),
  shipBottom: img('./StarshipSprites/booster.png'),
  starlink: img('./images/Starlink.png'),
  launchpad: img('./images/Launchpad.png'),
  tower: img('./StarshipSprites/Tower.png'),
  chopsticks: img('./StarshipSprites/Chopsticks.png'),
  ground: img('./images/Ground.png'),
  earth: img('./images/Earth1.png'),
  arrow_white: img('./images/Arrow White.png'),
};

class Game {
  constructor() {
    this.groundLevel = GROUND_LEVEL;
    this.input = Input;
    this.started = false; // whether or not the game has started yet
    this.launched = false; // whether or not the Starship has launched yet
    this.launchTime = null; // the time when the Starship will launch
    this.starlinksReleased = false; // whether or not the Starlink satellites have been released
    this.won = false; // whether or not the game has been won
    this.wonAt = null; // timestamp when the game was won
    this.topScores = []; // cached top scores for mini leaderboard
    this.missionStartTime = null; // timestamp when the rocket launched
    this.missionTime = 0; // elapsed mission time in ms
    this.bestTime = parseFloat(localStorage.getItem('bestTime')) || null;
    this.checkpointInSpace = false; // checkpoint: stage separation done
    this.checkpointBoosterLanded = false; // checkpoint: booster has landed
    this.checkpointTime = 0; // missionTime (ms) when the last checkpoint was reached
    this.penaltyMs = 0; // accumulated crash penalty in ms (1000 per checkpoint resume)
    this.penaltyWaivers = 0;
    this.checkpointTextTimer = 0; // how long to show checkpoint text (ms)
    this.checkpointText = ''; // message shown when a checkpoint is reached
    this.descentAlerts = { 40: false, 30: false, 20: false }; // altitude descent warnings (km)
    this.invertPromptTimer = 0; // how long to show the invert prompt (ms)
    this.confetti = []; // world-record confetti pieces
    this.particles = []; // array to store all particles created
    this.stars = []; // WIP
    // object to store info on the current objective
    this.objective = {
      name: 'space', // the current objectives name
      text: 'Get to orbit!', // the text displayed explaining the current objective to the user
      x: 0, // the x coordinate of the objective (if type is "location")
      y: -20000, // the y coordinate of the objective (if type is "location")
      type: 'location', // the type of objective
      controlShip: null, // which ship the player currently has control of (keyboard input)
    };
    // camera object to allow 'scrolling', the camera will follow the player
    // smoothing enables a smooth camera follow (although the screen-shake kind of nullifies this...)
    this.Camera = {
      x: 0,
      y: 0,
      smoothing: .2,
    };
    // init
    this.scene = new Scene();
    const ground = new GameObject(0, 220, 0, Images.ground);
    this.scene.add(ground);
    const launchpad = new GameObject(0, 300, 0, Images.launchpad);
    this.scene.add(launchpad);
    const tower = new GameObject(0, 40, 0, Images.tower);
    this.scene.add(tower);
    this.chopsticks = new GameObject(1, -130, 0, Images.chopsticks);
    this.scene.add(this.chopsticks);
    this.shipFull = new Ship(0, 0, 0, Images.ship, this);
    this.shipTop = new Ship(0, 0, 0, Images.shipTop, this);
    this.shipBottom = new Ship(0, 0, 0, Images.shipBottom, this);
    this.shipFull.rotation = 270; // start upright
    // create a ship variable (let not const so it's value can be changed, note objects are assigned by reference which is why this works)
    this.ship = this.shipFull;
    this.objective.controlShip = this.ship;
    this.scene.add(this.ship);
    this.ship.addEventListener('update', this.ship.updateControl);
    this.loadLeaderboard();
  }

  // a function to create an explosion effect with particles
  // takes in the x and y coordinates of the explosion, how far the particles should spread, and how many particles should be created
  explosion(x, y, spread, count) {
    vibrate([300]);
    stopAllExcept('explosion');
    playSound('explosion');
    const game = this;
    const fifth = count / 5; // a fifth of the particles to be created
    const fourFifths = 4 * fifth; // four fifths of the particles created
    // four fifths of the particles
    for (let i = 0; i < fourFifths; i += 1) {
      // create a particle at the x and y coordinates plus a random offset based on half the spread, with a velocity of 100 and a color of rgb(255,165,0) (orange)
      const particle = new Particle(x + Math.random() * spread - spread / 2, y + Math.random() * spread - spread / 2, Math.random() * 360, 100, [255, 165, 0]);
      particle.start_time = performance.now();
      // add an update event listener to the particle (called each frame)
      particle.addEventListener('update', function update(deltaTime) {
        // slowly fade out the particles
        particle.colour[3] -= deltaTime * 1;
        // if the time elapsed between the particle being created and now is greater than 1 second (1000 milliseconds)
        if (performance.now() - particle.start_time > 1000) {
          // remove the particle from the array of particles
          game.particles.splice(game.particles.indexOf(this), 1);
        }
      });
      game.particles.push(particle);
    }
    // a fifth of the particles
    for (let i = 0; i < fifth; i += 1) {
      const particle = new Particle(x + Math.random() * spread * 2 - spread, y + Math.random() * spread * 2 - spread, Math.random() * 360, 100, [255, 0, 0]);
      particle.start_time = performance.now();
      particle.addEventListener('update', function update(deltaTime) {
        particle.colour[3] -= deltaTime * 1;
        if (performance.now() - particle.start_time > 1000) {
          game.particles.splice(game.particles.indexOf(this), 1);
        }
      });
      game.particles.push(particle);
    }
  }

  // a function to reset all variables easily (many variables are defined below but still accessible because of hoisting)
  reset() {
    this.shipFull.gravity = true;
    this.shipFull.x = 0;
    this.shipFull.velocity.x = this.shipFull.velocity.y = this.shipFull.velocity.rotation = 0; // set all velocities and x coordinate of the ship to 0
    this.shipFull.y = 0; // set the ship's y to -200 (to align with landing pad etc)
    this.shipFull.rotation = 270; // set the ship's rotation to 270 (in the unit circle 270 or 3/2 pi is upright)
    this.shipFull.removeEventListener('update');
    this.shipTop.gravity = true;
    this.shipTop.x = this.shipTop.y = this.shipTop.rotation = this.shipTop.velocity.x = this.shipTop.velocity.y = this.shipTop.velocity.rotation = 0; // set all velocities and x and y coordinates of the ship top to 0
    this.shipTop.removeEventListener('update');
    this.shipBottom.gravity = true;
    this.shipBottom.x = this.shipBottom.y = this.shipBottom.rotation = this.shipBottom.velocity.x = this.shipBottom.velocity.y = this.shipBottom.velocity.rotation = 0; // set all velocities and x and y coordinates of the ship bottom to 0
    this.shipBottom.removeEventListener('update');
    // remove the ships from the scene (doesn't have any impact if they aren't in the scene)
    this.scene.remove(this.shipFull);
    this.scene.remove(this.shipTop);
    this.scene.remove(this.shipBottom);
    // reset the global variables
    this.started = false;
    this.launched = false;
    this.launchTime = null;
    this.starlinksReleased = false;
    this.won = false;
    this.wonAt = null;
    this.missionStartTime = null;
    this.missionTime = 0;
    this.checkpointInSpace = false;
    this.checkpointBoosterLanded = false;
    this.checkpointTime = 0;
    this.penaltyMs = 0;
    this.penaltyWaivers = 0;
    this.checkpointTextTimer = 0;
    this.checkpointText = '';
    this.descentAlerts = { 40: false, 30: false, 20: false };
    this.invertPromptTimer = 0;
    this.confetti = [];
    // reset the default objective
    this.objective.name = 'space';
    this.objective.text = 'Get to orbit!';
    this.objective.x = 0;
    this.objective.y = -20000;
    this.objective.type = 'location';
    // reset the ship being used
    this.ship = this.shipFull; // set the ship we are using is the full ship, not one of the parts
    this.objective.controlShip = this.ship;
    this.ship.addEventListener('update', this.ship.updateControl);
    this.scene.add(this.ship);
    this.loadLeaderboard();
  }

  resetToCheckpoint(noPenalty = false) {
    // Restore booster to its landed position
    this.shipBottom.gravity = false;
    this.shipBottom.x = 0;
    this.shipBottom.y = 100;
    this.shipBottom.rotation = 270;
    this.shipBottom.velocity.x = this.shipBottom.velocity.y = this.shipBottom.velocity.rotation = 0;
    this.shipBottom.removeEventListener('update');
    this.scene.remove(this.shipBottom);
    this.scene.add(this.shipBottom);
    // Respawn Starship high enough for the player to regain control
    this.shipTop.gravity = true;
    this.shipTop.x = 0;
    this.shipTop.y = -22000;
    this.shipTop.rotation = 270;
    this.shipTop.velocity.x = this.shipTop.velocity.y = this.shipTop.velocity.rotation = 0;
    this.shipTop.removeEventListener('update');
    this.ship = this.shipTop;
    this.objective.controlShip = this.ship;
    this.ship.addEventListener('update', this.ship.updateControl);
    this.scene.add(this.ship);
    // Restore objective
    this.objective.name = 'landing pad';
    this.objective.text = 'Land the Starship';
    this.objective.type = 'location';
    this.objective.x = 0;
    this.objective.y = -131;
    this.won = false;
    this.descentAlerts = { 40: false, 30: false, 20: false };
    this.invertPromptTimer = 0;
    if (!noPenalty) this.penaltyMs += 1000;
    // Reset displayed clock to checkpoint time
    this.missionStartTime = performance.now() - this.checkpointTime;
  }

  resetToSpaceCheckpoint(noPenalty = false) {
    // Remove any ships from the scene
    this.scene.remove(this.shipFull);
    this.scene.remove(this.shipTop);
    this.scene.remove(this.shipBottom);
    // Reset booster so it is in the scene and ready for landing after Starlinks deploy
    this.shipBottom.gravity = true;
    this.shipBottom.x = 4700;
    this.shipBottom.y = -26200;
    this.shipBottom.rotation = 270;
    this.shipBottom.velocity.x = 80;
    this.shipBottom.velocity.y = 80;
    this.shipBottom.velocity.rotation = 0;
    this.shipBottom.removeEventListener('update');
    this.scene.add(this.shipBottom);
    // Respawn Starship in space for Starlink deployment
    this.shipTop.gravity = true;
    this.shipTop.x = 5000;
    this.shipTop.y = -26000;
    this.shipTop.rotation = 270;
    this.shipTop.velocity.x = this.shipTop.velocity.y = this.shipTop.velocity.rotation = 0;
    this.shipTop.removeEventListener('update');
    this.ship = this.shipTop;
    this.objective.controlShip = this.ship;
    this.ship.addEventListener('update', this.ship.updateControl);
    this.scene.add(this.ship);
    // Reset Starlink deployment so it runs again from this checkpoint
    this.starlinksReleased = false;
    this.objective.name = 'Starlink satellites';
    this.objective.text = 'Deploying Starlink satellites...';
    this.objective.type = 'interact';
    // Booster checkpoint not yet reached
    this.checkpointBoosterLanded = false;
    this.won = false;
    this.descentAlerts = { 40: false, 30: false, 20: false };
    this.invertPromptTimer = 0;
    if (!noPenalty) this.penaltyMs += 1000;
    // Reset displayed clock to checkpoint time
    this.missionStartTime = performance.now() - this.checkpointTime;
  }

  // Called by ship.js after the explosion delay (ship already removed from scene)
  onCrash() {
    this.objective.controlShip = null; // prevent engineFiring from re-triggering thrust sound this frame
    this.doReset();
  }

  // Resolves the correct reset based on checkpoint state.
  // Automatically consumes a penalty waiver if the player has one.
  doReset(noPenalty = false) {
    if (!noPenalty && this.penaltyWaivers > 0) {
      this.penaltyWaivers--;
      noPenalty = true;
    }
    if (this.checkpointBoosterLanded) {
      this.resetToCheckpoint(noPenalty);
    } else if (this.checkpointInSpace) {
      this.resetToSpaceCheckpoint(noPenalty);
    } else {
      this.reset();
    }
  }

  loadLeaderboard() {
    getTopScores(10).then((scores) => { this.topScores = scores; });
  }

  Update(deltaTime) {
    const game = this;
    if (this.checkpointTextTimer > 0) {
      this.checkpointTextTimer -= deltaTime * 1000;
    }
    if (this.started) {
      if (this.launched || this.launchTime - performance.now() <= 0) {
        if (!this.launched) {
          this.launched = true;
          this.missionStartTime = performance.now();
          // move and rotate the ship slightly
          //this.ship.x = -20;
          this.ship.rotation = -91;
          vibrate([100, 50, 100, 50, 200]);
        }
        this.scene.update(deltaTime);
      }
      if (this.objective.name === 'space') {
        if (this.ship.y < this.objective.y) {
          // update the objective
          this.objective.name = 'correct position';
          this.objective.text = 'Move into the correct position';
          this.objective.x = 5000;
          this.objective.y = -25000;
        }
      } /* if the objective is correct position */ else if (this.objective.name === 'correct position') {
        // if the Starship is less than 5km away from the location
        if (Math.sqrt((this.ship.x - this.objective.x) ** 2 + (this.ship.y - this.objective.y) ** 2) < 1000) {
          // update the objective and schedule auto-separation
          this.objective.name = 'Stage separation';
          this.objective.text = 'Stage separation in progress...';
          this.objective.type = 'interact';
          this.objective.controlShip = null;
          const game = this;
          setTimeout(() => {
            game.shipBottom.x = game.shipTop.x = game.ship.x;
            game.shipBottom.y = game.shipTop.y = game.ship.y;
            game.shipBottom.rotation = game.shipTop.rotation = game.ship.rotation;
            game.shipBottom.velocity.x = game.shipTop.velocity.x = game.shipBottom.velocity.y = game.shipTop.velocity.y = 0;
            game.shipBottom.velocity.rotation = game.shipTop.velocity.rotation = game.ship.velocity.rotation;
            game.shipTop.x += Math.cos(game.ship.rotation * PI_ON_180) * 100;
            game.shipTop.y += Math.sin(game.ship.rotation * PI_ON_180) * 100;
            game.shipTop.thrust(0.15);
            game.shipBottom.x += Math.cos(game.ship.rotation * PI_ON_180) * -100;
            game.shipBottom.y += Math.sin(game.ship.rotation * PI_ON_180) * -100;
            game.shipBottom.thrust(-0.15);
            game.ship.removeEventListener('update');
            game.scene.remove(game.ship);
            game.ship = game.shipTop;
            game.objective.controlShip = game.ship;
            game.ship.addEventListener('update', game.ship.updateControl);
            game.scene.add(game.ship);
            game.scene.add(game.shipBottom);
            game.objective.name = 'Starlink satellites';
            game.objective.text = 'Deploying Starlink satellites...';
            game.objective.type = 'interact';
            vibrate([50, 30, 50, 30, 150]);
          }, 2000);
        }
      } else if (this.objective.name === 'Starlink satellites') {
        this.ship.velocity.x = this.ship.velocity.y = 100;
        this.ship.velocity.rotation = 0;
        if (!this.starlinksReleased) {
          for (let i = 1; i <= 10; i += 1) {
            const starlink = new GameObject(0, 0, 0, Images.starlink);
            starlink.id = i;
            starlink.addEventListener('update', function update(deltaTime2) {
              this.velocity.x += Math.cos(this.rotation * PI_ON_180) * 15 * deltaTime2;
              this.velocity.y += Math.sin(this.rotation * PI_ON_180) * 15 * deltaTime2;
              if (Math.abs(game.ship.x - this.x) > window.innerWidth || Math.abs(game.ship.y - this.y) > window.innerHeight) {
                game.scene.remove(this);
                if (this.id === 10) {
                  game.objective.name = 'landing pad';
                  game.objective.text = 'Land the booster';
                  game.objective.type = 'location';
                  game.objective.x = 0;
                  game.objective.y = 100;
                  game.ship.removeEventListener('update');
                  game.ship = game.shipBottom;
                  game.objective.controlShip = game.ship;
                  game.ship.addEventListener('update', game.ship.updateControl);
                  // Checkpoint: Starlinks deployed, camera now on booster
                  game.checkpointInSpace = true;
                  game.checkpointTime = game.missionTime;
                  game.checkpointText = 'Checkpoint saved!';
                  game.checkpointTextTimer = 3000;
                  vibrate([50, 30, 50, 30, 150]);
                }
              }
            });
            setTimeout(() => {
              starlink.x = game.ship.x + Math.cos((game.ship.rotation) * PI_ON_180) * -5;
              starlink.y = game.ship.y + Math.sin((game.ship.rotation) * PI_ON_180) * -5;
              starlink.rotation = game.ship.rotation - 90;
              game.scene.add(starlink);
            }, starlink.id * 500);
          }
          this.starlinksReleased = true;
          vibrate([30, 20, 30, 20, 30, 20, 30, 20, 30, 20, 30]);
          playSound('starlink');
        }
      } else if (this.objective.name === 'landing pad') {
        if (this.objective.text === 'Land the booster') {
          if (Math.abs(this.ship.x - this.objective.x) < 200 && Math.abs(this.ship.y - this.objective.y) < 200 && (this.ship.rotation > 220 && this.ship.rotation < 320)) {
            this.ship.removeEventListener('update');
            this.ship.addEventListener('update', this.ship.landBottom);
            this.ship = this.shipTop;
            this.objective.controlShip = this.ship;
            this.ship.addEventListener('update', this.ship.updateControl);
            this.objective.text = 'Land the Starship';
            this.objective.x = 0;
            this.objective.y = -131;
            this.checkpointBoosterLanded = true;
            this.checkpointTime = this.missionTime;
            this.checkpointText = 'Checkpoint saved! Booster landed.';
            this.checkpointTextTimer = 3000;
            this.descentAlerts = { 40: false, 30: false, 20: false };
            this.invertPromptTimer = 0;
            vibrate([200, 100, 400]);
          }
        } else if (this.objective.text === 'Land the Starship') {
          if (Math.abs(this.ship.x - this.objective.x) < 200 && Math.abs(this.ship.y - this.objective.y) < 200 && (this.ship.rotation > 220 && this.ship.rotation < 320)) {
            this.ship.removeEventListener('update');
            this.ship.addEventListener('update', this.ship.landTop);
            this.objective.text = '';
            this.objective.controlShip = null;
            this.objective.type = 'animation';
          }
        }
      }
      // Determine if engine is firing: keyboard OR joystick aligned within 20°
      let engineFiring = false;
      if (this.objective.controlShip) {
        if (this.input.KeyW || this.input.ArrowUp || this.input.Space) {
          engineFiring = true;
        } else if (this.input.joystickAngle !== null && this.input.joystickAngle !== undefined) {
          const jDiff = ((this.input.joystickAngle - this.ship.rotation + 540) % 360) - 180;
          if (Math.abs(jDiff) <= 20) engineFiring = true;
        }
      }
      setThrust(engineFiring);
      if (engineFiring && this.particles.length < 100) {
        const nozzleOffset = this.ship.image.width / 2;
        for (let i = 0; i < 4; i += 1) {
          const angleInRadians = (this.ship.rotation + 180) * PI_ON_180;
          const particle = new Particle(this.ship.x + Math.cos(angleInRadians) * (nozzleOffset + Math.random() * 40 - 20), this.ship.y + Math.sin(angleInRadians) * (nozzleOffset + Math.ceil(Math.random() * 20)), this.ship.rotation + 180 + Math.random() * 30 - 15, 800, [140, 20, 252]);
          particle.created_at = performance.now();
          particle.addEventListener('update', function update() {
            if (performance.now() - particle.created_at >= 100) {
              game.particles.splice(game.particles.indexOf(this), 1);
            }
          });
          this.particles.push(particle);
        }
      }
      // update mission timer
      if (this.launched && !this.won) {
        this.missionTime = performance.now() - this.missionStartTime;
      }
      // descent altitude warnings (during landing phases only)
      if (this.objective.name === 'landing pad' && this.objective.controlShip && this.ship.velocity.y > 30) {
        const altKm = Math.abs(this.ship.y) / 200;
        if (altKm <= 40 && !this.descentAlerts[40]) {
          this.descentAlerts[40] = true;
          vibrate([200, 100, 200]);
        }
        if (altKm <= 30 && !this.descentAlerts[30]) {
          this.descentAlerts[30] = true;
          vibrate([300, 100, 300]);
        }
        if (altKm <= 20 && !this.descentAlerts[20]) {
          this.descentAlerts[20] = true;
          vibrate([400, 100, 400, 100, 400]);
          this.invertPromptTimer = 6000;
        }
      }
      // tick invert prompt timer
      if (this.invertPromptTimer > 0) {
        this.invertPromptTimer -= deltaTime * 1000;
      }
      // handle win
      if (this.won) {
        if (this.wonAt === null) {
          this.wonAt = performance.now();
          vibrate([100, 50, 100, 50, 600]);
          stopAllSounds();
          playSound('victory');
          const finalTime = this.missionTime + this.penaltyMs;
          if (this.bestTime === null || finalTime < this.bestTime) {
            this.bestTime = finalTime;
            localStorage.setItem('bestTime', this.bestTime);
          }
          const playerName = localStorage.getItem('starshipPlayerName') || 'Anonymous';
          submitScore(playerName, finalTime).then(() => {
            getTopScores(10).then((scores) => {
              this.topScores = scores;
              const isWR = scores.length > 0
                && scores[0].name.toLowerCase() === playerName.toLowerCase()
                && Math.round(scores[0].time) === Math.round(finalTime);
              if (isWR) {
                this.confetti = spawnConfetti();
                vibrate([100, 50, 100, 50, 100, 50, 100, 50, 800]);
                playSound('worldrecord');
              }
              showScoreboard(scores, finalTime, isWR);
            });
          });
        }
      }
    } else if (this.input.KeyW || this.input.ArrowUp || this.input.Space) {
      this.started = true;
      this.launchTime = performance.now() + 5000;
      this.launched = false;
    }
    for (let i = 0; i < this.particles.length; i += 1) {
      this.particles[i].update(deltaTime);
    }
    // stars
    if (this.ship.y < -15000) {
      const starCount = (window.innerWidth * window.innerHeight) / 5000;
      while (game.stars.length < starCount) {
        const starY = game.ship.y + Math.random() * window.innerHeight - window.innerHeight / 2;
        const star = new Particle(game.ship.x + Math.random() * window.innerWidth - window.innerWidth / 2, starY, Math.random() * 360, 0, [255, 255, 255, starY > -18000 ? 1 - (18000 + starY) / 3000 : 1]);
        star.addEventListener('update', function update() {
          if (Math.abs(game.ship.x - this.x) > window.innerWidth || Math.abs(game.ship.y - this.y) > window.innerHeight) {
            game.stars.splice(game.stars.indexOf(this), 1);
          }
        });
        this.stars.push(star);
      }
    } else {
      this.stars.splice(0, this.stars.length);
    }
    for (let i = 0; i < this.stars.length; i += 1) {
      this.stars[i].update(deltaTime);
    }
    if (this.confetti.length > 0) updateConfetti(this.confetti, deltaTime);
    // smooth camera follow
    this.Camera.x += ((window.innerWidth / 2 - this.ship.x) - this.Camera.x) * this.Camera.smoothing;
    this.Camera.y += ((window.innerHeight / 2 - this.ship.y) - this.Camera.y) * this.Camera.smoothing;
    
    // camera shake (based on the ships velocity)
    if (this.started) {
      const averageVelocity = Math.floor(Math.abs(this.ship.velocity.x + this.ship.velocity.y) / 2);
      const SHAKE_CONSTANT = 0.037;
      this.Camera.x += Math.random() * averageVelocity * SHAKE_CONSTANT - (averageVelocity * SHAKE_CONSTANT) / 2;
      this.Camera.y += Math.random() * averageVelocity * SHAKE_CONSTANT - (averageVelocity * SHAKE_CONSTANT) / 2;
      if (!this.launched && this.objective.name === 'space' && (this.input.KeyW || this.input.ArrowUp || this.input.Space)) {
        this.Camera.x += Math.random() * 100 * SHAKE_CONSTANT - (100 * SHAKE_CONSTANT) / 2;
        this.Camera.y += Math.random() * 100 * SHAKE_CONSTANT - (100 * SHAKE_CONSTANT) / 2;
      }
    }
  }

  formatTime(ms) {
    const totalSecs = ms / 1000;
    const m = Math.floor(totalSecs / 60);
    const s = (totalSecs % 60).toFixed(2).padStart(5, '0');
    return `${m}:${s}`;
  }

  // render
  Render() {
    // reset the canvas transform matrix (undo any transformations/rotations)
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    // Background {
    // scale = the distance between the ship and space scaled to be from 0 to 1
    let scale = 1 - Math.abs((Math.max(this.ship.y, -20000) + 20000) / 20000);
    // set the fillStyle to gradually turn black as the scale increases to 1
    ctx.fillStyle = `rgb(${116 - 116 * scale},${162 - 162 * scale}, ${255 - 255 * scale})`;
    // fill the screen (also clearing the previous screen)
    ctx.fillRect(0, 0, window.innerWidth, window.innerHeight);
    // }
    // Ground {
    // if the camera can see the ground
    if (this.Camera.y + window.innerWidth > this.Camera.y + GROUND_LEVEL + 150) {
      // draw the ground
      // (a darker green line)
      ctx.strokeStyle = 'rgb(10,142,47)';
      // make the line thicker
      ctx.lineWidth = 8;
      // draw the line
      ctx.beginPath();
      ctx.moveTo(0, this.Camera.y + GROUND_LEVEL + 168);
      ctx.lineTo(window.innerWidth, this.Camera.y + GROUND_LEVEL + 168);
      ctx.closePath();
      // display the line
      ctx.stroke();
      // (a lighter green rectangle from ground level to the bottom of the screen)
      ctx.fillStyle = 'rgb(11,176,58)';
      ctx.fillRect(0, this.Camera.y + GROUND_LEVEL + 168, window.innerWidth, window.innerHeight - this.Camera.y + GROUND_LEVEL + 150);
    }
    // }
    // Stars {
    // for each star
    for (let i = 0; i < this.stars.length; i += 1) {
      // render it (passing in the canvas context and the Camera)
      this.stars[i].render(ctx, this.Camera);
    }
    // }
    // Earth {
    // if the ship is less than 25km from space
    if (this.ship.y < -15000) {
      scale = 2 - Math.min(-(this.ship.y + 15000) / 7500, 2);
      // Earth1.png is 602px vs the original 1000px — scale up to match visual size
      const earthDrawScale = scale * (1000 / 602);
      const yOffset = Math.max((this.ship.y + 15000) / 100, -200);
      const earthW = window.innerWidth * earthDrawScale;
      const earthX = window.innerWidth / 2 - earthW / 2;
      const earthY = window.innerHeight + yOffset;
      const earthCX = window.innerWidth / 2;
      const earthCY = earthY + earthW / 2;
      const earthR = earthW / 2;
      // Atmosphere glow — fades in as the ship enters space
      const atmosAlpha = Math.min(scale / 1.2, 1);
      const atmosOuter = earthR * 1.28;
      const atmosGrad = ctx.createRadialGradient(earthCX, earthCY, earthR * 0.88, earthCX, earthCY, atmosOuter);
      atmosGrad.addColorStop(0, `rgba(100, 180, 255, ${0.55 * atmosAlpha})`);
      atmosGrad.addColorStop(0.45, `rgba(60, 140, 255, ${0.22 * atmosAlpha})`);
      atmosGrad.addColorStop(1, `rgba(20, 80, 200, 0)`);
      ctx.fillStyle = atmosGrad;
      ctx.beginPath();
      ctx.arc(earthCX, earthCY, atmosOuter, 0, Math.PI * 2);
      ctx.fill();
      // Earth
      ctx.drawImage(Images.earth, earthX, earthY, earthW, earthW);
    }
    // }
    // Scene {
    this.scene.render(ctx, this.Camera);
    // }
    // Particles {
    const game = this;
    for (let i = 0; i < game.particles.length; i += 1) {
      if (game.Camera.x + game.particles[i].x >= 0 && game.Camera.x + game.particles[i].x <= window.innerWidth && game.Camera.y + this.particles[i].y >= 0 && game.Camera.y + game.particles[i].y <= window.innerHeight) {
        game.particles[i].render(ctx, game.Camera);
      }
    }
    // }
    // UI {
    // HUD scale: 1.0 at 1200px wide, smaller on mobile, capped at 1.6 on large screens
    const hudScale = Math.max(0.5, Math.min(1.6, window.innerWidth / 1200));
    const hudPx = (base) => Math.round(base * hudScale);
    const hudFontLg = `${hudPx(20)}px Trebuchet MS`;
    const hudFontMd = `${hudPx(16)}px Trebuchet MS`;
    const hudFontSm = `${hudPx(13)}px Trebuchet MS`;
    const hudFontSmBold = `bold ${hudPx(13)}px Trebuchet MS`;
    const hudFontXl = `${hudPx(28)}px Trebuchet MS`;
    const hudLineH = hudPx(26);

    ctx.fillStyle = '#ffffff';
    ctx.font = hudFontXl;
    ctx.textAlign = 'center';
    if (this.started) {
      if (!this.launched) {
        ctx.fillText(`Launch in T${((performance.now() - this.launchTime) / 1000).toFixed(2)}`, Math.floor(window.innerWidth / 2), Math.floor(window.innerHeight / 4));
      } else if (this.won) {
        ctx.fillText('Mission Success!', Math.floor(window.innerWidth / 2), Math.floor(window.innerHeight / 4));
      }
    } else {
      ctx.fillText('Press space or tap to start!', Math.floor(window.innerWidth / 2), Math.floor(window.innerHeight / 4));
      ctx.font = hudFontMd;
      ctx.fillText('On mobile, tap higher for thrust, lower half to rotate', Math.floor(window.innerWidth / 2), Math.floor(window.innerHeight / 4) + hudPx(30));
    }
    // timer + best time (top center) — always visible
    const timeCx = Math.floor(window.innerWidth / 2);
    const timeStr = this.formatTime(this.missionTime);
    ctx.fillStyle = '#ffffff';
    if (this.penaltyMs > 0) {
      const penaltySecs = Math.round(this.penaltyMs / 1000);
      const penaltyStr = `+${penaltySecs}s`;
      ctx.font = `${hudPx(22)}px Trebuchet MS`;
      ctx.textAlign = 'left';
      const timeWidth = ctx.measureText(timeStr).width;
      ctx.font = `${hudPx(15)}px Trebuchet MS`;
      const penaltyWidth = ctx.measureText(penaltyStr).width;
      const gap = hudPx(4);
      const groupWidth = timeWidth + gap + penaltyWidth;
      const groupX = timeCx - groupWidth / 2;
      ctx.font = `${hudPx(22)}px Trebuchet MS`;
      ctx.fillText(timeStr, groupX, hudPx(30));
      ctx.font = `${hudPx(15)}px Trebuchet MS`;
      ctx.fillStyle = '#ff4444';
      ctx.fillText(penaltyStr, groupX + timeWidth + gap, hudPx(30));
    } else {
      ctx.font = `${hudPx(22)}px Trebuchet MS`;
      ctx.textAlign = 'center';
      ctx.fillText(timeStr, timeCx, hudPx(30));
    }
    ctx.font = hudFontMd;
    ctx.textAlign = 'center';
    ctx.fillStyle = this.won && this.bestTime !== null && this.missionTime === this.bestTime ? '#ffd700' : 'rgba(255,255,255,0.6)';
    ctx.fillText(this.bestTime !== null ? `Best: ${this.formatTime(this.bestTime)}` : 'Best: --:--.--', timeCx, hudPx(54));
    // objective + telemetry (top left)
    ctx.font = hudFontLg;
    ctx.textAlign = 'left';
    ctx.fillStyle = '#ffffff';
    ctx.fillText(this.objective.text, 10, hudLineH);
    ctx.fillText(`Rotation: ${Math.round(this.ship.rotation) % 360}°`, 10, hudLineH * 2);
    ctx.fillText(`Altitude: ${Math.abs(this.ship.y / 200).toFixed(2)}km`, 10, hudLineH * 3);
    // Mini leaderboard (left HUD)
    if (this.topScores.length > 0) {
      const playerName = localStorage.getItem('starshipPlayerName') || '';
      const lbStartY = hudLineH * 3 + hudPx(22);
      const lbRightX = hudPx(220);
      const lbRowH = hudPx(18);
      ctx.font = hudFontSmBold;
      ctx.fillStyle = 'rgba(255,255,255,0.5)';
      ctx.textAlign = 'left';
      ctx.fillText('TOP 10', 10, lbStartY);
      ctx.font = hudFontSm;
      this.topScores.forEach((entry, i) => {
        const y = lbStartY + lbRowH + i * lbRowH;
        ctx.fillStyle = entry.name === playerName ? 'rgba(255,215,0,0.9)' : 'rgba(255,255,255,0.55)';
        ctx.fillText(`${i + 1}. ${entry.name}`, 10, y);
        ctx.textAlign = 'right';
        ctx.fillText(this.formatTime(entry.time), lbRightX, y);
        ctx.textAlign = 'left';
      });
    }
    // arrow pointing to the objective
    if (this.objective.type === 'location') {
      ctx.translate(window.innerWidth / 2, hudPx(110));
      ctx.rotate(Math.atan2(this.objective.y - this.ship.y, this.objective.x - this.ship.x) + Math.PI / 2);
      ctx.drawImage(Images.arrow_white, -Images.arrow_white.width / 2, -Images.arrow_white.height / 2);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.font = hudFontMd;
      ctx.textAlign = 'center';
      ctx.fillStyle = '#ffffff';
      ctx.fillText(`${(Math.sqrt((this.ship.x - this.objective.x) ** 2 + (this.ship.y - this.objective.y) ** 2) / 200).toFixed(2)}km to ${this.objective.name}`, window.innerWidth / 2, hudPx(180));
    }
    // Checkpoint saved text
    if (this.checkpointTextTimer > 0) {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = `rgba(0, 255, 136, ${Math.min(this.checkpointTextTimer / 500, 1)})`;
      ctx.font = hudFontLg;
      ctx.textAlign = 'center';
      ctx.fillText(this.checkpointText || 'Checkpoint saved!', window.innerWidth / 2, window.innerHeight / 2);
    }
    // Invert-for-landing prompt
    if (this.invertPromptTimer > 0) {
      const alpha = Math.min(this.invertPromptTimer / 500, 1);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.textAlign = 'center';
      ctx.font = hudFontLg;
      ctx.fillStyle = `rgba(255, 80, 80, ${alpha})`;
      ctx.fillText('INVERT FOR LANDING', window.innerWidth / 2, window.innerHeight / 2 - 40);
      ctx.font = hudFontMd;
      ctx.fillStyle = `rgba(255, 200, 80, ${alpha})`;
      ctx.fillText('Rotate upright ↑ to prepare', window.innerWidth / 2, window.innerHeight / 2);
    }
    // Render the joystick
    renderJoystick();
    // World-record confetti (screen-space, on top of everything)
    if (this.confetti.length > 0) {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      renderConfetti(this.confetti);
    }
  }
}

// --- Confetti ---
const CONFETTI_COLORS = ['#ffd700','#ff4e50','#00e5ff','#69ff47','#ff6fd8','#ffffff'];
function spawnConfetti() {
  const pieces = [];
  for (let i = 0; i < 160; i++) {
    pieces.push({
      x: Math.random() * window.innerWidth,
      y: -10 - Math.random() * 200,
      vx: (Math.random() - 0.5) * 180,
      vy: 120 + Math.random() * 220,
      rotation: Math.random() * 360,
      vr: (Math.random() - 0.5) * 400,
      w: 7 + Math.random() * 7,
      h: 4 + Math.random() * 4,
      color: CONFETTI_COLORS[Math.floor(Math.random() * CONFETTI_COLORS.length)],
      alpha: 1,
    });
  }
  return pieces;
}

function updateConfetti(pieces, deltaTime) {
  for (let i = pieces.length - 1; i >= 0; i--) {
    const p = pieces[i];
    p.x += p.vx * deltaTime;
    p.y += p.vy * deltaTime;
    p.rotation += p.vr * deltaTime;
    p.vy += 60 * deltaTime; // gentle gravity
    if (p.y > window.innerHeight + 20) p.alpha -= deltaTime * 2;
    if (p.alpha <= 0) pieces.splice(i, 1);
  }
}

function renderConfetti(pieces) {
  for (const p of pieces) {
    ctx.save();
    ctx.globalAlpha = Math.max(0, p.alpha);
    ctx.translate(p.x, p.y);
    ctx.rotate(p.rotation * Math.PI / 180);
    ctx.fillStyle = p.color;
    ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
    ctx.restore();
  }
  ctx.globalAlpha = 1;
}

// --- Share ---
const GAME_URL = 'https://spacex-starship-lander.pages.dev/';

async function shareGame() {
  const name = localStorage.getItem('starshipPlayerName') || 'Anonymous';
  const bestMs = parseFloat(localStorage.getItem('bestTime'));
  const rank = window._shareRank || null;

  let text = `🚀 I'm ${name} and I landed the SpaceX Starship`;
  if (bestMs) text += ` in ${formatTime(bestMs)}`;
  if (rank) text += ` — ranked #${rank} on the global leaderboard`;
  text += `! I bet you can't beat me!`;

  try {
    // Native Android/iOS share sheet via Capacitor
    await Share.share({
      title: 'Starship Lander',
      text,
      url: GAME_URL,
      dialogTitle: 'Share with friends',
    });
  } catch {
    // Fallback: Web Share API (some browsers)
    if (navigator.share) {
      navigator.share({ title: 'Starship Lander', text, url: GAME_URL }).catch(() => {});
    } else {
      // Last resort: copy to clipboard + toast
      navigator.clipboard?.writeText(`${text}\n${GAME_URL}`).catch(() => {});
      showToast('Link copied!');
    }
  }
}

function showToast(msg) {
  const t = document.createElement('div');
  t.textContent = msg;
  t.style.cssText = 'position:fixed;bottom:80px;left:50%;transform:translateX(-50%);background:rgba(0,0,0,0.75);color:#fff;padding:10px 20px;border-radius:20px;font-family:Trebuchet MS,sans-serif;font-size:0.9em;z-index:99;pointer-events:none';
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 2500);
}

// --- Scoreboard helpers ---
function formatTime(ms) {
  const totalSecs = ms / 1000;
  const m = Math.floor(totalSecs / 60);
  const s = (totalSecs % 60).toFixed(2).padStart(5, '0');
  return `${m}:${s}`;
}

function showScoreboard(scores, myTime, isWorldRecord) {
  // Store rank for share button
  const rankIdx = scores.findIndex(s => Math.round(s.time) === Math.round(myTime));
  window._shareRank = rankIdx >= 0 ? rankIdx + 1 : null;

  const body = document.getElementById('scoreboard-body');
  const status = document.getElementById('scoreboard-status');
  const wrBanner = document.getElementById('wr-banner');
  wrBanner.style.display = isWorldRecord ? 'block' : 'none';
  body.innerHTML = '';
  if (scores.length === 0) {
    status.textContent = 'No scores yet — Firebase not configured or you\'re the first!';
  } else {
    status.textContent = '';
    scores.forEach((entry, i) => {
      const tr = document.createElement('tr');
      if (Math.round(entry.time) === Math.round(myTime)) tr.classList.add('highlight');
      tr.innerHTML = `<td>${i + 1}</td><td>${entry.name}</td><td>${formatTime(entry.time)}</td><td>${entry.flights ?? 1}</td>`;
      body.appendChild(tr);
    });
  }
  document.getElementById('overlay-scoreboard').style.display = 'flex';
}

function hideScoreboard() {
  document.getElementById('overlay-scoreboard').style.display = 'none';
}

// --- Name entry setup ---
window.addEventListener('load', () => {
  const nameOverlay = document.getElementById('overlay-name');
  const nameInput = document.getElementById('player-name-input');
  const playBtn = document.getElementById('play-btn');
  const closeBtn = document.getElementById('close-scoreboard-btn');

  function confirmName() {
    const name = nameInput.value.trim() || 'Pilot';
    localStorage.setItem('starshipPlayerName', name);
    nameOverlay.style.display = 'none';
  }

  playBtn.addEventListener('click', confirmName);
  nameInput.addEventListener('keydown', (e) => { if (e.code === 'Enter') confirmName(); });

  // Play Again wired up in the game load listener below

  const saved = localStorage.getItem('starshipPlayerName');
  if (saved) {
    nameOverlay.style.display = 'none';
  } else {
    nameInput.focus();
  }
});

// --- Burger / pause menu setup ---
window.addEventListener('load', () => {
  const pauseOverlay = document.getElementById('overlay-pause');
  const burgerBtn = document.getElementById('burger-btn');
  const resumeBtn = document.getElementById('pause-resume-btn');
  const restartBtn = document.getElementById('pause-restart-btn');
  const usernameBtn = document.getElementById('pause-username-btn');

  async function openPauseMenu() {
    const status = document.getElementById('pause-scoreboard-status');
    const body = document.getElementById('pause-scoreboard-body');
    status.textContent = 'Loading scores…';
    body.innerHTML = '';
    pauseOverlay.style.display = 'flex';
    const scores = await getTopScores(10);
    const playerName = localStorage.getItem('starshipPlayerName') || '';
    if (scores.length === 0) {
      status.textContent = 'No scores yet — be the first!';
    } else {
      status.textContent = '';
      scores.forEach((entry, i) => {
        const tr = document.createElement('tr');
        if (entry.name === playerName) {
          tr.classList.add('highlight');
          window._shareRank = i + 1; // store rank for share button
        }
        tr.innerHTML = `<td>${i + 1}</td><td>${entry.name}</td><td>${formatTime(entry.time)}</td><td>${entry.flights ?? 1}</td>`;
        body.appendChild(tr);
      });
    }
  }

  function togglePauseMenu() {
    if (pauseOverlay.style.display === 'none' || pauseOverlay.style.display === '') {
      openPauseMenu();
    } else {
      pauseOverlay.style.display = 'none';
    }
  }
  burgerBtn.addEventListener('click', togglePauseMenu);
  burgerBtn.addEventListener('touchend', (e) => {
    e.stopPropagation();
    e.preventDefault();
    togglePauseMenu();
  });

  resumeBtn.addEventListener('click', () => {
    pauseOverlay.style.display = 'none';
  });

  // restart wired after game is created — see below
  window._pauseRestartBtn = restartBtn;
  window._openPauseMenu = openPauseMenu;

  usernameBtn.addEventListener('click', () => {
    pauseOverlay.style.display = 'none';
    const nameInput = document.getElementById('player-name-input');
    nameInput.value = localStorage.getItem('starshipPlayerName') || '';
    document.getElementById('overlay-name').style.display = 'flex';
    nameInput.focus();
  });

});

// start game on load
window.addEventListener('load', () => {
  // fit the canvas to the window
  function fillScreen() {
    dpr = window.devicePixelRatio || 1;
    canvas.width = window.innerWidth * dpr;
    canvas.height = window.innerHeight * dpr;
    canvas.style.width = window.innerWidth + 'px';
    canvas.style.height = window.innerHeight + 'px';
  }
  // apply
  fillScreen();
  // re-apply every time the window is resized
  window.addEventListener('resize', fillScreen);

  // add the canvas to the DOM
  document.body.append(canvas);

  const game = new Game();

  // Play Again button
  document.getElementById('close-scoreboard-btn').addEventListener('click', () => {
    hideScoreboard();
    previousFrame = 0;
    game.reset();
  });

  // Share buttons
  document.getElementById('scoreboard-share-btn').addEventListener('click', shareGame);
  document.getElementById('pause-share-btn').addEventListener('click', shareGame);

  // Burger menu restart button
  if (window._pauseRestartBtn) {
    window._pauseRestartBtn.addEventListener('click', () => {
      document.getElementById('overlay-pause').style.display = 'none';
      game.reset();
    });
  }
  // performance control/measurement
  const MAX_FRAME = 100; // ensures that physics don't break on slow devices or when tabs are switched
  // game loop (an Immediately Invoked Function Expression that returns a function inside the `requestAnimationFrame`)
  window.requestAnimationFrame((function main(currentFrame) {
    if (appActive) {
      if (!overlayVisible()) {
        // update (pass in `deltaTime`: the time in seconds since the last frame, restricted by an upper bound of 100ms)
        game.Update(Math.min(currentFrame - previousFrame, MAX_FRAME) / 1000);
      }
      // render
      game.Render();
      // always advance previousFrame so deltaTime doesn't spike after resuming from pause
      previousFrame = currentFrame;
    }
    // indirect recursion
    window.requestAnimationFrame(main);
  }));
});

// Ensure the joystick is positioned correctly on window resize
window.addEventListener('resize', () => {
  fillScreen();
  setJoystickPosition();
});
