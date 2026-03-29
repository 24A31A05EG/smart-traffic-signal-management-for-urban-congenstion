/**
 * SmartFlow – script.js
 * Smart Traffic Signal Management System
 * ----------------------------------------
 * Architecture:
 *  - TrafficState   : holds all densities, signal states, cycle data
 *  - SignalEngine   : adaptive algorithm & timer loop
 *  - SimRenderer    : junction visuals & car animations
 *  - ChartManager   : Chart.js graphs
 *  - UIController  : DOM bindings, toasts, logs
 */

/* =====================================================
   1. GLOBAL STATE
===================================================== */
const TrafficState = {
  densities: { N: 50, S: 30, E: 70, W: 20 },
  signals:   { N: 'red', S: 'red', E: 'red', W: 'red' },
  isRunning:   false,
  isManual:    false,
  isEmergency: false,
  cycleCount:  0,
  currentGreen: null,
  timerValue:   0,
  greenTimes:  { N: 0, S: 0, E: 0, W: 0 }, // cumulative green seconds per dir
  densityHistory: { N: [], S: [], E: [], W: [] },
  historyTimestamps: [],
  emergencyEvents: [],
};

/* =====================================================
   2. CONSTANTS / CONFIG
===================================================== */
const DIRS = ['N', 'S', 'E', 'W'];
const DIR_NAMES = { N: 'NORTH', S: 'SOUTH', E: 'EAST', W: 'WEST' };
const MIN_GREEN  = 5;   // minimum green time (seconds)
const MAX_GREEN  = 25;  // maximum green time (seconds)
const YELLOW_DUR = 2;   // yellow phase duration (seconds)
const EMERGENCY_DUR = 15; // emergency green duration
const HISTORY_MAX = 30;   // max history points on chart

/* =====================================================
   3. UTILITY HELPERS
===================================================== */
/** Clamp a value between min and max */
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

/** Return congestion label for a density value */
function congestionLabel(density) {
  if (density < 35)  return 'LOW';
  if (density < 65)  return 'MEDIUM';
  return 'HIGH';
}

/** Compute proportional green time based on density (MIN_GREEN–MAX_GREEN range) */
function calcGreenTime(density) {
  return Math.round(MIN_GREEN + (density / 100) * (MAX_GREEN - MIN_GREEN));
}

/** Sort directions by density descending → returns array like ['E','N','S','W'] */
function rankByDensity() {
  return [...DIRS].sort((a, b) => TrafficState.densities[b] - TrafficState.densities[a]);
}

/* =====================================================
   4. LOG + TOAST
===================================================== */
function log(msg, type = 'info') {
  const el = document.getElementById('eventLog');
  const ts = new Date().toLocaleTimeString();
  const row = document.createElement('div');
  row.className = `el-row el-${type}`;
  row.textContent = `[${ts}] ${msg}`;
  el.appendChild(row);
  el.scrollTop = el.scrollHeight;
}

let toastTimer;
function showToast(msg, type = '') {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = 'toast show' + (type ? ` ${type}` : '');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 3000);
}

/* =====================================================
   5. SIGNAL RENDERER – update traffic lights in DOM
===================================================== */
/**
 * Set a direction's traffic light to a given phase.
 * @param {string} dir  - 'N'|'S'|'E'|'W'
 * @param {string} phase - 'red'|'yellow'|'green'
 */
function setSignal(dir, phase) {
  TrafficState.signals[dir] = phase;

  // Update bulb glow on junction lights
  ['red', 'yellow', 'green'].forEach(color => {
    const bulb = document.getElementById(`tl${dir}-${color[0]}`);
    if (bulb) {
      if (color === phase) bulb.classList.add('active');
      else bulb.classList.remove('active');
    }
  });

  // Update status list row
  const stateEl   = document.getElementById(`ss${dir}`);
  const dotEl     = document.getElementById(`ssDot${dir}`);
  const rowEl     = document.getElementById(`ss-${dir}`);
  if (stateEl) stateEl.textContent = phase.toUpperCase();
  if (dotEl)   dotEl.className = `ss-dot ss-dot-${phase}`;
  if (rowEl)   rowEl.classList.toggle('green-active', phase === 'green');

  // Update active direction display
  if (phase === 'green') {
    document.getElementById('activeDir').textContent = DIR_NAMES[dir];
    TrafficState.currentGreen = dir;
  }

  // Update nav status
  updateNavStatus();
}

function updateNavStatus() {
  const dot   = document.getElementById('systemStatusDot');
  const label = document.getElementById('systemStatusLabel');
  if (TrafficState.isEmergency) {
    dot.className = 'status-dot emergency';
    label.textContent = '🚨 EMERGENCY MODE';
  } else if (TrafficState.isRunning) {
    dot.className = 'status-dot active';
    label.textContent = 'SYSTEM RUNNING';
  } else {
    dot.className = 'status-dot';
    label.textContent = 'SYSTEM IDLE';
  }
}

/* Set all directions to red */
function allRed() {
  DIRS.forEach(d => setSignal(d, 'red'));
  document.getElementById('activeDir').textContent = '—';
  TrafficState.currentGreen = null;
}

/* =====================================================
   6. TIMER DISPLAY – countdown per light
===================================================== */
function setTimers(greenDir, seconds) {
  DIRS.forEach(d => {
    const el = document.getElementById(`timer${d}`);
    if (!el) return;
    el.textContent = d === greenDir ? seconds + 's' : '--';
  });
  // Big timer on smart section
  const big = document.getElementById('bigTimer');
  if (big) big.textContent = String(seconds).padStart(2, '0');
}

/* =====================================================
   7. SIGNAL ENGINE – the core adaptive algorithm
===================================================== */
let engineTimer = null;   // setInterval handle
let phaseTimer  = null;   // countdown handle

/**
 * Main cycle:
 * 1. Rank directions by density
 * 2. For the highest-density dir: assign greenTime proportional to density
 * 3. Run green phase → yellow phase → move to next direction
 * The cycle rotates through ALL directions but allocates more time to busier ones.
 */
let phaseQueue = [];       // ordered queue of [dir, greenTime]
let phaseIndex = 0;

function buildPhaseQueue() {
  const ranked = rankByDensity();
  phaseQueue = ranked.map(dir => ({
    dir,
    greenTime: calcGreenTime(TrafficState.densities[dir]),
  }));
  // Update rank display
  updateRankDisplay(ranked);
  // Set next green label
  document.getElementById('nextGreenDir').textContent = DIR_NAMES[phaseQueue[0]?.dir] || '—';
}

function updateRankDisplay(ranked) {
  ranked.forEach((dir, i) => {
    const row = document.getElementById(`rl${dir}`);
    if (!row) return;
    row.querySelector('.rl-rank').textContent = `#${i + 1}`;
    const pct = TrafficState.densities[dir];
    document.getElementById(`rlBar${dir}`).style.width = pct + '%';
    document.getElementById(`rlPct${dir}`).textContent = pct + '%';
  });
}

function runNextPhase() {
  if (!TrafficState.isRunning || TrafficState.isEmergency || TrafficState.isManual) return;

  if (phaseIndex >= phaseQueue.length) {
    // Completed one full cycle – rebuild queue with updated densities
    phaseIndex = 0;
    TrafficState.cycleCount++;
    document.getElementById('cycleCount').textContent = TrafficState.cycleCount;
    buildPhaseQueue();
    recordHistory();
    ChartManager.updateDensityChart();
    ChartManager.updateCycleChart();
  }

  const { dir, greenTime } = phaseQueue[phaseIndex];
  phaseIndex++;

  // Update cycle info panel
  document.getElementById('cyclePhase').textContent = `GREEN ${dir}`;
  document.getElementById('greenTime').textContent = `${greenTime}s`;

  // Next dir in queue (for preview)
  const nextItem = phaseQueue[phaseIndex] || phaseQueue[0];
  document.getElementById('nextGreenDir').textContent = DIR_NAMES[nextItem?.dir] || '—';

  // Set all red, then light up green
  allRed();
  setSignal(dir, 'green');
  setTimers(dir, greenTime);
  highlightAlgoStep(4);
  log(`GREEN → ${DIR_NAMES[dir]} for ${greenTime}s (density ${TrafficState.densities[dir]}%)`, 'green');

  // Update cumulative green time tracking
  TrafficState.greenTimes[dir] += greenTime;

  // Countdown
  let remaining = greenTime;
  clearInterval(phaseTimer);
  phaseTimer = setInterval(() => {
    remaining--;
    setTimers(dir, remaining);

    if (remaining <= 0) {
      clearInterval(phaseTimer);
      // Yellow phase
      setSignal(dir, 'yellow');
      document.getElementById('cyclePhase').textContent = `YELLOW ${dir}`;
      log(`YELLOW → ${DIR_NAMES[dir]}`, 'amber');
      let yel = YELLOW_DUR;
      const yt = setInterval(() => {
        yel--;
        setTimers(dir, yel);
        if (yel <= 0) {
          clearInterval(yt);
          runNextPhase(); // recurse to next direction
        }
      }, 1000);
    }
  }, 1000);
}

function startSmartSystem() {
  if (TrafficState.isRunning) return;
  TrafficState.isRunning  = true;
  TrafficState.isManual   = false;
  TrafficState.cycleCount = 0;
  phaseIndex = 0;

  document.getElementById('btnStart').classList.add('hidden');
  document.getElementById('btnStop').classList.remove('hidden');
  document.getElementById('moResume').classList.add('hidden');

  updateNavStatus();
  buildPhaseQueue();
  log('Smart system STARTED. Adaptive control active.', 'green');
  showToast('Smart Signal System activated!');
  highlightAlgoStep(1);
  runNextPhase();
  SimRenderer.startCars();
}

function stopSmartSystem() {
  TrafficState.isRunning  = false;
  TrafficState.isManual   = false;
  TrafficState.isEmergency = false;
  clearInterval(phaseTimer);
  allRed();
  setTimers(null, 0);
  document.getElementById('bigTimer').textContent = '00';
  document.getElementById('activeDir').textContent = '—';
  document.getElementById('cyclePhase').textContent = 'IDLE';
  document.getElementById('nextGreenDir').textContent = '—';

  document.getElementById('btnStart').classList.remove('hidden');
  document.getElementById('btnStop').classList.add('hidden');
  document.getElementById('moResume').classList.add('hidden');

  updateNavStatus();
  log('System STOPPED by user.', 'info');
  showToast('System stopped.');
  SimRenderer.stopCars();
}

/* =====================================================
   8. MANUAL OVERRIDE
===================================================== */
function manualGreen(dir) {
  if (!TrafficState.isRunning) {
    showToast('Start the system first!');
    return;
  }
  TrafficState.isManual = true;
  clearInterval(phaseTimer);
  allRed();
  setSignal(dir, 'green');
  setTimers(dir, 99);
  document.getElementById('cyclePhase').textContent = `MANUAL ${dir}`;
  document.getElementById('moResume').classList.remove('hidden');
  log(`MANUAL OVERRIDE: GREEN forced on ${DIR_NAMES[dir]}`, 'amber');
  showToast(`Manual: ${DIR_NAMES[dir]} is GREEN`);
}

function resumeAuto() {
  TrafficState.isManual = false;
  phaseIndex = 0;
  document.getElementById('moResume').classList.add('hidden');
  log('Resuming auto adaptive control.', 'green');
  showToast('Resuming AUTO mode');
  runNextPhase();
}

/* =====================================================
   9. EMERGENCY VEHICLE
===================================================== */
function emergencyVehicle(dir) {
  if (!TrafficState.isRunning) {
    showToast('Start the system first!');
    return;
  }
  TrafficState.isEmergency = true;
  clearInterval(phaseTimer);
  allRed();
  setSignal(dir, 'green');
  setTimers(dir, EMERGENCY_DUR);
  updateNavStatus();
  log(`🚨 EMERGENCY: Clearing path for ${DIR_NAMES[dir]}! (${EMERGENCY_DUR}s)`, 'em');
  showToast(`🚨 Emergency vehicle: ${DIR_NAMES[dir]} cleared!`, 'emergency');

  // Record emergency event
  const ts = new Date().toLocaleTimeString();
  TrafficState.emergencyEvents.push({ dir, ts });
  UIController.updateEmergencyLog();

  let rem = EMERGENCY_DUR;
  const et = setInterval(() => {
    rem--;
    setTimers(dir, rem);
    if (rem <= 0) {
      clearInterval(et);
      TrafficState.isEmergency = false;
      log('Emergency cleared. Resuming normal operation.', 'green');
      showToast('Emergency over – normal control resumed');
      phaseIndex = 0;
      buildPhaseQueue();
      runNextPhase();
    }
  }, 1000);
}

/* =====================================================
   10. DENSITY SLIDERS → live update
===================================================== */
document.querySelectorAll('.density-slider').forEach(slider => {
  slider.addEventListener('input', () => {
    const dir = slider.dataset.dir;
    const val = parseInt(slider.value);
    TrafficState.densities[dir] = val;

    // Update display
    document.getElementById(`val${dir}`).textContent = val;
    document.getElementById(`db${dir}`).style.width = val + '%';

    // Congestion indicator
    const level   = congestionLabel(val);
    const congEl  = document.getElementById(`cong${dir}`);
    const lvlEl   = congEl.querySelector('.cong-level');
    lvlEl.textContent = level;
    congEl.className = `cong-item ${level.toLowerCase()}`;

    // Dashboard KPI update
    UIController.updateKPIs();

    // Rebuild queue immediately if running
    if (TrafficState.isRunning && !TrafficState.isManual && !TrafficState.isEmergency) {
      buildPhaseQueue();
    }

    highlightAlgoStep(2);
  });
});

/* Initialise slider fill widths and congestion classes */
function initSliders() {
  DIRS.forEach(dir => {
    const val = TrafficState.densities[dir];
    document.getElementById(`slider${dir}`).value = val;
    document.getElementById(`val${dir}`).textContent = val;
    document.getElementById(`db${dir}`).style.width = val + '%';
    const level = congestionLabel(val);
    const congEl = document.getElementById(`cong${dir}`);
    congEl.querySelector('.cong-level').textContent = level;
    congEl.className = `cong-item ${level.toLowerCase()}`;
  });
}

/* =====================================================
   11. ALGORITHM STEP HIGHLIGHTER
===================================================== */
let stepTimer;
function highlightAlgoStep(step) {
  clearTimeout(stepTimer);
  for (let i = 1; i <= 5; i++) {
    document.getElementById(`afs${i}`)?.classList.remove('active');
  }
  document.getElementById(`afs${step}`)?.classList.add('active');
  if (step < 5) {
    stepTimer = setTimeout(() => highlightAlgoStep(step + 1), 600);
  }
}

/* =====================================================
   12. DENSITY HISTORY RECORDER
===================================================== */
function recordHistory() {
  const ts = new Date().toLocaleTimeString();
  TrafficState.historyTimestamps.push(ts);
  DIRS.forEach(d => TrafficState.densityHistory[d].push(TrafficState.densities[d]));

  // Trim to last HISTORY_MAX points
  if (TrafficState.historyTimestamps.length > HISTORY_MAX) {
    TrafficState.historyTimestamps.shift();
    DIRS.forEach(d => TrafficState.densityHistory[d].shift());
  }
}

/* =====================================================
   13. CAR SIMULATION
===================================================== */
const SimRenderer = (() => {
  let carInterval = null;
  let carId = 0;

  // Car colours per direction
  const CAR_COLORS = {
    N: '#00e5ff', S: '#dd44ff', E: '#00ffaa', W: '#ffc107',
  };

  /**
   * Spawn a car moving through the junction.
   * Cars come from the approach of each direction.
   * If that direction has a red light they queue; green means they flow.
   */
  function spawnCar(dir) {
    const layer = document.getElementById('carsLayer');
    if (!layer) return;

    const id   = `car-${carId++}`;
    const car  = document.createElement('div');
    car.id     = id;
    car.className = 'car';
    car.style.background = CAR_COLORS[dir];
    car.style.boxShadow  = `0 0 6px ${CAR_COLORS[dir]}`;

    // Determine starting position and movement based on direction
    // The junction is 520×520 with center at 260,260
    const isGreen = TrafficState.signals[dir] === 'green';

    if (dir === 'N') {
      car.style.left = `${235 + Math.random() * 20}px`;
      car.style.top  = '0px';
      car.style.width = '10px'; car.style.height = '18px';
      animateCar(car, dir, isGreen, {
        startY: -18, endY: isGreen ? 540 : 145,
        axis: 'top', startX: 235 + Math.random() * 20,
      });
    } else if (dir === 'S') {
      car.style.left  = `${265 + Math.random() * 20}px`;
      car.style.bottom = '0px'; car.style.top = 'unset';
      car.style.width = '10px'; car.style.height = '18px';
      animateCar(car, dir, isGreen, {
        startY: 540, endY: isGreen ? -18 : 375,
        axis: 'top', startX: 265 + Math.random() * 20, reverse: true,
      });
    } else if (dir === 'E') {
      car.style.top  = `${235 + Math.random() * 20}px`;
      car.style.right = '0'; car.style.left = 'unset';
      car.style.width = '18px'; car.style.height = '10px';
      animateCar(car, dir, isGreen, {
        startX: 540, endX: isGreen ? -18 : 375,
        axis: 'left', startY: 235 + Math.random() * 20, reverse: true,
      });
    } else { // W
      car.style.top  = `${265 + Math.random() * 20}px`;
      car.style.left = '0px';
      car.style.width = '18px'; car.style.height = '10px';
      animateCar(car, dir, isGreen, {
        startX: -18, endX: isGreen ? 540 : 145,
        axis: 'left', startY: 265 + Math.random() * 20,
      });
    }

    layer.appendChild(car);

    // Remove car after animation ends
    car.addEventListener('animationend', () => car.remove());
  }

  function animateCar(car, dir, isGreen, opts) {
    const duration = isGreen ? (1.5 + Math.random()) : 1;
    const endPos   = opts.axis === 'top'  ? opts.endY : opts.endX;
    const startPos = opts.axis === 'top'  ? opts.startY : opts.startX;
    const fixedPos = opts.axis === 'top'  ? opts.startX : opts.startY;

    if (opts.axis === 'top') {
      car.style.top  = startPos + 'px';
      car.style.left = fixedPos + 'px';
    } else {
      car.style.left = startPos + 'px';
      car.style.top  = fixedPos + 'px';
    }

    car.style.animation = 'none';
    // Use CSS transition to move the car
    setTimeout(() => {
      car.style.transition = `${duration}s linear`;
      if (opts.axis === 'top')  car.style.top  = endPos + 'px';
      else                      car.style.left = endPos + 'px';
    }, 50);

    // Remove after transition
    setTimeout(() => car.remove(), (duration + .1) * 1000);
  }

  function startCars() {
    stopCars();
    carInterval = setInterval(() => {
      DIRS.forEach(dir => {
        // Spawn cars proportional to density
        const count = Math.ceil(TrafficState.densities[dir] / 35);
        for (let i = 0; i < count; i++) {
          if (Math.random() < .4) spawnCar(dir);
        }
      });
    }, 800);
  }

  function stopCars() {
    clearInterval(carInterval);
    const layer = document.getElementById('carsLayer');
    if (layer) layer.innerHTML = '';
  }

  return { startCars, stopCars };
})();

/* =====================================================
   14. UI CONTROLLER
===================================================== */
const UIController = {
  updateKPIs() {
    let total = 0;
    DIRS.forEach(dir => {
      const val   = TrafficState.densities[dir];
      const level = congestionLabel(val);
      total += val;

      // KPI cards
      const kpiEl  = document.getElementById(`kpi${dir}`);
      const lvlEl  = document.getElementById(`kpi${dir}Level`);
      if (kpiEl) {
        kpiEl.textContent = val + '%';
        kpiEl.className   = `kpi-value kpi-${level.toLowerCase().replace('medium','med')}`;
      }
      if (lvlEl) lvlEl.textContent = level;
    });

    // Overall congestion
    const avg    = total / 4;
    const ovLevel = congestionLabel(avg);
    const ovEl   = document.getElementById('kpiOverallVal');
    const ovBar  = document.getElementById('kpiOverallBar');
    if (ovEl) {
      ovEl.textContent  = ovLevel;
      ovEl.className    = `kpi-value kpi-${ovLevel.toLowerCase().replace('medium','med')}`;
    }
    if (ovBar) ovBar.style.width = avg + '%';
  },

  updateEmergencyLog() {
    const el = document.getElementById('emLog');
    if (!el) return;
    el.innerHTML = '';
    if (TrafficState.emergencyEvents.length === 0) {
      el.innerHTML = '<div class="em-empty">No emergency events yet.</div>';
      return;
    }
    TrafficState.emergencyEvents.slice(-10).reverse().forEach(ev => {
      const row = document.createElement('div');
      row.className = 'em-log-row';
      row.textContent = `[${ev.ts}] 🚨 Emergency cleared: ${DIR_NAMES[ev.dir]}`;
      el.appendChild(row);
    });
  },
};

/* =====================================================
   15. CHART MANAGER
===================================================== */
const ChartManager = (() => {
  let densityChart = null;
  let cycleChart   = null;

  const CHART_COLORS = {
    N: 'rgba(0,229,255,1)',
    S: 'rgba(221,68,255,1)',
    E: 'rgba(0,255,170,1)',
    W: 'rgba(255,193,7,1)',
  };

  function initDensityChart() {
    const ctx = document.getElementById('densityChart');
    if (!ctx) return;
    densityChart = new Chart(ctx, {
      type: 'line',
      data: {
        labels: ['—'],
        datasets: DIRS.map(dir => ({
          label: DIR_NAMES[dir],
          data: [TrafficState.densities[dir]],
          borderColor: CHART_COLORS[dir],
          backgroundColor: CHART_COLORS[dir].replace(',1)', ',.1)'),
          tension: .4, fill: true, pointRadius: 3,
          borderWidth: 2,
        })),
      },
      options: {
        responsive: true,
        plugins: {
          legend: { labels: { color: '#556070', font: { family: 'JetBrains Mono', size: 11 } } },
        },
        scales: {
          x: { ticks: { color: '#556070', font: { family: 'JetBrains Mono', size: 10 } }, grid: { color: '#1e2d4a' } },
          y: {
            min: 0, max: 100,
            ticks: { color: '#556070', font: { family: 'JetBrains Mono', size: 10 } },
            grid: { color: '#1e2d4a' },
          },
        },
      },
    });
  }

  function initCycleChart() {
    const ctx = document.getElementById('cycleChart');
    if (!ctx) return;
    cycleChart = new Chart(ctx, {
      type: 'doughnut',
      data: {
        labels: DIRS.map(d => DIR_NAMES[d]),
        datasets: [{
          data: DIRS.map(() => 25),
          backgroundColor: DIRS.map(d => CHART_COLORS[d].replace(',1)', ',.8)')),
          borderColor: '#131c2e', borderWidth: 3,
        }],
      },
      options: {
        responsive: true,
        plugins: {
          legend: { labels: { color: '#556070', font: { family: 'JetBrains Mono', size: 11 } } },
        },
      },
    });
  }

  function updateDensityChart() {
    if (!densityChart) return;
    densityChart.data.labels = [...TrafficState.historyTimestamps];
    DIRS.forEach((dir, i) => {
      densityChart.data.datasets[i].data = [...TrafficState.densityHistory[dir]];
    });
    densityChart.update();
  }

  function updateCycleChart() {
    if (!cycleChart) return;
    const total = DIRS.reduce((s, d) => s + TrafficState.greenTimes[d], 0) || 1;
    cycleChart.data.datasets[0].data = DIRS.map(d => Math.round((TrafficState.greenTimes[d] / total) * 100));
    cycleChart.update();
  }

  return { initDensityChart, initCycleChart, updateDensityChart, updateCycleChart };
})();

/* =====================================================
   16. NAV LINK ACTIVE ON SCROLL
===================================================== */
function initScrollSpy() {
  const sections = document.querySelectorAll('.section');
  const navLinks = document.querySelectorAll('.nav-link');

  const observer = new IntersectionObserver(entries => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        const id = entry.target.id;
        navLinks.forEach(l => {
          l.classList.toggle('active', l.getAttribute('href') === `#${id}`);
        });
      }
    });
  }, { threshold: .4 });

  sections.forEach(s => observer.observe(s));
}

/* =====================================================
   17. HERO STAT COUNT-UP ANIMATION
===================================================== */
function initCountUp() {
  document.querySelectorAll('.stat-val').forEach(el => {
    const target = parseInt(el.dataset.target);
    let current  = 0;
    const step   = Math.ceil(target / 40);
    const timer  = setInterval(() => {
      current = Math.min(current + step, target);
      el.textContent = current;
      if (current >= target) clearInterval(timer);
    }, 30);
  });
}

/* =====================================================
   18. RANDOM DENSITY DRIFT (optional demo mode)
   Gently randomises densities when NOT running to show live chart
===================================================== */
setInterval(() => {
  if (!TrafficState.isRunning) {
    DIRS.forEach(dir => {
      const slider = document.getElementById(`slider${dir}`);
      if (!slider) return;
      // Small random walk ±3
      let val = TrafficState.densities[dir] + (Math.random() * 6 - 3);
      val = Math.round(clamp(val, 5, 95));
      slider.value = val;
      slider.dispatchEvent(new Event('input'));
    });
  }
}, 3000);

/* =====================================================
   19. INIT
===================================================== */
window.addEventListener('DOMContentLoaded', () => {
  // Initial slider states
  initSliders();
  UIController.updateKPIs();

  // Charts
  ChartManager.initDensityChart();
  ChartManager.initCycleChart();

  // Seed initial history point
  recordHistory();

  // Scroll spy
  initScrollSpy();

  // Hero count-up
  initCountUp();

  log('SmartFlow system initialised. All sensors nominal.', 'green');

  // Periodically update density chart even when idle
  setInterval(() => {
    if (!TrafficState.isRunning) {
      recordHistory();
      ChartManager.updateDensityChart();
    }
  }, 5000);
});
